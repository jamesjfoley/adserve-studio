import { describe, expect, test } from "vitest";
import { buildWhere, parseListParams, resolveOwnerFilter } from "@/lib/crm/query";
import { stateToQuery, type ListState } from "@/lib/crm/list-params";

const ME = "11111111-1111-1111-1111-111111111111";
const TENANT = "00000000-0000-0000-0000-000000000000";
const ENTITY = "00000000-0000-0000-0000-000000000001";

describe("resolveOwnerFilter", () => {
  test("null token → null", () => {
    expect(resolveOwnerFilter(null, ME)).toBeNull();
  });
  test('"me" resolves to the current user', () => {
    expect(resolveOwnerFilter("me", ME)).toEqual({ kind: "user", userId: ME });
  });
  test('"unassigned" → unassigned kind', () => {
    expect(resolveOwnerFilter("unassigned", ME)).toEqual({ kind: "unassigned" });
  });
  test("an explicit userId is passed through", () => {
    expect(resolveOwnerFilter("user-9", ME)).toEqual({ kind: "user", userId: "user-9" });
  });
});

describe("parseListParams — owner", () => {
  test("absent owner → null", () => {
    expect(parseListParams(new URLSearchParams()).owner).toBeNull();
  });
  test("blank owner → null", () => {
    expect(parseListParams(new URLSearchParams({ owner: "  " })).owner).toBeNull();
  });
  test("token preserved", () => {
    expect(parseListParams(new URLSearchParams({ owner: "me" })).owner).toBe("me");
  });
});

describe("stateToQuery — owner round-trip", () => {
  const base: ListState = {
    offset: 0,
    limit: 50,
    includeArchived: false,
    sort: null,
    filters: [],
  };
  test("emits owner when set", () => {
    const qs = stateToQuery({ ...base, owner: "unassigned" });
    expect(new URLSearchParams(qs).get("owner")).toBe("unassigned");
    expect(parseListParams(new URLSearchParams(qs)).owner).toBe("unassigned");
  });
  test("omits owner when null/undefined", () => {
    expect(new URLSearchParams(stateToQuery(base)).has("owner")).toBe(false);
    expect(
      new URLSearchParams(stateToQuery({ ...base, owner: null })).has("owner")
    ).toBe(false);
  });
});

describe("buildWhere — owner predicate", () => {
  test("accepts a user owner filter without throwing", () => {
    expect(() =>
      buildWhere(TENANT, ENTITY, [], [], false, { kind: "user", userId: ME })
    ).not.toThrow();
  });
  test("accepts an unassigned owner filter without throwing", () => {
    expect(() =>
      buildWhere(TENANT, ENTITY, [], [], false, { kind: "unassigned" })
    ).not.toThrow();
  });
  test("owner filter is optional (back-compat)", () => {
    expect(() => buildWhere(TENANT, ENTITY, [], [], false)).not.toThrow();
  });
});
