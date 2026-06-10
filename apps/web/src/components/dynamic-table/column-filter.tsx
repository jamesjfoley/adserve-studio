"use client";

import { useEffect, useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import type { FilterOperator } from "./operators";
import type { Filter } from "./types";

/** The three text operators a column filter offers (all take a text value). */
const TEXT_OPS: { value: FilterOperator; label: string }[] = [
  { value: "contains", label: "Contains" },
  { value: "equals", label: "Equals" },
  { value: "startsWith", label: "Starts with" },
];

interface ColumnFilterProps {
  slug: string;
  /** Resolved column label, used for accessible names. */
  label: string;
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
 * A per-column filter, surfaced as a funnel icon in the table header. Clicking
 * opens a small popover (operator + text value); Apply commits a single filter
 * for this column (replacing any existing one), Clear removes it. Drafts are
 * local until Apply, mirroring the rest of the table's commit-on-action model.
 */
export function ColumnFilter({ slug, label, active, onChange }: ColumnFilterProps) {
  const [open, setOpen] = useState(false);
  const [operator, setOperator] = useState<FilterOperator>(
    (active?.operator as FilterOperator) ?? "contains"
  );
  const [value, setValue] = useState(
    typeof active?.value === "string" ? active.value : ""
  );

  // Re-seed the draft from the committed filter each time the popover opens
  // (so it reflects the current state, and discards an abandoned edit).
  useEffect(() => {
    if (!open) return;
    setOperator((active?.operator as FilterOperator) ?? "contains");
    setValue(typeof active?.value === "string" ? active.value : "");
  }, [open, active]);

  const isActive =
    active != null && typeof active.value === "string" && active.value !== "";

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    onChange(trimmed === "" ? null : { fieldSlug: slug, operator, value: trimmed });
    setOpen(false);
  }

  function clear() {
    onChange(null);
    setValue("");
    setOpen(false);
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
            onSubmit={submit}
            className="absolute right-0 top-full z-30 mt-1 w-56 space-y-2 rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] p-3 text-[var(--foreground)] shadow-lg"
          >
            <select
              aria-label={`${label} filter operator`}
              value={operator}
              onChange={(e) => setOperator(e.target.value as FilterOperator)}
              className="w-full rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-2 py-1.5 text-sm font-normal"
            >
              {TEXT_OPS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              autoFocus
              aria-label={`Filter ${label} value`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={`Filter ${label.toLowerCase()}…`}
              className="w-full rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-2 py-1.5 text-sm font-normal placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-foreground)] hover:brightness-95"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={clear}
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--muted)]"
              >
                Clear
              </button>
            </div>
          </form>
        </>
      ) : null}
    </span>
  );
}
