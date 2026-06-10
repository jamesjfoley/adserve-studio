"use client";

import { useEffect, useRef, useState } from "react";

/**
 * `useState` whose value is mirrored to `localStorage` under `key`, so a user's
 * choice survives reloads and re-logins (per browser/profile). Pass `key = null`
 * to disable persistence entirely (behaves like plain `useState`).
 *
 * SSR-safe: the stored value is read in an effect AFTER mount (never during
 * render), so the server and first client render agree on `fallback` and there
 * is no hydration mismatch — the stored value is applied a frame later.
 *
 * NOTE (prototype): this is per-device. A production per-user preference that
 * follows the account across devices would live in a server-side user-settings
 * store; that is deferred (a new table/RLS policy is a standing human gate).
 */
export function usePersistentState<T>(
  key: string | null,
  fallback: T,
  isValid?: (v: unknown) => v is T
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(fallback);
  // Tracks the key we've successfully read, so the initial fallback render
  // doesn't overwrite a stored value before it has been loaded.
  const loadedKey = useRef<string | null>(null);

  useEffect(() => {
    if (key == null || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) {
        const parsed = JSON.parse(raw) as unknown;
        setValue(!isValid || isValid(parsed) ? (parsed as T) : fallback);
      } else {
        setValue(fallback);
      }
    } catch {
      /* storage unavailable / blocked — fall back to in-memory state */
    }
    loadedKey.current = key;
    // `fallback`/`isValid` are intentionally excluded: a load is keyed solely
    // on `key` (a stable per-user string), not on identity of the validators.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (key == null || typeof window === "undefined") return;
    // Don't write until THIS key has been read (guards the first render and a
    // key change from clobbering a stored value).
    if (loadedKey.current !== key) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable / blocked */
    }
  }, [key, value]);

  return [value, setValue];
}
