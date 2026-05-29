import { afterAll, describe, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  setupTestContext,
  testClient,
  withTestTransaction,
} from "@adserve/database/test-helpers";
import {
  entityTypes,
  fieldDefinitions,
  layouts,
  schemaRelationships,
} from "@adserve/database";
import { activateCrmForTenant, CRM_SCHEMA_VERSION } from "../src/activate";
import { CRM_ENTITY_TYPES } from "../src/entity-types";
import { DEFAULT_FIELDS_BY_ENTITY } from "../src/field-definitions";
import { CRM_RELATIONSHIPS } from "../src/relationships";
import { DEFAULT_PIPELINE_STAGES } from "../src/pipeline";

afterAll(async () => {
  await testClient.end();
});

describe("activateCrmForTenant", () => {
  test("registers all 4 CRM entity types (system)", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const result = await activateCrmForTenant(tx, { tenantId: tenant.id });

      const rows = await tx
        .select()
        .from(entityTypes)
        .where(eq(entityTypes.tenantId, tenant.id));
      expect(rows.map((r) => r.slug).sort()).toEqual([
        "account",
        "contact",
        "lead",
        "opportunity",
      ]);
      expect(rows.every((r) => r.isSystem)).toBe(true);
      expect(Object.keys(result.entityTypeIds).sort()).toEqual([
        "account",
        "contact",
        "lead",
        "opportunity",
      ]);
    });
  });

  test("creates the default field definitions per entity type", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const result = await activateCrmForTenant(tx, { tenantId: tenant.id });

      for (const et of CRM_ENTITY_TYPES) {
        const expected = DEFAULT_FIELDS_BY_ENTITY[et.slug];
        const rows = await tx
          .select()
          .from(fieldDefinitions)
          .where(eq(fieldDefinitions.entityTypeId, result.entityTypeIds[et.slug]));
        expect(rows).toHaveLength(expected.length);
      }

      // Spot-check a required system field.
      const accountFields = await tx
        .select()
        .from(fieldDefinitions)
        .where(
          and(
            eq(fieldDefinitions.entityTypeId, result.entityTypeIds.account),
            eq(fieldDefinitions.slug, "name")
          )
        );
      expect(accountFields[0].isRequired).toBe(true);
      expect(accountFields[0].isSystem).toBe(true);
    });
  });

  test("resolves opportunity.stage choices from the pipeline stages", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const result = await activateCrmForTenant(tx, { tenantId: tenant.id });

      const [stageField] = await tx
        .select()
        .from(fieldDefinitions)
        .where(
          and(
            eq(fieldDefinitions.entityTypeId, result.entityTypeIds.opportunity),
            eq(fieldDefinitions.slug, "stage")
          )
        );
      const choices = (stageField.options as {
        choices?: { value: string; label: string }[];
      }).choices;
      expect(choices).toHaveLength(DEFAULT_PIPELINE_STAGES.length);
      expect(choices?.map((c) => c.value)).toEqual(
        DEFAULT_PIPELINE_STAGES.map((s) => s.slug)
      );
    });
  });

  test("creates one default detail layout per entity type", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      await activateCrmForTenant(tx, { tenantId: tenant.id });

      const lays = await tx
        .select()
        .from(layouts)
        .where(eq(layouts.tenantId, tenant.id));
      expect(lays).toHaveLength(4);
      expect(lays.every((l) => l.layoutType === "detail")).toBe(true);
      expect(lays.every((l) => l.isDefault)).toBe(true);
    });
  });

  test("creates the 3 CRM relationships as many_to_one with correct entity FKs", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const result = await activateCrmForTenant(tx, { tenantId: tenant.id });

      const rels = await tx
        .select()
        .from(schemaRelationships)
        .where(eq(schemaRelationships.tenantId, tenant.id));
      expect(rels).toHaveLength(CRM_RELATIONSHIPS.length);
      expect(rels.every((r) => r.relationshipType === "many_to_one")).toBe(true);

      // Each spec is represented with source/target resolved to entity ids.
      for (const spec of CRM_RELATIONSHIPS) {
        const match = rels.find((r) => r.name === spec.name);
        expect(match).toBeDefined();
        expect(match!.sourceEntityTypeId).toBe(
          result.entityTypeIds[spec.sourceEntitySlug]
        );
        expect(match!.targetEntityTypeId).toBe(
          result.entityTypeIds[spec.targetEntitySlug]
        );
      }
    });
  });

  test("stamps schemaVersion into every entity's settings; pipeline stages on opportunity", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      await activateCrmForTenant(tx, { tenantId: tenant.id });

      const rows = await tx
        .select()
        .from(entityTypes)
        .where(eq(entityTypes.tenantId, tenant.id));

      for (const r of rows) {
        const settings = r.settings as {
          schemaVersion?: number;
          pipelineStages?: unknown[];
        };
        expect(settings.schemaVersion).toBe(CRM_SCHEMA_VERSION);
        if (r.slug === "opportunity") {
          expect(settings.pipelineStages).toHaveLength(
            DEFAULT_PIPELINE_STAGES.length
          );
        } else {
          expect(settings.pipelineStages).toBeUndefined();
        }
      }
    });
  });

  test("sets nameFieldId on account + opportunity, null on contact + lead", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const result = await activateCrmForTenant(tx, { tenantId: tenant.id });

      const rows = await tx
        .select()
        .from(entityTypes)
        .where(eq(entityTypes.tenantId, tenant.id));
      const bySlug = new Map(rows.map((r) => [r.slug, r]));

      // account + opportunity point at their "name" field.
      for (const slug of ["account", "opportunity"]) {
        const [nameField] = await tx
          .select()
          .from(fieldDefinitions)
          .where(
            and(
              eq(fieldDefinitions.entityTypeId, result.entityTypeIds[slug]),
              eq(fieldDefinitions.slug, "name")
            )
          );
        expect(bySlug.get(slug)!.nameFieldId).toBe(nameField.id);
      }
      expect(bySlug.get("contact")!.nameFieldId).toBeNull();
      expect(bySlug.get("lead")!.nameFieldId).toBeNull();
    });
  });

  test("is fully idempotent — re-running creates no duplicates", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);

      await activateCrmForTenant(tx, { tenantId: tenant.id });
      const second = await activateCrmForTenant(tx, { tenantId: tenant.id });

      // Second run reports nothing new for relationships.
      expect(second.relationshipsCreated).toBe(0);

      const ets = await tx
        .select()
        .from(entityTypes)
        .where(eq(entityTypes.tenantId, tenant.id));
      expect(ets).toHaveLength(4);

      const lays = await tx
        .select()
        .from(layouts)
        .where(eq(layouts.tenantId, tenant.id));
      expect(lays).toHaveLength(4);

      const rels = await tx
        .select()
        .from(schemaRelationships)
        .where(eq(schemaRelationships.tenantId, tenant.id));
      expect(rels).toHaveLength(CRM_RELATIONSHIPS.length);

      // Field counts unchanged across all entities.
      for (const et of CRM_ENTITY_TYPES) {
        const rows = await tx
          .select()
          .from(fieldDefinitions)
          .where(eq(fieldDefinitions.entityTypeId, second.entityTypeIds[et.slug]));
        expect(rows).toHaveLength(DEFAULT_FIELDS_BY_ENTITY[et.slug].length);
      }
    });
  });
});
