import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import {
  db,
  tenantInvitations,
  roles,
} from "@adserve/database";
import { and, eq } from "drizzle-orm";
import { apiRequireTenantAdmin } from "@/lib/tenant-admin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const guard = await apiRequireTenantAdmin();
  if (guard.error) return guard.error;
  const { tenant, user: actor, role: actorRole } = guard.ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { email, roleId } = (body ?? {}) as {
    email?: unknown;
    roleId?: unknown;
  };

  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Field 'email' must be a valid email address." },
      { status: 400 }
    );
  }
  if (typeof roleId !== "string") {
    return NextResponse.json(
      { error: "Field 'roleId' must be a string." },
      { status: 400 }
    );
  }

  const [targetRole] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenant.id)));
  if (!targetRole) {
    return NextResponse.json(
      { error: "Role not found in this tenant." },
      { status: 400 }
    );
  }

  // Owner-role guard
  if (targetRole.slug === "owner" && actorRole.slug !== "owner") {
    return NextResponse.json(
      { error: "Only an Owner can invite a new Owner." },
      { status: 403 }
    );
  }

  const clerkOrgId = (tenant.settings as { clerkOrgId?: string }).clerkOrgId;
  if (!clerkOrgId) {
    return NextResponse.json(
      { error: "Tenant is not linked to a Clerk organisation." },
      { status: 500 }
    );
  }

  // Call Clerk to create the org invitation. Use org:member uniformly —
  // our internal RBAC is the authority on what the user can do.
  let clerkInvitationId: string | null = null;
  let clerkError: string | null = null;
  try {
    const client = await clerkClient();
    const inv = await client.organizations.createOrganizationInvitation({
      organizationId: clerkOrgId,
      inviterUserId: actor.authProviderId ?? undefined,
      emailAddress: email,
      role: "org:member",
    });
    clerkInvitationId = inv.id;
  } catch (err) {
    clerkError =
      err instanceof Error ? err.message : "Failed to create Clerk invitation.";
  }

  if (clerkError) {
    return NextResponse.json({ error: clerkError }, { status: 502 });
  }

  // Store the DB record. The unique-pending index prevents duplicate
  // pending invitations for the same (tenant, email).
  try {
    const [invitation] = await db
      .insert(tenantInvitations)
      .values({
        tenantId: tenant.id,
        email,
        roleId: targetRole.id,
        invitedBy: actor.id,
        clerkInvitationId,
        status: "pending",
      })
      .returning();
    return NextResponse.json({ invitation });
  } catch (err) {
    // Likely the unique-pending index fired
    return NextResponse.json(
      {
        error:
          err instanceof Error && /unique/i.test(err.message)
            ? "A pending invitation already exists for this email."
            : "Failed to record invitation.",
      },
      { status: 409 }
    );
  }
}
