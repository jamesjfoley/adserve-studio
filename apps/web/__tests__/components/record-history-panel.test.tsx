// @vitest-environment jsdom
import "../setup/jest-dom";

import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { RecordHistoryPanel } from "@/app/(platform)/crm/[entityType]/[id]/_components/record-history-panel";

function stubFetch(entryCount: number) {
  const entries = Array.from({ length: entryCount }, (_, i) => ({
    id: `e${i}`,
    action: "update",
    changes: { before: { stage: `Old ${i}` }, after: { stage: `New ${i}` } },
    userId: "u1",
    userName: "Jo Bloggs",
    createdAt: `2026-06-${((i % 27) + 1).toString().padStart(2, "0")}T09:00:00.000Z`,
  }));
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ entries }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("RecordHistoryPanel — 15-row cap + scroll", () => {
  test("caps the scroll area to 15 rows of height; all rows remain (scrollable)", async () => {
    stubFetch(20);
    const { container } = render(
      <RecordHistoryPanel entitySegment="accounts" recordId="r1" />
    );

    // All 20 change rows render (none are dropped — they scroll within the cap).
    await waitFor(() =>
      expect(screen.getAllByText(/^New \d+$/)).toHaveLength(20)
    );

    // The scroll container is height-capped (15 rows × est. 26px, since jsdom
    // reports 0 client heights) and scrolls vertically.
    const scroll = container.querySelector(
      "div.overflow-auto"
    ) as HTMLElement | null;
    expect(scroll).not.toBeNull();
    await waitFor(() => expect(scroll!.style.maxHeight).toBe("390px"));
  });
});
