// @vitest-environment jsdom
import "../setup/jest-dom";

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  FieldDefinitionWithLabels,
  FieldType,
  LayoutConfig,
} from "@adserve/module-framework";
import type { SerializedRecord } from "@/lib/crm/serialize";
import { CrmDetailClient } from "@/app/(platform)/crm/[entityType]/[id]/_components/crm-detail-client";

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

const NAME = fieldDef({
  id: "f-name",
  slug: "name",
  name: "Name",
  fieldType: "text",
  isRequired: true,
});
const LAYOUT: LayoutConfig = {
  sections: [{ title: "Details", columns: 1, fieldIds: ["f-name"] }],
};

function record(overrides: Partial<SerializedRecord> = {}): SerializedRecord {
  return {
    id: "r1",
    data: { name: "Acme" },
    isArchived: false,
    ownedBy: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderDetail(overrides: Record<string, unknown> = {}) {
  return render(
    <CrmDetailClient
      collectionSegment="accounts"
      entityName="Account"
      recordId="r1"
      title="Acme"
      record={record()}
      fields={[NAME]}
      layoutConfig={LAYOUT}
      relationships={{}}
      activities={[]}
      canEdit={true}
      canArchive={true}
      canConvert={false}
      canLogActivity={true}
      canViewActivities={true}
      locale="en-GB"
      {...overrides}
    />
  );
}

afterEach(() => {
  push.mockClear();
  refresh.mockClear();
  vi.unstubAllGlobals();
  cleanup();
});

describe("CrmDetailClient", () => {
  test("renders the entity name and record title", () => {
    renderDetail();
    expect(screen.getByRole("heading", { name: /Acme/ })).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
  });

  test("hides the Edit button when canEdit is false", () => {
    renderDetail({ canEdit: false });
    expect(
      screen.queryByRole("button", { name: "Edit" })
    ).not.toBeInTheDocument();
  });

  test("Edit → change → save PATCHes to the record URL then refreshes", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ record: { id: "r1" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const input = screen.getByLabelText("Name");
    await user.clear(input);
    await user.type(input, "Acme Corp");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/crm/accounts/r1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      data: { name: "Acme Corp" },
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("Log activity → submit POSTs to /api/crm/activities then refreshes", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ activity: { id: "a1" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByRole("button", { name: /log activity/i }));
    await user.type(screen.getByLabelText("Subject"), "Intro call");
    await user.type(screen.getByLabelText("Notes"), "Discussed pricing");
    await user.click(screen.getByRole("button", { name: /save activity/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/crm/activities");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      recordId: "r1",
      activityType: "note",
      subject: "Intro call",
      body: { text: "Discussed pricing" },
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("Convert is absent on a non-lead entity", () => {
    renderDetail();
    expect(
      screen.queryByRole("button", { name: /convert lead/i })
    ).not.toBeInTheDocument();
  });

  test("Convert is hidden for an already-converted lead", () => {
    renderDetail({
      collectionSegment: "leads",
      entityName: "Lead",
      canConvert: true,
      record: record({ data: { name: "Jo", status: "converted" } }),
    });
    expect(
      screen.queryByRole("button", { name: /convert lead/i })
    ).not.toBeInTheDocument();
  });

  test("Convert → POST then routes to the new account detail page", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ account: { id: "acc-9" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderDetail({
      collectionSegment: "leads",
      entityName: "Lead",
      canConvert: true,
      record: record({ data: { name: "Jo", status: "new" } }),
    });

    await user.click(screen.getByRole("button", { name: /convert lead/i }));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/crm/leads/r1/convert");
    expect(init.method).toBe("POST");
    expect(push).toHaveBeenCalledWith("/crm/accounts/acc-9");
  });

  test("related-records sidebar links to related detail pages", () => {
    renderDetail({
      relationships: {
        contact: [
          {
            id: "c1",
            data: { firstName: "Jo", lastName: "Bloggs" },
            isArchived: false,
            ownedBy: null,
            createdAt: "2026-05-01T00:00:00.000Z",
            updatedAt: "2026-05-01T00:00:00.000Z",
          },
        ],
      },
    });
    const link = screen.getByRole("link", { name: "Jo Bloggs" });
    expect(link).toHaveAttribute("href", "/crm/contacts/c1");
  });

  test("timeline renders activities when canViewActivities is true", () => {
    renderDetail({
      activities: [
        {
          id: "a1",
          activityType: "call",
          subject: "Kickoff",
          body: { text: "Spoke for 20m" },
          performedBy: "u1",
          createdAt: "2026-05-02T09:00:00.000Z",
        },
      ],
    });
    const timeline = screen.getByRole("region", { name: /activity timeline/i });
    expect(within(timeline).getByText("Kickoff")).toBeInTheDocument();
    expect(within(timeline).getByText("Spoke for 20m")).toBeInTheDocument();
  });

  test("timeline is omitted when canViewActivities is false", () => {
    renderDetail({ canViewActivities: false });
    expect(
      screen.queryByRole("region", { name: /activity timeline/i })
    ).not.toBeInTheDocument();
  });
});
