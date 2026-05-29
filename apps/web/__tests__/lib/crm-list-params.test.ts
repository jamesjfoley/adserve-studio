import { describe, expect, test } from "vitest";
import { stateToQuery, type ListState } from "@/lib/crm/list-params";
import { parseListParams } from "@/lib/crm/query";

/**
 * The list page and the client wrapper rely on stateToQuery producing a
 * query string that parseListParams (the 1.2 contract) reads back
 * identically. These round-trip tests are the load-bearing guarantee.
 */
function roundTrip(state: ListState): ListState {
  const parsed = parseListParams(new URLSearchParams(stateToQuery(state)));
  return {
    offset: parsed.offset,
    limit: parsed.limit,
    includeArchived: parsed.includeArchived,
    sort: parsed.sort,
    filters: parsed.filters,
  };
}

describe("stateToQuery ↔ parseListParams round-trip", () => {
  test("default state round-trips", () => {
    const state: ListState = {
      offset: 0,
      limit: 50,
      includeArchived: false,
      sort: null,
      filters: [],
    };
    expect(roundTrip(state)).toEqual(state);
  });

  test("full state (offset, limit, archived, sort, filters) round-trips identically", () => {
    const state: ListState = {
      offset: 100,
      limit: 25,
      includeArchived: true,
      sort: { fieldSlug: "name", direction: "desc" },
      filters: [
        { fieldSlug: "status", operator: "is", value: "active" },
        { fieldSlug: "revenue", operator: "between", value: ["1000", "5000"] },
      ],
    };
    expect(roundTrip(state)).toEqual(state);
  });

  test("offset 0 is omitted from the query but parses back to 0", () => {
    const qs = stateToQuery({
      offset: 0,
      limit: 50,
      includeArchived: false,
      sort: null,
      filters: [],
    });
    expect(qs).not.toContain("offset");
    expect(parseListParams(new URLSearchParams(qs)).offset).toBe(0);
  });

  test("empty query string yields parser defaults (no-params first-load path)", () => {
    expect(parseListParams(new URLSearchParams(""))).toEqual({
      offset: 0,
      limit: 50,
      includeArchived: false,
      sort: null,
      filters: [],
      owner: null,
    });
  });
});
