import { afterAll, describe, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  createTestRole,
  setupTestContext,
  testClient,
  withTestTransaction,
} from "@adserve/database/test-helpers";
import {
  aiUsageLimits,
  entityTypes,
  fieldDefinitions,
  layouts,
  permissions,
  rolePermissions,
  schemaRelationships,
} from "@adserve/database";
import { activateCrmForTenant, CRM_SCHEMA_VERSION } from "../src/activate";
import { CRM_ENTITY_TYPES } from "../src/entity-types";
import { DEFAULT_FIELDS_BY_ENTITY } from "../src/field-definitions";
import { CRM_RELATIONSHIPS } from "../src/relationships";
import { DEFAULT_PIPELINE_STAGES } from "../src/pipeline";
import { CRM_PERMISSIONS, CRM_PERMISSION_KEYS } from "../src/permissions";
import { DEFAULT_CRM_ROLE_PERMISSIONS } from "../src/role-assignments";

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

  test("creates the CRM relationships with per-spec cardinality + correct entity FKs", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const result = await activateCrmForTenant(tx, { tenantId: tenant.id });

      const rels = await tx
        .select()
        .from(schemaRelationships)
        .where(eq(schemaRelationships.tenantId, tenant.id));
      expect(rels).toHaveLength(CRM_RELATIONSHIPS.length);

      // contact_belongs_to_account is the PRIMARY relationship → many_to_one;
      // contact_related_to_account is the NEW many_to_many related link;
      // opportunity↔contact is many_to_many; opportunity↔account is
      // many_to_one. The DB relationship_type must match each spec's
      // cardinality (the spec is the source of truth).
      const typeByName = new Map(rels.map((r) => [r.name, r.relationshipType]));
      expect(typeByName.get("contact_belongs_to_account")).toBe("many_to_one");
      expect(typeByName.get("contact_related_to_account")).toBe("many_to_many");
      expect(typeByName.get("opportunity_has_primary_contact")).toBe(
        "many_to_many"
      );
      expect(typeByName.get("opportunity_belongs_to_account")).toBe(
        "many_to_one"
      );

      // Each spec is represented with source/target resolved to entity ids,
      // and the stored relationship_type equals the spec cardinality.
      for (const spec of CRM_RELATIONSHIPS) {
        const match = rels.find((r) => r.name === spec.name);
        expect(match).toBeDefined();
        expect(match!.relationshipType).toBe(spec.cardinality);
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

describe("activateCrmForTenant — permissions & grants", () => {
  // Helper: the CRM permission keys granted to a role.
  async function grantedCrmKeys(
    tx: Parameters<Parameters<typeof withTestTransaction>[0]>[0],
    roleId: string,
    moduleId: string
  ): Promise<Set<string>> {
    const rows = await tx
      .select({
        resource: permissions.resource,
        action: permissions.action,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(
        and(
          eq(rolePermissions.roleId, roleId),
          eq(permissions.moduleId, moduleId)
        )
      );
    return new Set(rows.map((r) => `${r.resource}.${r.action}`));
  }

  test("seeds the 22 CRM permission rows under the crm module", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      const result = await activateCrmForTenant(tx, { tenantId: tenant.id });

      const rows = await tx
        .select({
          resource: permissions.resource,
          action: permissions.action,
        })
        .from(permissions)
        .where(eq(permissions.moduleId, result.moduleId));
      const keys = new Set(rows.map((r) => `${r.resource}.${r.action}`));

      expect(CRM_PERMISSIONS).toHaveLength(22);
      // Presence check (not exact count) — the shared permissions table
      // may also carry Phase-2 placeholders until 1.9a cleans them.
      for (const key of CRM_PERMISSION_KEYS) {
        expect(keys.has(key)).toBe(true);
      }
    });
  });

  test("grants CRM perms per role — owner 22, admin 22, member 7", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, role: ownerRole } = await setupTestContext(tx);
      const admin = await createTestRole(tx, tenant.id, {
        name: "Admin",
        slug: "admin",
      });
      const member = await createTestRole(tx, tenant.id, {
        name: "Member",
        slug: "member",
      });

      const result = await activateCrmForTenant(tx, { tenantId: tenant.id });

      const owner = await grantedCrmKeys(tx, ownerRole.id, result.moduleId);
      expect(owner).toEqual(new Set(DEFAULT_CRM_ROLE_PERMISSIONS.owner));
      expect(owner.size).toBe(22);

      const adminKeys = await grantedCrmKeys(tx, admin.id, result.moduleId);
      expect(adminKeys).toEqual(new Set(DEFAULT_CRM_ROLE_PERMISSIONS.admin));
      expect(adminKeys.size).toBe(22);

      const memberKeys = await grantedCrmKeys(tx, member.id, result.moduleId);
      expect(memberKeys).toEqual(new Set(DEFAULT_CRM_ROLE_PERMISSIONS.member));
      expect(memberKeys.size).toBe(7);
    });
  });

  test("permission seeding + role grants are idempotent on re-run", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      await createTestRole(tx, tenant.id, { name: "Admin", slug: "admin" });
      await createTestRole(tx, tenant.id, { name: "Member", slug: "member" });

      const expectedGrants =
        DEFAULT_CRM_ROLE_PERMISSIONS.owner.length +
        DEFAULT_CRM_ROLE_PERMISSIONS.admin.length +
        DEFAULT_CRM_ROLE_PERMISSIONS.member.length;

      const first = await activateCrmForTenant(tx, { tenantId: tenant.id });
      // Roles are fresh in this tx → all grants are new.
      expect(first.grantsCreated).toBe(expectedGrants);

      const second = await activateCrmForTenant(tx, { tenantId: tenant.id });
      // permissionsSeeded first-run count is not asserted: the global
      // permissions table is committed state shared across test runs.
      // Idempotency is what matters — the second run adds nothing.
      expect(second.permissionsSeeded).toBe(0);
      expect(second.grantsCreated).toBe(0);
    });
  });

  test("seeds the default AI usage limit ($50 = 50_000_000 micros), idempotent", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);

      await activateCrmForTenant(tx, { tenantId: tenant.id });
      let rows = await tx
        .select()
        .from(aiUsageLimits)
        .where(eq(aiUsageLimits.tenantId, tenant.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].monthlyCostLimitMicros).toBe(50_000_000);

      // Re-running activation must not duplicate the limits row.
      await activateCrmForTenant(tx, { tenantId: tenant.id });
      rows = await tx
        .select()
        .from(aiUsageLimits)
        .where(eq(aiUsageLimits.tenantId, tenant.id));
      expect(rows).toHaveLength(1);
    });
  });
});
