import { describe, expect, test } from "vitest";
import type { FieldDefinitionWithLabels } from "@adserve/module-framework";
import {
  buildOrderBy,
  buildWhere,
  CrmQueryError,
  parseListParams,
} from "@/lib/crm/query";

function field(
  slug: string,
  fieldType: FieldDefinitionWithLabels["fieldType"]
): FieldDefinitionWithLabels {
  return {
    id: `id-${slug}`,
    tenantId: "t",
    entityTypeId: "e",
    name: slug,
    slug,
    fieldType,
    isRequired: false,
    isUnique: false,
    isSystem: false,
    defaultValue: null,
    options: {},
    labels: { en: slug },
    displayOrder: 0,
    groupName: null,
    description: null,
    isSearchable: false,
    isFilterable: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const TENANT = "00000000-0000-0000-0000-000000000000";
const ENTITY = "00000000-0000-0000-0000-000000000001";

describe("parseListParams", () => {
  test("defaults offset/limit and excludes archived", () => {
    const p = parseListParams(new URLSearchParams());
    expect(p.offset).toBe(0);
    expect(p.limit).toBe(50);
    expect(p.includeArchived).toBe(false);
    expect(p.sort).toBeNull();
    expect(p.filters).toEqual([]);
  });

  test("caps limit at 200 and clamps offset at 0", () => {
    const p = parseListParams(
      new URLSearchParams({ limit: "9999", offset: "-5" })
    );
    expect(p.limit).toBe(200);
    expect(p.offset).toBe(0);
  });

  test("parses sort + filters JSON and includeArchived", () => {
    const p = parseListParams(
      new URLSearchParams({
        includeArchived: "true",
        sort: JSON.stringify({ fieldSlug: "name", direction: "desc" }),
        filters: JSON.stringify([
          { fieldSlug: "status", operator: "is", value: "active" },
        ]),
      })
    );
    expect(p.includeArchived).toBe(true);
    expect(p.sort).toEqual({ fieldSlug: "name", direction: "desc" });
    expect(p.filters).toHaveLength(1);
  });

  test("rejects malformed JSON and bad sort direction", () => {
    expect(() =>
      parseListParams(new URLSearchParams({ sort: "{" }))
    ).toThrow(CrmQueryError);
    expect(() =>
      parseListParams(
        new URLSearchParams({
          sort: JSON.stringify({ fieldSlug: "x", direction: "sideways" }),
        })
      )
    ).toThrow(CrmQueryError);
    expect(() =>
      parseListParams(new URLSearchParams({ filters: JSON.stringify({}) }))
    ).toThrow(CrmQueryError);
  });
});

describe("buildWhere — eligibility enforcement", () => {
  const fields = [
    field("name", "text"),
    field("status", "select"),
    field("revenue", "currency"),
    field("tags", "multi_select"),
  ];

  test("builds without throwing for valid filters", () => {
    expect(() =>
      buildWhere(
        TENANT,
        ENTITY,
        fields,
        [
          { fieldSlug: "name", operator: "contains", value: "ac" },
          { fieldSlug: "revenue", operator: "gt", value: "1000" },
          { fieldSlug: "tags", operator: "has", value: "vip" },
        ],
        false
      )
    ).not.toThrow();
  });

  test("rejects an unknown filter field", () => {
    expect(() =>
      buildWhere(
        TENANT,
        ENTITY,
        fields,
        [{ fieldSlug: "nope", operator: "contains", value: "x" }],
        false
      )
    ).toThrow(CrmQueryError);
  });

  test("rejects an operator not allowed for the field type", () => {
    // `gt` is a number operator; not valid on a text field.
    expect(() =>
      buildWhere(
        TENANT,
        ENTITY,
        fields,
        [{ fieldSlug: "name", operator: "gt", value: "1" }],
        false
      )
    ).toThrow(CrmQueryError);
  });
});

describe("buildOrderBy — sort eligibility", () => {
  test("returns null when no sort", () => {
    expect(buildOrderBy([field("name", "text")], null)).toBeNull();
  });

  test("builds for a sortable field", () => {
    expect(buildOrderBy([field("name", "text")], {
      fieldSlug: "name",
      direction: "asc",
    })).not.toBeNull();
  });

  test("rejects a non-sortable field type (multi_select)", () => {
    expect(() =>
      buildOrderBy([field("tags", "multi_select")], {
        fieldSlug: "tags",
        direction: "asc",
      })
    ).toThrow(CrmQueryError);
  });

  test("rejects an unknown sort field", () => {
    expect(() =>
      buildOrderBy([field("name", "text")], {
        fieldSlug: "ghost",
        direction: "asc",
      })
    ).toThrow(CrmQueryError);
  });
});
