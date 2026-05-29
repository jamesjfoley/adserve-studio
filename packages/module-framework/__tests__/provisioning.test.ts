import { afterAll, describe, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  getModuleBySlug,
  setupTestContext,
  testClient,
  withTestTransaction,
} from "@adserve/database/test-helpers";
import { entityTypes, layouts } from "@adserve/database";
import { listFieldDefinitions } from "../src/field-engine";
import { getDefaultLayout } from "../src/layout-engine";
import { provisionEntityType, type ProvisionFieldSpec } from "../src/provisioning";

afterAll(async () => {
  await testClient.end();
});

const FIELDS: ProvisionFieldSpec[] = [
  {
    slug: "name",
    name: "Name",
    fieldType: "text",
    isRequired: true,
    isSystem: true,
    displayOrder: 10,
  },
  {
    slug: "status",
    name: "Status",
    fieldType: "select",
    displayOrder: 20,
    options: { choices: [{ value: "active", label: "Active" }] },
  },
  {
    slug: "amount",
    name: "Amount",
    fieldType: "currency",
    displayOrder: 30,
    groupName: "Financials",
  },
];

async function baseInput(tx: Parameters<typeof provisionEntityType>[0], tenantId: string, moduleId: string) {
  return {
    tenantId,
    moduleId,
    slug: "widget",
    name: "Widget",
    isSystem: true,
    fields: FIELDS,
    nameFieldSlug: "name",
    settings: { schemaVersion: 1 },
  };
}

describe("provisionEntityType", () => {
  test("creates entity + fields + default detail layout + nameFieldId", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");

      const result = await provisionEntityType(tx, await baseInput(tx, tenant.id, mod.id));

      expect(result.created).toBe(true);
      expect(result.fieldsCreated).toBe(3);
      expect(result.layoutCreated).toBe(true);

      const fields = await listFieldDefinitions(tx, {
        tenantId: tenant.id,
        entityTypeId: result.entityType.id,
      });
      expect(fields.map((f) => f.slug).sort()).toEqual([
        "amount",
        "name",
        "status",
      ]);

      // nameFieldId points at the "name" field.
      const nameField = fields.find((f) => f.slug === "name")!;
      expect(result.entityType.nameFieldId).toBe(nameField.id);

      // settings merged.
      expect(
        (result.entityType.settings as { schemaVersion?: number }).schemaVersion
      ).toBe(1);

      // Default detail layout exists and groups Financials into its own section.
      const layout = await getDefaultLayout(tx, {
        tenantId: tenant.id,
        entityTypeId: result.entityType.id,
        layoutType: "detail",
      });
      expect(layout).not.toBeNull();
      const config = layout!.config as {
        sections: { title: string; fieldIds: string[] }[];
      };
      expect(config.sections.map((s) => s.title)).toContain("Financials");
      // Every referenced field id is real.
      const ids = new Set(fields.map((f) => f.id));
      for (const s of config.sections) {
        for (const fid of s.fieldIds) expect(ids.has(fid)).toBe(true);
      }
    });
  });

  test("is idempotent — a second run creates nothing new", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");

      await provisionEntityType(tx, await baseInput(tx, tenant.id, mod.id));
      const second = await provisionEntityType(tx, await baseInput(tx, tenant.id, mod.id));

      expect(second.created).toBe(false);
      expect(second.fieldsCreated).toBe(0);
      expect(second.layoutCreated).toBe(false);

      // Exactly one entity type row, one default layout.
      const ets = await tx
        .select()
        .from(entityTypes)
        .where(
          and(
            eq(entityTypes.tenantId, tenant.id),
            eq(entityTypes.slug, "widget")
          )
        );
      expect(ets).toHaveLength(1);

      const lays = await tx
        .select()
        .from(layouts)
        .where(eq(layouts.entityTypeId, ets[0].id));
      expect(lays).toHaveLength(1);
    });
  });

  test("tops up only the missing fields on re-run", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");

      // First pass with only the first field.
      const partial = {
        ...(await baseInput(tx, tenant.id, mod.id)),
        fields: [FIELDS[0]],
      };
      const first = await provisionEntityType(tx, partial);
      expect(first.fieldsCreated).toBe(1);

      // Second pass with the full set → only the 2 new fields are added.
      const full = await provisionEntityType(tx, await baseInput(tx, tenant.id, mod.id));
      expect(full.fieldsCreated).toBe(2);

      const fields = await listFieldDefinitions(tx, {
        tenantId: tenant.id,
        entityTypeId: full.entityType.id,
      });
      expect(fields).toHaveLength(3);
    });
  });

  test("does not clobber an existing settings key on re-run", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const mod = await getModuleBySlug(tx, "crm");

      const input = await baseInput(tx, tenant.id, mod.id);
      await provisionEntityType(tx, input);

      // Simulate a tenant customisation written after activation.
      const [et] = await tx
        .select()
        .from(entityTypes)
        .where(
          and(
            eq(entityTypes.tenantId, tenant.id),
            eq(entityTypes.slug, "widget")
          )
        );
      await tx
        .update(entityTypes)
        .set({ settings: { schemaVersion: 1, custom: "keep-me" } })
        .where(eq(entityTypes.id, et.id));

      // Re-run with the same activation settings.
      const again = await provisionEntityType(tx, input);
      const settings = again.entityType.settings as Record<string, unknown>;
      expect(settings.custom).toBe("keep-me");
      expect(settings.schemaVersion).toBe(1);
    });
  });
});
