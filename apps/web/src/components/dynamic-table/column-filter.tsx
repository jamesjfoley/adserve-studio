"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import type { Filter } from "./types";

interface ColumnFilterProps {
  slug: string;
  /** Resolved column label, used for accessible names. */
  label: string;
  /** All distinct values present in this column (server-supplied). */
  values: string[];
  /** The committed filter for this column, or null when none is active. */
  active: Filter | null;
  /** Commit (or, with null, clear) the filter for this column. */
  onChange: (next: Filter | null) => void;
}

function FunnelIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      aria-hidden="true"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    >
      <path d="M1.5 2.5h13l-5 6v4l-3 1.5v-5.5z" />
    </svg>
  );
}

/**
 * A per-column value picker, surfaced as a funnel icon in the table header.
 * Clicking opens a popover with a type-ahead box over the column's distinct
 * values (alphabetical): typing narrows the list; picking a value commits an
 * `equals` filter for this column; "All …" clears it. Only columns the server
 * deems filterable (repeating text columns) ever render this control.
 */
export function ColumnFilter({
  slug,
  label,
  values,
  active,
  onChange,
}: ColumnFilterProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Reset the type-ahead each time the popover opens.
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const selected =
    active != null && typeof active.value === "string" ? active.value : null;
  const isActive = selected != null;

  const sorted = useMemo(
    () => [...values].sort((a, b) => a.localeCompare(b)),
    [values]
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === "" ? sorted : sorted.filter((v) => v.toLowerCase().includes(q));
  }, [sorted, query]);

  function select(value: string) {
    onChange({ fieldSlug: slug, operator: "equals", value });
    setOpen(false);
  }

  function clear() {
    onChange(null);
    setOpen(false);
  }

  // Enter selects the first visible value — a convenience for keyboard users.
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (shown.length > 0) select(shown[0]);
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={`Filter by ${label}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "rounded p-0.5 transition-colors",
          isActive
            ? "text-[var(--accent)]"
            : "text-[var(--muted-foreground)]/50 hover:text-[var(--foreground)]"
        )}
      >
        <FunnelIcon filled={isActive} />
      </button>

      {open ? (
        <>
          {/* Click-away backdrop. */}
          <div
            className="fixed inset-0 z-20"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <form
            onSubmit={onSubmit}
            className="absolute right-0 top-full z-30 mt-1 w-60 space-y-2 rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] p-2 text-[var(--foreground)] shadow-lg"
          >
            <input
              type="text"
              autoFocus
              aria-label={`Filter ${label} value`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}…`}
              className="w-full rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-2 py-1.5 text-sm font-normal placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            />
            <ul
              role="listbox"
              aria-label={`${label} values`}
              className="max-h-56 overflow-auto"
            >
              <li>
                <button
                  type="button"
                  onClick={clear}
                  className={cn(
                    "w-full rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--row-hover)]",
                    !isActive && "font-medium text-[var(--accent)]"
                  )}
                >
                  All {label.toLowerCase()}
                </button>
              </li>
              {shown.length === 0 ? (
                <li className="px-2 py-1.5 text-sm text-[var(--muted-foreground)]">
                  No matches
                </li>
              ) : (
                shown.map((value) => (
                  <li key={value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={value === selected}
                      onClick={() => select(value)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--row-hover)]",
                        value === selected && "font-medium text-[var(--accent)]"
                      )}
                    >
                      <span className="truncate">{value}</span>
                      {value === selected ? (
                        <span aria-hidden="true">✓</span>
                      ) : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </form>
        </>
      ) : null}
    </span>
  );
}
