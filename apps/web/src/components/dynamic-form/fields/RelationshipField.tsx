"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  RecordPicker,
  recordSearchConfig,
  type RecordSelection,
} from "@/components/crm/record-picker";
import { formatFieldValue } from "../format-field-value";
import {
  FieldShell,
  inputClassName,
  VIEW_EMPTY,
  type FieldComponentProps,
} from "./FieldShell";

/**
 * Relationship field. Driven by the field definition's
 * `options.relationship = { targetSlug, allowCreate }` — it renders the
 * searchable record picker for the target entity (e.g. account → account picker
 * with create-new; reportsTo → contact picker, existing only). The value is a
 * `RecordSelection` the form caller routes into `record_relationships`, never
 * `records.data`. Relationship fields without that config fall back to the
 * Phase-1 UUID text input.
 */
interface RelationshipOptions {
  relationship?: { targetSlug?: string; allowCreate?: boolean };
}

export function RelationshipField(props: FieldComponentProps) {
  const { field, value, onChange, mode, error, locale, inputId } = props;
  const rel = (field.options as RelationshipOptions | null)?.relationship;
  const cfg = useMemo(
    () => (rel?.targetSlug ? recordSearchConfig(rel.targetSlug) : null),
    [rel?.targetSlug]
  );

  if (mode === "view") {
    return (
      <FieldShell field={field} fieldId={inputId} error={error} locale={locale}>
        {cfg
          ? selectionLabel(value) ?? VIEW_EMPTY
          : formatFieldValue(field, value, locale)}
      </FieldShell>
    );
  }

  if (cfg) {
    return (
      <FieldShell field={field} fieldId={inputId} error={error} locale={locale}>
        <RecordPicker
          inputId={inputId}
          invalid={!!error}
          value={(value as RecordSelection | null) ?? null}
          onChange={(next) => onChange(next)}
          entitySegment={cfg.entitySegment}
          searchFieldSlug={cfg.searchFieldSlug}
          placeholder={cfg.placeholder}
          labelOf={cfg.labelOf}
          allowCreate={rel?.allowCreate ?? false}
        />
      </FieldShell>
    );
  }

  // Fallback: Phase-1 raw UUID input for relationship fields without config.
  const str = value === null || value === undefined ? "" : String(value);
  return (
    <FieldShell field={field} fieldId={inputId} error={error} locale={locale}>
      <input
        id={inputId}
        type="text"
        placeholder="00000000-0000-0000-0000-000000000000"
        className={cn(inputClassName, "font-mono")}
        value={str}
        required={field.isRequired ?? false}
        aria-required={field.isRequired ?? false}
        aria-invalid={!!error}
        aria-describedby={error ? `${inputId}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldShell>
  );
}

/** Human label for a stored RecordSelection in view mode. */
function selectionLabel(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const sel = value as RecordSelection;
  if (sel.kind === "existing") return sel.label;
  if (sel.kind === "new") return sel.name;
  return null;
}
