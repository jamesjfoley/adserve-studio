"use client";

import {
  FieldShell,
  inputClassName,
  viewValueClassName,
  VIEW_EMPTY,
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
    const choice = choices.find((c) => c.value === str);
    return (
      <FieldShell
        field={field}
        fieldId={inputId}
        error={error}
        locale={locale}
      >
        <p className={viewValueClassName}>
          {str ? choice?.label ?? str : VIEW_EMPTY}
        </p>
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
