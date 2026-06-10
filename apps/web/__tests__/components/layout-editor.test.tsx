// @vitest-environment jsdom
import "../setup/jest-dom";

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LayoutEditor } from "@/app/(tenant-admin)/admin/crm/layouts/_components/layout-editor";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const fields = [
  { id: "f1", name: "First name" },
  { id: "f2", name: "Last name" },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function sectionPanels() {
  // Each section's title <input> is the simplest stable handle on the panel.
  return screen
    .getAllByRole("textbox")
    .map((el) => el as HTMLInputElement);
}

describe("LayoutEditor", () => {
  test("move section down reorders the sections array", async () => {
    const user = userEvent.setup();
    render(
      <LayoutEditor
        layoutId="l1"
        fields={fields}
        initialConfig={{
          sections: [
            { title: "Alpha", columns: 2, fieldIds: ["f1"] },
            { title: "Beta", columns: 2, fieldIds: ["f2"] },
          ],
        }}
      />
    );

    let titles = sectionPanels().map((i) => i.value);
    expect(titles).toEqual(["Alpha", "Beta"]);

    // Move the first section ("Alpha") down.
    const downButtons = screen.getAllByLabelText("Move section down");
    await user.click(downButtons[0]);

    titles = sectionPanels().map((i) => i.value);
    expect(titles).toEqual(["Beta", "Alpha"]);
  });

  test("move section up/down disabled at the ends", () => {
    render(
      <LayoutEditor
        layoutId="l1"
        fields={fields}
        initialConfig={{
          sections: [
            { title: "Alpha", columns: 2, fieldIds: [] },
            { title: "Beta", columns: 2, fieldIds: [] },
          ],
        }}
      />
    );

    const ups = screen.getAllByLabelText("Move section up");
    const downs = screen.getAllByLabelText("Move section down");
    expect(ups[0]).toBeDisabled(); // first can't move up
    expect(ups[1]).not.toBeDisabled();
    expect(downs[0]).not.toBeDisabled();
    expect(downs[1]).toBeDisabled(); // last can't move down
  });

  test("hidden checkbox toggles the section and shows a Hidden badge", async () => {
    const user = userEvent.setup();
    render(
      <LayoutEditor
        layoutId="l1"
        fields={fields}
        initialConfig={{
          sections: [{ title: "Alpha", columns: 2, fieldIds: [] }],
        }}
      />
    );

    expect(screen.queryByText("Hidden", { selector: "span" })).toBeNull();

    const checkbox = screen.getByLabelText("Hidden");
    await user.click(checkbox);

    expect(checkbox).toBeChecked();
    // A visible "Hidden" badge appears (span), distinct from the label text.
    expect(
      screen.getByText("Hidden", { selector: "span" })
    ).toBeInTheDocument();
  });

  test("widget section hides field UI and columns selector but keeps title + hidden + remove", () => {
    render(
      <LayoutEditor
        layoutId="l1"
        fields={fields}
        initialConfig={{
          sections: [
            { title: "Brands", columns: 2, fieldIds: [], widget: "brands" },
          ],
        }}
      />
    );

    // No columns selector for a widget panel.
    expect(screen.queryByText("Columns")).toBeNull();
    // No "Add field" picker (combobox) for a widget panel.
    expect(screen.queryByRole("combobox")).toBeNull();
    // Panel label present.
    expect(screen.getByText(/Brands — panel \(brands\)/)).toBeInTheDocument();
    // Title editable, hidden checkbox + remove still present.
    expect(screen.getByDisplayValue("Brands")).toBeInTheDocument();
    expect(screen.getByLabelText("Hidden")).toBeInTheDocument();
    expect(screen.getByText("Remove section")).toBeInTheDocument();
  });

  test("widget section fieldIds do not consume unplaced fields", () => {
    render(
      <LayoutEditor
        layoutId="l1"
        fields={fields}
        initialConfig={{
          sections: [
            // A (buggy) widget section carrying ids must not hide them from unplaced.
            { title: "Hist", columns: 2, fieldIds: ["f1"], widget: "history" },
            { title: "Details", columns: 2, fieldIds: [] },
          ],
        }}
      />
    );

    // Both fields remain unplaced (rendered as draggable chips in the unplaced
    // area) because the only fieldIds live on a widget section.
    expect(screen.getByText(/Unplaced fields:/)).toBeInTheDocument();
    // Names appear as draggable chips (spans) in the unplaced area.
    expect(screen.getByText("First name", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Last name", { selector: "span" })).toBeInTheDocument();
  });

  test("field grid uses the section's column count and re-renders on change", async () => {
    const user = userEvent.setup();
    render(
      <LayoutEditor
        layoutId="l1"
        fields={fields}
        initialConfig={{
          sections: [
            { title: "Alpha", columns: 2, fieldIds: ["f1", "f2"] },
          ],
        }}
      />
    );

    const grid = screen.getByTestId("grid-0");
    // The WYSIWYG grid mirrors the panel's column count (row-major placement).
    expect(grid.getAttribute("data-columns")).toBe("2");
    expect(grid.style.gridTemplateColumns).toContain("repeat(2");
    // Both placed fields are rendered as draggable chips.
    expect(within(grid).getByText("First name")).toBeInTheDocument();
    expect(within(grid).getByText("Last name")).toBeInTheDocument();

    // Changing the Columns select re-renders the same fields in the new count.
    const columnsLabel = screen.getByText("Columns").closest("label")!;
    const select = within(columnsLabel).getByRole("combobox");
    await user.selectOptions(select, "3");
    expect(grid.getAttribute("data-columns")).toBe("3");
    expect(grid.style.gridTemplateColumns).toContain("repeat(3");
  });

  test("columns selector offers 1 through 4 for normal sections", () => {
    render(
      <LayoutEditor
        layoutId="l1"
        fields={fields}
        initialConfig={{
          sections: [{ title: "Alpha", columns: 4, fieldIds: [] }],
        }}
      />
    );

    // The Columns <select> is the combobox inside the "Columns" label.
    const columnsLabel = screen.getByText("Columns").closest("label")!;
    const select = within(columnsLabel).getByRole(
      "combobox"
    ) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["1", "2", "3", "4"]);
    expect(select.value).toBe("4");
  });

  test("changing a field cell's width span is sent in the saved items", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 }) as Response
      );
    const user = userEvent.setup();
    render(
      <LayoutEditor
        layoutId="l1"
        fields={fields}
        initialConfig={{
          sections: [{ title: "Alpha", columns: 3, fieldIds: ["f1", "f2"] }],
        }}
      />
    );

    // The first field cell's width <select>.
    const widthSelect = screen.getByLabelText(
      "Width for Field First name"
    ) as HTMLSelectElement;
    // 1..columns offered.
    expect(Array.from(widthSelect.options).map((o) => o.value)).toEqual([
      "1",
      "2",
      "3",
    ]);
    await user.selectOptions(widthSelect, "3");

    await user.click(screen.getByText("Save layout"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    ) as { config: { sections: Array<Record<string, unknown>> } };
    const section = body.config.sections[0];
    // items carries the field cell with the new span; fieldIds preserved in order.
    expect(section.items).toEqual([
      { fieldId: "f1", span: 3 },
      { fieldId: "f2", span: 1 },
    ]);
    expect(section.fieldIds).toEqual(["f1", "f2"]);
    fetchMock.mockRestore();
  });

  test("Add empty cell and Add row break append spacer cells", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 }) as Response
      );
    const user = userEvent.setup();
    render(
      <LayoutEditor
        layoutId="l1"
        fields={fields}
        initialConfig={{
          // One field at span 1 in a 2-col section: row has 1 column remaining.
          sections: [{ title: "Alpha", columns: 2, fieldIds: ["f1"] }],
        }}
      />
    );

    await user.click(screen.getByText("Add empty cell"));
    await user.click(screen.getByText("Add row break"));
    await user.click(screen.getByText("Save layout"));

    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    ) as { config: { sections: Array<Record<string, unknown>> } };
    const section = body.config.sections[0];
    // field(1) + empty(1) = 2 used (row full) -> row break is a full-width 2 spacer.
    expect(section.items).toEqual([
      { fieldId: "f1", span: 1 },
      { spacer: true, span: 1 },
      { spacer: true, span: 2 },
    ]);
    // fieldIds excludes spacers.
    expect(section.fieldIds).toEqual(["f1"]);
    fetchMock.mockRestore();
  });

  test("widget section shows a read-only preview of its panel fields", () => {
    render(
      <LayoutEditor
        layoutId="l1"
        fields={fields}
        initialConfig={{
          sections: [
            { title: "Brands", columns: 2, fieldIds: [], widget: "brands" },
          ],
        }}
      />
    );

    expect(
      screen.getByText("Panel fields (managed by the panel)")
    ).toBeInTheDocument();
    expect(screen.getByText("Brand Values")).toBeInTheDocument();
    expect(screen.getByText("Brand Category")).toBeInTheDocument();
  });
});
