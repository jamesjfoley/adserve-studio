import { describe, expect, test } from "vitest";
import type { FieldDefinitionWithLabels } from "@adserve/module-framework";
import { recordTitle } from "@/lib/crm/record-title";

function field(id: string, slug: string): FieldDefinitionWithLabels {
  return { id, slug } as unknown as FieldDefinitionWithLabels;
}

const NAME = field("f-name", "name");

describe("recordTitle", () => {
  test("returns the value of the entity's name field", () => {
    expect(
      recordTitle({ nameFieldId: "f-name" }, [NAME], { name: "Acme Ltd" }, "id-1")
    ).toBe("Acme Ltd");
  });

  test("coerces a numeric name-field value to a string", () => {
    expect(
      recordTitle({ nameFieldId: "f-name" }, [NAME], { name: 42 }, "id-1")
    ).toBe("42");
  });

  test("falls back when the name-field value is missing or empty", () => {
    expect(recordTitle({ nameFieldId: "f-name" }, [NAME], {}, "id-1")).toBe(
      "id-1"
    );
    expect(
      recordTitle({ nameFieldId: "f-name" }, [NAME], { name: "   " }, "id-1")
    ).toBe("id-1");
  });

  test("falls back when nameFieldId is null", () => {
    expect(
      recordTitle({ nameFieldId: null }, [NAME], { name: "Acme" }, "id-1")
    ).toBe("id-1");
  });

  test("falls back when nameFieldId points to a field that no longer exists", () => {
    expect(
      recordTitle({ nameFieldId: "gone" }, [NAME], { name: "Acme" }, "id-1")
    ).toBe("id-1");
  });
});
