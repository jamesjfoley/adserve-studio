import { and, eq } from "drizzle-orm";
import {
  db,
  modules,
  permissions,
  rolePermissions,
  roles,
  schemaRelationships,
} from "@adserve/database";
import {
  provisionEntityType,
  type ProvisionFieldSpec,
} from "@adserve/module-framework";
import { CRM_ENTITY_TYPES } from "./entity-types";
import { DEFAULT_FIELDS_BY_ENTITY } from "./field-definitions";
import { CRM_RELATIONSHIPS, type RelationshipCardinality } from "./relationships";
import { DEFAULT_PIPELINE_STAGES } from "./pipeline";
import { CRM_PERMISSIONS } from "./permissions";
import { DEFAULT_CRM_ROLE_PERMISSIONS } from "./role-assignments";

/**
 * CRM module activation for a single tenant.
 *
 * Maps the CRM constants (entity types, default fields, relationships,
 * pipeline) through the framework's `provisionEntityType` primitive,
 * wires the cross-entity `relationships` rows, stamps each entity's
 * `settings` with a schema version (+ the opportunity's pipeline
 * stages), seeds the global CRM `permissions` rows, and grants them to
 * the tenant's roles per `DEFAULT_CRM_ROLE_PERMISSIONS` (Task 1.1).
 *
 * Idempotent end to end — safe to call on every provision and to re-run
 * for existing tenants (Task 1.9a).
 *
 * Explicitly NOT handled here (see docs/phase-3-status.md deferrals):
 *   - `ai_usage.read` platform permission → Task 0.8
 *   - Deleting the live Phase-2 placeholder CRM permission rows
 *     (contacts/companies/deals/ai) + migrating their grants → Task 1.9a
 *   - `ai_usage_limits` seeding → Task 0.8 (table created there)
 *   - `validation_rules` seeding → until the createValidationRule adapter
 *     is implemented; `isRequired` is carried on field_definitions.
 */

type Tx = typeof db;

export const CRM_MODULE_SLUG = "crm";

/**
 * Schema version stamped into every CRM entity's `entity_types.settings`
 * so future migrations can target individual entities. Bump when an
 * entity's default field/layout shape changes; 1.9a compares this to
 * decide what to re-provision.
 */
export const CRM_SCHEMA_VERSION = 1;

const DB_RELATIONSHIP_TYPES = new Set<RelationshipCardinality>([
  "one_to_many",
  "many_to_one",
  "many_to_many",
]);

export interface ActivateCrmResult {
  moduleId: string;
  /** Entity type slug → row id. */
  entityTypeIds: Record<string, string>;
  /** Relationship rows created on this run (0 on a clean re-run). */
  relationshipsCreated: number;
  /** Global CRM permission rows created on this run (0 on a clean re-run). */
  permissionsSeeded: number;
  /** role_permissions grants created on this run (0 on a clean re-run). */
  grantsCreated: number;
}

export async function activateCrmForTenant(
  tx: Tx,
  args: { tenantId: string }
): Promise<ActivateCrmResult> {
  const { tenantId } = args;

  const [crmModule] = await tx
    .select()
    .from(modules)
    .where(eq(modules.slug, CRM_MODULE_SLUG));
  if (!crmModule) {
    throw new Error("CRM module not seeded — run pnpm db:seed");
  }

  // The opportunity `stage` select draws its choices from the tenant's
  // pipeline stages (the constant declares `options.choicesFrom`).
  const stageChoices = DEFAULT_PIPELINE_STAGES.map((s) => ({
    value: s.slug,
    label: s.name,
  }));

  const entityTypeIds: Record<string, string> = {};

  for (const entitySpec of CRM_ENTITY_TYPES) {
    const baseFields = DEFAULT_FIELDS_BY_ENTITY[entitySpec.slug] ?? [];
    const fields: ProvisionFieldSpec[] = baseFields.map((f) => {
      if (entitySpec.slug === "opportunity" && f.slug === "stage") {
        // Resolve `choicesFrom: "pipeline_stages"` to concrete choices.
        return { ...f, options: { choices: stageChoices } };
      }
      return f;
    });

    const settings: Record<string, unknown> = {
      schemaVersion: CRM_SCHEMA_VERSION,
    };
    if (entitySpec.slug === "opportunity") {
      settings.pipelineStages = DEFAULT_PIPELINE_STAGES;
    }

    // Account + Opportunity have a single `name` field; Contact + Lead
    // compose a display name from first/last app-side (nameFieldId null).
    const nameFieldSlug =
      entitySpec.slug === "account" || entitySpec.slug === "opportunity"
        ? "name"
        : undefined;

    const result = await provisionEntityType(tx, {
      tenantId,
      moduleId: crmModule.id,
      slug: entitySpec.slug,
      name: entitySpec.name,
      description: entitySpec.description,
      icon: entitySpec.icon,
      isSystem: entitySpec.isSystem,
      fields,
      nameFieldSlug,
      defaultLayoutType: "detail",
      settings,
    });
    entityTypeIds[entitySpec.slug] = result.entityType.id;
  }

  // Relationships — SELECT-then-INSERT keyed on
  // (tenantId, sourceEntityTypeId, targetEntityTypeId, relationshipType).
  // No DB unique constraint exists on that tuple, so we check first.
  let relationshipsCreated = 0;
  for (const rel of CRM_RELATIONSHIPS) {
    const sourceEntityTypeId = entityTypeIds[rel.sourceEntitySlug];
    const targetEntityTypeId = entityTypeIds[rel.targetEntitySlug];
    if (!sourceEntityTypeId || !targetEntityTypeId) continue;

    const relationshipType = toDbRelationshipType(rel.cardinality);

    const existing = await tx
      .select({ id: schemaRelationships.id })
      .from(schemaRelationships)
      .where(
        and(
          eq(schemaRelationships.tenantId, tenantId),
          eq(schemaRelationships.sourceEntityTypeId, sourceEntityTypeId),
          eq(schemaRelationships.targetEntityTypeId, targetEntityTypeId),
          eq(schemaRelationships.relationshipType, relationshipType)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      await tx.insert(schemaRelationships).values({
        tenantId,
        name: rel.name,
        sourceEntityTypeId,
        targetEntityTypeId,
        relationshipType,
        cascadeDelete: rel.cascadeDelete,
      });
      relationshipsCreated += 1;
    }
  }

  // Global CRM permission rows (module-scoped, not tenant-scoped).
  // Idempotent on the (module_id, resource, action) unique index. These
  // are distinct tuples from the Phase-2 placeholders
  // (contacts/companies/deals/ai), which 1.9a removes from live DBs.
  let permissionsSeeded = 0;
  for (const perm of CRM_PERMISSIONS) {
    const inserted = await tx
      .insert(permissions)
      .values({
        moduleId: crmModule.id,
        resource: perm.resource,
        action: perm.action,
        description: perm.description,
      })
      .onConflictDoNothing()
      .returning({ id: permissions.id });
    if (inserted.length > 0) permissionsSeeded += 1;
  }

  // Resolve every CRM permission row to its id for granting.
  const crmPermRows = await tx
    .select({
      id: permissions.id,
      resource: permissions.resource,
      action: permissions.action,
    })
    .from(permissions)
    .where(eq(permissions.moduleId, crmModule.id));
  const permIdByKey = new Map(
    crmPermRows.map((p) => [`${p.resource}.${p.action}`, p.id])
  );

  // Look up the tenant's roles by slug — grant only to roles that exist.
  const roleRows = await tx
    .select({ id: roles.id, slug: roles.slug })
    .from(roles)
    .where(eq(roles.tenantId, tenantId));
  const roleIdBySlug = new Map(roleRows.map((r) => [r.slug, r.id]));

  // Grant per DEFAULT_CRM_ROLE_PERMISSIONS. Idempotent on the
  // role_permissions (roleId, permissionId) primary key.
  let grantsCreated = 0;
  for (const [slug, keys] of Object.entries(DEFAULT_CRM_ROLE_PERMISSIONS)) {
    const roleId = roleIdBySlug.get(slug);
    if (!roleId) continue;
    for (const key of keys) {
      const permissionId = permIdByKey.get(key);
      if (!permissionId) continue;
      const inserted = await tx
        .insert(rolePermissions)
        .values({ roleId, permissionId })
        .onConflictDoNothing()
        .returning({ roleId: rolePermissions.roleId });
      if (inserted.length > 0) grantsCreated += 1;
    }
  }

  return {
    moduleId: crmModule.id,
    entityTypeIds,
    relationshipsCreated,
    permissionsSeeded,
    grantsCreated,
  };
}

/**
 * The CRM cardinality vocabulary now aligns 1:1 with the DB
 * `relationship_type` enum (after migration 004 added `many_to_one`).
 * Guard anyway so an unexpected cardinality fails loudly rather than
 * writing a bad enum value.
 */
function toDbRelationshipType(
  cardinality: RelationshipCardinality
): "one_to_many" | "many_to_one" | "many_to_many" {
  if (!DB_RELATIONSHIP_TYPES.has(cardinality)) {
    throw new Error(`Unsupported relationship cardinality: ${cardinality}`);
  }
  return cardinality as "one_to_many" | "many_to_one" | "many_to_many";
}
