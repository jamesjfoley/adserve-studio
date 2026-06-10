// @vitest-environment jsdom
import "../setup/jest-dom";

import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  FieldDefinitionWithLabels,
  FieldType,
} from "@adserve/module-framework";
import type { RelatedRecord } from "@/lib/crm/relationships";
import { ContactsTable } from "@/app/(platform)/crm/[entityType]/[id]/_components/contacts-table";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

// PermissionGate is cosmetic in tests — render children so controls appear.
vi.mock("@/lib/permissions-client", () => ({
  PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</>,
  usePermissions: () => ({ hasPermission: () => true, isLoading: false }),
}));

function fieldDef(args: {
  slug: string;
  name: string;
  fieldType: FieldType;
  displayOrder?: number;
  choices?: { value: string; label: string }[];
}): FieldDefinitionWithLabels {
  return {
    id: `f-${args.slug}`,
    tenantId: "t",
    entityTypeId: "e",
    name: args.name,
    slug: args.slug,
    fieldType: args.fieldType,
    isRequired: false,
    isUnique: false,
    isSystem: false,
    defaultValue: null,
    options: args.choices ? { choices: args.choices } : {},
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

const FIELDS: FieldDefinitionWithLabels[] = [
  fieldDef({ slug: "firstName", name: "First name", fieldType: "text", displayOrder: 1 }),
  fieldDef({ slug: "lastName", name: "Last name", fieldType: "text", displayOrder: 2 }),
  fieldDef({ slug: "email", name: "Email", fieldType: "email", displayOrder: 3 }),
  fieldDef({
    slug: "status",
    name: "Status",
    fieldType: "select",
    displayOrder: 4,
    choices: [
      { value: "active", label: "Active" },
      { value: "lead", label: "Lead" },
    ],
  }),
];

function rel(
  id: string,
  data: Record<string, unknown>,
  isArchived = false
): RelatedRecord {
  return {
    id,
    data,
    isArchived,
    ownedBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    relationshipName: "contact_belongs_to_account",
    metadata: {},
    isPrimary: false,
  };
}

const ITEMS: RelatedRecord[] = [
  rel("c1", { firstName: "Alice", lastName: "Zephyr", email: "alice@x.com", status: "active" }),
  rel("c2", { firstName: "Bob", lastName: "Young", email: "bob@x.com", status: "lead" }),
  rel("c3", { firstName: "Carol", lastName: "Xavier", email: "carol@x.com", status: "active" }),
];

function renderTable(overrides: Record<string, unknown> = {}) {
  return render(
    <ContactsTable
      title="Contacts"
      items={ITEMS}
      fields={FIELDS}
      primaryAccountById={{}}
      owningSegment="accounts"
      owningId="acc-1"
      relationshipName="contact_belongs_to_account"
      direction="owner-is-source"
      editPermission="contact.update"
      canEdit
      {...overrides}
    />
  );
}

function bodyRowNames(): string[] {
  const rows = screen.getAllByRole("row");
  // row[0] is the header.
  return rows.slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent ?? "");
}

afterEach(() => {
  push.mockClear();
  refresh.mockClear();
  window.localStorage.clear();
  cleanup();
});

describe("ContactsTable (client-side DynamicTable)", () => {
  test("renders all active contacts initially", () => {
    renderTable();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Carol")).toBeInTheDocument();
  });

  test("sorting by first name ascending then descending reorders rows", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByRole("button", { name: "Sort by First name" }));
    let names = bodyRowNames();
    expect(names[0]).toContain("Alice");
    expect(names[2]).toContain("Carol");

    // Second click flips to descending.
    await user.click(screen.getByRole("button", { name: "Sort by First name" }));
    names = bodyRowNames();
    expect(names[0]).toContain("Carol");
    expect(names[2]).toContain("Alice");
  });

  test("a select column value-picker filter narrows the rows client-side", async () => {
    const user = userEvent.setup();
    renderTable();

    // The Status column is categorical → gets a funnel value-picker. Pick the
    // "Lead" value; only Bob is a lead.
    await user.click(screen.getByRole("button", { name: /filter by status/i }));
    await user.click(screen.getByRole("option", { name: "Lead" }));

    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.queryByText("Carol")).not.toBeInTheDocument();
  });

  test("row click navigates to the contact detail page", async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByText("Alice"));
    expect(push).toHaveBeenCalledWith("/crm/contacts/c1");
  });

  test("archived contacts are hidden until 'Include archived' is ticked", async () => {
    const user = userEvent.setup();
    const withArchived = [
      ...ITEMS,
      rel("c4", { firstName: "Dave", lastName: "Wu", status: "active" }, true),
    ];
    renderTable({ items: withArchived });

    expect(screen.queryByText("Dave")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("checkbox", { name: /include archived/i })
    );
    expect(screen.getByText("Dave")).toBeInTheDocument();
  });

  test("the row-count stepper defaults to 8 and is user-adjustable", async () => {
    const user = userEvent.setup();
    renderTable();
    const group = screen.getByRole("group", { name: /rows shown/i });
    expect(within(group).getByText("8")).toBeInTheDocument();

    await user.click(within(group).getByRole("button", { name: /more rows/i }));
    expect(within(group).getByText("9")).toBeInTheDocument();

    await user.click(within(group).getByRole("button", { name: /fewer rows/i }));
    await user.click(within(group).getByRole("button", { name: /fewer rows/i }));
    expect(within(group).getByText("7")).toBeInTheDocument();
  });

  test("persists the row count per user across remounts when a persistKey is set", async () => {
    const user = userEvent.setup();
    const persist = { persistKey: "account-contacts", storageScope: "user-1" };

    const { unmount } = renderTable(persist);
    let group = screen.getByRole("group", { name: /rows shown/i });
    await user.click(within(group).getByRole("button", { name: /more rows/i }));
    expect(within(group).getByText("9")).toBeInTheDocument();
    unmount();

    // Fresh mount (simulates a later login / page load) restores the choice.
    renderTable(persist);
    group = screen.getByRole("group", { name: /rows shown/i });
    expect(await within(group).findByText("9")).toBeInTheDocument();
  });

  test("a different user's persisted row count does not leak across scopes", async () => {
    const user = userEvent.setup();
    const { unmount } = renderTable({
      persistKey: "account-contacts",
      storageScope: "user-1",
    });
    await user.click(
      within(screen.getByRole("group", { name: /rows shown/i })).getByRole(
        "button",
        { name: /more rows/i }
      )
    );
    unmount();

    // A different user on the same browser starts from the default.
    renderTable({ persistKey: "account-contacts", storageScope: "user-2" });
    expect(
      await within(
        screen.getByRole("group", { name: /rows shown/i })
      ).findByText("8")
    ).toBeInTheDocument();
  });

  test("the 'New contact' action shows only when a create context is given", () => {
    // Primary Contacts table → create new.
    const { unmount } = renderTable({
      createContext: {
        fields: FIELDS,
        layoutConfig: { sections: [] },
        accountId: "acc-1",
        accountName: "Acme",
        locale: "en-GB",
      },
    });
    expect(
      screen.getByRole("button", { name: "New contact" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /link existing contact/i })
    ).not.toBeInTheDocument();
    unmount();

    // Linked Contacts table (no create context) → link existing, renamed.
    renderTable();
    expect(
      screen.getByRole("button", { name: /link existing contact/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "New contact" })
    ).not.toBeInTheDocument();
  });
});
