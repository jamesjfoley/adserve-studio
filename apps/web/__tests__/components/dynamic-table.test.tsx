// @vitest-environment jsdom
import "../setup/jest-dom";

import { describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  FieldDefinitionWithLabels,
  FieldType,
  LayoutConfig,
} from "@adserve/module-framework";
import { DynamicTable } from "@/components/dynamic-table";
import type {
  DynamicTableProps,
  DynamicTableRecord,
} from "@/components/dynamic-table";
import { DynamicForm } from "@/components/dynamic-form/DynamicForm";

function fieldDef(args: {
  id: string;
  slug: string;
  name: string;
  fieldType: FieldType;
  displayOrder?: number;
  options?: Record<string, unknown>;
}): FieldDefinitionWithLabels {
  return {
    id: args.id,
    tenantId: "00000000-0000-0000-0000-000000000000",
    entityTypeId: "00000000-0000-0000-0000-000000000001",
    name: args.name,
    slug: args.slug,
    fieldType: args.fieldType,
    isRequired: false,
    isUnique: false,
    isSystem: false,
    defaultValue: null,
    options: args.options ?? {},
    labels: { en: args.name },
    displayOrder: args.displayOrder ?? 0,
    groupName: null,
    description: null,
    isSearchable: false,
    isFilterable: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const NAME = fieldDef({ id: "f1", slug: "name", name: "Name", fieldType: "text", displayOrder: 0 });
const EMAIL = fieldDef({ id: "f2", slug: "email", name: "Email", fieldType: "email", displayOrder: 1 });
const REVENUE = fieldDef({ id: "f3", slug: "revenue", name: "Revenue", fieldType: "currency", displayOrder: 2 });
const TAGS = fieldDef({
  id: "f4",
  slug: "tags",
  name: "Tags",
  fieldType: "multi_select",
  displayOrder: 3,
  options: { choices: [{ value: "vip", label: "VIP" }] },
});

const RECORDS: DynamicTableRecord[] = [
  {
    id: "r1",
    data: {
      name: "Acme",
      email: "ops@acme.test",
      revenue: { amount: 50000, currency: "GBP" },
      tags: ["vip"],
    },
  },
  {
    id: "r2",
    data: {
      name: "Globex",
      email: "hi@globex.test",
      revenue: { amount: 12000, currency: "GBP" },
      tags: [],
    },
    isArchived: true,
  },
];

function buildProps(
  overrides: Partial<DynamicTableProps> = {}
): DynamicTableProps {
  return {
    fields: [NAME, EMAIL, REVENUE, TAGS],
    records: RECORDS,
    sort: null,
    onSortChange: vi.fn(),
    filterState: { filters: [], includeArchived: false },
    onFiltersChange: vi.fn(),
    pagination: { offset: 0, limit: 10, total: 2 },
    onPageChange: vi.fn(),
    locale: "en-GB",
    ...overrides,
  };
}

describe("DynamicTable — rendering", () => {
  test("renders a column header and a row cell per field/record", () => {
    render(<DynamicTable {...buildProps()} />);

    expect(
      screen.getByRole("button", { name: "Sort by Name" })
    ).toBeInTheDocument();
    // Non-sortable column renders a plain header (no sort button).
    expect(
      screen.queryByRole("button", { name: "Sort by Tags" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /Tags/ })
    ).toBeInTheDocument();

    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Globex")).toBeInTheDocument();
  });

  test("empty state spans the table when there are no records", () => {
    render(
      <DynamicTable
        {...buildProps({ records: [], pagination: { offset: 0, limit: 10, total: 0 } })}
        emptyMessage="Nothing here yet."
      />
    );
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });
});

describe("DynamicTable — sorting", () => {
  test("clicking a sortable header emits asc, then desc, then clear", async () => {
    const onSortChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <DynamicTable {...buildProps({ onSortChange })} />
    );

    await user.click(screen.getByRole("button", { name: "Sort by Name" }));
    expect(onSortChange).toHaveBeenLastCalledWith({
      fieldSlug: "name",
      direction: "asc",
    });

    rerender(
      <DynamicTable
        {...buildProps({ onSortChange, sort: { fieldSlug: "name", direction: "asc" } })}
      />
    );
    await user.click(screen.getByRole("button", { name: "Sort by Name" }));
    expect(onSortChange).toHaveBeenLastCalledWith({
      fieldSlug: "name",
      direction: "desc",
    });

    rerender(
      <DynamicTable
        {...buildProps({ onSortChange, sort: { fieldSlug: "name", direction: "desc" } })}
      />
    );
    await user.click(screen.getByRole("button", { name: "Sort by Name" }));
    expect(onSortChange).toHaveBeenLastCalledWith(null);
  });

  test("active sort column exposes aria-sort", () => {
    render(
      <DynamicTable
        {...buildProps({ sort: { fieldSlug: "name", direction: "asc" } })}
      />
    );
    expect(
      screen.getByRole("columnheader", { name: /Name/ })
    ).toHaveAttribute("aria-sort", "ascending");
  });
});

describe("DynamicTable — column value-picker filters", () => {
  // Facets drive which columns are filterable: only columns the server lists
  // (repeating text columns) get a filter icon and a value picklist.
  const FACETS = {
    name: ["Globex", "Acme", "Initech"],
  };

  test("only columns with server-supplied facets expose a filter icon", () => {
    render(<DynamicTable {...buildProps({ columnFacets: { name: FACETS.name } })} />);

    // Name has a facet → filterable.
    expect(
      screen.getByRole("button", { name: "Filter by Name" })
    ).toBeInTheDocument();
    // Email/Revenue/Tags have no facet (always-unique / non-text) → no icon.
    expect(
      screen.queryByRole("button", { name: "Filter by Email" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Filter by Revenue" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Filter by Tags" })
    ).not.toBeInTheDocument();
  });

  test("no filter icons at all when no facets are supplied", () => {
    render(<DynamicTable {...buildProps()} />);
    expect(
      screen.queryByRole("button", { name: /^Filter by / })
    ).not.toBeInTheDocument();
  });

  test("there is no global 'Add filter' control", () => {
    render(<DynamicTable {...buildProps({ columnFacets: { name: FACETS.name } })} />);
    expect(screen.queryByLabelText("Add filter")).not.toBeInTheDocument();
  });

  test("the picklist lists every value in alphabetical order", async () => {
    const user = userEvent.setup();
    render(<DynamicTable {...buildProps({ columnFacets: { name: FACETS.name } })} />);

    await user.click(screen.getByRole("button", { name: "Filter by Name" }));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Acme", "Globex", "Initech"]);
  });

  test("picking a value commits an equals filter for that column", async () => {
    const onFiltersChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DynamicTable
        {...buildProps({ onFiltersChange, columnFacets: { name: FACETS.name } })}
      />
    );

    await user.click(screen.getByRole("button", { name: "Filter by Name" }));
    await user.click(screen.getByRole("option", { name: "Globex" }));

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(onFiltersChange).toHaveBeenCalledWith({
      filters: [{ fieldSlug: "name", operator: "equals", value: "Globex" }],
      includeArchived: false,
    });
  });

  test("typing narrows the picklist to matching values (case-insensitive)", async () => {
    const user = userEvent.setup();
    render(<DynamicTable {...buildProps({ columnFacets: { name: FACETS.name } })} />);

    await user.click(screen.getByRole("button", { name: "Filter by Name" }));
    await user.type(screen.getByLabelText("Filter Name value"), "in");

    // "Initech" matches; "Acme"/"Globex" do not.
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Initech"]);
  });

  test("typing does not emit until a value is picked", async () => {
    const onFiltersChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DynamicTable
        {...buildProps({ onFiltersChange, columnFacets: { name: FACETS.name } })}
      />
    );

    await user.click(screen.getByRole("button", { name: "Filter by Name" }));
    await user.type(screen.getByLabelText("Filter Name value"), "ac");
    expect(onFiltersChange).not.toHaveBeenCalled();
  });

  test("picking a value replaces any existing filter on the same column", async () => {
    const onFiltersChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DynamicTable
        {...buildProps({
          onFiltersChange,
          columnFacets: { name: FACETS.name },
          filterState: {
            filters: [
              { fieldSlug: "name", operator: "equals", value: "Acme" },
              { fieldSlug: "email", operator: "contains", value: "keep" },
            ],
            includeArchived: false,
          },
        })}
      />
    );

    // The icon reflects the active selection.
    await user.click(screen.getByRole("button", { name: "Filter by Name" }));
    expect(screen.getByRole("option", { name: "Acme" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await user.click(screen.getByRole("option", { name: "Globex" }));

    expect(onFiltersChange).toHaveBeenLastCalledWith({
      filters: [
        { fieldSlug: "email", operator: "contains", value: "keep" },
        { fieldSlug: "name", operator: "equals", value: "Globex" },
      ],
      includeArchived: false,
    });
  });

  test("'All …' clears only that column's filter", async () => {
    const onFiltersChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DynamicTable
        {...buildProps({
          onFiltersChange,
          columnFacets: { name: FACETS.name },
          filterState: {
            filters: [
              { fieldSlug: "name", operator: "equals", value: "Acme" },
              { fieldSlug: "email", operator: "contains", value: "keep" },
            ],
            includeArchived: false,
          },
        })}
      />
    );

    await user.click(screen.getByRole("button", { name: "Filter by Name" }));
    await user.click(screen.getByRole("button", { name: "All name" }));

    expect(onFiltersChange).toHaveBeenLastCalledWith({
      filters: [{ fieldSlug: "email", operator: "contains", value: "keep" }],
      includeArchived: false,
    });
  });

  test("include-archived toggle commits immediately", async () => {
    const onFiltersChange = vi.fn();
    const user = userEvent.setup();
    render(<DynamicTable {...buildProps({ onFiltersChange })} />);

    await user.click(screen.getByLabelText("Include archived"));
    expect(onFiltersChange).toHaveBeenCalledWith({
      filters: [],
      includeArchived: true,
    });
  });
});

describe("DynamicTable — pagination", () => {
  test("Previous disabled on first page; Next emits the next offset", async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DynamicTable
        {...buildProps({
          onPageChange,
          pagination: { offset: 0, limit: 10, total: 42 },
        })}
      />
    );

    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByText("1–10 of 42")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPageChange).toHaveBeenCalledWith(10);
  });

  test("Next disabled on the last page", () => {
    render(
      <DynamicTable
        {...buildProps({ pagination: { offset: 40, limit: 10, total: 42 } })}
      />
    );
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByText("41–42 of 42")).toBeInTheDocument();
  });
});

describe("DynamicTable — column visibility", () => {
  test("unchecking a column hides it and notifies the callback", async () => {
    const onVisibleColumnsChange = vi.fn();
    const user = userEvent.setup();
    render(<DynamicTable {...buildProps({ onVisibleColumnsChange })} />);

    expect(
      screen.getByRole("button", { name: "Sort by Email" })
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Toggle columns" }));
    const menu = screen.getByRole("menu");
    await user.click(within(menu).getByLabelText("Email"));

    expect(onVisibleColumnsChange).toHaveBeenCalledWith([
      "name",
      "revenue",
      "tags",
    ]);
    expect(
      screen.queryByRole("button", { name: "Sort by Email" })
    ).not.toBeInTheDocument();
  });
});

describe("DynamicTable — row interaction", () => {
  test("clicking a row fires onRowClick with the record", async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    render(<DynamicTable {...buildProps({ onRowClick })} />);

    await user.click(screen.getByText("Acme"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(RECORDS[0]);
  });

  test("clicking an email link inside a row does NOT fire onRowClick", async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    render(<DynamicTable {...buildProps({ onRowClick })} />);

    await user.click(screen.getByRole("link", { name: "ops@acme.test" }));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  test("archived rows are marked with an indicator", () => {
    render(<DynamicTable {...buildProps()} />);
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });
});

describe("DynamicTable — cell formatting consistency with DynamicForm view mode", () => {
  test("currency renders identically in the form view and a table cell", () => {
    const field = REVENUE;
    const value = { amount: 50000, currency: "GBP" };
    const expected = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      maximumFractionDigits: 2,
    }).format(50000);

    const layout: LayoutConfig = {
      sections: [{ title: "Financials", columns: 2, fieldIds: [field.id] }],
    };
    render(
      <DynamicForm
        layoutConfig={layout}
        fields={[field]}
        initialData={{ revenue: value }}
        mode="view"
        locale="en-GB"
      />
    );
    render(
      <DynamicTable
        {...buildProps({
          fields: [field],
          records: [{ id: "r1", data: { revenue: value } }],
        })}
      />
    );

    // One occurrence from the form, one from the table — identical text.
    expect(screen.getAllByText(expected)).toHaveLength(2);
  });

  test("date renders identically (locale-aware) in both surfaces", () => {
    cleanup();
    const dateField = fieldDef({
      id: "d1",
      slug: "closeDate",
      name: "Close date",
      fieldType: "date",
    });
    const value = "2026-03-15";
    const expected = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(value + "T00:00:00Z"));

    render(
      <DynamicForm
        layoutConfig={{
          sections: [{ title: "S", columns: 2, fieldIds: [dateField.id] }],
        }}
        fields={[dateField]}
        initialData={{ closeDate: value }}
        mode="view"
        locale="en-GB"
      />
    );
    render(
      <DynamicTable
        {...buildProps({
          fields: [dateField],
          records: [{ id: "r1", data: { closeDate: value } }],
        })}
      />
    );

    expect(screen.getAllByText(expected)).toHaveLength(2);
  });
});

describe("DynamicTable — long_text cell truncation (Task 1.3 live-render verify)", () => {
  test("clamps via CSS while the full text stays in the DOM", () => {
    const notes = fieldDef({
      id: "n1",
      slug: "notes",
      name: "Notes",
      fieldType: "long_text",
      displayOrder: 0,
    });
    const longText = "Lorem ipsum dolor sit amet ".repeat(30).trim();

    render(
      <DynamicTable
        {...buildProps({
          fields: [notes],
          records: [{ id: "r1", data: { notes: longText } }],
        })}
      />
    );

    const textEl = screen.getByText(longText);
    // formatFieldValue output is un-truncated — full text present.
    expect(textEl.textContent).toBe(longText);
    // Truncation is CSS-only (line-clamp on the cell wrapper), so it never
    // alters textContent — this is what keeps the consistency guarantee.
    expect(textEl.closest(".line-clamp-2")).not.toBeNull();
  });
});

describe("DynamicTable — search box", () => {
  test("no search box unless searchField is provided", () => {
    render(<DynamicTable {...buildProps()} />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  test("submitting the search box commits a contains filter on the field", async () => {
    const onFiltersChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DynamicTable
        {...buildProps({ onFiltersChange, searchField: "name" })}
      />
    );

    const box = screen.getByRole("searchbox");
    await user.type(box, "acme{Enter}");

    expect(onFiltersChange).toHaveBeenLastCalledWith({
      filters: [{ fieldSlug: "name", operator: "contains", value: "acme" }],
      includeArchived: false,
    });
  });

  test("clearing the search box removes the contains filter, preserving others", async () => {
    const onFiltersChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DynamicTable
        {...buildProps({
          onFiltersChange,
          searchField: "name",
          filterState: {
            filters: [
              { fieldSlug: "name", operator: "contains", value: "acme" },
              { fieldSlug: "email", operator: "contains", value: "test" },
            ],
            includeArchived: false,
          },
        })}
      />
    );

    const box = screen.getByRole("searchbox");
    await user.clear(box);
    await user.keyboard("{Enter}");

    expect(onFiltersChange).toHaveBeenLastCalledWith({
      filters: [{ fieldSlug: "email", operator: "contains", value: "test" }],
      includeArchived: false,
    });
  });

  test("search box is seeded from the committed contains filter", () => {
    render(
      <DynamicTable
        {...buildProps({
          searchField: "name",
          filterState: {
            filters: [{ fieldSlug: "name", operator: "contains", value: "globex" }],
            includeArchived: false,
          },
        })}
      />
    );
    expect(screen.getByRole("searchbox")).toHaveValue("globex");
  });
});
