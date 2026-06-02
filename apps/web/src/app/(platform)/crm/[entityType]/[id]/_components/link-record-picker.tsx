"use client";

import { useEffect, useState } from "react";
import { crmCollectionSegment } from "@adserve/crm/url";
import type { SerializedRecord } from "@/lib/crm/serialize";
import { relatedLabel } from "./related-records-panel";

/**
 * WS3 — picks an existing record of `relatedSlug` to link. Loads candidates
 * from the existing list API and excludes already-linked ids. On selection it
 * invokes `onPick(id)`; the parent issues the WS2 link call.
 */
export function LinkRecordPicker({
  relatedSlug,
  excludeIds,
  onPick,
}: {
  relatedSlug: string;
  excludeIds: string[];
  onPick: (id: string) => void | Promise<void>;
}) {
  const [options, setOptions] = useState<
    { id: string; label: string }[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const segment = crmCollectionSegment(relatedSlug) ?? relatedSlug;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/crm/${segment}?limit=200`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) setError(`Failed to load ${segment} (${res.status})`);
          return;
        }
        const body = (await res.json()) as { records?: SerializedRecord[] };
        if (cancelled) return;
        const opts = (body.records ?? [])
          .map((r) => ({ id: r.id, label: relatedLabel(r) }))
          .sort((a, b) => a.label.localeCompare(b.label));
        setOptions(opts);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Network error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [segment]);

  const exclude = new Set(excludeIds);
  const available = (options ?? []).filter((o) => !exclude.has(o.id));

  if (error) {
    return (
      <p className="text-sm text-red-600" role="alert">
        {error}
      </p>
    );
  }
  if (options === null) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
    );
  }
  if (available.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        No more {segment} available to link.
      </p>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <label className="flex-1 text-sm">
        <span className="sr-only">Choose a {relatedSlug} to link</span>
        <select
          aria-label={`Choose a ${relatedSlug} to link`}
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
        >
          <option value="">Select a {relatedSlug}…</option>
          {available.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={!value || busy}
        onClick={async () => {
          if (!value) return;
          setBusy(true);
          try {
            await onPick(value);
            setValue("");
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
      >
        Link
      </button>
    </div>
  );
}
