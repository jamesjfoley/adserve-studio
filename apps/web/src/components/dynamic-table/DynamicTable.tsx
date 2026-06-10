"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
} from "react";
import { cn } from "@/lib/utils";

/**
 * Background style that continues the row zebra-banding into the empty space
 * below the last row (full-height tables), so the whole table is banded even
 * when there are fewer records than fit. Returns undefined until the row
 * height is measured. The first band's colour continues the parity from the
 * row that would follow the last rendered one — Tailwind's `even:` bands rows
 * at 0-based odd indices, so the filler starts on `--row-alt` when an odd
 * number of rows is rendered.
 */
export function stripeFillStyle(
  renderedRowCount: number,
  rowHeight: number
): CSSProperties | undefined {
  if (rowHeight <= 0) return undefined;
  const alt = "var(--row-alt)";
  const plain = "transparent";
  const firstIsAlt = renderedRowCount % 2 === 1;
  const a = firstIsAlt ? alt : plain;
  const b = firstIsAlt ? plain : alt;
  return {
    backgroundImage: `repeating-linear-gradient(to bottom, ${a} 0, ${a} ${rowHeight}px, ${b} ${rowHeight}px, ${b} ${rowHeight * 2}px)`,
  };
}
import { formatFieldValue } from "../dynamic-form/format-field-value";
import { ColumnToggle } from "./column-toggle";
import { Pagination } from "./pagination";
import { TableHeader } from "./table-header";
import type { DynamicTableProps, DynamicTableRecord, Filter } from "./types";

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
  columnOrder,
  onColumnOrderChange,
  columnWidths,
  onColumnWidthsChange,
  selectable = false,
  selectedIds,
  defaultSelectedIds,
  onSelectionChange,
  locale,
  emptyMessage = "No records found.",
  className,
  fillHeight = false,
  hideToolbar = false,
  hidePagination = false,
  dense = false,
  minRows,
  searchField,
  searchPlaceholder = "Search…",
  columnFacets,
}: DynamicTableProps) {
  // Column order: an explicit `columnOrder` (slugs) wins, with any unlisted
  // fields appended by `displayOrder`; otherwise pure `displayOrder`.
  const orderedFields = useMemo(() => {
    const byDisplay = [...fields].sort((a, b) => a.displayOrder - b.displayOrder);
    if (!columnOrder || columnOrder.length === 0) return byDisplay;
    const bySlug = new Map(byDisplay.map((f) => [f.slug, f]));
    const ordered: typeof byDisplay = [];
    for (const slug of columnOrder) {
      const f = bySlug.get(slug);
      if (f) {
        ordered.push(f);
        bySlug.delete(slug);
      }
    }
    // Remaining (new/unordered) fields keep their displayOrder sequence.
    for (const f of byDisplay) if (bySlug.has(f.slug)) ordered.push(f);
    return ordered;
  }, [fields, columnOrder]);

  // Full slug order (incl. hidden), the basis for reorder mutations.
  const fullOrder = useMemo(() => orderedFields.map((f) => f.slug), [orderedFields]);

  // Move `fromSlug` to just before `toSlug` in the full column order.
  function moveColumn(fromSlug: string, toSlug: string) {
    if (!onColumnOrderChange || fromSlug === toSlug) return;
    const next = fullOrder.filter((s) => s !== fromSlug);
    const at = next.indexOf(toSlug);
    if (at < 0) return;
    next.splice(at, 0, fromSlug);
    onColumnOrderChange(next);
  }

  function setColumnWidth(slug: string, width: number) {
    onColumnWidthsChange?.({
      ...(columnWidths ?? {}),
      [slug]: Math.max(64, Math.min(720, Math.round(width))),
    });
  }
  const widthsActive = columnWidths !== undefined && onColumnWidthsChange !== undefined;

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
    // The search box and the search field's own column filter share a single
    // slot, so drop ANY existing filter on that slug before re-adding.
    const rest = filterState.filters.filter((x) => x.fieldSlug !== searchField);
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

  // One filter per column: replace any existing filter on that slug (or remove
  // it when `next` is null). Reuses the same `onFiltersChange` commit seam.
  function handleColumnFilterChange(slug: string, next: Filter | null) {
    const rest = filterState.filters.filter((x) => x.fieldSlug !== slug);
    onFiltersChange({
      ...filterState,
      filters: next ? [...rest, next] : rest,
    });
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

  // Measure a body-row height so the empty space below the last row can be
  // banded to match (full-height OR min-rows tables). Guarded for non-DOM test
  // envs; falls back to an estimate when nothing has been measured yet.
  const banded = fillHeight || minRows != null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [rowHeight, setRowHeight] = useState(0);
  // Estimated row height (used until a real row is measured) tracks the cell
  // padding so empty/sparse banding lines up with rendered rows.
  const EST_ROW_HEIGHT = dense ? 30 : 41;
  const effRowHeight = rowHeight > 0 ? rowHeight : EST_ROW_HEIGHT;
  const cellPad = dense ? "px-3 py-1.5" : "px-4 py-3";

  useLayoutEffect(() => {
    if (!banded) return;
    const container = scrollRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const firstRow = bodyRef.current?.querySelector("tr");
      setRowHeight(firstRow ? firstRow.clientHeight : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [banded, records]);

  return (
    <div
      className={cn(
        fillHeight ? "flex min-h-0 flex-1 flex-col gap-4" : "space-y-4",
        className
      )}
    >
      {hideToolbar ? null : (
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-4">
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
          <label className="inline-flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={filterState.includeArchived}
              onChange={(e) =>
                onFiltersChange({
                  ...filterState,
                  includeArchived: e.target.checked,
                })
              }
            />
            Include archived
          </label>
        </div>
        <ColumnToggle
          fields={orderedFields}
          visible={visible}
          onChange={setVisible}
          locale={locale}
        />
      </div>
      )}

      <div
        ref={scrollRef}
        className={cn(
          "rounded-lg border border-[var(--border)]",
          fillHeight
            ? "flex min-h-0 flex-1 flex-col overflow-auto"
            : "overflow-x-auto"
        )}
      >
        <table className={cn("w-full text-sm", widthsActive && "table-fixed")}>
          {widthsActive ? (
            <colgroup>
              {selectable ? <col style={{ width: 40 }} /> : null}
              {visibleFields.map((f) => (
                <col
                  key={f.id}
                  style={columnWidths?.[f.slug] ? { width: columnWidths[f.slug] } : undefined}
                />
              ))}
            </colgroup>
          ) : null}
          <TableHeader
            fields={visibleFields}
            sort={sort}
            onSortChange={onSortChange}
            locale={locale}
            dense={dense}
            selectable={selectable}
            allSelected={allSelected}
            someSelected={someSelected}
            onToggleAll={toggleAll}
            filters={filterState.filters}
            onColumnFilterChange={handleColumnFilterChange}
            columnFacets={columnFacets}
            onReorder={onColumnOrderChange ? moveColumn : undefined}
            onResize={widthsActive ? setColumnWidth : undefined}
          />
          <tbody ref={bodyRef} className="divide-y divide-[var(--border)]">
            {records.length === 0 ? (
              <tr>
                <td
                  colSpan={colCount}
                  className={cn(
                    "text-center text-[var(--muted-foreground)]",
                    // A slim empty row when min-rows banding fills the rest;
                    // otherwise the roomier standalone empty state.
                    minRows != null ? cellPad : "px-4 py-8"
                  )}
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
                      <td className={cn("w-10 align-top", cellPad)}>
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
                      <td
                        key={f.id}
                        className={cn("align-top", cellPad)}
                      >
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
        {/* Continue the zebra banding into the empty space below the last row
            so the whole table is banded even when records don't fill it. */}
        {fillHeight ? (
          <div
            aria-hidden="true"
            className="min-h-0 flex-1"
            style={stripeFillStyle(
              records.length === 0 ? 1 : records.length,
              effRowHeight
            )}
          />
        ) : minRows != null ? (
          // Fixed-height banded filler that tops the table up to `minRows`
          // rows. The empty-state row counts as one rendered band, so the
          // floor is `minRows - max(records.length, 1)` extra bands.
          <div
            aria-hidden="true"
            style={{
              height:
                Math.max(0, minRows - Math.max(records.length, 1)) *
                effRowHeight,
              ...stripeFillStyle(
                records.length === 0 ? 1 : records.length,
                effRowHeight
              ),
            }}
          />
        ) : null}
      </div>

      {hidePagination ? null : (
        <Pagination pagination={pagination} onPageChange={onPageChange} />
      )}
    </div>
  );
}
