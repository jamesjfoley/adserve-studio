// @vitest-environment jsdom
import "../setup/jest-dom";

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  FieldDefinitionWithLabels,
  FieldType,
  LayoutConfig,
} from "@adserve/module-framework";
import { CrmListClient } from "@/app/(platform)/crm/[entityType]/_components/crm-list-client";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

function fieldDef(args: {
  id: string;
  slug: string;
  name: string;
  fieldType: FieldType;
  isRequired?: boolean;
}): FieldDefinitionWithLabels {
  return {
    id: args.id,
    tenantId: "t",
    entityTypeId: "e",
    name: args.name,
    slug: args.slug,
    fieldType: args.fieldType,
    isRequired: args.isRequired ?? false,
    isUnique: false,
    isSystem: false,
    defaultValue: null,
    options: {},
    labels: { en: args.name },
    displayOrder: 0,
    groupName: null,
    description: null,
    isSearchable: false,
    isFilterable: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const NAME = fieldDef({ id: "f-name", slug: "name", name: "Name", fieldType: "text", isRequired: true });
const LAYOUT: LayoutConfig = {
  sections: [{ title: "Details", columns: 1, fieldIds: ["f-name"] }],
};

function renderClient(overrides: Record<string, unknown> = {}) {
  return render(
    <CrmListClient
      collectionSegment="accounts"
      entityName="Account"
      fields={[NAME]}
      records={[]}
      defaultVisibleColumns={["name"]}
      sort={null}
      filterState={{ filters: [], includeArchived: false }}
      pagination={{ offset: 0, limit: 50, total: 0 }}
      createLayoutConfig={LAYOUT}
      locale="en-GB"
      {...overrides}
    />
  );
}

afterEach(() => {
  push.mockClear();
  refresh.mockClear();
  cleanup();
});

describe("CrmListClient", () => {
  test("renders the collection heading and a New button", () => {
    renderClient();
    expect(screen.getByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /new account/i })
    ).toBeInTheDocument();
  });

  test("sorting a column pushes a URL carrying the sort state (offset reset)", async () => {
    const user = userEvent.setup();
    renderClient();

    await user.click(screen.getByRole("button", { name: "Sort by Name" }));

    expect(push).toHaveBeenCalledTimes(1);
    const url = push.mock.calls[0][0] as string;
    expect(url).toContain("/crm/accounts?");
    // sort serialised as JSON; ascending on first click.
    expect(decodeURIComponent(url)).toContain('"fieldSlug":"name"');
    expect(decodeURIComponent(url)).toContain('"direction":"asc"');
    expect(url).not.toContain("offset="); // reset to 0 → omitted
  });

  test("New → fill → submit POSTs to the plural collection URL then refreshes", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ record: { id: "r1" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderClient();

    await user.click(screen.getByRole("button", { name: /new account/i }));
    await user.type(screen.getByLabelText("Name"), "Acme");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe("/api/crm/accounts");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ data: { name: "Acme" } });
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
