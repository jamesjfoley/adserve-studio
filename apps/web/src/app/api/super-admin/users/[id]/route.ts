import { NextRequest, NextResponse } from "next/server";
import {
  db,
  users,
  tenantMemberships,
  tenants,
  roles,
} from "@adserve/database";
import { eq } from "drizzle-orm";
import { apiRequireSuperAdmin } from "@/lib/super-admin";

type Params = { params: Promise<{ id: string }> };

const ALLOWED_STATUSES = ["active", "invited", "disabled"] as const;
type UserStatus = (typeof ALLOWED_STATUSES)[number];

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await apiRequireSuperAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;

  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const memberships = await db
    .select({
      membershipId: tenantMemberships.id,
      tenantId: tenants.id,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      roleSlug: roles.slug,
      roleName: roles.name,
      membershipStatus: tenantMemberships.status,
      joinedAt: tenantMemberships.joinedAt,
    })
    .from(tenantMemberships)
    .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
    .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
    .where(eq(tenantMemberships.userId, id));

  return NextResponse.json({ user, memberships });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await apiRequireSuperAdmin();
  if (auth.error) return auth.error;

  const { id } = await params;
  const self = auth.user;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { status, isSuperAdmin } = (body ?? {}) as {
    status?: unknown;
    isSuperAdmin?: unknown;
  };

  // Role separation: super admin status is not editable via this endpoint.
  // Super admin accounts are provisioned separately, not promoted from
  // (or demoted to) tenant users.
  if (isSuperAdmin !== undefined) {
    return NextResponse.json(
      {
        error:
          "Super admin status is not editable. Super admin accounts are provisioned separately.",
      },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (status !== undefined) {
    if (
      typeof status !== "string" ||
      !ALLOWED_STATUSES.includes(status as UserStatus)
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

  if (Object.keys(updates).length === 1) {
    return NextResponse.json(
      { error: "No updatable fields provided" },
      { status: 400 }
    );
  }

  // Self-protection: prevent self-lockout
  if (id === self.id && updates.status === "disabled") {
    return NextResponse.json(
      { error: "You cannot disable your own account" },
      { status: 403 }
    );
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ user: updated });
}
