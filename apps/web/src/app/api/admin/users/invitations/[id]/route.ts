import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { tenantInvitations, withTenant } from "@adserve/database";
import { and, eq } from "drizzle-orm";
import { apiRequireTenantAdmin } from "@/lib/tenant-admin";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await apiRequireTenantAdmin();
  if (guard.error) return guard.error;
  const { tenant } = guard.ctx;

  const { id } = await params;

  // Block 1: look up the invitation (RLS-scoped to this tenant).
  // The Clerk call below depends on this row, so we don't want it inside
  // the same tx — DB locks shouldn't be held across an HTTP roundtrip.
  const [invitation] = await withTenant(tenant.id, (tx) =>
    tx
      .select()
      .from(tenantInvitations)
      .where(
        and(
          eq(tenantInvitations.id, id),
          eq(tenantInvitations.tenantId, tenant.id)
        )
      )
  );

  if (!invitation) {
    return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
  }

  if (invitation.status !== "pending") {
    return NextResponse.json(
      { error: `Cannot revoke a ${invitation.status} invitation.` },
      { status: 400 }
    );
  }

  const clerkOrgId = (tenant.settings as { clerkOrgId?: string }).clerkOrgId;

  // Best-effort: revoke on Clerk first. If Clerk fails (e.g. invitation
  // already accepted server-side), fall through to mark our DB record
  // revoked anyway so the admin isn't stuck.
  let clerkError: string | null = null;
  if (clerkOrgId && invitation.clerkInvitationId) {
    try {
      const client = await clerkClient();
      await client.organizations.revokeOrganizationInvitation({
        organizationId: clerkOrgId,
        invitationId: invitation.clerkInvitationId,
        requestingUserId: guard.ctx.user.authProviderId ?? undefined,
      });
    } catch (err) {
      clerkError = err instanceof Error ? err.message : "Clerk revoke failed.";
    }
  }

  // Block 2: mark the invitation revoked. Separate tx from block 1
  // because of the Clerk call between them.
  const [updated] = await withTenant(tenant.id, (tx) =>
    tx
      .update(tenantInvitations)
      .set({ status: "revoked", updatedAt: new Date() })
      .where(eq(tenantInvitations.id, id))
      .returning()
  );

  return NextResponse.json({
    invitation: updated,
    ...(clerkError ? { clerkWarning: clerkError } : {}),
  });
}
