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
import { CrmCreateClient } from "@/app/(platform)/crm/[entityType]/new/_components/crm-create-client";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

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
  sections: [{ title: "Account Details", columns: 2, fieldIds: ["f-name"] }],
};

function renderCreate(slug = "account", segment = "accounts") {
  return render(
    <CrmCreateClient
      slug={slug}
      collectionSegment={segment}
      entityName={slug === "contact" ? "Contact" : "Account"}
      fields={[NAME]}
      layoutConfig={LAYOUT}
      locale="en-GB"
    />
  );
}

afterEach(() => {
  push.mockClear();
  vi.unstubAllGlobals();
  cleanup();
});

describe("CrmCreateClient", () => {
  test("renders the full-page create form with the panel layout", () => {
    renderCreate();
    expect(screen.getByRole("heading", { name: "New account" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Account Details" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/)).toBeInTheDocument();
  });

  test("blocks save until the mandatory field is filled, then POSTs + returns to the list", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ record: { id: "acc-1" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderCreate();

    // Submit with the required Name empty → blocked (no fetch).
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(fetchMock).not.toHaveBeenCalled();

    // Fill the mandatory field, then save.
    await user.type(screen.getByLabelText(/Name/), "Acme");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/crm/accounts");
    expect(JSON.parse(init.body as string)).toEqual({ data: { name: "Acme" } });
    // Returns to the Accounts home page (the list).
    expect(push).toHaveBeenCalledWith("/crm/accounts");
  });

  test("Cancel returns to the list", async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(push).toHaveBeenCalledWith("/crm/accounts");
  });
});
