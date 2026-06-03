"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * WS5 — single persisted boolean for the CRM primary nav.
 *
 * Pinned = full sidebar (occupies layout). Unpinned = icon rail (the rail IS the
 * collapsed state; there is no third state). The value is browser-local, NOT
 * tenant-scoped, so it must not follow Clerk org switches.
 *
 * No-flash contract: the inline <head> script in app/layout.tsx sets
 * `document.documentElement.dataset.navPinned` BEFORE paint. CSS keys the
 * sidebar width off `[data-nav-pinned]`, so first paint already matches the
 * stored state. This hook initialises FROM that dataset attribute (NOT a fresh
 * localStorage read) so SSR and the first client render agree, then keeps the
 * attribute in sync on every toggle so the CSS width follows state.
 */
export const NAV_PINNED_STORAGE_KEY = "adserve:nav:pinned";

/** Read the pre-paint dataset attribute. Default (unset / SSR) = pinned. */
function readPinnedFromDataset(): boolean {
  if (typeof document === "undefined") return true;
  return document.documentElement.dataset.navPinned !== "false";
}

/** Persist; storage may be blocked (private mode, etc.) — never throw. */
function persistPinned(value: boolean): void {
  try {
    window.localStorage.setItem(NAV_PINNED_STORAGE_KEY, String(value));
  } catch {
    // Blocked storage degrades to in-memory only — state still works this session.
  }
}

export function useNavPinned() {
  const [pinned, setPinned] = useState<boolean>(readPinnedFromDataset);

  // Keep the document attribute in sync so the CSS-driven width follows state
  // (this is the single source of truth the head script seeds pre-paint).
  useEffect(() => {
    document.documentElement.dataset.navPinned = String(pinned);
  }, [pinned]);

  const toggle = useCallback(() => {
    setPinned((prev) => {
      const next = !prev;
      persistPinned(next);
      return next;
    });
  }, []);

  return { pinned, toggle };
}
