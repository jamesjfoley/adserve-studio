"use client";

import { FieldShell, type FieldComponentProps } from "./FieldShell";

export function BooleanField(props: FieldComponentProps) {
  const { field, value, onChange, mode, error, locale, inputId } = props;
  const bool =
    value === true ||
    value === "true" ||
    (typeof value === "string" && value.toLowerCase() === "true");

  if (mode === "view") {
    // Show the boolean as a read-only checkbox, not "Yes / No" text.
    return (
      <FieldShell
        field={field}
        fieldId={inputId}
        error={error}
        locale={locale}
      >
        <input
          id={inputId}
          type="checkbox"
          className="h-4 w-4 rounded border-[var(--border)]"
          checked={bool}
          disabled
          readOnly
          aria-readonly="true"
        />
      </FieldShell>
    );
  }

  return (
    <FieldShell
      field={field}
      fieldId={inputId}
      error={error}
      locale={locale}
    >
      <label className="inline-flex items-center gap-2 text-sm">
        <input
          id={inputId}
          type="checkbox"
          className="h-4 w-4 rounded border-[var(--border)]"
          checked={bool}
          aria-required={field.isRequired ?? false}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="text-[var(--muted-foreground)]">
          {bool ? "Yes" : "No"}
        </span>
      </label>
    </FieldShell>
  );
}
