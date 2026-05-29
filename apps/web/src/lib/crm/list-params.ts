import type { Filter, SortState } from "@/components/dynamic-table/types";

/**
 * Serialise DynamicTable list state into a query string that
 * `parseListParams` (lib/crm/query.ts) reads back identically.
 *
 * Contract (must match parseListParams exactly):
 *   - offset/limit          → plain scalar params
 *   - includeArchived       → "true" only when true (omitted = false)
 *   - sort                  → JSON string, omitted when null
 *   - filters               → JSON string, omitted when empty
 *
 * `limit` is always written so the round-trip is exact regardless of the
 * parser's default. `offset` is omitted when 0 (parser defaults to 0).
 */
export interface ListState {
  offset: number;
  limit: number;
  includeArchived: boolean;
  sort: SortState | null;
  filters: Filter[];
  /** Owner filter token (userId | "me" | "unassigned"), omitted when null. */
  owner?: string | null;
}

export function stateToQuery(state: ListState): string {
  const sp = new URLSearchParams();
  if (state.offset > 0) sp.set("offset", String(state.offset));
  sp.set("limit", String(state.limit));
  if (state.includeArchived) sp.set("includeArchived", "true");
  if (state.sort) sp.set("sort", JSON.stringify(state.sort));
  if (state.filters.length > 0) sp.set("filters", JSON.stringify(state.filters));
  if (state.owner) sp.set("owner", state.owner);
  return sp.toString();
}
