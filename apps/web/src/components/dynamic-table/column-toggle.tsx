"use client";

import { useState } from "react";
import {
  resolveLabel,
  type FieldDefinitionWithLabels,
  type LocalizedLabel,
} from "@adserve/module-framework";

interface ColumnToggleProps {
  /** All candidate columns, already ordered. */
  fields: FieldDefinitionWithLabels[];
  /** Currently visible column slugs. */
  visible: string[];
  onChange: (slugs: string[]) => void;
  locale?: string;
}

export function ColumnToggle({
  fields,
  visible,
  onChange,
  locale,
}: ColumnToggleProps) {
  const [open, setOpen] = useState(false);
  const visibleSet = new Set(visible);

  function toggle(slug: string) {
    if (visibleSet.has(slug)) {
      // Never let the user hide the last remaining column.
      if (visible.length <= 1) return;
      onChange(visible.filter((s) => s !== slug));
    } else {
      // Preserve field order when re-adding.
      onChange(fields.map((f) => f.slug).filter((s) => visibleSet.has(s) || s === slug));
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Toggle columns"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm font-medium hover:bg-[var(--muted)]"
      >
        Columns
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-[var(--border)] bg-[var(--background)] p-2 shadow-lg"
        >
          {fields.map((f) => {
            const label = resolveLabel(
              (f.labels as LocalizedLabel) ?? {},
              locale ?? "en",
              f.name
            );
            const checked = visibleSet.has(f.slug);
            return (
              <label
                key={f.id}
                className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-[var(--muted)]"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={checked}
                  onChange={() => toggle(f.slug)}
                />
                <span>{label}</span>
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
