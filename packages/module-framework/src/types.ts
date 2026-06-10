/**
 * Central type module for the module framework.
 *
 * Most types are Drizzle inferred row types from `@adserve/database`,
 * re-exported so engine code and consumers (CRM, future modules) can
 * import everything from one place.
 *
 * A few types extend the inferred shapes:
 *   - `FieldDefinitionWithLabels` — predicts the post-Task-0.2 shape
 *     once the `labels jsonb` migration lands.
 *   - `LayoutConfig` / `LayoutSection` — structured TS shape for what
 *     lives in `layouts.config` JSONB.
 *   - `ValidationCondition` / `ValidationAction` — structured shapes
 *     for what lives in `validation_rules.condition` / `.action` JSONB.
 *     Speculative — Task 0.2's validation adapter will lock these in.
 */
import type {
  activities,
  entityTypes,
  fieldDefinitions,
  layouts,
  recordRelationships,
  records,
  schemaRelationships,
  validationRules,
} from "@adserve/database";

// ============================================================
// Row types — Drizzle inferred from the live schema
// ============================================================

export type EntityType = typeof entityTypes.$inferSelect;
export type EntityTypeInsert = typeof entityTypes.$inferInsert;

export type FieldDefinition = typeof fieldDefinitions.$inferSelect;
export type FieldDefinitionInsert = typeof fieldDefinitions.$inferInsert;

export type SchemaRelationship = typeof schemaRelationships.$inferSelect;
export type SchemaRelationshipInsert = typeof schemaRelationships.$inferInsert;

export type Layout = typeof layouts.$inferSelect;
export type LayoutInsert = typeof layouts.$inferInsert;

export type ValidationRule = typeof validationRules.$inferSelect;
export type ValidationRuleInsert = typeof validationRules.$inferInsert;

// `Record` clashes with TS's built-in utility type — use `RecordRow`.
export type RecordRow = typeof records.$inferSelect;
export type RecordRowInsert = typeof records.$inferInsert;

export type RecordRelationship = typeof recordRelationships.$inferSelect;
export type RecordRelationshipInsert = typeof recordRelationships.$inferInsert;

export type Activity = typeof activities.$inferSelect;
export type ActivityInsert = typeof activities.$inferInsert;

// ============================================================
// Augmented types
// ============================================================

/**
 * Field definition with locale-aware labels. Task 0.2 added the `labels`
 * column to the schema, so this is now a plain alias for the inferred
 * row type — retained as a named export so consumers (engine code, CRM
 * field-definition specs) don't have to switch import names.
 */
export type FieldDefinitionWithLabels = FieldDefinition;

// ============================================================
// Structured JSONB shapes
// ============================================================

/**
 * Structured shape for `layouts.config`. Stored as JSONB; this is the
 * canonical TS representation. Layout engine reads/writes through this
 * type.
 */
/**
 * One cell in a section's grid: either a field (occupying `span` columns) or an
 * empty spacer (a gap, also `span` columns). Spacers let the admin leave parts
 * of a panel empty and push following fields onto a new row. `span` defaults to
 * 1 and is clamped to the section's column count at render.
 */
export type LayoutItem =
  | { fieldId: string; span?: number }
  | { spacer: true; span?: number };

export interface LayoutSection {
  title: string;
  columns: 1 | 2 | 3 | 4;
  /**
   * Field definition IDs in display order — the canonical membership of the
   * section (used for validation + the unplaced-fields calc). When `items` is
   * absent the detail renders these row-major at span 1 (backward compatible).
   */
  fieldIds: string[];
  /**
   * Optional explicit grid layout: field cells (with column `span`) + empty
   * spacer cells, in order. When present it drives rendering; its field cells
   * must match `fieldIds`. Absent → render `fieldIds` at span 1.
   */
  items?: LayoutItem[];
  /**
   * When true the section is configured but NOT rendered on the detail page
   * (show/hide, distinct from removing it — the fields/widget are retained).
   */
  hidden?: boolean;
  /**
   * Marks a non-field "widget" panel (e.g. "brands", "history") rendered by a
   * registered component instead of a field grid; `fieldIds` is empty. Lets
   * special panels be reordered/hidden alongside field panels in the editor.
   */
  widget?: string;
}

export interface LayoutConfig {
  sections: LayoutSection[];
}

/**
 * Structured shape for `validation_rules.condition`. Discriminated by
 * `type`; each variant carries its field reference and any rule-specific
 * parameters.
 *
 * TODO(task-0.2): the validation adapter may need to add/remove variants
 * as the rule engine matures. The list below covers the cases the field
 * engine's `isRequired`/`isUnique` flags translate to, plus the common
 * length / value / regex rules from the original plan.
 */
export type ValidationCondition =
  | { type: "required"; fieldId: string }
  | { type: "min_length"; fieldId: string; value: number }
  | { type: "max_length"; fieldId: string; value: number }
  | { type: "min_value"; fieldId: string; value: number }
  | { type: "max_value"; fieldId: string; value: number }
  | { type: "regex"; fieldId: string; pattern: string }
  | { type: "unique_in_tenant"; fieldId: string };

/**
 * Structured shape for `validation_rules.action`. Currently a small
 * set; will grow as the engine adds warn-only and computed-default
 * behaviors.
 */
export type ValidationAction =
  | { type: "block_save" }
  | { type: "warn"; severity: "info" | "warning" };

// ============================================================
// Cross-cutting types
// ============================================================

/**
 * The field types enum mirrors `packages/database/src/schema/enums.ts`'s
 * `fieldTypeEnum`. Re-declared as a TS union for use in stubs and
 * factories that don't have a Drizzle row to infer from. Keep in sync
 * with the schema enum or insertion via the field engine will fail at
 * the DB layer.
 *
 * Phase 1 handles a subset in coerceFieldValue:
 *   text, long_text, number, currency, date, datetime, boolean, select,
 *   multi_select, email, phone, url, relationship
 *
 * Phase 2+ types (user, file, image, json, computed, ai_generated) are
 * valid schema values but not yet supported by the field engine; they
 * coerce as opaque pass-through with no validation.
 */
export type FieldType =
  | "text"
  | "long_text"
  | "number"
  | "currency"
  | "date"
  | "datetime"
  | "boolean"
  | "select"
  | "multi_select"
  | "email"
  | "phone"
  | "url"
  | "relationship"
  | "user"
  | "file"
  | "image"
  | "json"
  | "computed"
  | "ai_generated";

/**
 * A currency value as stored in `records.data` for currency-typed
 * fields. Amount is in the smallest unit of the currency (e.g. pence
 * for GBP, cents for USD); the field engine stores integers, the UI
 * formats with decimals.
 */
export interface CurrencyValue {
  amount: number;
  currency: string; // ISO-4217 code (e.g. "GBP", "USD")
}

/**
 * A locale-tagged label map. Use for `field_definitions.labels` and
 * any other i18n-aware label storage. Always populated with at least
 * "en" as the fallback.
 */
export type LocalizedLabel = Record<string, string>;

/**
 * Resolve a localized label with `en` fallback. Provided as a helper
 * so consumers (UI, prompt builders, etc.) don't reinvent the lookup.
 */
export function resolveLabel(
  labels: LocalizedLabel,
  locale: string,
  fallbackName: string
): string {
  return labels[locale] ?? labels["en"] ?? fallbackName;
}
