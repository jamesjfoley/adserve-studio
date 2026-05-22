import { NextRequest, NextResponse } from "next/server";
import {
  db,
  tenantMemberships,
  users,
  roles,
} from "@adserve/database";
import { and, eq } from "drizzle-orm";
import { apiRequireTenantAdmin } from "@/lib/tenant-admin";

type Params = { params: Promise<{ id: string }> };

const ALLOWED_STATUSES = ["active", "suspended"] as const;
type Status = (typeof ALLOWED_STATUSES)[number];

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await apiRequireTenantAdmin();
  if (guard.error) return guard.error;
  const { tenant, user: actor, role: actorRole } = guard.ctx;

  const { id: targetUserId } = await params;

  // Self-edit guard: actor cannot change their own role or status.
  if (targetUserId === actor.id) {
    return NextResponse.json(
      { error: "You cannot edit your own role or status." },
      { status: 403 }
    );
  }

  // Look up target user + membership in this tenant.
  const [target] = await db
    .select({
      userId: users.id,
      isSuperAdmin: users.isSuperAdmin,
      membershipId: tenantMemberships.id,
      currentRoleId: tenantMemberships.roleId,
      currentRoleSlug: roles.slug,
    })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
    .where(
      and(
        eq(tenantMemberships.tenantId, tenant.id),
        eq(tenantMemberships.userId, targetUserId)
      )
    );

  if (!target) {
    return NextResponse.json(
      { error: "User not found in this tenant." },
      { status: 404 }
    );
  }

  // Role separation: super admins cannot be touched via tenant admin APIs.
  if (target.isSuperAdmin) {
    return NextResponse.json(
      { error: "This user cannot be edited through tenant administration." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { roleId, status } = (body ?? {}) as {
    roleId?: unknown;
    status?: unknown;
  };

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  // ---- Status update ----
  if (status !== undefined) {
    if (
      typeof status !== "string" ||
      !ALLOWED_STATUSES.includes(status as Status)
    ) {
      return NextResponse.json(
        {
          error: `Field 'status' must be one of: ${ALLOWED_STATUSES.join(", ")}`,
        },
        { status: 400 }
      );
    }
    updates.status = status;
  }

  // ---- Role update ----
  if (roleId !== undefined) {
    if (typeof roleId !== "string") {
      return NextResponse.json(
        { error: "Field 'roleId' must be a string" },
        { status: 400 }
      );
    }

    // Target role must exist within this tenant.
    const [newRole] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenant.id)));
    if (!newRole) {
      return NextResponse.json(
        { error: "Role not found in this tenant." },
        { status: 400 }
      );
    }

    // Owner-role guard: only Owners may assign or remove the Owner role.
    const touchesOwner =
      newRole.slug === "owner" || target.currentRoleSlug === "owner";
    if (touchesOwner && actorRole.slug !== "owner") {
      return NextResponse.json(
        {
          error:
            "Only an Owner can assign or remove the Owner role.",
        },
        { status: 403 }
      );
    }

    updates.roleId = newRole.id;
  }

  if (Object.keys(updates).length === 1) {
    return NextResponse.json(
      { error: "No updatable fields provided" },
      { status: 400 }
    );
  }

  const [updated] = await db
    .update(tenantMemberships)
    .set(updates)
    .where(eq(tenantMemberships.id, target.membershipId))
    .returning();

  return NextResponse.json({ membership: updated });
}
