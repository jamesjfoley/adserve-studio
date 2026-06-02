"use client";

import { useEffect, useState } from "react";
import type { SerializedRecord } from "@/lib/crm/serialize";

interface AccountOption {
  id: string;
  label: string;
}

function accountLabel(rec: SerializedRecord): string {
  const name = rec.data.name;
  if (typeof name === "string" && name.trim() !== "") return name;
  return rec.id;
}

/**
 * WS3 — account multi-select for the contact create form. Lazily loads the
 * tenant's accounts from the existing accounts list API (`GET /api/crm/accounts`)
 * the first time it mounts. Selected ids are lifted to the parent, which submits
 * them to the combined contact-create-with-accounts endpoint.
 *
 * Zero selected accounts is allowed (creates an unlinked contact). Structured as
 * a self-contained section so WS4 can swap the wrapper for a <Panel>.
 */
export function AccountMultiSelect({
  selectedIds,
  onChange,
  disabled,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [options, setOptions] = useState<AccountOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // v1 limitation: loads up to 200 candidate accounts without pagination.
        // Tenants with >200 accounts won't see the overflow in this picker —
        // accepted for v1; revisit with a typeahead/search-backed picker later.
        const res = await fetch("/api/crm/accounts?limit=200", {
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) setLoadError(`Failed to load accounts (${res.status})`);
          return;
        }
        const body = (await res.json()) as { records?: SerializedRecord[] };
        if (cancelled) return;
        const opts = (body.records ?? []).map((r) => ({
          id: r.id,
          label: accountLabel(r),
        }));
        opts.sort((a, b) => a.label.localeCompare(b.label));
        setOptions(opts);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Network error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  return (
    <section
      aria-label="Link to accounts"
      className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4"
    >
      <h3 className="text-sm font-semibold tracking-tight">Accounts</h3>
      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
        Optionally link this contact to one or more accounts.
      </p>

      {loadError ? (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {loadError}
        </p>
      ) : options === null ? (
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          Loading accounts…
        </p>
      ) : options.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          No accounts to link yet.
        </p>
      ) : (
        <ul
          className="mt-2 max-h-48 space-y-1 overflow-auto"
          role="group"
          aria-label="Accounts"
        >
          {options.map((opt) => {
            const checked = selectedIds.includes(opt.id);
            return (
              <li key={opt.id}>
                <label className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-[var(--muted)]">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(opt.id)}
                    className="h-4 w-4 rounded border-[var(--border)]"
                  />
                  <span>{opt.label}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {selectedIds.length > 0 ? (
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
          {selectedIds.length} account{selectedIds.length === 1 ? "" : "s"} selected
        </p>
      ) : null}
    </section>
  );
}
