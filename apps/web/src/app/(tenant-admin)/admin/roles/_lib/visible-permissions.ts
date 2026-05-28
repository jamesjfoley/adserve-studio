import {
  db,
  modules,
  permissions,
  tenantModules,
} from "@adserve/database";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import type { PermissionRow } from "../_components/role-form";

/**
 * Fetch every permission visible to the given tenant — that is:
 *   - all platform permissions (module_id IS NULL), AND
 *   - permissions whose module is enabled for this tenant.
 *
 * Disabled-module perms are hidden so admins can't accidentally grant
 * access to features the super admin hasn't enabled.
 *
 * Takes a `tx` so the caller owns the RLS wrapper (typically `withTenant`).
 */
export async function getVisiblePermissions(
  tx: typeof db,
  tenantId: string
): Promise<PermissionRow[]> {
  const enabledRows = await tx
    .select({ moduleId: tenantModules.moduleId })
    .from(tenantModules)
    .where(
      and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.enabled, true))
    );
  const enabledModuleIds = enabledRows.map((r) => r.moduleId);

  const filter =
    enabledModuleIds.length > 0
      ? or(
          isNull(permissions.moduleId),
          inArray(permissions.moduleId, enabledModuleIds)
        )
      : isNull(permissions.moduleId);

  const rows = await tx
    .select({
      id: permissions.id,
      moduleId: permissions.moduleId,
      moduleSlug: modules.slug,
      moduleName: modules.name,
      resource: permissions.resource,
      action: permissions.action,
      description: permissions.description,
    })
    .from(permissions)
    .leftJoin(modules, eq(modules.id, permissions.moduleId))
    .where(filter)
    .orderBy(asc(permissions.resource), asc(permissions.action));

  return rows;
}
