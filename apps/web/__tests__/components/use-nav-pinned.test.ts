// @vitest-environment jsdom
import "../setup/jest-dom";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  NAV_PINNED_STORAGE_KEY,
  useNavPinned,
} from "@/components/nav/use-nav-pinned";

beforeEach(() => {
  delete document.documentElement.dataset.navPinned;
  window.localStorage.clear();
});

afterEach(() => cleanup());

describe("useNavPinned", () => {
  test("defaults to pinned when the dataset attribute is unset", () => {
    const { result } = renderHook(() => useNavPinned());
    expect(result.current.pinned).toBe(true);
  });

  test("initialises from the document dataset attribute, not a fresh localStorage read", () => {
    // Storage and the pre-paint dataset deliberately disagree: the dataset (set
    // by the head script before paint) is the source of truth so SSR and the
    // first client render agree.
    window.localStorage.setItem(NAV_PINNED_STORAGE_KEY, "true");
    document.documentElement.dataset.navPinned = "false";
    const { result } = renderHook(() => useNavPinned());
    expect(result.current.pinned).toBe(false);
  });

  test("toggle flips state, persists to localStorage, and syncs the dataset", () => {
    const { result } = renderHook(() => useNavPinned());
    expect(result.current.pinned).toBe(true);

    act(() => result.current.toggle());

    expect(result.current.pinned).toBe(false);
    expect(window.localStorage.getItem(NAV_PINNED_STORAGE_KEY)).toBe("false");
    expect(document.documentElement.dataset.navPinned).toBe("false");
  });

  test("does not throw when storage is blocked (degrades to in-memory)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage blocked");
      });

    const { result } = renderHook(() => useNavPinned());
    expect(() => act(() => result.current.toggle())).not.toThrow();
    // State still flips in-memory even though persistence failed.
    expect(result.current.pinned).toBe(false);

    spy.mockRestore();
  });
});
