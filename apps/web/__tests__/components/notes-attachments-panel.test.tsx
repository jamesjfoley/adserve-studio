// @vitest-environment jsdom
import "../setup/jest-dom";

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { NoteItem } from "@/lib/crm/notes";
import { NotesAttachmentsPanel } from "@/app/(platform)/crm/[entityType]/[id]/_components/notes-attachments-panel";

const ITEMS: NoteItem[] = [
  {
    id: "n1",
    type: "note",
    name: "Kickoff summary",
    body: "Discussed Q3 budget.",
    addedById: "u1",
    addedByName: "Jo Bloggs",
    createdAt: "2026-06-01T09:00:00.000Z",
  },
  {
    id: "l1",
    type: "link",
    name: "Brief",
    url: "https://example.com/brief",
    addedById: "u1",
    addedByName: "Jo Bloggs",
    createdAt: "2026-06-02T09:00:00.000Z",
  },
];

function stubFetch(items: NoteItem[]) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ items }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("NotesAttachmentsPanel", () => {
  test("loads items on mount and lists them with the count in the title", async () => {
    const fetchMock = stubFetch(ITEMS);
    render(
      <NotesAttachmentsPanel
        entitySegment="accounts"
        recordId="r1"
        canEdit={false}
      />
    );

    // GETs the notes endpoint on mount.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/crm/accounts/r1/notes")
    );

    // Lists both items.
    expect(await screen.findByText("Kickoff summary")).toBeInTheDocument();
    expect(screen.getByText("Brief")).toBeInTheDocument();

    // The link's URL renders as an external anchor.
    const link = screen.getByRole("link", { name: "https://example.com/brief" });
    expect(link).toHaveAttribute("href", "https://example.com/brief");
    expect(link).toHaveAttribute("target", "_blank");

    // Title carries the count.
    expect(
      screen.getByRole("heading", { name: /Notes & Attachments \(2\)/ })
    ).toBeInTheDocument();
  });

  test("shows the Add buttons when canEdit is true", async () => {
    stubFetch(ITEMS);
    render(
      <NotesAttachmentsPanel
        entitySegment="accounts"
        recordId="r1"
        canEdit={true}
      />
    );

    await screen.findByText("Kickoff summary");
    expect(
      screen.getByRole("button", { name: "+ Add Note" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ Add Attachment" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ Add Link" })
    ).toBeInTheDocument();
  });

  test("hides Add buttons and the Actions column when canEdit is false", async () => {
    stubFetch(ITEMS);
    render(
      <NotesAttachmentsPanel
        entitySegment="accounts"
        recordId="r1"
        canEdit={false}
      />
    );

    await screen.findByText("Kickoff summary");
    expect(
      screen.queryByRole("button", { name: "+ Add Note" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Actions" })
    ).not.toBeInTheDocument();
  });

  test("renders the empty state when there are no items", async () => {
    stubFetch([]);
    render(
      <NotesAttachmentsPanel
        entitySegment="contacts"
        recordId="c1"
        canEdit={true}
      />
    );

    expect(
      await screen.findByText("No notes or attachments yet.")
    ).toBeInTheDocument();
  });
});
