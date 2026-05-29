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

  locale?: string;
  emptyMessage?: string;
  className?: string;
}
