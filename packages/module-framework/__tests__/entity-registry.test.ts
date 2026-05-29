import { afterAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestTenant,
  getModuleBySlug,
  setupTestContext,
  testClient,
  withTestTransaction,
} from "@adserve/database/test-helpers";
import { entityTypes } from "@adserve/database";
import {
  getEntityTypeBySlug,
  listEntityTypesForModule,
  registerEntityType,
} from "../src/entity-registry";

afterAll(async () => {
  await testClient.end();
});

describe("entity registry — registerEntityType", () => {
  test("creates an entity type row", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");

      const et = await registerEntityType(tx, {
        tenantId: tenant.id,
        moduleId: mod.id,
        name: "Account",
        slug: "account",
        isSystem: true,
      });

      expect(et.slug).toBe("account");
      expect(et.isSystem).toBe(true);
      expect(et.tenantId).toBe(tenant.id);
    });
  });

  test("is idempotent on (tenantId, slug) — re-register returns the same row, no duplicate", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");

      const first = await registerEntityType(tx, {
        tenantId: tenant.id,
        moduleId: mod.id,
        name: "Account",
        slug: "account",
      });
      const second = await registerEntityType(tx, {
        tenantId: tenant.id,
        moduleId: mod.id,
        name: "Account renamed attempt",
        slug: "account",
      });

      expect(second.id).toBe(first.id);
      // Conflict path does not clobber the existing name.
      expect(second.name).toBe("Account");

      const rows = await tx
        .select()
        .from(entityTypes)
        .where(eq(entityTypes.tenantId, tenant.id));
      expect(rows.filter((r) => r.slug === "account")).toHaveLength(1);
    });
  });
});

describe("entity registry — getEntityTypeBySlug", () => {
  test("returns the row for the owning tenant", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");
      await registerEntityType(tx, {
        tenantId: tenant.id,
        moduleId: mod.id,
        name: "Lead",
        slug: "lead",
      });

      const found = await getEntityTypeBySlug(tx, {
        tenantId: tenant.id,
        slug: "lead",
      });
      expect(found?.slug).toBe("lead");
    });
  });

  test("is tenant-scoped — a slug owned by another tenant is not found", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const other = await createTestTenant(tx);
      const mod = await getModuleBySlug(tx, "crm");

      await registerEntityType(tx, {
        tenantId: other.id,
        moduleId: mod.id,
        name: "Opportunity",
        slug: "opportunity",
      });

      const found = await getEntityTypeBySlug(tx, {
        tenantId: tenant.id,
        slug: "opportunity",
      });
      expect(found).toBeNull();
    });
  });
});

describe("entity registry — listEntityTypesForModule", () => {
  test("returns the tenant's entity types for the module, slug-ordered", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");

      await registerEntityType(tx, {
        tenantId: tenant.id,
        moduleId: mod.id,
        name: "Opportunity",
        slug: "opportunity",
      });
      await registerEntityType(tx, {
        tenantId: tenant.id,
        moduleId: mod.id,
        name: "Account",
        slug: "account",
      });

      const list = await listEntityTypesForModule(tx, {
        tenantId: tenant.id,
        moduleId: mod.id,
      });
      expect(list.map((e) => e.slug)).toEqual(["account", "opportunity"]);
    });
  });
});
