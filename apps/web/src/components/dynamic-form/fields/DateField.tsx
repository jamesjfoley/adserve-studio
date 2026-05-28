"use client";

import {
  FieldShell,
  inputClassName,
  viewValueClassName,
  VIEW_EMPTY,
  type FieldComponentProps,
} from "./FieldShell";

const DEFAULT_LOCALE = "en-GB";

export function DateField(props: FieldComponentProps) {
  const { field, value, onChange, mode, error, locale, inputId } = props;
  const str = value === null || value === undefined ? "" : String(value);

  if (mode === "view") {
    let display = VIEW_EMPTY;
    if (str) {
      const d = new Date(str + "T00:00:00Z");
      if (!Number.isNaN(d.getTime())) {
        display = new Intl.DateTimeFormat(locale ?? DEFAULT_LOCALE, {
          dateStyle: "medium",
          timeZone: "UTC",
        }).format(d);
      } else {
        display = str;
      }
    }
    return (
      <FieldShell
        field={field}
        fieldId={inputId}
        error={error}
        locale={locale}
      >
        <p className={viewValueClassName}>{display}</p>
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
      <input
        id={inputId}
        type="date"
        className={inputClassName}
        value={str}
        required={field.isRequired ?? false}
        aria-required={field.isRequired ?? false}
        aria-invalid={!!error}
        aria-describedby={error ? `${inputId}-error` : undefined}
        onChange={(e) => onChange(e.target.value || null)}
      />
    </FieldShell>
  );
}
