"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import { cn } from "@/lib/utils";
import { formatFieldValue } from "../dynamic-form/format-field-value";
import { ColumnToggle } from "./column-toggle";
import { FilterBar } from "./filter-bar";
import { Pagination } from "./pagination";
import { TableHeader } from "./table-header";
import type { DynamicTableProps, DynamicTableRecord } from "./types";

export type {
  DynamicTableProps,
  DynamicTableRecord,
  Filter,
  FilterState,
  PaginationState,
  SortState,
  SortDirection,
} from "./types";

export function DynamicTable({
  fields,
  records,
  sort,
  onSortChange,
  filterState,
  onFiltersChange,
  pagination,
  onPageChange,
  onRowClick,
  visibleColumns,
  defaultVisibleColumns,
  onVisibleColumnsChange,
  selectable = false,
  selectedIds,
  defaultSelectedIds,
  onSelectionChange,
  locale,
  emptyMessage = "No records found.",
  className,
  fillHeight = false,
  searchField,
  searchPlaceholder = "Search…",
}: DynamicTableProps) {
  // Stable column order: declared displayOrder, then insertion order.
  const orderedFields = useMemo(
    () =>
      [...fields].sort((a, b) => a.displayOrder - b.displayOrder),
    [fields]
  );

  // Controllable column visibility: controlled when `visibleColumns` is
  // provided, otherwise internal state seeded from defaults / all fields.
  const [internalVisible, setInternalVisible] = useState<string[]>(
    () => defaultVisibleColumns ?? fields.map((f) => f.slug)
  );
  const visible = visibleColumns ?? internalVisible;

  function setVisible(next: string[]) {
    if (visibleColumns === undefined) setInternalVisible(next);
    onVisibleColumnsChange?.(next);
  }

  const visibleSet = new Set(visible);
  const visibleFields = orderedFields.filter((f) => visibleSet.has(f.slug));
  const colCount = Math.max(1, visibleFields.length) + (selectable ? 1 : 0);

  // Row selection: controlled when `selectedIds` is provided, else internal.
  const [internalSelected, setInternalSelected] = useState<string[]>(
    () => defaultSelectedIds ?? []
  );
  const selected = selectedIds ?? internalSelected;
  const selectedSet = new Set(selected);

  function setSelected(next: string[]) {
    if (selectedIds === undefined) setInternalSelected(next);
    onSelectionChange?.(next);
  }

  function toggleRow(id: string, checked: boolean) {
    setSelected(
      checked ? [...selected, id] : selected.filter((x) => x !== id)
    );
  }

  // Select-all operates on the records currently on the page.
  const pageIds = records.map((r) => r.id);
  const selectedOnPage = pageIds.filter((id) => selectedSet.has(id));
  const allSelected = pageIds.length > 0 && selectedOnPage.length === pageIds.length;
  const someSelected = selectedOnPage.length > 0 && !allSelected;

  function toggleAll(checked: boolean) {
    if (checked) {
      setSelected(Array.from(new Set([...selected, ...pageIds])));
    } else {
      const pageSet = new Set(pageIds);
      setSelected(selected.filter((id) => !pageSet.has(id)));
    }
  }

  // Free-text search: a `contains` filter on `searchField`, kept distinct from
  // the advanced filter bar's filters so the two compose. The box drafts
  // locally and commits the merged filter set on submit / clear.
  const committedSearch = useMemo(() => {
    if (!searchField) return "";
    const f = filterState.filters.find(
      (x) => x.fieldSlug === searchField && x.operator === "contains"
    );
    return typeof f?.value === "string" ? f.value : "";
  }, [filterState.filters, searchField]);

  const [searchDraft, setSearchDraft] = useState(committedSearch);
  // Re-sync the box when the committed term changes out from under us
  // (browser back/forward, external filter reset).
  useEffect(() => setSearchDraft(committedSearch), [committedSearch]);

  function commitSearch(term: string) {
    if (!searchField) return;
    const trimmed = term.trim();
    const rest = filterState.filters.filter(
      (x) => !(x.fieldSlug === searchField && x.operator === "contains")
    );
    onFiltersChange({
      ...filterState,
      filters:
        trimmed === ""
          ? rest
          : [...rest, { fieldSlug: searchField, operator: "contains", value: trimmed }],
    });
  }

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    commitSearch(searchDraft);
  }

  function handleRowClick(
    e: MouseEvent<HTMLTableRowElement>,
    record: DynamicTableRecord
  ) {
    if (!onRowClick) return;
    // Let interactive cell content (email/url links) win the click
    // without also triggering row navigation.
    if ((e.target as HTMLElement).closest("a")) return;
    onRowClick(record);
  }

  return (
    <div
      className={cn(
        fillHeight ? "flex min-h-0 flex-1 flex-col gap-4" : "space-y-4",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-1 items-start gap-3">
          {searchField ? (
            <form onSubmit={handleSearchSubmit} className="relative">
              <input
                type="search"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onBlur={() => commitSearch(searchDraft)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="w-64 rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-1.5 text-sm placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:border-[var(--accent)]"
              />
            </form>
          ) : null}
          <FilterBar
            fields={orderedFields}
            filterState={filterState}
            onFiltersChange={onFiltersChange}
            locale={locale}
          />
        </div>
        <ColumnToggle
          fields={orderedFields}
          visible={visible}
          onChange={setVisible}
          locale={locale}
        />
      </div>

      <div
        className={cn(
          "rounded-lg border border-[var(--border)]",
          fillHeight ? "min-h-0 flex-1 overflow-auto" : "overflow-x-auto"
        )}
      >
        <table className="w-full text-sm">
          <TableHeader
            fields={visibleFields}
            sort={sort}
            onSortChange={onSortChange}
            locale={locale}
            selectable={selectable}
            allSelected={allSelected}
            someSelected={someSelected}
            onToggleAll={toggleAll}
          />
          <tbody className="divide-y divide-[var(--border)]">
            {records.length === 0 ? (
              <tr>
                <td
                  colSpan={colCount}
                  className="px-4 py-8 text-center text-[var(--muted-foreground)]"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              records.map((record) => {
                const archived = record.isArchived === true;
                return (
                  <tr
                    key={record.id}
                    data-archived={archived || undefined}
                    onClick={(e) => handleRowClick(e, record)}
                    className={cn(
                      onRowClick && "cursor-pointer",
                      "even:bg-[var(--row-alt)] hover:bg-[var(--row-hover)]",
                      archived && "opacity-60"
                    )}
                  >
                    {selectable ? (
                      <td className="w-10 px-4 py-3 align-top">
                        <input
                          type="checkbox"
                          aria-label={`Select row ${record.id}`}
                          checked={selectedSet.has(record.id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            toggleRow(record.id, e.target.checked)
                          }
                        />
                      </td>
                    ) : null}
                    {visibleFields.map((f, colIdx) => (
                      <td key={f.id} className="px-4 py-3 align-top">
                        <div className="line-clamp-2">
                          {formatFieldValue(f, record.data[f.slug], locale)}
                        </div>
                        {archived && colIdx === 0 ? (
                          <span
                            className="mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                            style={{
                              backgroundColor: "var(--status-neutral-bg)",
                              color: "var(--status-neutral-fg)",
                            }}
                          >
                            Inactive
                          </span>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Pagination pagination={pagination} onPageChange={onPageChange} />
    </div>
  );
}
