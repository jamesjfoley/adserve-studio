import { NextRequest, NextResponse } from "next/server";
import {
  tenantMemberships,
  users,
  roles,
  withTenant,
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

  // Status / roleId shape validation (cheap, tx-independent).
  if (
    status !== undefined &&
    (typeof status !== "string" ||
      !ALLOWED_STATUSES.includes(status as Status))
  ) {
    return NextResponse.json(
      {
        error: `Field 'status' must be one of: ${ALLOWED_STATUSES.join(", ")}`,
      },
      { status: 400 }
    );
  }
  if (roleId !== undefined && typeof roleId !== "string") {
    return NextResponse.json(
      { error: "Field 'roleId' must be a string" },
      { status: 400 }
    );
  }

  type PatchOutcome =
    | { kind: "ok"; membership: typeof tenantMemberships.$inferSelect }
    | { kind: "error"; status: number; message: string };

  const outcome: PatchOutcome = await withTenant(tenant.id, async (tx) => {
    // Look up target user + membership in this tenant.
    const [target] = await tx
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
      return {
        kind: "error",
        status: 404,
        message: "User not found in this tenant.",
      };
    }

    // Role separation: super admins cannot be touched via tenant admin APIs.
    if (target.isSuperAdmin) {
      return {
        kind: "error",
        status: 403,
        message: "This user cannot be edited through tenant administration.",
      };
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (status !== undefined) {
      updates.status = status;
    }

    if (roleId !== undefined) {
      // Target role must exist within this tenant.
      const [newRole] = await tx
        .select()
        .from(roles)
        .where(
          and(eq(roles.id, roleId as string), eq(roles.tenantId, tenant.id))
        );
      if (!newRole) {
        return {
          kind: "error",
          status: 400,
          message: "Role not found in this tenant.",
        };
      }

      // Owner-role guard: only Owners may assign or remove the Owner role.
      const touchesOwner =
        newRole.slug === "owner" || target.currentRoleSlug === "owner";
      if (touchesOwner && actorRole.slug !== "owner") {
        return {
          kind: "error",
          status: 403,
          message: "Only an Owner can assign or remove the Owner role.",
        };
      }

      updates.roleId = newRole.id;
    }

    if (Object.keys(updates).length === 1) {
      return {
        kind: "error",
        status: 400,
        message: "No updatable fields provided",
      };
    }

    const [row] = await tx
      .update(tenantMemberships)
      .set(updates)
      .where(eq(tenantMemberships.id, target.membershipId))
      .returning();

    return { kind: "ok", membership: row };
  });

  if (outcome.kind === "error") {
    return NextResponse.json(
      { error: outcome.message },
      { status: outcome.status }
    );
  }

  return NextResponse.json({ membership: outcome.membership });
}
