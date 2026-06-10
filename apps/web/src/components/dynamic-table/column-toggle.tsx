"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { resolveLabel } from "@adserve/module-framework/client";
import type {
  FieldDefinitionWithLabels,
  LocalizedLabel,
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
  const btnRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(
    null
  );
  const visibleSet = new Set(visible);

  function toggle(slug: string) {
    if (visibleSet.has(slug)) {
      // Never let the user hide the last remaining column.
      if (visible.length <= 1) return;
      onChange(visible.filter((s) => s !== slug));
    } else {
      // Preserve field order when re-adding.
      onChange(
        fields.map((f) => f.slug).filter((s) => visibleSet.has(s) || s === slug)
      );
    }
  }

  function openMenu() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setAnchor({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpen(true);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Toggle columns"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm font-medium hover:bg-[var(--muted)]"
      >
        Columns
      </button>
      {open && anchor && typeof document !== "undefined"
        ? createPortal(
            <>
              {/* Click-away backdrop. */}
              <div
                className="fixed inset-0 z-[60]"
                aria-hidden="true"
                onClick={() => setOpen(false)}
              />
              {/* Menu — portaled to <body> so it escapes the panel's
                  overflow:hidden, and scrolls when there are many columns. */}
              <div
                role="menu"
                style={{
                  position: "fixed",
                  top: anchor.top,
                  right: anchor.right,
                  maxHeight: "min(70vh, 420px)",
                }}
                className="z-[61] w-60 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--background)] p-2 shadow-lg"
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
            </>,
            document.body
          )
        : null}
    </>
  );
}
