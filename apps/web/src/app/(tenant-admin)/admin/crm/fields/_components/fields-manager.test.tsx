// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FieldsManager } from "./fields-manager";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const baseField = {
  isRequired: false,
  isFilterable: false,
  isSystem: false,
  description: "",
};

const FIELDS = [
  { id: "1", name: "Zebra", slug: "zebra", fieldType: "text", ...baseField },
  { id: "2", name: "apple", slug: "apple", fieldType: "text", ...baseField },
  { id: "3", name: "Mango", slug: "mango", fieldType: "text", ...baseField },
];

describe("FieldsManager", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists existing fields alphabetically by name, case-insensitive", () => {
    render(<FieldsManager entityType="account" fields={FIELDS} />);
    const rows = screen.getAllByRole("row");
    // rows[0] is the header; the rest are data rows in display order.
    const names = rows
      .slice(1)
      .map((r) => within(r).queryAllByRole("cell")[1]?.textContent?.trim())
      .filter(Boolean);
    expect(names).toEqual(["apple", "Mango", "Zebra"]);
  });

  it("shows the options editor for select and posts choices on create", async () => {
    const user = userEvent.setup();
    render(<FieldsManager entityType="account" fields={FIELDS} />);

    await user.click(screen.getByRole("button", { name: "+ Add field" }));

    // No options editor while type is the default (text).
    expect(screen.queryByText("Options — one per line")).toBeNull();

    // Fill name + slug (target by position within the add form).
    const textboxes = screen.getAllByRole("textbox");
    await user.type(textboxes[0], "Stage");
    await user.type(textboxes[1], "stage");

    // Switch type to select -> editor appears.
    const typeSelect = screen.getByRole("combobox");
    await user.selectOptions(typeSelect, "select");
    expect(screen.getByText("Options — one per line")).toBeTruthy();

    // One option per line; the option text IS the value (no label/value split).
    await user.type(
      screen.getByLabelText("Options (one per line)"),
      "Closed Won"
    );

    await user.click(screen.getByRole("button", { name: "Add field" }));

    expect(globalThis.fetch).toHaveBeenCalled();
    const [, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    const payload = JSON.parse(init.body as string);
    expect(payload.fieldType).toBe("select");
    expect(payload.options).toEqual({
      choices: [{ value: "Closed Won", label: "Closed Won" }],
      sortAlphabetical: false,
    });
  });

  it("blocks create for a select field with no options", async () => {
    const user = userEvent.setup();
    render(<FieldsManager entityType="account" fields={FIELDS} />);
    await user.click(screen.getByRole("button", { name: "+ Add field" }));
    const textboxes = screen.getAllByRole("textbox");
    await user.type(textboxes[0], "Stage");
    await user.type(textboxes[1], "stage");
    await user.selectOptions(screen.getByRole("combobox"), "multi_select");
    await user.click(screen.getByRole("button", { name: "Add field" }));
    expect(
      screen.getByText("Add at least one option for a select field.")
    ).toBeTruthy();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
