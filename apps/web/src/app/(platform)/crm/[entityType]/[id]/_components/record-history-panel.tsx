"use client";

import { useEffect, useState } from "react";
import { CollapsiblePanel } from "@/components/ui/collapsible-panel";

/**
 * Per-record History panel. Fetches the read-only audit trail for a CRM record
 * and renders it as a table: Field Name / New Value / Old Value / Changed By /
 * Date & Time, newest first.
 *
 * The endpoint returns audit rows with a `changes` JSON whose shape varies by
 * action (see apps/web/src/lib/crm/audit.ts):
 *   - update  → { before, after }  → one row per changed key
 *   - create  → { after }          → a single "Created" summary row
 *   - archive → { before:{isArchived:false}, after:{isArchived:true} } → status row
 *   - link/unlink (resourceType "relationship") → a relationship summary row
 *
 * Token-driven (Panel + CSS vars), matching the DynamicTable header band +
 * zebra row styling used across the CRM tables.
 */

interface HistoryEntry {
  id: string;
  action: string;
  changes: unknown;
  userId: string | null;
  userName: string | null;
  createdAt: string;
}

/** A single rendered table row (one field change, or a summary). */
interface HistoryRow {
  key: string;
  fieldName: string;
  newValue: string;
  oldValue: string;
  changedBy: string;
  when: string;
}

interface RecordHistoryPanelProps {
  entitySegment: string;
  recordId: string;
  /** Panel heading. Defaults to "History". */
  title?: string;
}

const EMPTY = "—";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Format any field value for display in a cell. */
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return EMPTY;
  if (typeof v === "string") return v === "" ? EMPTY : v;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.length === 0 ? EMPTY : JSON.stringify(v);
  if (isRecord(v)) return JSON.stringify(v);
  return String(v);
}

/** Humanise a camelCase / snake_case field slug into a label. */
function humaniseKey(key: string): string {
  const spaced = key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (spaced === "") return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Derive the displayable rows for a single audit entry. */
function rowsForEntry(entry: HistoryEntry): HistoryRow[] {
  const changedBy = entry.userName ?? entry.userId ?? "System";
  const when = formatTimestamp(entry.createdAt);
  const changes = isRecord(entry.changes) ? entry.changes : {};
  const before = isRecord(changes.before) ? changes.before : null;
  const after = isRecord(changes.after) ? changes.after : null;

  const base = (suffix: string): Omit<HistoryRow, "fieldName" | "newValue" | "oldValue"> => ({
    key: `${entry.id}:${suffix}`,
    changedBy,
    when,
  });

  // update (and archive, which is a before/after on isArchived): emit one row
  // per key that actually changed between before and after.
  if (before && after) {
    const keys = Array.from(
      new Set([...Object.keys(before), ...Object.keys(after)])
    ).sort();
    const rows: HistoryRow[] = [];
    for (const k of keys) {
      const oldV = before[k];
      const newV = after[k];
      if (formatValue(oldV) === formatValue(newV)) continue; // unchanged
      rows.push({
        ...base(k),
        fieldName: humaniseKey(k),
        newValue: formatValue(newV),
        oldValue: formatValue(oldV),
      });
    }
    if (rows.length > 0) return rows;
    // Fell through with no detectable diff — show a generic action row.
    return [
      {
        ...base("action"),
        fieldName: humaniseKey(entry.action),
        newValue: EMPTY,
        oldValue: EMPTY,
      },
    ];
  }

  // create: { after } only — a single "Created" summary row.
  if (after && !before) {
    return [
      {
        ...base("created"),
        fieldName: "Record created",
        newValue: EMPTY,
        oldValue: EMPTY,
      },
    ];
  }

  // link / unlink (resourceType "relationship") carry a relationship name +
  // source/target ids in `changes`. Summarise without before/after.
  if (entry.action === "link" || entry.action === "unlink") {
    const relName =
      typeof changes.name === "string"
        ? changes.name
        : typeof changes.relationshipName === "string"
          ? changes.relationshipName
          : "relationship";
    const verb = entry.action === "link" ? "Linked" : "Unlinked";
    return [
      {
        ...base(entry.action),
        fieldName: `${verb} ${relName}`,
        newValue: entry.action === "link" ? "Linked" : EMPTY,
        oldValue: entry.action === "unlink" ? "Linked" : EMPTY,
      },
    ];
  }

  // Fallback: a single generic action row.
  return [
    {
      ...base("action"),
      fieldName: humaniseKey(entry.action),
      newValue: EMPTY,
      oldValue: EMPTY,
    },
  ];
}

export function RecordHistoryPanel({
  entitySegment,
  recordId,
  title = "History",
}: RecordHistoryPanelProps) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    setEntries(null);
    fetch(`/api/crm/${entitySegment}/${recordId}/history`)
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          entries?: HistoryEntry[];
          error?: string;
        };
        if (!active) return;
        if (!res.ok) {
          setError(body.error ?? `Failed to load history (${res.status})`);
          return;
        }
        setEntries(body.entries ?? []);
      })
      .catch(() => {
        if (active) setError("Network error while loading history.");
      });
    return () => {
      active = false;
    };
  }, [entitySegment, recordId]);

  const cellClass = "px-4 py-3 text-sm align-top";
  const headClass = "px-4 py-3 text-left text-xs font-medium";

  const rows =
    entries == null ? [] : entries.flatMap((e) => rowsForEntry(e));

  return (
    <CollapsiblePanel as="section" aria-label={title} title={title} collapsible defaultOpen>
      {error ? (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : entries == null ? (
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">
          No history yet.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--table-header-bg)] text-left text-xs font-medium text-[var(--muted-foreground)]">
              <tr>
                <th className={headClass}>Field Name</th>
                <th className={headClass}>New Value</th>
                <th className={headClass}>Old Value</th>
                <th className={headClass}>Changed By</th>
                <th className={headClass}>Date &amp; Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((r) => (
                <tr
                  key={r.key}
                  className="even:bg-[var(--row-alt)] hover:bg-[var(--row-hover)]"
                >
                  <td className={cellClass}>{r.fieldName}</td>
                  <td className={cellClass}>{r.newValue}</td>
                  <td className={cellClass}>{r.oldValue}</td>
                  <td className={cellClass}>{r.changedBy}</td>
                  <td className={cellClass}>{r.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CollapsiblePanel>
  );
}
