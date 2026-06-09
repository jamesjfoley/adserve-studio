"use client";

import { cn } from "@/lib/utils";
import type { SerializedRecord } from "@/lib/crm/serialize";
import { AccountPicker } from "@/components/crm/account-picker";
import { RecordPicker, type RecordSelection } from "@/components/crm/record-picker";
import { formatFieldValue } from "../format-field-value";
import {
  FieldShell,
  inputClassName,
  VIEW_EMPTY,
  type FieldComponentProps,
} from "./FieldShell";

/**
 * Relationship field. The CRM's relationship fields render an appropriate
 * inline picker; the value is a `RecordSelection` (existing id or, where
 * allowed, a new name) that the form caller routes into `record_relationships`,
 * never `records.data`.
 *
 *  - `account`   → searchable account picker (with inline create-new).
 *  - `reportsTo` → searchable contact picker (existing only — the manager).
 *
 * Prototype scope: keyed on `field.slug`. The production version should drive
 * the target entity / create-ability from the field definition's settings
 * rather than this slug map (see docs/prototypes/crm/SPEC.md). Any other
 * relationship field falls back to the Phase-1 UUID text input.
 */

function contactLabel(rec: SerializedRecord): string {
  const fn = typeof rec.data.firstName === "string" ? rec.data.firstName : "";
  const ln = typeof rec.data.lastName === "string" ? rec.data.lastName : "";
  const full = `${fn} ${ln}`.trim();
  if (full !== "") return full;
  const name = rec.data.name;
  return typeof name === "string" && name.trim() !== "" ? name : rec.id;
}

export function RelationshipField(props: FieldComponentProps) {
  const { field, value, onChange, mode, error, locale, inputId } = props;
  const isAccount = field.slug === "account";
  const isReportsTo = field.slug === "reportsTo";
  const isPicker = isAccount || isReportsTo;

  if (mode === "view") {
    return (
      <FieldShell field={field} fieldId={inputId} error={error} locale={locale}>
        {isPicker
          ? selectionLabel(value) ?? VIEW_EMPTY
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
          value={(value as RecordSelection | null) ?? null}
          onChange={(next) => onChange(next)}
        />
      </FieldShell>
    );
  }

  if (isReportsTo) {
    return (
      <FieldShell field={field} fieldId={inputId} error={error} locale={locale}>
        <RecordPicker
          inputId={inputId}
          invalid={!!error}
          value={(value as RecordSelection | null) ?? null}
          onChange={(next) => onChange(next)}
          entitySegment="contacts"
          searchFieldSlug="lastName"
          placeholder="Search contacts by last name…"
          allowCreate={false}
          labelOf={contactLabel}
        />
      </FieldShell>
    );
  }

  // Fallback: Phase-1 raw UUID input for non-picker relationships.
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
