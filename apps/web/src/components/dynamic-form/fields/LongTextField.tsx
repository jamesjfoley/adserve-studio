"use client";

import { cn } from "@/lib/utils";
import { formatFieldValue } from "../format-field-value";
import {
  FieldShell,
  inputClassName,
  type FieldComponentProps,
} from "./FieldShell";

export function LongTextField(props: FieldComponentProps) {
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
        <textarea
          id={inputId}
          rows={4}
          className={cn(inputClassName, "resize-y")}
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
