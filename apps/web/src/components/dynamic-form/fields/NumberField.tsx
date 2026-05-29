"use client";

import { formatFieldValue } from "../format-field-value";
import {
  FieldShell,
  inputClassName,
  type FieldComponentProps,
} from "./FieldShell";

export function NumberField(props: FieldComponentProps) {
  const { field, value, onChange, mode, error, locale, inputId } = props;

  if (mode === "view") {
    return (
      <FieldShell
        field={field}
        fieldId={inputId}
        error={error}
        locale={locale}
      >
        {formatFieldValue(field, value, locale)}
      </FieldShell>
    );
  }

  // Edit/create: <input type="number">. We keep the string form in the
  // input (controlled by the value prop), but pass the parsed number to
  // onChange so the form state holds numbers, not strings.
  const inputValue =
    value === null || value === undefined ? "" : String(value);

  return (
    <FieldShell
      field={field}
      fieldId={inputId}
      error={error}
      locale={locale}
    >
      <input
        id={inputId}
        type="number"
        inputMode="decimal"
        className={inputClassName}
        value={inputValue}
        required={field.isRequired ?? false}
        aria-required={field.isRequired ?? false}
        aria-invalid={!!error}
        aria-describedby={error ? `${inputId}-error` : undefined}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange(null);
            return;
          }
          // Hand the form the raw string; coerceFieldValue parses it on
          // submit. This keeps the input snappy for users typing
          // partial numbers (e.g. "-", ".") that don't yet parse.
          onChange(raw);
        }}
      />
    </FieldShell>
  );
}
