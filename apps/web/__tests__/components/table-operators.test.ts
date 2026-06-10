import { describe, expect, test } from "vitest";
import type { FieldType } from "@adserve/module-framework";
import {
  isFilterable,
  isSortable,
  isTextFilterable,
  operatorsForType,
} from "@/components/dynamic-table/operators";

describe("operatorsForType", () => {
  test("text-family types share contains/equals/startsWith", () => {
    for (const t of ["text", "long_text", "email", "phone", "url"] as const) {
      expect(operatorsForType(t).map((o) => o.value)).toEqual([
        "contains",
        "equals",
        "startsWith",
      ]);
    }
  });

  test("number and currency get equals/gt/lt/between", () => {
    for (const t of ["number", "currency"] as const) {
      expect(operatorsForType(t).map((o) => o.value)).toEqual([
        "equals",
        "gt",
        "lt",
        "between",
      ]);
    }
  });

  test("date/datetime get before/after/between with the right input kind", () => {
    expect(operatorsForType("date").map((o) => o.input)).toEqual([
      "date",
      "date",
      "between-date",
    ]);
    expect(operatorsForType("datetime").map((o) => o.input)).toEqual([
      "datetime",
      "datetime",
      "between-datetime",
    ]);
  });

  test("select is/isNot, boolean isTrue/isFalse, multi_select has/hasNot", () => {
    expect(operatorsForType("select").map((o) => o.value)).toEqual([
      "is",
      "isNot",
    ]);
    expect(operatorsForType("boolean").map((o) => o.value)).toEqual([
      "isTrue",
      "isFalse",
    ]);
    expect(operatorsForType("multi_select").map((o) => o.value)).toEqual([
      "has",
      "hasNot",
    ]);
  });

  test("relationship and non-data types are not filterable", () => {
    for (const t of [
      "relationship",
      "user",
      "file",
      "image",
      "json",
      "computed",
      "ai_generated",
    ] as FieldType[]) {
      expect(operatorsForType(t)).toEqual([]);
      expect(isFilterable(t)).toBe(false);
    }
  });
});

describe("isSortable", () => {
  test("scalar types are sortable", () => {
    for (const t of [
      "text",
      "long_text",
      "email",
      "phone",
      "url",
      "number",
      "currency",
      "date",
      "datetime",
      "boolean",
      "select",
    ] as const) {
      expect(isSortable(t)).toBe(true);
    }
  });

  test("multi_select and relationship are NOT sortable (no scalar cast)", () => {
    expect(isSortable("multi_select")).toBe(false);
    expect(isSortable("relationship")).toBe(false);
  });
});

describe("isTextFilterable", () => {
  test("text-value columns are text-filterable (get a header filter icon)", () => {
    for (const t of ["text", "long_text", "email", "phone", "url"] as FieldType[]) {
      expect(isTextFilterable(t)).toBe(true);
    }
  });

  test("numeric, currency, date, select, boolean, multi_select are NOT", () => {
    for (const t of [
      "number",
      "currency",
      "date",
      "datetime",
      "select",
      "boolean",
      "multi_select",
      "relationship",
    ] as FieldType[]) {
      expect(isTextFilterable(t)).toBe(false);
    }
  });
});
