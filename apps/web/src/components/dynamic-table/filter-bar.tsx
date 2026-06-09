"use client";

import { useMemo, useState } from "react";
import { resolveLabel } from "@adserve/module-framework/client";
import type {
  FieldDefinitionWithLabels,
  LocalizedLabel,
} from "@adserve/module-framework";
import {
  operatorsForType,
  type FilterOperator,
  type OperatorInputKind,
} from "./operators";
import type { Filter, FilterState } from "./types";

interface Choice {
  value: string;
  label: string;
}

function readChoices(field: FieldDefinitionWithLabels): Choice[] {
  const opts = (field.options as { choices?: Choice[] }) ?? {};
  return Array.isArray(opts.choices) ? opts.choices : [];
}

function defaultValueForKind(
  kind: OperatorInputKind
): string | [string, string] | null {
  if (kind === "none") return null;
  if (kind.startsWith("between")) return ["", ""];
  return "";
}

const controlClass =
  "rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-2 py-1.5 text-sm";

interface FilterBarProps {
  fields: FieldDefinitionWithLabels[];
  filterState: FilterState;
  onFiltersChange: (next: FilterState) => void;
  locale?: string;
}

/**
 * Draft-then-commit filter bar. Edits stay local; `onFiltersChange`
 * fires only on Apply (or Clear) — never per keystroke — so the server
 * runs at most one COUNT+query per committed change.
 */
export function FilterBar({
  fields,
  filterState,
  onFiltersChange,
  locale,
}: FilterBarProps) {
  const fieldBySlug = useMemo(
    () => new Map(fields.map((f) => [f.slug, f])),
    [fields]
  );
  const filterableFields = useMemo(
    () => fields.filter((f) => operatorsForType(f.fieldType).length > 0),
    [fields]
  );

  const [draft, setDraft] = useState<Filter[]>(filterState.filters);
  const [includeArchived, setIncludeArchived] = useState(
    filterState.includeArchived
  );

  function labelFor(field: FieldDefinitionWithLabels): string {
    return resolveLabel(
      (field.labels as LocalizedLabel) ?? {},
      locale ?? "en",
      field.name
    );
  }

  function inputKindFor(filter: Filter): OperatorInputKind {
    const field = fieldBySlug.get(filter.fieldSlug);
    if (!field) return "none";
    const spec = operatorsForType(field.fieldType).find(
      (o) => o.value === filter.operator
    );
    return spec?.input ?? "none";
  }

  function addFilter(slug: string) {
    const field = fieldBySlug.get(slug);
    if (!field) return;
    const ops = operatorsForType(field.fieldType);
    if (ops.length === 0) return;
    const first = ops[0];
    setDraft((d) => [
      ...d,
      {
        fieldSlug: slug,
        operator: first.value,
        value: defaultValueForKind(first.input),
      },
    ]);
  }

  function patchFilter(index: number, patch: Partial<Filter>) {
    setDraft((d) => d.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function removeFilter(index: number) {
    setDraft((d) => d.filter((_, i) => i !== index));
  }

  function changeOperator(index: number, operator: FilterOperator) {
    const filter = draft[index];
    const field = fieldBySlug.get(filter.fieldSlug);
    const spec = field
      ? operatorsForType(field.fieldType).find((o) => o.value === operator)
      : undefined;
    patchFilter(index, {
      operator,
      value: defaultValueForKind(spec?.input ?? "none"),
    });
  }

  // "between" low ≤ high check. Incomplete (either side blank) is not an
  // ordering error — Apply stays enabled, the server treats blanks as
  // open-ended.
  function betweenInvalid(filter: Filter): boolean {
    const kind = inputKindFor(filter);
    if (!kind.startsWith("between")) return false;
    if (!Array.isArray(filter.value)) return false;
    const [low, high] = filter.value;
    if (low === "" || high === "") return false;
    if (kind === "between-number") return Number(low) > Number(high);
    return low > high; // ISO date / datetime-local strings sort lexically
  }

  const anyInvalid = draft.some(betweenInvalid);

  function apply() {
    if (anyInvalid) return;
    onFiltersChange({ filters: draft, includeArchived });
  }

  function clear() {
    setDraft([]);
    setIncludeArchived(false);
    onFiltersChange({ filters: [], includeArchived: false });
  }

  function renderValueInput(filter: Filter, index: number) {
    const field = fieldBySlug.get(filter.fieldSlug);
    if (!field) return null;
    const label = labelFor(field);
    const kind = inputKindFor(filter);

    if (kind === "none") return null;

    if (kind === "select") {
      const choices = readChoices(field);
      const value = typeof filter.value === "string" ? filter.value : "";
      return (
        <select
          aria-label={`${label} value`}
          className={controlClass}
          value={value}
          onChange={(e) => patchFilter(index, { value: e.target.value })}
        >
          <option value="">— Select —</option>
          {choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      );
    }

    if (kind.startsWith("between")) {
      const inputType =
        kind === "between-number"
          ? "number"
          : kind === "between-datetime"
            ? "datetime-local"
            : "date";
      const [low, high] = Array.isArray(filter.value)
        ? filter.value
        : ["", ""];
      const invalid = betweenInvalid(filter);
      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <input
              type={inputType}
              aria-label={`${label} from`}
              aria-invalid={invalid}
              className={controlClass}
              value={low}
              onChange={(e) =>
                patchFilter(index, { value: [e.target.value, high] })
              }
            />
            <span className="text-xs text-[var(--muted-foreground)]">and</span>
            <input
              type={inputType}
              aria-label={`${label} to`}
              aria-invalid={invalid}
              className={controlClass}
              value={high}
              onChange={(e) =>
                patchFilter(index, { value: [low, e.target.value] })
              }
            />
          </div>
          {invalid ? (
            <p role="alert" className="text-xs text-red-600">
              From must be less than or equal to To.
            </p>
          ) : null}
        </div>
      );
    }

    const inputType =
      kind === "number"
        ? "number"
        : kind === "date"
          ? "date"
          : kind === "datetime"
            ? "datetime-local"
            : "text";
    const value = typeof filter.value === "string" ? filter.value : "";
    return (
      <input
        type={inputType}
        aria-label={`${label} value`}
        className={controlClass}
        value={value}
        onChange={(e) => patchFilter(index, { value: e.target.value })}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Add filter"
          className={controlClass}
          value=""
          onChange={(e) => {
            if (e.target.value) addFilter(e.target.value);
          }}
        >
          <option value="">+ Add filter…</option>
          {filterableFields.map((f) => (
            <option key={f.id} value={f.slug}>
              {labelFor(f)}
            </option>
          ))}
        </select>

        <label className="inline-flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Include archived
        </label>

        <div className="flex-1" />

        <button
          type="button"
          onClick={apply}
          disabled={anyInvalid}
          className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:brightness-95 disabled:opacity-50"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={clear}
          className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm font-medium hover:bg-[var(--muted)]"
        >
          Clear
        </button>
      </div>

      {draft.length > 0 ? (
        <ul className="space-y-2">
          {draft.map((filter, index) => {
            const field = fieldBySlug.get(filter.fieldSlug);
            if (!field) return null;
            const label = labelFor(field);
            const ops = operatorsForType(field.fieldType);
            return (
              <li
                key={`${filter.fieldSlug}-${index}`}
                className="flex flex-wrap items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-2"
              >
                <span className="py-1.5 text-sm font-medium">{label}</span>
                <select
                  aria-label={`${label} operator`}
                  className={controlClass}
                  value={filter.operator}
                  onChange={(e) =>
                    changeOperator(index, e.target.value as FilterOperator)
                  }
                >
                  {ops.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {renderValueInput(filter, index)}
                <button
                  type="button"
                  aria-label={`Remove ${label} filter`}
                  onClick={() => removeFilter(index)}
                  className="ml-auto rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs hover:bg-[var(--muted)]"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
