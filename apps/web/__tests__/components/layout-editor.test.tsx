// @vitest-environment jsdom
import "../setup/jest-dom";

import { afterEach, describe, expect, test, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  within,
  fireEvent,
} from "@testing-library/react";
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
  return screen.getAllByRole("textbox").map((el) => el as HTMLInputElement);
}

/** Parse the section list out of the last fetch save call. */
function savedSections(fetchMock: ReturnType<typeof vi.spyOn>) {
  const body = JSON.parse(
    (fetchMock.mock.calls[0][1] as RequestInit).body as string
  ) as { config: { sections: Array<Record<string, unknown>> } };
  return body.config.sections;
}

function mockSave() {
  return vi
    .spyOn(global, "fetch")
    .mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }) as Response
    );
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
    expect(ups[0]).toBeDisabled();
    expect(ups[1]).not.toBeDisabled();
    expect(downs[0]).not.toBeDisabled();
    expect(downs[1]).toBeDisabled();
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
    await user.click(screen.getByLabelText("Hidden"));
    expect(screen.getByLabelText("Hidden")).toBeChecked();
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

    expect(screen.queryByText("Columns")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(/Brands — panel \(brands\)/)).toBeInTheDocument();
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
            { title: "Hist", columns: 2, fieldIds: ["f1"], widget: "history" },
            { title: "Details", columns: 2, fieldIds: [] },
          ],
        }}
      />
    );

    expect(screen.getByText(/Unplaced fields:/)).toBeInTheDocument();
    expect(
      screen.getByText("First name", { selector: "span" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Last name", { selector: "span" })
    ).toBeInTheDocument();
  });

  test("field grid mirrors the section's column count and reshapes on change", async () => {
    const user = userEvent.setup();
    render(
      <LayoutEditor
        layoutId="l1"
        fields={fields}
        initialConfig={{
          sections: [{ title: "Alpha", columns: 2, fieldIds: ["f1", "f2"] }],
        }}
      />
    );

    const grid = screen.getByTestId("grid-0");
    expect(grid.getAttribute("data-columns")).toBe("2");
    expect(grid.style.gridTemplateColumns).toContain("repeat(2");
    expect(within(grid).getByText("First name")).toBeInTheDocument();
    expect(within(grid).getByText("Last name")).toBeInTheDocument();

    const columnsLabel = screen.getByText("Columns").closest("label")!;
    await user.selectOptions(within(columnsLabel).getByRole("combobox"), "3");
    expect(grid.getAttribute("data-columns")).toBe("3");
    expect(grid.style.gridTemplateColumns).toContain("repeat(3");
    // Both fields survive the reshape (kept at their columns 0 and 1).
    expect(within(grid).getByText("First name")).toBeInTheDocument();
    expect(within(grid).getByText("Last name")).toBeInTheDocument();
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

    const columnsLabel = screen.getByText("Columns").closest("label")!;
    const select = within(columnsLabel).getByRole(
      "combobox"
    ) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    expect(select.value).toBe("4");
  });

  test("saves absolute-positioned items with row/col, fieldIds and rows", async () => {
    const fetchMock = mockSave();
    const user = userEvent.setup();
    render(
      <LayoutEditor
        layoutId="l1"
        fields={fields}
        initialConfig={{
          sections: [{ title: "Alpha", columns: 2, fieldIds: ["f1", "f2"] }],
        }}
      />
    );

    await user.click(screen.getByText("Save layout"));
    const section = savedSections(fetchMock)[0];
    expect(section.items).toEqual([
      { fieldId: "f1", span: 1, row: 0, col: 0 },
      { fieldId: "f2", span: 1, row: 0, col: 1 },
    ]);
    expect(section.fieldIds).toEqual(["f1", "f2"]);
    expect(section.rows).toBe(1);
    fetchMock.mockRestore();
  });

  test("field width is capped so it cannot overlap the next field, and persists", async () => {
    const fetchMock = mockSave();
    const user = userEvent.setup();
    render(
      <LayoutEditor
        layoutId="l1"
        fields={fields}
        initialConfig={{
          // Only f1 placed in a 3-col section → it can span the full width.
          sections: [{ title: "Alpha", columns: 3, fieldIds: ["f1"] }],
        }}
      />
    );

    const widthSelect = screen.getByLabelText(
      "Width for Field First name"
    ) as HTMLSelectElement;
    expect(Array.from(widthSelect.options).map((o) => o.value)).toEqual([
      "1",
      "2",
      "3",
    ]);
    await user.selectOptions(widthSelect, "3");
    await user.click(screen.getByText("Save layout"));

    const section = savedSections(fetchMock)[0];
    expect(section.items).toEqual([
      { fieldId: "f1", span: 3, row: 0, col: 0 },
    ]);
    fetchMock.mockRestore();
  });

  test("a field next to another caps width at 1 (no overlap option)", () => {
    render(
      <LayoutEditor
        layoutId="l1"
        fields={fields}
        initialConfig={{
          sections: [{ title: "Alpha", columns: 3, fieldIds: ["f1", "f2"] }],
        }}
      />
    );
    // f1 at col 0, f2 at col 1 → f1 can only be width 1 (f2 blocks col 1).
    const widthSelect = screen.getByLabelText(
      "Width for Field First name"
    ) as HTMLSelectElement;
    expect(Array.from(widthSelect.options).map((o) => o.value)).toEqual(["1"]);
  });

  test("dragging a field onto an EMPTY cell moves it there; nothing else moves", async () => {
    const fetchMock = mockSave();
    const user = userEvent.setup();
    render(
      <LayoutEditor
        layoutId="l1"
        fields={fields}
        initialConfig={{
          // f1 at (0,0); (0,1) empty.
          sections: [{ title: "Alpha", columns: 2, fieldIds: ["f1"] }],
        }}
      />
    );

    const source = screen.getByLabelText("Field First name");
    const target = screen.getByLabelText("Empty cell row 1 column 2");
    fireEvent.dragStart(source);
    fireEvent.drop(target);

    await user.click(screen.getByText("Save layout"));
    const section = savedSections(fetchMock)[0];
    // f1 now lives at col 1; no other cell created or moved.
    expect(section.items).toEqual([
      { fieldId: "f1", span: 1, row: 0, col: 1 },
    ]);
    fetchMock.mockRestore();
  });

  test("dragging a field onto a FILLED cell swaps the two; nothing else moves", async () => {
    const fetchMock = mockSave();
    const user = userEvent.setup();
    render(
      <LayoutEditor
        layoutId="l1"
        fields={fields}
        initialConfig={{
          // f1 at (0,0), f2 at (0,1).
          sections: [{ title: "Alpha", columns: 2, fieldIds: ["f1", "f2"] }],
        }}
      />
    );

    fireEvent.dragStart(screen.getByLabelText("Field First name"));
    fireEvent.drop(screen.getByLabelText("Field Last name"));

    await user.click(screen.getByText("Save layout"));
    const section = savedSections(fetchMock)[0];
    // f1 and f2 swapped positions; both still present, exactly two cells.
    expect(section.items).toEqual([
      { fieldId: "f2", span: 1, row: 0, col: 0 },
      { fieldId: "f1", span: 1, row: 0, col: 1 },
    ]);
    expect(section.fieldIds).toEqual(["f2", "f1"]);
    fetchMock.mockRestore();
  });

  test("Add row grows the grid (persisted), Remove last row trims an empty trailing row", async () => {
    const fetchMock = mockSave();
    const user = userEvent.setup();
    render(
      <LayoutEditor
        layoutId="l1"
        fields={fields}
        initialConfig={{
          sections: [{ title: "Alpha", columns: 2, fieldIds: ["f1"] }],
        }}
      />
    );

    const grid = screen.getByTestId("grid-0");
    expect(grid.getAttribute("data-rows")).toBe("1");

    // Remove last row is disabled while the only row holds a field.
    expect(screen.getByText("Remove last row")).toBeDisabled();

    await user.click(screen.getByText("Add row"));
    expect(grid.getAttribute("data-rows")).toBe("2");
    // The new empty trailing row makes Remove last row available again.
    expect(screen.getByText("Remove last row")).not.toBeDisabled();

    await user.click(screen.getByText("Save layout"));
    expect(savedSections(fetchMock)[0].rows).toBe(2);

    await user.click(screen.getByText("Remove last row"));
    expect(grid.getAttribute("data-rows")).toBe("1");
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
