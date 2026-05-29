import { eq } from "drizzle-orm";
import { db, entityTypes } from "@adserve/database";
import type { EntityType, FieldType, LocalizedLabel } from "./types";
import { getEntityTypeBySlug, registerEntityType } from "./entity-registry";
import { createFieldDefinition, listFieldDefinitions } from "./field-engine";
import {
  createLayout,
  generateDefaultLayoutConfig,
  getDefaultLayout,
  type LayoutType,
} from "./layout-engine";

/**
 * Generic entity-type provisioning — the reusable framework primitive a
 * module's activation flow calls once per entity type. It composes the
 * registry + field engine + layout engine into one idempotent unit:
 *
 *   1. Register the entity type (idempotent on (tenantId, slug)).
 *   2. Create any field definitions that don't yet exist (by slug).
 *   3. Set `nameFieldId` to the declared name field (once).
 *   4. Merge extra `settings` without clobbering existing keys.
 *   5. Create a default layout (default type "detail") if none exists.
 *
 * Re-running is a no-op beyond filling gaps: existing fields/layout are
 * left untouched, so module re-activation (Task 1.9a) is safe.
 */

type Tx = typeof db;

export interface ProvisionFieldSpec {
  slug: string;
  name: string;
  labels?: LocalizedLabel;
  fieldType: FieldType;
  isRequired?: boolean;
  isUnique?: boolean;
  isSystem?: boolean;
  defaultValue?: unknown;
  options?: Record<string, unknown>;
  displayOrder?: number;
  groupName?: string | null;
  description?: string | null;
  isSearchable?: boolean;
  isFilterable?: boolean;
}

export interface ProvisionEntityTypeInput {
  tenantId: string;
  moduleId: string;
  slug: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  isSystem?: boolean;
  fields: ProvisionFieldSpec[];
  /** Field slug whose row becomes the entity's display field (entity_types.nameFieldId). */
  nameFieldSlug?: string;
  /** Layout type for the generated default layout. Defaults to "detail". */
  defaultLayoutType?: LayoutType;
  /** Extra settings merged into entity_types.settings — only keys not already present are written. */
  settings?: Record<string, unknown>;
}

export interface ProvisionEntityTypeResult {
  entityType: EntityType;
  /** True if the entity-type row was created on this run (vs. already existed). */
  created: boolean;
  /** Number of field definitions created on this run (0 on a clean re-run). */
  fieldsCreated: number;
  /** True if a default layout was created on this run. */
  layoutCreated: boolean;
}

export async function provisionEntityType(
  tx: Tx,
  input: ProvisionEntityTypeInput
): Promise<ProvisionEntityTypeResult> {
  const layoutType: LayoutType = input.defaultLayoutType ?? "detail";

  // 1. Register entity type (idempotent). Track whether it pre-existed.
  const before = await getEntityTypeBySlug(tx, {
    tenantId: input.tenantId,
    slug: input.slug,
  });
  let entityType = await registerEntityType(tx, {
    tenantId: input.tenantId,
    moduleId: input.moduleId,
    name: input.name,
    slug: input.slug,
    description: input.description ?? null,
    icon: input.icon ?? null,
    isSystem: input.isSystem ?? false,
  });
  const created = !before;

  // 2. Create only the field definitions that don't already exist.
  const existingFields = await listFieldDefinitions(tx, {
    tenantId: input.tenantId,
    entityTypeId: entityType.id,
  });
  const existingSlugs = new Set(existingFields.map((f) => f.slug));
  let fieldsCreated = 0;
  for (const f of input.fields) {
    if (existingSlugs.has(f.slug)) continue;
    await createFieldDefinition(tx, {
      tenantId: input.tenantId,
      entityTypeId: entityType.id,
      name: f.name,
      slug: f.slug,
      fieldType: f.fieldType,
      labels: f.labels,
      isRequired: f.isRequired,
      isUnique: f.isUnique,
      isSystem: f.isSystem,
      defaultValue: f.defaultValue,
      options: f.options,
      displayOrder: f.displayOrder,
      groupName: f.groupName ?? null,
      description: f.description ?? null,
      isSearchable: f.isSearchable,
      isFilterable: f.isFilterable,
    });
    fieldsCreated += 1;
  }

  // 3 + 4. Patch nameFieldId (once) and merge settings (only-if-absent).
  const allFields = await listFieldDefinitions(tx, {
    tenantId: input.tenantId,
    entityTypeId: entityType.id,
  });
  const patch: Partial<typeof entityTypes.$inferInsert> = {};

  if (input.nameFieldSlug && !entityType.nameFieldId) {
    const nameField = allFields.find((f) => f.slug === input.nameFieldSlug);
    if (nameField) patch.nameFieldId = nameField.id;
  }

  if (input.settings) {
    const current = (entityType.settings as Record<string, unknown>) ?? {};
    const merged = { ...current };
    let changed = false;
    for (const [key, value] of Object.entries(input.settings)) {
      if (!(key in merged)) {
        merged[key] = value;
        changed = true;
      }
    }
    if (changed) patch.settings = merged;
  }

  if (Object.keys(patch).length > 0) {
    patch.updatedAt = new Date();
    const [updated] = await tx
      .update(entityTypes)
      .set(patch)
      .where(eq(entityTypes.id, entityType.id))
      .returning();
    if (updated) entityType = updated;
  }

  // 5. Default layout — create only if none exists for this layout type.
  let layoutCreated = false;
  const existingLayout = await getDefaultLayout(tx, {
    tenantId: input.tenantId,
    entityTypeId: entityType.id,
    layoutType,
  });
  if (!existingLayout) {
    const config = await generateDefaultLayoutConfig(tx, {
      tenantId: input.tenantId,
      entityTypeId: entityType.id,
    });
    if (config.sections.length > 0) {
      await createLayout(tx, {
        tenantId: input.tenantId,
        entityTypeId: entityType.id,
        layoutType,
        name: `${input.name} ${layoutType}`,
        isDefault: true,
        config,
      });
      layoutCreated = true;
    }
  }

  return { entityType, created, fieldsCreated, layoutCreated };
}
