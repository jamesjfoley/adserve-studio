"use client";

import type { ReactNode } from "react";
import { resolveLabel } from "@adserve/module-framework/client";
import type {
  FieldDefinitionWithLabels,
  LocalizedLabel,
} from "@adserve/module-framework";
import { cn } from "@/lib/utils";

/**
 * Shared wrapper for every field component: renders the localized label
 * with a required marker, the input slot (children), and an inline
 * error message if validation failed.
 *
 * Keeps the styling consistent across all field types without each
 * component reinventing the label/error markup.
 */
export interface FieldShellProps {
  field: Pick<FieldDefinitionWithLabels, "name" | "labels" | "isRequired" | "description">;
  fieldId: string; // for label htmlFor association
  error?: string | null;
  locale?: string;
  children: ReactNode;
  className?: string;
}

export function FieldShell({
  field,
  fieldId,
  error,
  locale = "en",
  children,
  className,
}: FieldShellProps) {
  const label = resolveLabel(
    (field.labels as LocalizedLabel) ?? {},
    locale,
    field.name
  );

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center">
        <label
          id={`${fieldId}-label`}
          htmlFor={fieldId}
          className="text-xs font-medium text-[var(--muted-foreground)]"
        >
          {label}
        </label>
        {field.isRequired ? (
          // Marker is a *sibling* of the label, not a child, so the
          // label's text content is exactly the field name. Keeps
          // getByLabelText("Name") matching cleanly. aria-hidden so AT
          // sees the input's aria-required attribute instead.
          <span
            aria-hidden="true"
            data-testid="required-marker"
            className="ml-0.5 text-xs text-red-600"
          >
            *
          </span>
        ) : null}
      </div>
      {children}
      {field.description ? (
        <p className="text-xs text-[var(--muted-foreground)]">{field.description}</p>
      ) : null}
      {error ? (
        <p
          id={`${fieldId}-error`}
          role="alert"
          className="text-xs text-red-600"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Common shape every field-input component conforms to. The
 * field-renderer switch picks one of these based on
 * `field.fieldType`.
 */
export interface FieldComponentProps {
  field: FieldDefinitionWithLabels;
  value: unknown;
  onChange: (next: unknown) => void;
  mode: "create" | "edit" | "view";
  error?: string | null;
  locale?: string;
  /** Unique DOM id for the input (used by label htmlFor). */
  inputId: string;
}

/**
 * Shared input className — a filled light-grey "well" (style-guide inputs are
 * recessed on the white panel, not white-on-white). Border + fill come from the
 * field tokens so they flip in dark mode.
 */
export const inputClassName = cn(
  "w-full rounded-md border border-[var(--field-border)] bg-[var(--field-bg)]",
  "px-3 py-2 text-sm text-[var(--foreground)]",
  "placeholder:text-[var(--muted-foreground)]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:border-[var(--accent)]",
  "disabled:opacity-60"
);

/** View-mode value text style. */
export const viewValueClassName = "text-sm text-[var(--foreground)]";

/** Placeholder shown in view mode for empty/null values. */
export const VIEW_EMPTY = "—";
