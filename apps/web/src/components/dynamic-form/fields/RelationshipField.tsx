"use client";

import { cn } from "@/lib/utils";
import {
  FieldShell,
  inputClassName,
  viewValueClassName,
  VIEW_EMPTY,
  type FieldComponentProps,
} from "./FieldShell";

/**
 * Phase 1: simple UUID text input. The full entity picker (search,
 * pre-populate via the related entity type) comes later.
 *
 * The value lives in form state but the caller is responsible for
 * routing it into `record_relationships` rather than `records.data` —
 * see the validation boundary docs in field-engine.ts.
 */
export function RelationshipField(props: FieldComponentProps) {
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
        <p className={cn(viewValueClassName, "font-mono text-xs")}>
          {str || VIEW_EMPTY}
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
      <input
        id={inputId}
        type="text"
        placeholder="00000000-0000-0000-0000-000000000000"
        className={cn(inputClassName, "font-mono")}
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
