"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { coerceFieldValue } from "@adserve/module-framework/client";
import type {
  FieldDefinitionWithLabels,
  LayoutConfig,
} from "@adserve/module-framework";
import { cn } from "@/lib/utils";
import { Panel } from "@/components/ui/panel";
import { FieldRenderer } from "./field-renderer";

export type DynamicFormMode = "create" | "edit" | "view";

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
      const result = coerceFieldValue(f, state[f.slug]);
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
      {layoutConfig.sections.map((section, sIdx) => (
        // Each section is a shaded Panel — distinguishing panel surface from the
        // page background, with the inputs (--background) sitting on the panel.
        <Panel
          key={`${section.title}-${sIdx}`}
          as="section"
          title={section.title}
          aria-label={section.title}
        >
          <div
            className={cn(
              "mt-3 grid gap-4",
              section.columns === 1 && "grid-cols-1",
              section.columns === 2 && "grid-cols-1 sm:grid-cols-2",
              section.columns === 3 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
            )}
          >
            {section.fieldIds.map((fieldId) => {
              const field = fieldsById.get(fieldId);
              if (!field) return null; // shouldn't happen — layout was validated
              const inputId = `${formId}-${field.id}`;
              // A field can be inactive for data-entry — statically
              // (`options.readOnly`) or conditionally (`options.disabledWhen`,
              // e.g. the site-address fields while "Same as account" is ticked).
              // It's rendered read-only (view mode) within the editable form.
              const fieldMode =
                mode !== "view" && fieldInactive(field, state) ? "view" : mode;
              return (
                <FieldRenderer
                  key={field.id}
                  field={field}
                  value={state[field.slug]}
                  onChange={(next) => setSlug(field.slug, next)}
                  mode={fieldMode}
                  error={errors[field.slug] ?? null}
                  locale={locale}
                  inputId={inputId}
                />
              );
            })}
          </div>
        </Panel>
      ))}

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
