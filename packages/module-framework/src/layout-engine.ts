import { and, asc, eq, sql } from "drizzle-orm";
import { db, layouts } from "@adserve/database";
import type {
  Layout,
  LayoutConfig,
  LayoutSection,
  FieldDefinitionWithLabels,
} from "./types";
import { listFieldDefinitions } from "./field-engine";

/**
 * Layout engine.
 *
 * Manages `layouts` rows — per-tenant, per-entity-type page configurations.
 * The `config` JSONB is structured as `LayoutConfig` (sections of fields).
 *
 * Invariants enforced here:
 *   - Every `fieldIds` entry in `config.sections[]` refers to a field
 *     definition that exists for the same (tenantId, entityTypeId).
 *   - At most one layout per (tenantId, entityTypeId, layoutType) can have
 *     `isDefault: true`. Creating/promoting a default demotes any existing
 *     one in the same tx.
 *   - At least one layout per (tenantId, entityTypeId, layoutType) tuple
 *     must exist once any have been created — deletion of the last one
 *     refuses. If no layouts exist, `getDefaultLayout` returns null and
 *     the caller is expected to create one (typically via the activation
 *     flow + `generateDefaultLayoutConfig`).
 *
 * Cross-tenant reads are treated as not-found — we never surface that a
 * field ID exists in another tenant. Tenant-scoped lookups are
 * non-negotiable.
 */

type Tx = typeof db;

/** Mirrors the schema's layout_type enum (packages/database/src/schema/enums.ts). */
export type LayoutType = "detail" | "list" | "create" | "edit" | "card";

const ALLOWED_LAYOUT_TYPES: ReadonlySet<LayoutType> = new Set([
  "detail",
  "list",
  "create",
  "edit",
  "card",
]);

const VALID_COLUMN_COUNTS = new Set([1, 2, 3, 4]);

export interface CreateLayoutInput {
  tenantId: string;
  entityTypeId: string;
  layoutType: LayoutType;
  name: string;
  isDefault?: boolean;
  config: LayoutConfig;
  assignedRoles?: string[];
}

export interface UpdateLayoutConfigArgs {
  layoutId: string;
  tenantId: string;
  config: LayoutConfig;
}

export interface DeleteLayoutArgs {
  layoutId: string;
  tenantId: string;
}

export interface GetDefaultLayoutArgs {
  tenantId: string;
  entityTypeId: string;
  layoutType: LayoutType;
}

export interface GenerateDefaultLayoutConfigArgs {
  tenantId: string;
  entityTypeId: string;
  /**
   * Non-field "widget" panels to append after the field sections (e.g. the
   * account's Brands + Account History panels), so they're part of the default
   * layout and reorderable/hideable in the editor.
   */
  widgets?: { title: string; widget: string }[];
}

export interface ValidateLayoutConfigArgs {
  tenantId: string;
  entityTypeId: string;
  config: LayoutConfig;
}

export interface LayoutValidationError {
  code:
    | "invalid_columns"
    | "field_not_found"
    | "duplicate_field"
    | "invalid_structure";
  message: string;
  details?: Record<string, unknown>;
}

export type LayoutValidationResult =
  | { ok: true }
  | { ok: false; errors: LayoutValidationError[] };

export class LayoutError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "last_layout"
      | "invalid_layout_type"
      | "invalid_config",
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "LayoutError";
  }
}

// ============================================================
// CRUD
// ============================================================

export async function createLayout(
  tx: Tx,
  input: CreateLayoutInput
): Promise<Layout> {
  if (!ALLOWED_LAYOUT_TYPES.has(input.layoutType)) {
    throw new LayoutError(
      `Invalid layout type: ${input.layoutType}`,
      "invalid_layout_type"
    );
  }

  // Structural + reference validation
  const validation = await validateLayoutConfig(tx, {
    tenantId: input.tenantId,
    entityTypeId: input.entityTypeId,
    config: input.config,
  });
  if (!validation.ok) {
    throw new LayoutError(
      "Layout config is invalid.",
      "invalid_config",
      { errors: validation.errors }
    );
  }

  // Promote: if this layout will be the default, demote any existing
  // default for the same (tenantId, entityTypeId, layoutType) tuple
  // first — inside the same tx, so it's atomic.
  if (input.isDefault) {
    await tx
      .update(layouts)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(layouts.tenantId, input.tenantId),
          eq(layouts.entityTypeId, input.entityTypeId),
          eq(layouts.layoutType, input.layoutType),
          eq(layouts.isDefault, true)
        )
      );
  }

  const [row] = await tx
    .insert(layouts)
    .values({
      tenantId: input.tenantId,
      entityTypeId: input.entityTypeId,
      layoutType: input.layoutType,
      name: input.name,
      isDefault: input.isDefault ?? false,
      config: input.config,
      assignedRoles: input.assignedRoles ?? [],
    })
    .returning();
  return row;
}

export async function updateLayoutConfig(
  tx: Tx,
  args: UpdateLayoutConfigArgs
): Promise<Layout> {
  const [existing] = await tx
    .select()
    .from(layouts)
    .where(
      and(eq(layouts.id, args.layoutId), eq(layouts.tenantId, args.tenantId))
    );
  if (!existing) {
    throw new LayoutError(
      `Layout ${args.layoutId} not found in tenant.`,
      "not_found"
    );
  }

  const validation = await validateLayoutConfig(tx, {
    tenantId: args.tenantId,
    entityTypeId: existing.entityTypeId,
    config: args.config,
  });
  if (!validation.ok) {
    throw new LayoutError(
      "Layout config is invalid.",
      "invalid_config",
      { errors: validation.errors }
    );
  }

  const [updated] = await tx
    .update(layouts)
    .set({ config: args.config, updatedAt: new Date() })
    .where(eq(layouts.id, args.layoutId))
    .returning();
  return updated;
}

export async function deleteLayout(
  tx: Tx,
  args: DeleteLayoutArgs
): Promise<void> {
  const [existing] = await tx
    .select()
    .from(layouts)
    .where(
      and(eq(layouts.id, args.layoutId), eq(layouts.tenantId, args.tenantId))
    );
  if (!existing) {
    throw new LayoutError(
      `Layout ${args.layoutId} not found in tenant.`,
      "not_found"
    );
  }

  // Refuse if this is the only layout for (tenantId, entityTypeId, layoutType).
  // Every entity type's layout type must keep at least one row so the UI
  // always has something to render.
  const [{ count }] = await tx
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(layouts)
    .where(
      and(
        eq(layouts.tenantId, args.tenantId),
        eq(layouts.entityTypeId, existing.entityTypeId),
        eq(layouts.layoutType, existing.layoutType)
      )
    );

  if (Number(count) <= 1) {
    throw new LayoutError(
      `Cannot delete the only layout of type "${existing.layoutType}" for this entity type. Create another layout first, or recreate this one with different config.`,
      "last_layout",
      {
        layoutId: existing.id,
        entityTypeId: existing.entityTypeId,
        layoutType: existing.layoutType,
      }
    );
  }

  await tx.delete(layouts).where(eq(layouts.id, args.layoutId));
}

export async function getDefaultLayout(
  tx: Tx,
  args: GetDefaultLayoutArgs
): Promise<Layout | null> {
  // First try: explicit default.
  const explicit = await tx
    .select()
    .from(layouts)
    .where(
      and(
        eq(layouts.tenantId, args.tenantId),
        eq(layouts.entityTypeId, args.entityTypeId),
        eq(layouts.layoutType, args.layoutType),
        eq(layouts.isDefault, true)
      )
    )
    .limit(1);
  if (explicit.length > 0) return explicit[0];

  // Fallback: first by createdAt then id, for stable ordering when no
  // explicit default exists.
  const fallback = await tx
    .select()
    .from(layouts)
    .where(
      and(
        eq(layouts.tenantId, args.tenantId),
        eq(layouts.entityTypeId, args.entityTypeId),
        eq(layouts.layoutType, args.layoutType)
      )
    )
    .orderBy(asc(layouts.createdAt), asc(layouts.id))
    .limit(1);
  return fallback[0] ?? null;
}

// ============================================================
// Generation + validation
// ============================================================

const DEFAULT_GROUP_NAME = "General";
const DEFAULT_SECTION_COLUMNS = 2 as const;

/**
 * Build a sensible default `LayoutConfig` from the entity type's current
 * field definitions. Groups fields by `groupName` (null/empty → "General"),
 * orders sections by the minimum `displayOrder` of any field in that
 * group, orders fields within each section by `displayOrder` then name.
 *
 * Returns the config object only — caller persists via `createLayout`.
 */
export async function generateDefaultLayoutConfig(
  tx: Tx,
  args: GenerateDefaultLayoutConfigArgs
): Promise<LayoutConfig> {
  const fields = await listFieldDefinitions(tx, args);

  const widgetSections: LayoutSection[] = (args.widgets ?? []).map((w) => ({
    title: w.title,
    columns: 1,
    fieldIds: [],
    widget: w.widget,
  }));

  if (fields.length === 0) {
    return { sections: widgetSections };
  }

  // Group by groupName, treating null/empty as DEFAULT_GROUP_NAME.
  const groups = new Map<
    string,
    {
      title: string;
      minDisplayOrder: number;
      fields: FieldDefinitionWithLabels[];
    }
  >();

  for (const f of fields) {
    const group = f.groupName && f.groupName.trim() !== ""
      ? f.groupName
      : DEFAULT_GROUP_NAME;
    const existing = groups.get(group);
    if (existing) {
      existing.fields.push(f);
      if (f.displayOrder < existing.minDisplayOrder) {
        existing.minDisplayOrder = f.displayOrder;
      }
    } else {
      groups.set(group, {
        title: group,
        minDisplayOrder: f.displayOrder,
        fields: [f],
      });
    }
  }

  const sortedSections: LayoutSection[] = Array.from(groups.values())
    .sort((a, b) => a.minDisplayOrder - b.minDisplayOrder)
    .map((g) => {
      const sortedFields = g.fields.slice().sort((a, b) => {
        if (a.displayOrder !== b.displayOrder) {
          return a.displayOrder - b.displayOrder;
        }
        return a.name.localeCompare(b.name);
      });
      return {
        title: g.title,
        columns: DEFAULT_SECTION_COLUMNS,
        fieldIds: sortedFields.map((f) => f.id),
      };
    });

  return { sections: [...sortedSections, ...widgetSections] };
}

/**
 * Validate a layout config against the field definitions that actually
 * exist for the given (tenantId, entityTypeId). Cross-tenant field IDs
 * are treated as `field_not_found` — we never surface that an ID exists
 * in another tenant.
 *
 * Collects all errors rather than failing on the first; the caller (or
 * the UI) can present a complete picture of what's broken.
 */
export async function validateLayoutConfig(
  tx: Tx,
  args: ValidateLayoutConfigArgs
): Promise<LayoutValidationResult> {
  const errors: LayoutValidationError[] = [];

  // Structural shape check.
  if (
    !args.config ||
    typeof args.config !== "object" ||
    !Array.isArray(args.config.sections)
  ) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_structure",
          message: "Layout config must have a `sections` array.",
        },
      ],
    };
  }

  // Field ids for this entity type — used to verify references and
  // implicitly enforce tenant scoping (listFieldDefinitions is
  // tenantId+entityTypeId scoped).
  const fields = await listFieldDefinitions(tx, args);
  const validFieldIds = new Set(fields.map((f) => f.id));

  // Track field ids we've already seen across sections.
  const seenFieldIds = new Set<string>();

  for (let i = 0; i < args.config.sections.length; i++) {
    const section = args.config.sections[i];

    if (!VALID_COLUMN_COUNTS.has(section.columns)) {
      errors.push({
        code: "invalid_columns",
        message: `Section ${i} ("${section.title}"): columns must be 1, 2, 3 or 4 (got ${section.columns}).`,
        details: { sectionIndex: i, columns: section.columns },
      });
    }

    if (!Array.isArray(section.fieldIds)) {
      errors.push({
        code: "invalid_structure",
        message: `Section ${i} ("${section.title}"): fieldIds must be an array.`,
        details: { sectionIndex: i },
      });
      continue;
    }

    for (const fieldId of section.fieldIds) {
      if (!validFieldIds.has(fieldId)) {
        errors.push({
          code: "field_not_found",
          message: `Section ${i} ("${section.title}"): field ${fieldId} does not exist for this entity type.`,
          details: { sectionIndex: i, fieldId },
        });
        continue;
      }
      if (seenFieldIds.has(fieldId)) {
        errors.push({
          code: "duplicate_field",
          message: `Section ${i} ("${section.title}"): field ${fieldId} already appears in another section.`,
          details: { sectionIndex: i, fieldId },
        });
      } else {
        seenFieldIds.add(fieldId);
      }
    }

    // Optional explicit grid items: validate field-cell references + spans.
    // (Spacer cells carry no field; spans out of [1..columns] are clamped at
    // render, so a too-large span is allowed here but a non-positive integer
    // is rejected.)
    if (Array.isArray(section.items)) {
      for (const item of section.items) {
        const span = (item as { span?: unknown }).span;
        if (
          span !== undefined &&
          (typeof span !== "number" || !Number.isInteger(span) || span < 1)
        ) {
          errors.push({
            code: "invalid_columns",
            message: `Section ${i} ("${section.title}"): item span must be a positive integer (got ${String(span)}).`,
            details: { sectionIndex: i },
          });
        }
        if ("fieldId" in item && !validFieldIds.has(item.fieldId)) {
          errors.push({
            code: "field_not_found",
            message: `Section ${i} ("${section.title}"): item field ${item.fieldId} does not exist for this entity type.`,
            details: { sectionIndex: i, fieldId: item.fieldId },
          });
        }
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// Re-export structural types for convenience.
export type { LayoutSection, LayoutConfig };
