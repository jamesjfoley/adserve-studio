"use client";

import { useEffect, useRef, useState } from "react";
import type { SerializedRecord } from "@/lib/crm/serialize";
import { cn } from "@/lib/utils";
import { inputClassName } from "@/components/dynamic-form/fields/FieldShell";

/**
 * A chosen record: either an EXISTING record (by id) or a NEW one to create
 * (by typed name, when the picker allows create). Single-select.
 */
export type RecordSelection =
  | { kind: "existing"; id: string; label: string }
  | { kind: "new"; name: string };

interface Option {
  id: string;
  label: string;
}

/** Per-entity search config (segment + field to `contains`-search + label). */
export function recordSearchConfig(slug: string): {
  entitySegment: string;
  searchFieldSlug: string;
  placeholder: string;
  labelOf: (rec: SerializedRecord) => string;
} {
  const name = (rec: SerializedRecord) =>
    typeof rec.data.name === "string" && rec.data.name.trim() !== ""
      ? rec.data.name
      : rec.id;
  const person = (rec: SerializedRecord) => {
    const fn = typeof rec.data.firstName === "string" ? rec.data.firstName : "";
    const ln = typeof rec.data.lastName === "string" ? rec.data.lastName : "";
    return `${fn} ${ln}`.trim() || name(rec);
  };
  if (slug === "contact" || slug === "lead") {
    return {
      entitySegment: slug === "contact" ? "contacts" : "leads",
      searchFieldSlug: "lastName",
      placeholder: `Search ${slug}s by last name…`,
      labelOf: person,
    };
  }
  const segment = slug === "account" ? "accounts" : "opportunities";
  return {
    entitySegment: segment,
    searchFieldSlug: "name",
    placeholder: `Search ${slug}s…`,
    labelOf: name,
  };
}

/**
 * Bare, single-select, server-side-searchable record control — the generic
 * engine behind the account picker, the reports-to picker, etc. Renders like
 * any other field (no Panel/heading; the surrounding `FieldShell` supplies the
 * label/error chrome). Debounced typeahead hits the target entity's list
 * endpoint with a `contains` filter on `searchFieldSlug`. When `allowCreate`
 * and the query matches nothing, a "Create '<name>'" row is offered.
 */
export function RecordPicker({
  value,
  onChange,
  disabled,
  inputId,
  invalid,
  entitySegment,
  searchFieldSlug,
  placeholder,
  allowCreate,
  labelOf,
  excludeIds,
}: {
  value: RecordSelection | null;
  onChange: (selection: RecordSelection | null) => void;
  disabled?: boolean;
  inputId?: string;
  invalid?: boolean;
  /** Collection segment of the entity to search (e.g. "accounts", "contacts"). */
  entitySegment: string;
  /** Text field to `contains`-filter on (e.g. "name", "lastName"). */
  searchFieldSlug: string;
  placeholder: string;
  allowCreate: boolean;
  /** Resolve a record's display label. */
  labelOf: (rec: SerializedRecord) => string;
  /** Ids to drop from results (e.g. already-linked records). */
  excludeIds?: string[];
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Option[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trimmed = query.trim();

  useEffect(() => {
    if (value) return; // a record is chosen — no live search
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
            { fieldSlug: searchFieldSlug, operator: "contains", value: trimmed },
          ])
        );
        sp.set(
          "sort",
          JSON.stringify({ fieldSlug: searchFieldSlug, direction: "asc" })
        );
        const res = await fetch(`/api/crm/${entitySegment}?${sp.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          setError(`Search failed (${res.status})`);
          setResults([]);
          return;
        }
        const body = (await res.json()) as { records?: SerializedRecord[] };
        const exclude = new Set(excludeIds ?? []);
        setResults(
          (body.records ?? [])
            .filter((r) => !exclude.has(r.id))
            .map((r) => ({ id: r.id, label: labelOf(r) }))
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
  }, [trimmed, value, entitySegment, searchFieldSlug, labelOf, excludeIds]);

  function choose(selection: RecordSelection | null) {
    onChange(selection);
    setQuery("");
    setResults(null);
  }

  const exactMatch =
    results?.some(
      (o) => o.label.trim().toLowerCase() === trimmed.toLowerCase()
    ) ?? false;
  const showCreate = allowCreate && !value && trimmed !== "" && !loading && !exactMatch;

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2">
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
          aria-label="Clear selection"
          className="rounded-md px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--background)]"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        id={inputId}
        type="text"
        value={query}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-invalid={invalid || undefined}
        onChange={(e) => setQuery(e.target.value)}
        className={inputClassName}
      />

      {trimmed !== "" ? (
        <ul
          className={cn(
            "mt-1 max-h-56 overflow-auto rounded-md border border-[var(--border)]",
            "bg-[var(--panel-bg)]"
          )}
          role="listbox"
          aria-label="Search results"
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
                      choose({ kind: "existing", id: opt.id, label: opt.label })
                    }
                    className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-[var(--muted)]"
                  >
                    {opt.label}
                  </button>
                </li>
              ))}
              {results !== null && results.length === 0 && !showCreate ? (
                <li className="px-3 py-2 text-sm text-[var(--muted-foreground)]">
                  No matches found.
                </li>
              ) : null}
              {showCreate ? (
                <li>
                  <button
                    type="button"
                    onClick={() => choose({ kind: "new", name: trimmed })}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--muted)]"
                  >
                    Create <span className="font-medium">“{trimmed}”</span>
                  </button>
                </li>
              ) : null}
            </>
          )}
        </ul>
      ) : null}
    </div>
  );
}
