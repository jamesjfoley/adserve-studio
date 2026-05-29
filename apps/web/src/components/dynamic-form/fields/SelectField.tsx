"use client";

import { formatFieldValue } from "../format-field-value";
import {
  FieldShell,
  inputClassName,
  type FieldComponentProps,
} from "./FieldShell";

interface Choice {
  value: string;
  label: string;
}

function readChoices(field: FieldComponentProps["field"]): Choice[] {
  const opts = (field.options as { choices?: Choice[] }) ?? {};
  return Array.isArray(opts.choices) ? opts.choices : [];
}

export function SelectField(props: FieldComponentProps) {
  const { field, value, onChange, mode, error, locale, inputId } = props;
  const choices = readChoices(field);
  const str = value === null || value === undefined ? "" : String(value);

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

  return (
    <FieldShell
      field={field}
      fieldId={inputId}
      error={error}
      locale={locale}
    >
      <select
        id={inputId}
        className={inputClassName}
        value={str}
        required={field.isRequired ?? false}
        aria-required={field.isRequired ?? false}
        aria-invalid={!!error}
        aria-describedby={error ? `${inputId}-error` : undefined}
        onChange={(e) => onChange(e.target.value || null)}
      >
        {!field.isRequired || !str ? (
          <option value="">— Select —</option>
        ) : null}
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
