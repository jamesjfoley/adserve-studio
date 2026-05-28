"use client";

import {
  FieldShell,
  inputClassName,
  viewValueClassName,
  VIEW_EMPTY,
  type FieldComponentProps,
} from "./FieldShell";

export function EmailField(props: FieldComponentProps) {
  const { field, value, onChange, mode, error, locale, inputId } = props;
  const str = value === null || value === undefined ? "" : String(value);

  if (mode === "view") {
    return (
      <FieldShell
        field={field}
        fieldId={inputId}
        error={error}
        locale={locale}
      >
        {str ? (
          <a
            href={`mailto:${str}`}
            className="text-sm text-brand-600 hover:underline"
          >
            {str}
          </a>
        ) : (
          <p className={viewValueClassName}>{VIEW_EMPTY}</p>
        )}
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
        type="email"
        autoComplete="email"
        className={inputClassName}
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
