"use client";

import { useEffect, useRef, useState } from "react";
import type { SerializedRecord } from "@/lib/crm/serialize";
import { Panel } from "@/components/ui/panel";

/**
 * The contact's chosen account: either an EXISTING account (by id) or a NEW one
 * to create (by typed name). Single-select — the prototype enforces one account
 * per contact in the UX (the data model stays many_to_many; see
 * docs/prototypes/crm/SPEC.md).
 */
export type AccountSelection =
  | { kind: "existing"; id: string; label: string }
  | { kind: "new"; name: string };

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
 * Single-select, server-side-searchable account picker for the contact-create
 * form. Debounced typeahead hits the existing accounts list endpoint
 * (`GET /api/crm/accounts`) using its `contains` (ILIKE) filter on the `name`
 * text field — so it scales to thousands of accounts without loading them all.
 * When the query matches no existing account, a "Create '<name>'" row lets the
 * user create the account inline (the combined endpoint validates uniqueness
 * and creates+links atomically).
 *
 * adserve-design: wrapped in a <Panel>, tokens only (light + dark), no
 * hardcoded colours.
 */
export function AccountPicker({
  value,
  onChange,
  disabled,
}: {
  value: AccountSelection | null;
  onChange: (selection: AccountSelection | null) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AccountOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trimmed = query.trim();

  useEffect(() => {
    // No live search while an account is already chosen.
    if (value) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (trimmed === "") {
      setResults(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const sp = new URLSearchParams();
        sp.set("limit", "20");
        sp.set(
          "filters",
          JSON.stringify([
            { fieldSlug: "name", operator: "contains", value: trimmed },
          ])
        );
        sp.set(
          "sort",
          JSON.stringify({ fieldSlug: "name", direction: "asc" })
        );
        const res = await fetch(`/api/crm/accounts?${sp.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          setError(`Search failed (${res.status})`);
          setResults([]);
          return;
        }
        const body = (await res.json()) as { records?: SerializedRecord[] };
        setResults(
          (body.records ?? []).map((r) => ({ id: r.id, label: accountLabel(r) }))
        );
        setError(null);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Network error");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [trimmed, value]);

  function choose(selection: AccountSelection | null) {
    onChange(selection);
    setQuery("");
    setResults(null);
  }

  const exactMatch =
    results?.some(
      (o) => o.label.trim().toLowerCase() === trimmed.toLowerCase()
    ) ?? false;
  const showCreate = !value && trimmed !== "" && !loading && !exactMatch;

  return (
    <Panel compact title="Account" aria-label="Link to account">
      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
        Search for an account, or type a new name to create one. One account per
        contact.
      </p>

      {value ? (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2">
          <span className="truncate text-sm">
            {value.kind === "existing" ? (
              value.label
            ) : (
              <>
                <span className="font-medium">{value.name}</span>
                <span className="ml-2 rounded-sm bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--accent-foreground)]">
                  New
                </span>
              </>
            )}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => choose(null)}
            aria-label="Clear selected account"
            className="rounded-md px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--background)]"
          >
            Change
          </button>
        </div>
      ) : (
        <div className="relative mt-3">
          <input
            type="text"
            value={query}
            disabled={disabled}
            placeholder="Search accounts…"
            aria-label="Search accounts"
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />

          {trimmed !== "" ? (
            <ul
              className="mt-1 max-h-56 overflow-auto rounded-md border border-[var(--border)] bg-[var(--panel-bg)]"
              role="listbox"
              aria-label="Account search results"
            >
              {loading ? (
                <li className="px-3 py-2 text-sm text-[var(--muted-foreground)]">
                  Searching…
                </li>
              ) : error ? (
                <li className="px-3 py-2 text-sm text-red-600" role="alert">
                  {error}
                </li>
              ) : (
                <>
                  {(results ?? []).map((opt) => (
                    <li key={opt.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() =>
                          choose({
                            kind: "existing",
                            id: opt.id,
                            label: opt.label,
                          })
                        }
                        className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-[var(--muted)]"
                      >
                        {opt.label}
                      </button>
                    </li>
                  ))}
                  {results !== null && results.length === 0 && !showCreate ? (
                    <li className="px-3 py-2 text-sm text-[var(--muted-foreground)]">
                      No accounts found.
                    </li>
                  ) : null}
                  {showCreate ? (
                    <li>
                      <button
                        type="button"
                        onClick={() => choose({ kind: "new", name: trimmed })}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--muted)]"
                      >
                        Create{" "}
                        <span className="font-medium">“{trimmed}”</span>
                      </button>
                    </li>
                  ) : null}
                </>
              )}
            </ul>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
