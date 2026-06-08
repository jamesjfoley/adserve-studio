"use client";

import { cn } from "@/lib/utils";
import {
  AccountPicker,
  type AccountSelection,
} from "@/components/crm/account-picker";
import { formatFieldValue } from "../format-field-value";
import {
  FieldShell,
  inputClassName,
  VIEW_EMPTY,
  type FieldComponentProps,
} from "./FieldShell";

/**
 * Relationship field. The `account` relationship (contact → account) renders
 * the searchable, inline-create account picker so it looks like any other field
 * on the form and is placeable by the admin via the layout editor. The picker's
 * value is an `AccountSelection` (existing id or new name); the form caller
 * routes it into `record_relationships`, never `records.data`.
 *
 * Prototype scope: the picker is keyed on `field.slug === "account"`. The
 * production version should read the relationship target from the field
 * definition's settings rather than hardcoding the slug (see
 * docs/prototypes/crm/SPEC.md). Any other relationship field falls back to the
 * Phase-1 UUID text input.
 */
export function RelationshipField(props: FieldComponentProps) {
  const { field, value, onChange, mode, error, locale, inputId } = props;
  const isAccount = field.slug === "account";

  if (mode === "view") {
    return (
      <FieldShell field={field} fieldId={inputId} error={error} locale={locale}>
        {isAccount
          ? accountSelectionLabel(value) ?? VIEW_EMPTY
          : formatFieldValue(field, value, locale)}
      </FieldShell>
    );
  }

  if (isAccount) {
    return (
      <FieldShell field={field} fieldId={inputId} error={error} locale={locale}>
        <AccountPicker
          inputId={inputId}
          invalid={!!error}
          value={(value as AccountSelection | null) ?? null}
          onChange={(next) => onChange(next)}
        />
      </FieldShell>
    );
  }

  // Fallback: Phase-1 raw UUID input for non-account relationships.
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

/** Human label for a stored AccountSelection in view mode. */
function accountSelectionLabel(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const sel = value as AccountSelection;
  if (sel.kind === "existing") return sel.label;
  if (sel.kind === "new") return sel.name;
  return null;
}
