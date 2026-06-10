"use client";

import { useEffect, useRef } from "react";
import { resolveLabel } from "@adserve/module-framework/client";
import type {
  FieldDefinitionWithLabels,
  LocalizedLabel,
} from "@adserve/module-framework";
import { isSortable, isTextFilterable } from "./operators";
import { ColumnFilter } from "./column-filter";
import type { Filter, SortState } from "./types";

interface TableHeaderProps {
  /** Visible columns, already ordered. */
  fields: FieldDefinitionWithLabels[];
  sort: SortState | null;
  onSortChange: (next: SortState | null) => void;
  locale?: string;
  /** When true, render a leading select-all checkbox column. */
  selectable?: boolean;
  allSelected?: boolean;
  someSelected?: boolean;
  onToggleAll?: (checked: boolean) => void;
  /** Committed filters — used to light up active column-filter icons. */
  filters?: Filter[];
  /** Commit (or clear, with null) the filter for one column. */
  onColumnFilterChange?: (slug: string, next: Filter | null) => void;
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
  selectable = false,
  allSelected = false,
  someSelected = false,
  onToggleAll,
  filters = [],
  onColumnFilterChange,
}: TableHeaderProps) {
  const selectAllRef = useRef<HTMLInputElement>(null);
  // `indeterminate` is a DOM-only property, not an attribute.
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  return (
    <thead className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--table-header-bg)] text-left text-xs font-medium text-[var(--muted-foreground)]">
      <tr>
        {selectable ? (
          <th scope="col" className="w-10 px-4 py-3">
            <input
              ref={selectAllRef}
              type="checkbox"
              aria-label="Select all rows"
              checked={allSelected}
              onChange={(e) => onToggleAll?.(e.target.checked)}
            />
          </th>
        ) : null}
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
          // Text-value columns get an inline filter icon; numeric/currency/
          // date/select columns do not (per the column-filter UX).
          const filterable =
            isTextFilterable(f.fieldType) && onColumnFilterChange != null;
          return (
            <th
              key={f.id}
              scope="col"
              aria-sort={ariaSort}
              className="px-4 py-3 font-medium"
            >
              <span className="inline-flex items-center gap-1">
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
                {filterable ? (
                  <ColumnFilter
                    slug={f.slug}
                    label={label}
                    active={filters.find((x) => x.fieldSlug === f.slug) ?? null}
                    onChange={(next) => onColumnFilterChange(f.slug, next)}
                  />
                ) : null}
              </span>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}
