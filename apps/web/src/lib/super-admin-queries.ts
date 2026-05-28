import {
  db,
  modules,
  roles,
  tenantMemberships,
  tenantModules,
  users,
} from "@adserve/database";
import { desc, eq } from "drizzle-orm";

/**
 * Load the members of a single tenant with the user and role rows joined.
 * Takes a `tx` so the caller owns the RLS wrapper (typically
 * `withSuperAdminBypass` from a super-admin context).
 */
export function loadTenantMembers(tx: typeof db, tenantId: string) {
  return tx
    .select({
      membershipId: tenantMemberships.id,
      userId: users.id,
      email: users.email,
      fullName: users.fullName,
      userStatus: users.status,
      membershipStatus: tenantMemberships.status,
      roleSlug: roles.slug,
      roleName: roles.name,
      joinedAt: tenantMemberships.joinedAt,
    })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
    .where(eq(tenantMemberships.tenantId, tenantId))
    .orderBy(desc(tenantMemberships.joinedAt));
}

/**
 * Build the {module, enabled} list for a given tenant: every module in the
 * catalog with a boolean indicating whether the tenant has it enabled.
 * Sorted by `modules.displayOrder` so callers can render directly.
 */
export async function loadTenantModuleStates(
  tx: typeof db,
  tenantId: string
) {
  const [enabledRows, allModules] = await Promise.all([
    tx
      .select({
        moduleId: tenantModules.moduleId,
        enabled: tenantModules.enabled,
      })
      .from(tenantModules)
      .where(eq(tenantModules.tenantId, tenantId)),
    tx.select().from(modules),
  ]);

  const enabledMap = new Map(enabledRows.map((r) => [r.moduleId, r.enabled]));
  return allModules
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((m) => ({ ...m, enabled: enabledMap.get(m.id) === true }));
}
