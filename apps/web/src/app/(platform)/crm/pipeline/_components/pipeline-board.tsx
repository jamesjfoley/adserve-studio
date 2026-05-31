"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/crm/format";
import type { PipelineColumn, PipelineFilters } from "@/lib/crm/pipeline";

interface Member {
  id: string;
  fullName: string;
}
interface Account {
  id: string;
  name: string;
}

interface Props {
  columns: PipelineColumn[];
  currency: string;
  members: Member[];
  accounts: Account[];
  filters: PipelineFilters;
  canMove: boolean;
  locale: string;
}

const OTHER_SLUG = "__other__";

export function PipelineBoard({
  columns: initialColumns,
  currency,
  members,
  accounts,
  filters,
  canMove,
  locale,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [columns, setColumns] = useState(initialColumns);
  const [error, setError] = useState<string | null>(null);
  const [dragCardId, setDragCardId] = useState<string | null>(null);

  // Re-sync with server truth after router.refresh() (or filter changes).
  useEffect(() => {
    setColumns(initialColumns);
  }, [initialColumns]);

  function recompute(cols: PipelineColumn[]): PipelineColumn[] {
    return cols.map((c) => ({
      ...c,
      count: c.cards.length,
      total: c.cards.reduce((sum, card) => sum + (card.amount ?? 0), 0),
    }));
  }

  async function move(cardId: string, toSlug: string) {
    setError(null);
    if (toSlug === OTHER_SLUG) return; // not a real stage — not a drop target

    const fromCol = columns.find((c) => c.cards.some((x) => x.id === cardId));
    if (!fromCol || fromCol.slug === toSlug) return;
    const card = fromCol.cards.find((x) => x.id === cardId)!;

    // Optimistic move.
    const prev = columns;
    const next = recompute(
      columns.map((c) => {
        if (c.slug === fromCol.slug) {
          return { ...c, cards: c.cards.filter((x) => x.id !== cardId) };
        }
        if (c.slug === toSlug) {
          return { ...c, cards: [{ ...card, stage: toSlug }, ...c.cards] };
        }
        return c;
      })
    );
    setColumns(next);

    try {
      const res = await fetch(`/api/crm/pipeline/${cardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: toSlug }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setColumns(prev); // revert
        setError(body.error ?? `Move failed (${res.status})`);
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setColumns(prev);
      setError("Network error while moving the card.");
    }
  }

  function applyFilter(patch: Partial<PipelineFilters>) {
    const merged = { ...filters, ...patch };
    const params = new URLSearchParams();
    if (merged.owner) params.set("owner", merged.owner);
    if (merged.accountId) params.set("accountId", merged.accountId);
    if (merged.closeDateFrom) params.set("closeDateFrom", merged.closeDateFrom);
    if (merged.closeDateTo) params.set("closeDateTo", merged.closeDateTo);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/crm/pipeline?${qs}` : "/crm/pipeline"));
  }

  const inputClass =
    "rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm";

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
      </div>

      {/* Filter bar */}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
          Owner
          <select
            className={inputClass}
            value={filters.owner ?? ""}
            onChange={(e) => applyFilter({ owner: e.target.value || undefined })}
          >
            <option value="">All owners</option>
            <option value="unassigned">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
          Account
          <select
            className={inputClass}
            value={filters.accountId ?? ""}
            onChange={(e) =>
              applyFilter({ accountId: e.target.value || undefined })
            }
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
          Close from
          <input
            type="date"
            className={inputClass}
            value={filters.closeDateFrom ?? ""}
            onChange={(e) =>
              applyFilter({ closeDateFrom: e.target.value || undefined })
            }
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
          Close to
          <input
            type="date"
            className={inputClass}
            value={filters.closeDateTo ?? ""}
            onChange={(e) =>
              applyFilter({ closeDateTo: e.target.value || undefined })
            }
          />
        </label>
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <p className="mt-3 text-xs text-[var(--muted-foreground)]">
        {canMove
          ? "Drag a card to another column to change its stage. On a touch device, open a card to change its stage on the detail page."
          : "You have read-only access to the pipeline."}
      </p>

      {/* Board */}
      <div className="mt-4 flex gap-4 overflow-x-auto pb-4">
        {columns.map((col) => {
          const droppable = canMove && col.slug !== OTHER_SLUG;
          return (
            <div
              key={col.slug}
              className="flex w-72 flex-shrink-0 flex-col rounded-xl border border-[var(--border)] bg-[var(--muted)]/30"
              onDragOver={droppable ? (e) => e.preventDefault() : undefined}
              onDrop={
                droppable
                  ? (e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData("text/plain");
                      if (id) void move(id, col.slug);
                    }
                  : undefined
              }
            >
              <div className="sticky top-0 rounded-t-xl border-b border-[var(--border)] bg-[var(--muted)] px-3 py-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold">{col.name}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {col.count}
                  </span>
                </div>
                <div className="text-xs text-[var(--muted-foreground)]">
                  {formatCurrency(col.total, locale, currency)}
                </div>
              </div>

              <div className="flex flex-col gap-2 p-2">
                {col.cards.length === 0 && (
                  <p className="px-1 py-4 text-center text-xs text-[var(--muted-foreground)]">
                    No opportunities
                  </p>
                )}
                {col.cards.map((card) => (
                  <div
                    key={card.id}
                    draggable={canMove}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", card.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragCardId(card.id);
                    }}
                    onDragEnd={() => setDragCardId(null)}
                    onClick={() =>
                      startTransition(() =>
                        router.push(`/crm/opportunities/${card.id}`)
                      )
                    }
                    className={`cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-sm shadow-sm transition ${
                      dragCardId === card.id ? "opacity-50" : ""
                    } ${canMove ? "hover:shadow" : ""}`}
                  >
                    <div className="font-medium">{card.name}</div>
                    <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                      {card.accountName ?? "No account"}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-medium">
                        {card.amount != null
                          ? formatCurrency(card.amount, locale, card.currency)
                          : "—"}
                      </span>
                      {card.probability != null && (
                        <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
                          {card.probability}%
                        </span>
                      )}
                    </div>
                    {card.closeDate && (
                      <div className="mt-1 text-xs text-[var(--muted-foreground)]">
                        {new Date(card.closeDate).toLocaleDateString("en-GB")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
