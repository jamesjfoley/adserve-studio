// @vitest-environment jsdom
import "../setup/jest-dom";

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  FieldDefinitionWithLabels,
  FieldType,
} from "@adserve/module-framework";
import { DynamicTable } from "@/components/dynamic-table";
import type { DynamicTableRecord } from "@/components/dynamic-table";

function fieldDef(id: string, slug: string, name: string, fieldType: FieldType): FieldDefinitionWithLabels {
  return {
    id,
    tenantId: "t",
    entityTypeId: "e",
    name,
    slug,
    fieldType,
    isRequired: false,
    isUnique: false,
    isSystem: false,
    defaultValue: null,
    options: {},
    labels: { en: name },
    displayOrder: 0,
    groupName: null,
    description: null,
    isSearchable: false,
    isFilterable: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const NAME = fieldDef("f-name", "name", "Name", "text");
const ROWS: DynamicTableRecord[] = [
  { id: "r1", data: { name: "Acme" } },
  { id: "r2", data: { name: "Globex" } },
];

const noop = () => {};

function renderTable(overrides: Record<string, unknown> = {}) {
  return render(
    <DynamicTable
      fields={[NAME]}
      records={ROWS}
      sort={null}
      onSortChange={noop}
      filterState={{ filters: [], includeArchived: false }}
      onFiltersChange={noop}
      pagination={{ offset: 0, limit: 50, total: 2 }}
      onPageChange={noop}
      defaultVisibleColumns={["name"]}
      locale="en-GB"
      {...overrides}
    />
  );
}

afterEach(cleanup);

describe("DynamicTable — row selection", () => {
  test("no checkboxes unless selectable", () => {
    renderTable();
    expect(screen.queryByLabelText("Select all rows")).not.toBeInTheDocument();
  });

  test("toggling a row checkbox emits the new selection", async () => {
    const onSelectionChange = vi.fn();
    const user = userEvent.setup();
    renderTable({ selectable: true, selectedIds: [], onSelectionChange });

    await user.click(screen.getByLabelText("Select row r1"));
    expect(onSelectionChange).toHaveBeenCalledWith(["r1"]);
  });

  test("select-all selects every row on the page", async () => {
    const onSelectionChange = vi.fn();
    const user = userEvent.setup();
    renderTable({ selectable: true, selectedIds: [], onSelectionChange });

    await user.click(screen.getByLabelText("Select all rows"));
    expect(onSelectionChange).toHaveBeenCalledWith(["r1", "r2"]);
  });

  test("select-all is indeterminate on a partial selection", () => {
    renderTable({ selectable: true, selectedIds: ["r1"], onSelectionChange: noop });
    const selectAll = screen.getByLabelText("Select all rows") as HTMLInputElement;
    expect(selectAll.indeterminate).toBe(true);
    expect(selectAll.checked).toBe(false);
  });

  test("checkbox click does not trigger row navigation", async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    renderTable({
      selectable: true,
      selectedIds: [],
      onSelectionChange: noop,
      onRowClick,
    });

    await user.click(screen.getByLabelText("Select row r1"));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
