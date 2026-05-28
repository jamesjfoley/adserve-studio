"use client";

import {
  FieldShell,
  inputClassName,
  viewValueClassName,
  VIEW_EMPTY,
  type FieldComponentProps,
} from "./FieldShell";

export function TextField(props: FieldComponentProps) {
  const { field, value, onChange, mode, error, locale, inputId } = props;
  const str = value === null || value === undefined ? "" : String(value);

  return (
    <FieldShell
      field={field}
      fieldId={inputId}
      error={error}
      locale={locale}
    >
      {mode === "view" ? (
        <p className={viewValueClassName}>{str || VIEW_EMPTY}</p>
      ) : (
        <input
          id={inputId}
          type="text"
          className={inputClassName}
          value={str}
          required={field.isRequired ?? false}
          aria-required={field.isRequired ?? false}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </FieldShell>
  );
}
