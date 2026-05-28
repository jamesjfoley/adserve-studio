"use client";

import {
  FieldShell,
  inputClassName,
  viewValueClassName,
  VIEW_EMPTY,
  type FieldComponentProps,
} from "./FieldShell";

const DEFAULT_LOCALE = "en-GB";

/**
 * `<input type="datetime-local">` expects values in "YYYY-MM-DDTHH:mm"
 * (no timezone). We store ISO timestamps with timezone. Convert at the
 * boundary.
 */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DateTimeField(props: FieldComponentProps) {
  const { field, value, onChange, mode, error, locale, inputId } = props;
  const str = value === null || value === undefined ? "" : String(value);

  if (mode === "view") {
    let display = VIEW_EMPTY;
    if (str) {
      const d = new Date(str);
      if (!Number.isNaN(d.getTime())) {
        display = new Intl.DateTimeFormat(locale ?? DEFAULT_LOCALE, {
          dateStyle: "medium",
          timeStyle: "short",
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

  const inputValue = str ? isoToLocalInput(str) : "";

  return (
    <FieldShell
      field={field}
      fieldId={inputId}
      error={error}
      locale={locale}
    >
      <input
        id={inputId}
        type="datetime-local"
        className={inputClassName}
        value={inputValue}
        required={field.isRequired ?? false}
        aria-required={field.isRequired ?? false}
        aria-invalid={!!error}
        aria-describedby={error ? `${inputId}-error` : undefined}
        onChange={(e) => {
          if (!e.target.value) {
            onChange(null);
            return;
          }
          // Convert the local-input string back to ISO so coerceFieldValue
          // gets a proper datetime to parse.
          const d = new Date(e.target.value);
          onChange(Number.isNaN(d.getTime()) ? e.target.value : d.toISOString());
        }}
      />
    </FieldShell>
  );
}
