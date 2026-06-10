import type { FieldDefinitionWithLabels } from "@adserve/module-framework";
import type { FilterOperator } from "./operators";

/**
 * A record row as the table consumes it. The server (Task 1.2) returns
 * `data` already shaped by field slug; the table never reaches into the
 * database — it renders props and emits state changes via callbacks.
 */
export interface DynamicTableRecord {
  id: string;
  data: Record<string, unknown>;
  isArchived?: boolean;
}

export type SortDirection = "asc" | "desc";

export interface SortState {
  fieldSlug: string;
  direction: SortDirection;
}

/**
 * One active filter. `value` shape depends on the operator's input kind:
 *  - text / number / date single ops → string
 *  - between-* ops → [low, high]
 *  - select / multi_select ops → the chosen choice value (string)
 *  - boolean isTrue/isFalse → null (operator carries the meaning)
 */
export interface Filter {
  fieldSlug: string;
  operator: FilterOperator;
  value: string | [string, string] | null;
}

export interface FilterState {
  filters: Filter[];
  includeArchived: boolean;
}

export interface PaginationState {
  offset: number;
  limit: number;
  total: number;
}

export interface DynamicTableProps {
  fields: FieldDefinitionWithLabels[];
  records: DynamicTableRecord[];

  /** Current sort, or null for unsorted. Server applies the actual sort. */
  sort: SortState | null;
  onSortChange: (next: SortState | null) => void;

  /** Current committed filters. The filter bar drafts locally and emits on Apply. */
  filterState: FilterState;
  onFiltersChange: (next: FilterState) => void;

  pagination: PaginationState;
  /** Emits the next offset. Server re-queries (incl. COUNT over the filtered set). */
  onPageChange: (nextOffset: number) => void;

  onRowClick?: (record: DynamicTableRecord) => void;

  /**
   * Column visibility is controllable: pass `visibleColumns` to control
   * it, or omit for internal state seeded from `defaultVisibleColumns`
   * (falling back to all fields). `onVisibleColumnsChange` fires on every
   * toggle so per-user persistence (Phase 1b) can hook in without an API
   * change.
   */
  visibleColumns?: string[];
  defaultVisibleColumns?: string[];
  onVisibleColumnsChange?: (slugs: string[]) => void;

  /**
   * Row selection. Opt in with `selectable`; selection is then
   * controllable-with-default (same seam as column visibility): pass
   * `selectedIds` to control it, or omit for internal state seeded from
   * `defaultSelectedIds`. `onSelectionChange` fires on every toggle.
   */
  selectable?: boolean;
  selectedIds?: string[];
  defaultSelectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;

  locale?: string;
  emptyMessage?: string;
  className?: string;

  /**
   * Stretch the table to fill its container's height: the toolbar and
   * pagination stay fixed and the rows region scrolls internally. The host
   * must give the table a bounded height (a flex column with `min-h-0`).
   */
  fillHeight?: boolean;

  /**
   * Hide the built-in toolbar row (search / include-archived / columns). Use
   * when the host renders those controls itself — e.g. inline in a panel
   * header. Column visibility is still controllable via `visibleColumns`.
   */
  hideToolbar?: boolean;

  /**
   * Hide the pagination footer. Use when the host shows every row (no paging /
   * page-level scroll) rather than a server-paged window.
   */
  hidePagination?: boolean;

  /**
   * Guarantee at least this many rows of height: when fewer records are shown,
   * the empty space below the last row is zebra-banded to reach `minRows`, so
   * the table reads as a full, available surface even when sparse or empty.
   * Independent of `fillHeight` (which instead stretches to the parent).
   */
  minRows?: number;

  /**
   * Enables a free-text search box in the toolbar that filters on this field
   * slug via a `contains` operator. The box drafts locally and commits the
   * merged filter on submit (Enter / clear), reusing the same `onFiltersChange`
   * seam as the advanced filter bar.
   */
  searchField?: string;
  searchPlaceholder?: string;

  /**
   * Per-column distinct values for the header value-picker, keyed by field
   * slug. A column gets a filter icon ONLY when it appears here — the server
   * decides eligibility (a text column with repeating values; always-unique
   * columns like email/phone are excluded). Values are alphabetical.
   */
  columnFacets?: Record<string, string[]>;
}
