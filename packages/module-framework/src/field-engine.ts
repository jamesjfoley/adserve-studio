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
// coerceFieldValue — pure function (no DB)
// ============================================================

export type CoercionResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } };

/**
 * Shape the field-engine needs to coerce a value. Either pass a full
 * `FieldDefinitionWithLabels` row or construct a partial inline (handy
 * for tests).
 */
export interface FieldCoercionSpec {
  fieldType: FieldType;
  isRequired?: boolean | null;
  options?: Record<string, unknown> | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

function err(code: string, message: string): CoercionResult {
  return { ok: false, error: { code, message } };
}

function ok(value: unknown): CoercionResult {
  return { ok: true, value };
}

function isNullish(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

export function coerceFieldValue(
  field: FieldCoercionSpec,
  value: unknown
): CoercionResult {
  // ---- required + nullable handling ----
  if (isNullish(value)) {
    if (field.isRequired) {
      return err("required", "This field is required.");
    }
    return ok(null);
  }

  const opts = (field.options ?? {}) as Record<string, unknown>;

  switch (field.fieldType) {
    // ---------- text / long_text ----------
    case "text":
    case "long_text": {
      if (typeof value !== "string") {
        return err("type", "Expected a string.");
      }
      const min = typeof opts.minLength === "number" ? opts.minLength : null;
      const max = typeof opts.maxLength === "number" ? opts.maxLength : null;
      if (min !== null && value.length < min) {
        return err("min_length", `Must be at least ${min} characters.`);
      }
      if (max !== null && value.length > max) {
        return err("max_length", `Must be at most ${max} characters.`);
      }
      if (typeof opts.pattern === "string") {
        try {
          if (!new RegExp(opts.pattern).test(value)) {
            return err("pattern", "Value does not match the required format.");
          }
        } catch {
          return err("invalid_pattern", "Field has an invalid regex pattern.");
        }
      }
      return ok(value);
    }

    // ---------- number ----------
    case "number": {
      let n: number;
      if (typeof value === "number") {
        n = value;
      } else if (typeof value === "string" && value.trim() !== "") {
        n = Number(value);
      } else {
        return err("type", "Expected a number.");
      }
      if (!Number.isFinite(n)) {
        return err("type", "Value is not a finite number.");
      }
      if (opts.integer === true && !Number.isInteger(n)) {
        return err("integer", "Value must be an integer.");
      }
      const min = typeof opts.min === "number" ? opts.min : null;
      const max = typeof opts.max === "number" ? opts.max : null;
      if (min !== null && n < min) {
        return err("min_value", `Must be at least ${min}.`);
      }
      if (max !== null && n > max) {
        return err("max_value", `Must be at most ${max}.`);
      }
      return ok(n);
    }

    // ---------- currency ----------
    case "currency": {
      if (typeof value !== "object" || value === null) {
        return err("type", "Expected an object with amount and currency.");
      }
      const v = value as { amount?: unknown; currency?: unknown };
      if (typeof v.currency !== "string" || !CURRENCY_CODE_RE.test(v.currency)) {
        return err(
          "invalid_currency",
          "currency must be a 3-letter uppercase ISO-4217 code."
        );
      }
      let amount: number;
      if (typeof v.amount === "number") amount = v.amount;
      else if (typeof v.amount === "string" && v.amount.trim() !== "")
        amount = Number(v.amount);
      else return err("type", "amount must be a number.");
      if (!Number.isFinite(amount)) {
        return err("type", "amount is not a finite number.");
      }
      const allowed = opts.allowedCurrencies;
      if (Array.isArray(allowed) && !allowed.includes(v.currency)) {
        return err(
          "currency_not_allowed",
          `Currency ${v.currency} is not in the allowed list.`
        );
      }
      return ok({ amount, currency: v.currency });
    }

    // ---------- date ----------
    case "date": {
      if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
          return err("type", "Invalid date.");
        }
        return ok(value.toISOString().slice(0, 10));
      }
      if (typeof value === "string" && DATE_RE.test(value)) {
        const d = new Date(value + "T00:00:00Z");
        if (Number.isNaN(d.getTime())) return err("type", "Invalid date.");
        return ok(value);
      }
      return err("type", "Expected a date in YYYY-MM-DD format.");
    }

    // ---------- datetime ----------
    case "datetime": {
      if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
          return err("type", "Invalid datetime.");
        }
        return ok(value.toISOString());
      }
      if (typeof value === "string") {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) {
          return err("type", "Expected an ISO datetime string.");
        }
        return ok(d.toISOString());
      }
      return err("type", "Expected an ISO datetime string or Date.");
    }

    // ---------- boolean ----------
    case "boolean": {
      if (typeof value === "boolean") return ok(value);
      if (value === "true") return ok(true);
      if (value === "false") return ok(false);
      return err("type", "Expected true or false.");
    }

    // ---------- select ----------
    case "select": {
      if (typeof value !== "string") {
        return err("type", "Expected a string choice value.");
      }
      const choices = (opts.choices ?? []) as Array<{ value: string }>;
      if (
        choices.length > 0 &&
        !choices.some((c) => c?.value === value)
      ) {
        return err(
          "not_in_choices",
          `Value "${value}" is not one of the allowed choices.`
        );
      }
      return ok(value);
    }

    // ---------- multi_select ----------
    case "multi_select": {
      if (!Array.isArray(value)) {
        return err("type", "Expected an array of choice values.");
      }
      const choices = (opts.choices ?? []) as Array<{ value: string }>;
      const allowedSet = new Set(choices.map((c) => c?.value));
      for (const v of value) {
        if (typeof v !== "string") {
          return err("type", "Every element must be a string.");
        }
        if (choices.length > 0 && !allowedSet.has(v)) {
          return err(
            "not_in_choices",
            `Value "${v}" is not one of the allowed choices.`
          );
        }
      }
      return ok(value);
    }

    // ---------- email ----------
    case "email": {
      if (typeof value !== "string" || !EMAIL_RE.test(value)) {
        return err("type", "Expected a valid email address.");
      }
      return ok(value.trim());
    }

    // ---------- phone ----------
    case "phone": {
      // International phone validation is messy; Phase 1 just accepts
      // any non-empty string and trims whitespace.
      if (typeof value !== "string") {
        return err("type", "Expected a phone number string.");
      }
      return ok(value.trim());
    }

    // ---------- url ----------
    case "url": {
      if (typeof value !== "string") {
        return err("type", "Expected a URL string.");
      }
      try {
        // Constructor throws on invalid URL.
        new URL(value);
      } catch {
        return err("type", "Expected a valid URL.");
      }
      return ok(value);
    }

    // ---------- relationship ----------
    case "relationship": {
      // The caller is responsible for routing this UUID into
      // record_relationships, not records.data.
      if (typeof value !== "string" || !UUID_RE.test(value)) {
        return err("type", "Expected a record UUID.");
      }
      return ok(value);
    }

    // ---------- Phase 2+ types — opaque pass-through ----------
    case "user":
    case "file":
    case "image":
    case "json":
    case "computed":
    case "ai_generated":
      return ok(value);

    default: {
      // Exhaustiveness check — TS catches at compile time.
      const _: never = field.fieldType;
      void _;
      return err("unsupported_type", `Unsupported field type.`);
    }
  }
}
