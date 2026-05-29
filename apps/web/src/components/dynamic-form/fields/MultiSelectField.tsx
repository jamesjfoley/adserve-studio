"use client";

import { formatFieldValue } from "../format-field-value";
import { FieldShell, type FieldComponentProps } from "./FieldShell";

interface Choice {
  value: string;
  label: string;
}

function readChoices(field: FieldComponentProps["field"]): Choice[] {
  const opts = (field.options as { choices?: Choice[] }) ?? {};
  return Array.isArray(opts.choices) ? opts.choices : [];
}

function readArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return [];
}

export function MultiSelectField(props: FieldComponentProps) {
  const { field, value, onChange, mode, error, locale, inputId } = props;
  const choices = readChoices(field);
  const selected = readArray(value);

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

  function toggle(choiceValue: string) {
    if (selected.includes(choiceValue)) {
      onChange(selected.filter((v) => v !== choiceValue));
    } else {
      onChange([...selected, choiceValue]);
    }
  }

  return (
    <FieldShell
      field={field}
      fieldId={inputId}
      error={error}
      locale={locale}
    >
      <div
        role="group"
        // <div> is not labellable via htmlFor; reference the
        // FieldShell-provided label by id instead. Without this the
        // accessible name is missing.
        aria-labelledby={`${inputId}-label`}
        // Note: aria-required and aria-invalid are not in the ARIA
        // spec's supported attributes for role="group". The error
        // message is still announced via aria-describedby.
        aria-describedby={error ? `${inputId}-error` : undefined}
        className="flex flex-wrap gap-2"
      >
        {choices.map((c) => {
          const checked = selected.includes(c.value);
          return (
            <label
              key={c.value}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1 text-xs"
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={checked}
                onChange={() => toggle(c.value)}
              />
              <span>{c.label}</span>
            </label>
          );
        })}
      </div>
    </FieldShell>
  );
}
