"use client";

import {
  FieldShell,
  viewValueClassName,
  type FieldComponentProps,
} from "./FieldShell";

/**
 * Graceful placeholder for field types the framework recognises but
 * doesn't yet have a UI for: `user`, `file`, `image`, `json`,
 * `computed`, `ai_generated`. Phase 1's field-admin UI doesn't expose
 * these to tenant admins, so a real tenant won't hit this — but the
 * type system permits them, so the renderer needs a fallback.
 */
export function UnsupportedField(props: FieldComponentProps) {
  const { field, value, mode, error, locale, inputId } = props;
  return (
    <FieldShell
      field={field}
      fieldId={inputId}
      error={error}
      locale={locale}
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
          {field.fieldType}
        </span>
        <span className="text-xs text-[var(--muted-foreground)]">
          Not yet supported in Phase 1.
        </span>
      </div>
      {mode === "view" && value !== null && value !== undefined ? (
        <pre className={`${viewValueClassName} overflow-x-auto rounded border border-[var(--border)] bg-[var(--muted)] p-2 text-xs`}>
          {JSON.stringify(value, null, 2)}
        </pre>
      ) : null}
    </FieldShell>
  );
}
