import { and, asc, eq, sql } from "drizzle-orm";
import {
  db,
  fieldDefinitions,
  records,
} from "@adserve/database";
import type {
  FieldDefinitionWithLabels,
  FieldType,
  LocalizedLabel,
} from "./types";

/**
 * Field definition engine.
 *
 * VALIDATION BOUNDARY — what this engine owns vs what `validation_rules` owns:
 *
 *   This engine owns:
 *     - Type coercion (string "42" → number 42, ISO date strings → Date, etc.)
 *     - Per-field constraints derived from `field_definitions` columns
 *       (isRequired) and `field_definitions.options` JSONB (min/max,
 *       minLength/maxLength, pattern, choices, allowedCurrencies).
 *     - System-field protection (cannot delete; cannot change fieldType).
 *
 *   The `validation_rules` table owns (Task 0.3+):
 *     - Cross-field rules ("opportunity.closeDate must be after
 *       account.createdAt").
 *     - Business-logic rules ("a lost opportunity must have a lostReason").
 *     - Computed defaults.
 *
 *   Heuristic: if the rule can be evaluated with just one field value plus
 *   its definition row, it's a field engine concern. If it needs other
 *   fields, other rows, or DB lookups, it's a `validation_rules` concern.
 *
 *   Uniqueness (`field_definitions.isUnique`) is out of scope for the
 *   pure `coerceFieldValue` function (requires a DB lookup). Enforced
 *   at the API route layer in Phase 1; may move to `validation_rules`
 *   as a `unique_in_tenant` condition in Task 0.3.
 */

type Tx = typeof db;

// ============================================================
// CRUD
// ============================================================

export interface CreateFieldDefinitionInput {
  tenantId: string;
  entityTypeId: string;
  name: string;
  slug: string;
  fieldType: FieldType;
  isRequired?: boolean;
  isUnique?: boolean;
  isSystem?: boolean;
  defaultValue?: unknown;
  labels?: LocalizedLabel;
  options?: Record<string, unknown>;
  displayOrder?: number;
  groupName?: string | null;
  description?: string | null;
  isSearchable?: boolean;
  isFilterable?: boolean;
}

/** All field types accepted by `coerceFieldValue` (Phase 1). */
const SUPPORTED_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  "text",
  "long_text",
  "number",
  "currency",
  "date",
  "datetime",
  "boolean",
  "select",
  "multi_select",
  "email",
  "phone",
  "url",
  "relationship",
  // Phase 2+ types — accepted into field_definitions but no coercion logic
  "user",
  "file",
  "image",
  "json",
  "computed",
  "ai_generated",
]);

export class FieldDefinitionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "invalid_field_type"
      | "duplicate_slug"
      | "not_found"
      | "system_field"
      | "has_data"
      | "type_change_blocked",
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "FieldDefinitionError";
  }
}

export async function createFieldDefinition(
  tx: Tx,
  input: CreateFieldDefinitionInput
): Promise<FieldDefinitionWithLabels> {
  if (!SUPPORTED_FIELD_TYPES.has(input.fieldType)) {
    throw new FieldDefinitionError(
      `Invalid field type: ${input.fieldType}`,
      "invalid_field_type",
      { fieldType: input.fieldType }
    );
  }

  // Auto-populate `labels.en` from `name` if not provided. Explicit
  // labels win; en is only filled if absent.
  const labels: LocalizedLabel = {
    en: input.name,
    ...(input.labels ?? {}),
  };

  try {
    const [row] = await tx
      .insert(fieldDefinitions)
      .values({
        tenantId: input.tenantId,
        entityTypeId: input.entityTypeId,
        name: input.name,
        slug: input.slug,
        fieldType: input.fieldType,
        isRequired: input.isRequired ?? false,
        isUnique: input.isUnique ?? false,
        isSystem: input.isSystem ?? false,
        defaultValue: input.defaultValue ?? null,
        options: input.options ?? {},
        labels,
        displayOrder: input.displayOrder ?? 0,
        groupName: input.groupName ?? null,
        description: input.description ?? null,
        isSearchable: input.isSearchable ?? false,
        isFilterable: input.isFilterable ?? false,
      })
      .returning();
    return row;
  } catch (err: unknown) {
    // Postgres unique_violation: idx_field_defs_entity_slug
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      throw new FieldDefinitionError(
        `A field with slug "${input.slug}" already exists for this entity type.`,
        "duplicate_slug",
        { slug: input.slug, entityTypeId: input.entityTypeId }
      );
    }
    throw err;
  }
}

export interface UpdateFieldDefinitionArgs {
  fieldId: string;
  tenantId: string;
  updates: Partial<
    Pick<
      CreateFieldDefinitionInput,
      | "name"
      | "labels"
      | "description"
      | "displayOrder"
      | "groupName"
      | "options"
      | "isSearchable"
      | "isFilterable"
      | "isRequired"
      | "defaultValue"
    >
  > & {
    /**
     * fieldType is mutable on custom fields only. Attempting to change
     * it on a system field throws `type_change_blocked`.
     */
    fieldType?: FieldType;
  };
}

export async function updateFieldDefinition(
  tx: Tx,
  args: UpdateFieldDefinitionArgs
): Promise<FieldDefinitionWithLabels> {
  const [existing] = await tx
    .select()
    .from(fieldDefinitions)
    .where(
      and(
        eq(fieldDefinitions.id, args.fieldId),
        eq(fieldDefinitions.tenantId, args.tenantId)
      )
    );
  if (!existing) {
    throw new FieldDefinitionError(
      `Field definition ${args.fieldId} not found in tenant.`,
      "not_found"
    );
  }

  if (
    existing.isSystem &&
    args.updates.fieldType !== undefined &&
    args.updates.fieldType !== existing.fieldType
  ) {
    throw new FieldDefinitionError(
      `Cannot change fieldType on system field "${existing.slug}".`,
      "type_change_blocked",
      { fieldId: existing.id, slug: existing.slug }
    );
  }

  // Merge labels: if an update provides labels, deep-merge keeping
  // existing locales the caller didn't touch. Else leave as-is.
  const mergedLabels =
    args.updates.labels !== undefined
      ? {
          ...((existing.labels as LocalizedLabel) ?? {}),
          ...args.updates.labels,
        }
      : undefined;

  const updateSet: Partial<typeof fieldDefinitions.$inferInsert> & {
    updatedAt: Date;
  } = { updatedAt: new Date() };

  if (args.updates.name !== undefined) updateSet.name = args.updates.name;
  if (mergedLabels !== undefined) updateSet.labels = mergedLabels;
  if (args.updates.description !== undefined)
    updateSet.description = args.updates.description;
  if (args.updates.displayOrder !== undefined)
    updateSet.displayOrder = args.updates.displayOrder;
  if (args.updates.groupName !== undefined)
    updateSet.groupName = args.updates.groupName;
  if (args.updates.options !== undefined)
    updateSet.options = args.updates.options;
  if (args.updates.isSearchable !== undefined)
    updateSet.isSearchable = args.updates.isSearchable;
  if (args.updates.isFilterable !== undefined)
    updateSet.isFilterable = args.updates.isFilterable;
  if (args.updates.isRequired !== undefined)
    updateSet.isRequired = args.updates.isRequired;
  if (args.updates.defaultValue !== undefined)
    updateSet.defaultValue = args.updates.defaultValue;
  if (args.updates.fieldType !== undefined && !existing.isSystem)
    updateSet.fieldType = args.updates.fieldType;

  const [updated] = await tx
    .update(fieldDefinitions)
    .set(updateSet)
    .where(eq(fieldDefinitions.id, args.fieldId))
    .returning();
  return updated;
}

export interface DeleteFieldDefinitionArgs {
  fieldId: string;
  tenantId: string;
  /**
   * When true, deletes the field even if `records.data` JSONB contains
   * its slug. The orphaned JSONB keys remain in the records — they just
   * become unreferenced (Postgres does not cascade JSONB).
   *
   * System-field protection is absolute and is NOT bypassed by `force`.
   */
  force?: boolean;
}

export async function deleteFieldDefinition(
  tx: Tx,
  args: DeleteFieldDefinitionArgs
): Promise<void> {
  const [existing] = await tx
    .select()
    .from(fieldDefinitions)
    .where(
      and(
        eq(fieldDefinitions.id, args.fieldId),
        eq(fieldDefinitions.tenantId, args.tenantId)
      )
    );
  if (!existing) {
    throw new FieldDefinitionError(
      `Field definition ${args.fieldId} not found in tenant.`,
      "not_found"
    );
  }

  if (existing.isSystem) {
    throw new FieldDefinitionError(
      `Cannot delete system field "${existing.slug}".`,
      "system_field",
      { fieldId: existing.id, slug: existing.slug }
    );
  }

  if (!args.force) {
    // Count records (in this tenant + entity type) whose JSONB data has
    // this field's slug as a top-level key. Tenant-scoped to avoid
    // counting cross-tenant matches.
    const [{ count }] = await tx
      .select({
        count: sql<number>`COUNT(*)::int`,
      })
      .from(records)
      .where(
        and(
          eq(records.tenantId, args.tenantId),
          eq(records.entityTypeId, existing.entityTypeId),
          sql`${records.data} ? ${existing.slug}`
        )
      );

    if (Number(count) > 0) {
      throw new FieldDefinitionError(
        `Cannot delete field "${existing.slug}": ${count} record(s) have data for it. Pass force=true to delete and orphan the data.`,
        "has_data",
        {
          fieldId: existing.id,
          slug: existing.slug,
          recordCount: Number(count),
        }
      );
    }
  }

  await tx
    .delete(fieldDefinitions)
    .where(eq(fieldDefinitions.id, args.fieldId));
}

export async function listFieldDefinitions(
  tx: Tx,
  args: { tenantId: string; entityTypeId: string }
): Promise<FieldDefinitionWithLabels[]> {
  return tx
    .select()
    .from(fieldDefinitions)
    .where(
      and(
        eq(fieldDefinitions.tenantId, args.tenantId),
        eq(fieldDefinitions.entityTypeId, args.entityTypeId)
      )
    )
    .orderBy(asc(fieldDefinitions.displayOrder), asc(fieldDefinitions.name));
}

// ============================================================
// coerceFieldValue — pure value coercion (no DB)
// ============================================================
// Extracted to ./coercion so client components can import it without pulling
// field-engine's @adserve/database (→ postgres) import into the browser
// bundle. Re-exported here for server-side back-compat.
export {
  coerceFieldValue,
  type CoercionResult,
  type FieldCoercionSpec,
} from "./coercion";
