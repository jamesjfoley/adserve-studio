import { describe, expect, test } from "vitest";
import { formatCurrency, heuristicTitle } from "@/lib/crm/dashboard";

describe("heuristicTitle", () => {
  test("prefers data.name", () => {
    expect(heuristicTitle({ name: "Acme" }, "id-1")).toBe("Acme");
  });
  test("falls back to firstName + lastName", () => {
    expect(heuristicTitle({ firstName: "Jo", lastName: "Bloggs" }, "id-1")).toBe(
      "Jo Bloggs"
    );
  });
  test("falls back to the id when no name fields", () => {
    expect(heuristicTitle({ status: "active" }, "id-1")).toBe("id-1");
    expect(heuristicTitle({ name: "  " }, "id-1")).toBe("id-1");
  });
});

describe("formatCurrency", () => {
  test("formats GBP without fraction digits", () => {
    expect(formatCurrency(1500, "en-GB")).toBe("£1,500");
  });
  test("formats zero", () => {
    expect(formatCurrency(0, "en-GB")).toBe("£0");
  });
});
