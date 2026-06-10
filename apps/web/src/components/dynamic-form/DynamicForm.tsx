"use client";

import {
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { coerceFieldValue } from "@adserve/module-framework/client";
import type {
  FieldDefinitionWithLabels,
  LayoutConfig,
  LayoutItem,
  LayoutSection,
} from "@adserve/module-framework";
import { cn } from "@/lib/utils";
import { CollapsiblePanel } from "@/components/ui/collapsible-panel";
import { FieldRenderer } from "./field-renderer";

export type DynamicFormMode = "create" | "edit" | "view";

/**
 * The grid cells of a section: its explicit `items` (field + spacer cells with
 * spans) when present, else its `fieldIds` as span-1 field cells (backward
 * compatible with layouts saved before the items model).
 */
function sectionItems(section: LayoutSection): LayoutItem[] {
  if (section.items && section.items.length > 0) return section.items;
  return section.fieldIds.map((fieldId) => ({ fieldId }));
}

export interface DynamicFormProps {
  layoutConfig: LayoutConfig;
  fields: FieldDefinitionWithLabels[];
  /** Initial data keyed by field slug. Null/undefined → create mode defaults. */
  initialData: Record<string, unknown> | null;
  mode: DynamicFormMode;
  /**
   * Called after successful client-side coercion. The argument is keyed
   * by field slug, with values coerced to their declared types (numbers
   * are numbers, not strings, etc.).
   *
   * The caller routes the data into the right place — system fields,
   * custom fields, record_relationships for relationship-type slugs.
   */
  onSubmit?: (validated: Record<string, unknown>) => Promise<void> | void;
  /** Optional async failure message to surface in the form footer. */
  submitError?: string | null;
  submitLabel?: string;
  /** Locale for label resolution + value formatting. Defaults to "en". */
  locale?: string;
  className?: string;
  /**
   * Renderers for non-field "widget" layout sections, keyed by `section.widget`
   * (e.g. { brands: <BrandsPanel/>, history: <RecordHistoryPanel/> }). A widget
   * section renders its node in place (the component supplies its own panel) so
   * special panels participate in the layout's order + show/hide.
   */
  widgetRenderers?: Record<string, ReactNode>;
}

/**
 * Whether a field is inactive (read-only) for data entry. Driven by the field
 * definition's `options`:
 *   - `readOnly: true` — always inactive (admin-locked field).
 *   - `disabledWhen: { field, equals }` — inactive when another field's current
 *     value equals `equals` (e.g. site-address fields while
 *     `sameAsAccountAddress` is true).
 */
function fieldInactive(
  field: FieldDefinitionWithLabels,
  state: Record<string, unknown>
): boolean {
  const opts = (field.options as Record<string, unknown> | null) ?? {};
  if (opts.readOnly === true) return true;
  const dw = opts.disabledWhen as
    | { field?: string; equals?: unknown }
    | undefined;
  if (dw && typeof dw.field === "string") return state[dw.field] === dw.equals;
  return false;
}

/**
 * The slug a field mirrors FROM (`options.mirrorFrom`), or null. A mirrored
 * field copies the source's value live WHILE it is inactive — e.g. the billing
 * address fields mirror the matching site-address field while "Billing same as
 * site" is ticked (which is also what `disabledWhen` keys off). Untick → the
 * field becomes active and independent again.
 */
function mirrorSourceSlug(field: FieldDefinitionWithLabels): string | null {
  const opts = (field.options as Record<string, unknown> | null) ?? {};
  return typeof opts.mirrorFrom === "string" ? opts.mirrorFrom : null;
}

/** Value a field should display / submit: the mirrored source while inactive,
 * else its own state. */
function effectiveValue(
  field: FieldDefinitionWithLabels,
  state: Record<string, unknown>
): unknown {
  const src = mirrorSourceSlug(field);
  if (src && fieldInactive(field, state)) return state[src] ?? null;
  return state[field.slug];
}

interface InitialStateArgs {
  fields: FieldDefinitionWithLabels[];
  initialData: Record<string, unknown> | null;
  mode: DynamicFormMode;
}

/**
 * Build the initial form state, keyed by field slug:
 *   - edit/view: pre-populate from initialData
 *   - create: pre-populate from each field's defaultValue
 */
function buildInitialState({
  fields,
  initialData,
  mode,
}: InitialStateArgs): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const f of fields) {
    if (mode === "create") {
      state[f.slug] = f.defaultValue ?? null;
    } else {
      state[f.slug] = initialData?.[f.slug] ?? null;
    }
  }
  return state;
}

export function DynamicForm({
  layoutConfig,
  fields,
  initialData,
  mode,
  onSubmit,
  submitError,
  submitLabel,
  locale = "en",
  className,
  widgetRenderers,
}: DynamicFormProps) {
  const formId = useId();
  const [state, setState] = useState<Record<string, unknown>>(() =>
    buildInitialState({ fields, initialData, mode })
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Index fields by id for O(1) section→field lookup.
  const fieldsById = useMemo(() => {
    const m = new Map<string, FieldDefinitionWithLabels>();
    for (const f of fields) m.set(f.id, f);
    return m;
  }, [fields]);

  function setSlug(slug: string, next: unknown) {
    setState((prev) => ({ ...prev, [slug]: next }));
    // Clear the inline error for this field on every keystroke; the
    // next submit re-validates.
    if (errors[slug]) {
      setErrors((prev) => {
        const { [slug]: _omit, ...rest } = prev;
        void _omit;
        return rest;
      });
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (mode === "view" || !onSubmit) return;

    const newErrors: Record<string, string> = {};
    const coerced: Record<string, unknown> = {};

    for (const f of fields) {
      // Relationship fields are not stored in records.data and don't carry a
      // UUID here (e.g. the account picker's value is a selection object). The
      // caller routes relationship slugs into record_relationships — pass the
      // raw value through without the records.data coercion/validation.
      if (f.fieldType === "relationship") {
        coerced[f.slug] = state[f.slug];
        continue;
      }
      // Mirrored fields (e.g. billing-while-same-as-site) submit the source's
      // value, so the copied address is persisted.
      const result = coerceFieldValue(f, effectiveValue(f, state));
      if (!result.ok) {
        newErrors[f.slug] = result.error.message;
      } else {
        coerced[f.slug] = result.value;
      }
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setSubmitting(true);
    try {
      await onSubmit(coerced);
    } finally {
      setSubmitting(false);
    }
  }

  const isInteractive = mode !== "view";

  return (
    <form
      onSubmit={handleSubmit}
      className={cn("space-y-8", className)}
      noValidate
      aria-busy={submitting}
    >
      {(() => {
        // Hidden sections are configured but not rendered. The first VISIBLE
        // section is always open + non-collapsible; the rest are collapsible
        // accordions (open by default).
        const firstVisible = layoutConfig.sections.findIndex((s) => !s.hidden);
        return layoutConfig.sections.map((section, sIdx) => {
          if (section.hidden) return null;

          // Widget section: render its registered node in place (the widget
          // supplies its own panel) so it participates in layout order.
          if (section.widget) {
            const node = widgetRenderers?.[section.widget];
            return node ? (
              <div key={`${section.title}-${sIdx}`}>{node}</div>
            ) : null;
          }

          return (
            <CollapsiblePanel
              key={`${section.title}-${sIdx}`}
              as="section"
              title={section.title}
              aria-label={section.title}
              collapsible={sIdx !== firstVisible}
              defaultOpen
            >
              <div
                className="mt-3 grid gap-4"
                style={{
                  gridTemplateColumns: `repeat(${section.columns}, minmax(0, 1fr))`,
                }}
              >
                {sectionItems(section).map((item, itemIdx) => {
                  // Absolute placement: the cell carries a zero-based row/col, so
                  // it's pinned to that exact grid position (no flow). Otherwise
                  // the cell flows row-major (legacy layouts).
                  const hasCoords =
                    typeof item.col === "number" && typeof item.row === "number";
                  const col = hasCoords
                    ? Math.min(Math.max(0, item.col!), section.columns - 1)
                    : null;
                  // Column span, clamped so it never overflows the grid (from its
                  // start column when positioned absolutely).
                  const span = Math.min(
                    Math.max(1, item.span ?? 1),
                    col != null ? section.columns - col : section.columns
                  );
                  const cellStyle: CSSProperties =
                    col != null
                      ? {
                          gridColumn: `${col + 1} / span ${span}`,
                          gridRowStart: (item.row ?? 0) + 1,
                        }
                      : { gridColumn: `span ${span}` };
                  // Spacer cell — leaves a gap / pushes following fields to a
                  // new row. Skipped entirely when absolutely positioned (an
                  // empty position is simply unoccupied).
                  if ("spacer" in item) {
                    if (col != null) return null;
                    return (
                      <div
                        key={`spacer-${itemIdx}`}
                        aria-hidden="true"
                        style={cellStyle}
                      />
                    );
                  }
                  const field = fieldsById.get(item.fieldId);
                  if (!field) return null; // shouldn't happen — layout was validated
                  const inputId = `${formId}-${field.id}`;
                  // A field can be inactive for data-entry — statically
                  // (`options.readOnly`) or conditionally (`options.disabledWhen`,
                  // e.g. site-address fields while "Same as account" is ticked).
                  const fieldMode =
                    mode !== "view" && fieldInactive(field, state) ? "view" : mode;
                  return (
                    <div key={field.id} style={cellStyle}>
                      <FieldRenderer
                        field={field}
                        value={effectiveValue(field, state)}
                        onChange={(next) => setSlug(field.slug, next)}
                        mode={fieldMode}
                        error={errors[field.slug] ?? null}
                        locale={locale}
                        inputId={inputId}
                      />
                    </div>
                  );
                })}
              </div>
            </CollapsiblePanel>
          );
        });
      })()}

      {submitError ? (
        <p className="text-sm text-red-600" role="alert">
          {submitError}
        </p>
      ) : null}

      {isInteractive ? (
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:brightness-95 disabled:opacity-50"
          >
            {submitting
              ? "Saving…"
              : submitLabel ?? (mode === "create" ? "Create" : "Save changes")}
          </button>
        </div>
      ) : null}
    </form>
  );
}
