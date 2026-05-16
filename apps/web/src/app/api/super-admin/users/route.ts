import { NextRequest, NextResponse } from "next/server";
import {
  db,
  users,
  tenantMemberships,
  tenants,
  roles,
} from "@adserve/database";
import { desc, eq, inArray, ilike, or } from "drizzle-orm";
import { apiRequireSuperAdmin } from "@/lib/super-admin";

export async function GET(req: NextRequest) {
  const auth = await apiRequireSuperAdmin();
  if (auth.error) return auth.error;

  const q = req.nextUrl.searchParams.get("q")?.trim();

  const where =
    q && q.length > 0
      ? or(ilike(users.email, `%${q}%`), ilike(users.fullName, `%${q}%`))
      : undefined;

  const userRows = await db
    .select()
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt));

  const userIds = userRows.map((u) => u.id);

  const memberships =
    userIds.length === 0
      ? []
      : await db
          .select({
            userId: tenantMemberships.userId,
            tenantId: tenants.id,
            tenantName: tenants.name,
            tenantSlug: tenants.slug,
            roleSlug: roles.slug,
            roleName: roles.name,
            membershipStatus: tenantMemberships.status,
          })
          .from(tenantMemberships)
          .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
          .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
          .where(inArray(tenantMemberships.userId, userIds));

  type Membership = (typeof memberships)[number];
  const byUser = new Map<string, Membership[]>();
  for (const m of memberships) {
    const list = byUser.get(m.userId) ?? [];
    list.push(m);
    byUser.set(m.userId, list);
  }

  const result = userRows.map((u) => ({
    ...u,
    memberships: byUser.get(u.id) ?? [],
  }));

  return NextResponse.json({ users: result });
}
