import { db, permissions, tenantModules } from "@adserve/database";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

export type PermissionValidationResult =
  | { ok: true; permissionIds: string[] }
  | { ok: false };

/**
 * Validate that every permission ID in `permissionIds` is visible to the
 * given tenant — i.e. it is a platform permission (`module_id IS NULL`) or
 * belongs to a module that is enabled for the tenant.
 *
 * Takes a `tx` so the caller owns the transaction/RLS wrapper. Returns
 * `{ ok: false }` if any requested ID is not visible; otherwise returns
 * the resolved id list for downstream inserts.
 */
export async function validatePermissionsForTenant(
  tx: typeof db,
  tenantId: string,
  permissionIds: string[]
): Promise<PermissionValidationResult> {
  if (permissionIds.length === 0) return { ok: true, permissionIds: [] };

  const enabledModuleRows = await tx
    .select({ moduleId: tenantModules.moduleId })
    .from(tenantModules)
    .where(
      and(
        eq(tenantModules.tenantId, tenantId),
        eq(tenantModules.enabled, true)
      )
    );
  const enabledModuleIds = enabledModuleRows.map((r) => r.moduleId);

  const validPerms = await tx
    .select({ id: permissions.id })
    .from(permissions)
    .where(
      and(
        inArray(permissions.id, permissionIds),
        enabledModuleIds.length > 0
          ? or(
              isNull(permissions.moduleId),
              inArray(permissions.moduleId, enabledModuleIds)
            )
          : isNull(permissions.moduleId)
      )
    );

  if (validPerms.length !== permissionIds.length) return { ok: false };
  return { ok: true, permissionIds: validPerms.map((p) => p.id) };
}
