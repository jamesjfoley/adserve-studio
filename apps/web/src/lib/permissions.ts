import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
  createTenantDb,
  permissions,
  rolePermissions,
  roles,
  tenantMemberships,
  tenants,
  users,
  withSuperAdminBypass,
  type TenantDb,
} from "@adserve/database";
import { and, eq, sql } from "drizzle-orm";

export type TenantContextUser = typeof users.$inferSelect;
export type TenantContextTenant = typeof tenants.$inferSelect;
export type TenantContextMembership = typeof tenantMemberships.$inferSelect;
export type TenantContextRole = typeof roles.$inferSelect;

export type TenantContext = {
  user: TenantContextUser;
  tenant: TenantContextTenant;
  membership: TenantContextMembership;
  role: TenantContextRole;
  permissions: Set<string>;
  db: TenantDb;
};

/**
 * Resolve the current Clerk session into a full tenant context, or null
 * if the caller is not a tenant user for the active org. No permission
 * check is performed — callers layer that on top.
 *
 * Returns null when any of:
 *  - No Clerk session
 *  - No Clerk org selected
 *  - User is a super admin (role separation: super admins never have tenant access)
 *  - User record not in DB
 *  - Clerk org does not map to a tenant
 *  - User has no active membership in that tenant
 */
export async function getTenantContextOrNull(): Promise<TenantContext | null> {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) return null;

  // RLS bypass: this function resolves a Clerk session into a tenant
  // context, which by definition runs before any tenant id is known —
  // so withTenant() can't be used. Every lookup here is either a
  // non-RLS table (users, role_permissions, permissions) or one that's
  // load-bearing for resolving tenancy itself (tenants, tenant_memberships,
  // roles). Bypass is the only correct mode.
  return withSuperAdminBypass(async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.authProviderId, userId));
    if (!user) return null;

    // Role separation: super admins are not tenant users.
    if (user.isSuperAdmin) return null;

    const [tenant] = await tx
      .select()
      .from(tenants)
      .where(sql`${tenants.settings}->>'clerkOrgId' = ${orgId}`);
    if (!tenant) return null;

    const [membership] = await tx
      .select()
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, tenant.id),
          eq(tenantMemberships.userId, user.id),
          eq(tenantMemberships.status, "active")
        )
      );
    if (!membership) return null;

    const [role] = await tx
      .select()
      .from(roles)
      .where(eq(roles.id, membership.roleId));
    if (!role) return null;

    const permRows = await tx
      .select({
        resource: permissions.resource,
        action: permissions.action,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, role.id));

    const permSet = new Set(permRows.map((p) => `${p.resource}.${p.action}`));

    return {
      user,
      tenant,
      membership,
      role,
      permissions: permSet,
      db: createTenantDb(tenant.id),
    };
  });
}

/**
 * Server-side guard for pages. Redirects to /sign-in if unauthenticated,
 * /dashboard if signed in but the user's role does not include the
 * specified permission. Super admins always redirect — they have no
 * tenant-scoped permissions by design.
 */
export async function requirePermission(
  permissionKey: string
): Promise<TenantContext> {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const ctx = await getTenantContextOrNull();
  if (!ctx || !ctx.permissions.has(permissionKey)) {
    redirect("/dashboard");
  }
  return ctx;
}

export type ApiPermissionAuth =
  | { ctx: TenantContext; error: null }
  | { ctx: null; error: NextResponse };

/**
 * API route guard. Returns 401 if not signed in, 403 if signed in but
 * missing the permission. Super admins always 403 from tenant routes.
 */
export async function apiRequirePermission(
  permissionKey: string
): Promise<ApiPermissionAuth> {
  const { userId } = await auth();
  if (!userId) {
    return {
      ctx: null,
      error: NextResponse.json({ error: "Unauthenticated" }, { status: 401 }),
    };
  }

  const ctx = await getTenantContextOrNull();
  if (!ctx || !ctx.permissions.has(permissionKey)) {
    return {
      ctx: null,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ctx, error: null };
}
