"use client";

import { formatFieldValue } from "../format-field-value";
import {
  FieldShell,
  inputClassName,
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
        formatFieldValue(field, value, locale)
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
