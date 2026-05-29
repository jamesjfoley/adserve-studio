"use client";

import {
  resolveLabel,
  type FieldDefinitionWithLabels,
  type LocalizedLabel,
} from "@adserve/module-framework";
import { isSortable } from "./operators";
import type { SortState } from "./types";

interface TableHeaderProps {
  /** Visible columns, already ordered. */
  fields: FieldDefinitionWithLabels[];
  sort: SortState | null;
  onSortChange: (next: SortState | null) => void;
  locale?: string;
}

/**
 * Click cycle for a sortable column: unsorted → asc → desc → unsorted.
 */
function nextSort(current: SortState | null, slug: string): SortState | null {
  if (current?.fieldSlug !== slug) return { fieldSlug: slug, direction: "asc" };
  if (current.direction === "asc")
    return { fieldSlug: slug, direction: "desc" };
  return null;
}

function SortIcon({ direction }: { direction: "asc" | "desc" | null }) {
  const glyph = direction === "asc" ? "▲" : direction === "desc" ? "▼" : "↕";
  return (
    <span
      aria-hidden="true"
      className={
        direction
          ? "text-[var(--foreground)]"
          : "text-[var(--muted-foreground)]/50"
      }
    >
      {glyph}
    </span>
  );
}

export function TableHeader({
  fields,
  sort,
  onSortChange,
  locale,
}: TableHeaderProps) {
  return (
    <thead className="bg-[var(--muted)] text-left text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
      <tr>
        {fields.map((f) => {
          const label = resolveLabel(
            (f.labels as LocalizedLabel) ?? {},
            locale ?? "en",
            f.name
          );
          const sortable = isSortable(f.fieldType);
          const active = sort?.fieldSlug === f.slug ? sort.direction : null;
          const ariaSort = !sortable
            ? undefined
            : active === "asc"
              ? "ascending"
              : active === "desc"
                ? "descending"
                : "none";
          return (
            <th
              key={f.id}
              scope="col"
              aria-sort={ariaSort}
              className="px-4 py-3 font-medium"
            >
              {sortable ? (
                <button
                  type="button"
                  onClick={() => onSortChange(nextSort(sort, f.slug))}
                  aria-label={`Sort by ${label}`}
                  className="inline-flex items-center gap-1 hover:text-[var(--foreground)]"
                >
                  <span>{label}</span>
                  <SortIcon direction={active} />
                </button>
              ) : (
                <span>{label}</span>
              )}
            </th>
          );
        })}
      </tr>
    </thead>
  );
}
