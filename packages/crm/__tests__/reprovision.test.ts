import { afterAll, describe, expect, test } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  createTestRole,
  createTestTenant,
  setupTestContext,
  testClient,
  withTestTransaction,
} from "@adserve/database/test-helpers";
import {
  modules,
  permissions,
  rolePermissions,
  tenantModules,
} from "@adserve/database";
import { reprovisionCrm } from "../src/reprovision";
import { CRM_MODULE_SLUG } from "../src/activate";

afterAll(async () => {
  await testClient.end();
});

type Tx = Parameters<Parameters<typeof withTestTransaction>[0]>[0];

async function crmModuleId(tx: Tx): Promise<string> {
  const [m] = await tx
    .select({ id: modules.id })
    .from(modules)
    .where(eq(modules.slug, CRM_MODULE_SLUG));
  return m.id;
}

/** Upsert a placeholder permission and return its id (handles pre-existing). */
async function ensurePlaceholder(
  tx: Tx,
  moduleId: string,
  resource: string,
  action: string
): Promise<string> {
  await tx
    .insert(permissions)
    .values({ moduleId, resource, action, description: `${resource}.${action}` })
    .onConflictDoNothing();
  const [row] = await tx
    .select({ id: permissions.id })
    .from(permissions)
    .where(
      and(
        eq(permissions.moduleId, moduleId),
        eq(permissions.resource, resource),
        eq(permissions.action, action)
      )
    );
  return row.id;
}

async function enableCrm(tx: Tx, tenantId: string, moduleId: string, enabled: boolean) {
  await tx.insert(tenantModules).values({ tenantId, moduleId, enabled });
}

async function grant(tx: Tx, roleId: string, permissionId: string) {
  await tx
    .insert(rolePermissions)
    .values({ roleId, permissionId })
    .onConflictDoNothing();
}

async function roleHasPerm(
  tx: Tx,
  roleId: string,
  resource: string,
  action: string
): Promise<boolean> {
  const rows = await tx
    .select({ roleId: rolePermissions.roleId })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(
      and(
        eq(rolePermissions.roleId, roleId),
        eq(permissions.resource, resource),
        eq(permissions.action, action)
      )
    );
  return rows.length > 0;
}

describe("reprovisionCrm — placeholder retirement + grant migration", () => {
  test("migrates mappable grants, drops export/ai/disabled, deletes placeholders", async () => {
    await withTestTransaction(async (tx) => {
      const moduleId = await crmModuleId(tx);

      // Enabled CRM tenant with a custom role holding placeholder grants.
      const { tenant } = await setupTestContext(tx);
      await enableCrm(tx, tenant.id, moduleId, true);
      const custom = await createTestRole(tx, tenant.id, {
        name: "Sales",
        slug: "sales-custom",
      });

      const phContactsRead = await ensurePlaceholder(tx, moduleId, "contacts", "read");
      const phDealsUpdate = await ensurePlaceholder(tx, moduleId, "deals", "update");
      const phCompaniesExport = await ensurePlaceholder(tx, moduleId, "companies", "export");
      const phAiUse = await ensurePlaceholder(tx, moduleId, "ai", "use");

      await grant(tx, custom.id, phContactsRead);
      await grant(tx, custom.id, phDealsUpdate);
      await grant(tx, custom.id, phCompaniesExport);
      await grant(tx, custom.id, phAiUse);

      // A CRM-DISABLED tenant whose custom role holds a mappable placeholder.
      const disabledTenant = await createTestTenant(tx);
      await enableCrm(tx, disabledTenant.id, moduleId, false);
      const disabledRole = await createTestRole(tx, disabledTenant.id, {
        name: "Old", slug: "old-custom",
      });
      await grant(tx, disabledRole.id, phContactsRead);

      const placeholderIds = [phContactsRead, phDealsUpdate, phCompaniesExport, phAiUse];

      const result = await reprovisionCrm(tx);

      // Enabled custom role gained the migrated Phase-3 grants...
      expect(await roleHasPerm(tx, custom.id, "contact", "read")).toBe(true);
      expect(await roleHasPerm(tx, custom.id, "opportunity", "update")).toBe(true);
      // ...but export has no Phase-3 equivalent (no such perm exists at all).
      expect(await roleHasPerm(tx, custom.id, "account", "export")).toBe(false);

      // Disabled-CRM tenant's role did NOT gain a Phase-3 grant.
      expect(await roleHasPerm(tx, disabledRole.id, "contact", "read")).toBe(false);

      // All placeholder perms (and their grants, by cascade) are gone.
      const remaining = await tx
        .select({ id: permissions.id })
        .from(permissions)
        .where(inArray(permissions.id, placeholderIds));
      expect(remaining).toHaveLength(0);

      // Summary reflects our fixtures (>= because the shared DB may carry
      // other CRM-enabled tenants / placeholder grants).
      expect(result.grantsMigrated).toBeGreaterThanOrEqual(2);
      expect(result.grantsDroppedExport).toBeGreaterThanOrEqual(1);
      expect(result.grantsDroppedAi).toBeGreaterThanOrEqual(1);
      expect(result.grantsDroppedDisabledTenant).toBeGreaterThanOrEqual(1);
      expect(result.placeholdersDeleted).toBeGreaterThanOrEqual(4);
      expect(result.tenantsReprovisioned).toBeGreaterThanOrEqual(1);
    });
  });

  test("is a clean no-op on re-run (no placeholders remain anywhere)", async () => {
    await withTestTransaction(async (tx) => {
      const moduleId = await crmModuleId(tx);
      const { tenant } = await setupTestContext(tx);
      await enableCrm(tx, tenant.id, moduleId, true);
      const custom = await createTestRole(tx, tenant.id, { name: "S", slug: "s-custom" });
      const ph = await ensurePlaceholder(tx, moduleId, "contacts", "read");
      await grant(tx, custom.id, ph);

      await reprovisionCrm(tx); // first run retires everything globally

      const second = await reprovisionCrm(tx);
      expect(second.placeholdersDeleted).toBe(0);
      expect(second.grantsMigrated).toBe(0);
      expect(second.grantsDroppedExport).toBe(0);
      expect(second.grantsDroppedAi).toBe(0);
      expect(second.grantsDroppedDisabledTenant).toBe(0);
    });
  });
});
