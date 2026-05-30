import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  modules,
  permissions,
  rolePermissions,
  roles,
  tenantModules,
} from "@adserve/database";
import { activateCrmForTenant, CRM_MODULE_SLUG } from "./activate";

/**
 * Task 1.9a — bring already-provisioned tenants onto the Phase-3 CRM
 * permission model, and retire the Phase-2 placeholders.
 *
 * Two jobs, run once, in a single transaction (the caller wraps):
 *   1. Reprovision every CRM-enabled tenant via the idempotent
 *      `activateCrmForTenant` (seeds the 21 CRM perms + grants to
 *      owner/admin/member).
 *   2. Retire the 16 Phase-2 placeholder permission rows under the `crm`
 *      module (contacts/companies/deals × r/c/u/d/export + ai.use):
 *      migrate the grants on them to the new CRM perms FIRST, then delete
 *      the placeholders. Grant migration is scoped to CRM-enabled tenants'
 *      roles — a tenant that has since DISABLED CRM does not gain new CRM
 *      grants; its placeholder grants are simply dropped (cascade).
 *
 * Idempotent: a second run finds no placeholders and is a clean no-op.
 *
 * Mapping (Phase-2 → Phase-3): companies→account, deals→opportunity,
 * contacts→contact for r/c/u/d. `*.export` and `ai.use` have no Phase-3
 * equivalent and are dropped (counted distinctly; `ai.use` is flagged so a
 * future Task 0.8 `ai_usage.read` follow-up can be targeted).
 */

type Tx = typeof db;

const PLACEHOLDER_RESOURCES = new Set(["contacts", "companies", "deals", "ai"]);

/** Phase-2 resource → Phase-3 resource (null = no equivalent). */
const RESOURCE_MAP: Record<string, string | null> = {
  contacts: "contact",
  companies: "account",
  deals: "opportunity",
  ai: null,
};

type MappedTarget =
  | { kind: "key"; key: string }
  | { kind: "drop"; reason: "export" | "ai" };

function mapPlaceholder(resource: string, action: string): MappedTarget {
  if (resource === "ai") return { kind: "drop", reason: "ai" };
  if (action === "export") return { kind: "drop", reason: "export" };
  const newResource = RESOURCE_MAP[resource];
  if (!newResource) return { kind: "drop", reason: "ai" };
  return { kind: "key", key: `${newResource}.${action}` };
}

export interface ReprovisionCrmResult {
  tenantsReprovisioned: number;
  /** Net-new grants inserted for CRM-enabled tenants' (custom) roles. */
  grantsMigrated: number;
  grantsDroppedExport: number;
  grantsDroppedAi: number;
  /** Mappable grants dropped because their tenant no longer has CRM enabled. */
  grantsDroppedDisabledTenant: number;
  placeholdersDeleted: number;
}

export async function reprovisionCrm(tx: Tx): Promise<ReprovisionCrmResult> {
  const [crmModule] = await tx
    .select()
    .from(modules)
    .where(eq(modules.slug, CRM_MODULE_SLUG));
  if (!crmModule) {
    throw new Error("CRM module not seeded — run pnpm db:seed");
  }

  // 1) Reprovision every CRM-enabled tenant (idempotent).
  const enabledRows = await tx
    .select({ tenantId: tenantModules.tenantId })
    .from(tenantModules)
    .where(
      and(
        eq(tenantModules.moduleId, crmModule.id),
        eq(tenantModules.enabled, true)
      )
    );
  const enabledTenantIds = new Set(enabledRows.map((r) => r.tenantId));

  let tenantsReprovisioned = 0;
  for (const tenantId of enabledTenantIds) {
    await activateCrmForTenant(tx, { tenantId });
    tenantsReprovisioned += 1;
  }

  // After reprovision the 21 Phase-3 perms exist. Build key → id over all
  // crm-module perms (placeholder keys are plural/`ai`, new keys singular —
  // they never collide).
  const crmPerms = await tx
    .select({
      id: permissions.id,
      resource: permissions.resource,
      action: permissions.action,
    })
    .from(permissions)
    .where(eq(permissions.moduleId, crmModule.id));
  const newPermIdByKey = new Map(
    crmPerms.map((p) => [`${p.resource}.${p.action}`, p.id])
  );

  const placeholders = crmPerms.filter((p) =>
    PLACEHOLDER_RESOURCES.has(p.resource)
  );
  const placeholderIds = placeholders.map((p) => p.id);
  const placeholderById = new Map(placeholders.map((p) => [p.id, p]));

  let grantsMigrated = 0;
  let grantsDroppedExport = 0;
  let grantsDroppedAi = 0;
  let grantsDroppedDisabledTenant = 0;
  let placeholdersDeleted = 0;

  if (placeholderIds.length > 0) {
    // 2) Migrate grants (before deletion). Join roles to scope by tenant.
    const grants = await tx
      .select({
        roleId: rolePermissions.roleId,
        permissionId: rolePermissions.permissionId,
        tenantId: roles.tenantId,
      })
      .from(rolePermissions)
      .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
      .where(inArray(rolePermissions.permissionId, placeholderIds));

    for (const grant of grants) {
      const ph = placeholderById.get(grant.permissionId);
      if (!ph) continue;
      const mapped = mapPlaceholder(ph.resource, ph.action);

      if (mapped.kind === "drop") {
        if (mapped.reason === "export") grantsDroppedExport += 1;
        else grantsDroppedAi += 1;
        continue;
      }
      // Mappable, but the tenant must still have CRM enabled to gain it.
      if (!enabledTenantIds.has(grant.tenantId)) {
        grantsDroppedDisabledTenant += 1;
        continue;
      }
      const targetId = newPermIdByKey.get(mapped.key);
      if (!targetId) {
        // The new perm should exist post-reprovision; a missing target means
        // a botched reprovision — fail loudly rather than silently skip.
        throw new Error(
          `Reprovision target permission missing: ${mapped.key}`
        );
      }
      const inserted = await tx
        .insert(rolePermissions)
        .values({ roleId: grant.roleId, permissionId: targetId })
        .onConflictDoNothing()
        .returning({ roleId: rolePermissions.roleId });
      if (inserted.length > 0) grantsMigrated += 1;
    }

    // Delete placeholder grants then the placeholder perms. (The FK
    // cascades grants on perm delete; the explicit delete is belt-and-
    // suspenders and keeps intent clear.)
    await tx
      .delete(rolePermissions)
      .where(inArray(rolePermissions.permissionId, placeholderIds));
    const deleted = await tx
      .delete(permissions)
      .where(inArray(permissions.id, placeholderIds))
      .returning({ id: permissions.id });
    placeholdersDeleted = deleted.length;
  }

  return {
    tenantsReprovisioned,
    grantsMigrated,
    grantsDroppedExport,
    grantsDroppedAi,
    grantsDroppedDisabledTenant,
    placeholdersDeleted,
  };
}
