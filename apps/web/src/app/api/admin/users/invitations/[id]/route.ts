import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { db, tenantInvitations } from "@adserve/database";
import { and, eq } from "drizzle-orm";
import { apiRequireTenantAdmin } from "@/lib/tenant-admin";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await apiRequireTenantAdmin();
  if (guard.error) return guard.error;
  const { tenant } = guard.ctx;

  const { id } = await params;

  const [invitation] = await db
    .select()
    .from(tenantInvitations)
    .where(
      and(
        eq(tenantInvitations.id, id),
        eq(tenantInvitations.tenantId, tenant.id)
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

  const [updated] = await db
    .update(tenantInvitations)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(eq(tenantInvitations.id, id))
    .returning();

  return NextResponse.json({
    invitation: updated,
    ...(clerkError ? { clerkWarning: clerkError } : {}),
  });
}
