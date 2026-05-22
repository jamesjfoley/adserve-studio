import { NextRequest, NextResponse } from "next/server";
import {
  db,
  tenantMemberships,
  users,
  roles,
} from "@adserve/database";
import { and, eq, ilike, or, desc } from "drizzle-orm";
import { apiRequireTenantAdmin } from "@/lib/tenant-admin";

const ALLOWED_STATUSES = ["active", "invited", "suspended"] as const;
type Status = (typeof ALLOWED_STATUSES)[number];

export async function GET(req: NextRequest) {
  const guard = await apiRequireTenantAdmin();
  if (guard.error) return guard.error;
  const { tenant } = guard.ctx;

  const params = req.nextUrl.searchParams;
  const q = params.get("q")?.trim();
  const roleSlug = params.get("role")?.trim();
  const status = params.get("status")?.trim() as Status | null;

  const conditions = [
    eq(tenantMemberships.tenantId, tenant.id),
    eq(users.isSuperAdmin, false),
  ];

  if (q && q.length > 0) {
    conditions.push(
      or(ilike(users.email, `%${q}%`), ilike(users.fullName, `%${q}%`))!
    );
  }

  if (roleSlug) {
    conditions.push(eq(roles.slug, roleSlug));
  }

  if (status && ALLOWED_STATUSES.includes(status)) {
    conditions.push(eq(tenantMemberships.status, status));
  }

  const rows = await db
    .select({
      membershipId: tenantMemberships.id,
      userId: users.id,
      fullName: users.fullName,
      email: users.email,
      avatarUrl: users.avatarUrl,
      status: tenantMemberships.status,
      joinedAt: tenantMemberships.joinedAt,
      roleId: roles.id,
      roleSlug: roles.slug,
      roleName: roles.name,
    })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
    .where(and(...conditions))
    .orderBy(desc(tenantMemberships.joinedAt));

  return NextResponse.json({ users: rows });
}
