"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface StageRow {
  slug: string;
  name: string;
  defaultProbability: number;
  isClosed: boolean;
  isWon: boolean;
  existing: boolean;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^([0-9])/, "s_$1");
}

export function PipelineStagesEditor({
  initialStages,
}: {
  initialStages: StageRow[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [stages, setStages] = useState<StageRow[]>(initialStages);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update(i: number, patch: Partial<StageRow>) {
    setStages(stages.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function move(i: number, dir: -1 | 1) {
    const t = i + dir;
    if (t < 0 || t >= stages.length) return;
    const next = stages.slice();
    [next[i], next[t]] = [next[t], next[i]];
    setStages(next);
  }
  function remove(i: number) {
    setStages(stages.filter((_, idx) => idx !== i));
  }
  function add() {
    setStages([
      ...stages,
      {
        slug: "",
        name: "",
        defaultProbability: 0,
        isClosed: false,
        isWon: false,
        existing: false,
      },
    ]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    // New stages get a slug derived from the name; existing slugs are fixed.
    const payload = stages.map((s) => ({
      slug: s.existing ? s.slug : s.slug || slugify(s.name),
      name: s.name,
      defaultProbability: Number(s.defaultProbability),
      isClosed: s.isClosed,
      isWon: s.isWon,
    }));
    try {
      const res = await fetch("/api/admin/crm/pipeline", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stages: payload }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as {
          error?: string;
          inUse?: { stage: string; n: number }[];
        };
        const detail = b.inUse?.length
          ? ` (${b.inUse.map((u) => `${u.stage}: ${u.n}`).join(", ")})`
          : "";
        setError((b.error ?? `Save failed (${res.status})`) + detail);
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  }

  const input =
    "rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm";

  return (
    <div className="mt-6">
      {error && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="space-y-2">
        {stages.map((s, i) => (
          <div
            key={s.existing ? s.slug : `new-${i}`}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] p-3"
          >
            <div className="flex gap-1">
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="rounded border border-[var(--border)] px-1.5 disabled:opacity-30"
                aria-label="Move up"
              >
                ↑
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === stages.length - 1}
                className="rounded border border-[var(--border)] px-1.5 disabled:opacity-30"
                aria-label="Move down"
              >
                ↓
              </button>
            </div>
            <input
              className={`${input} flex-1 min-w-[10rem]`}
              placeholder="Stage name"
              value={s.name}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <span className="font-mono text-xs text-[var(--muted-foreground)]">
              {s.existing ? s.slug : "(new)"}
            </span>
            <label className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
              Prob %
              <input
                type="number"
                min={0}
                max={100}
                className={`${input} w-20`}
                value={s.defaultProbability}
                onChange={(e) =>
                  update(i, { defaultProbability: Number(e.target.value) })
                }
              />
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={s.isClosed}
                onChange={(e) => update(i, { isClosed: e.target.checked })}
              />
              Closed
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={s.isWon}
                onChange={(e) => update(i, { isWon: e.target.checked })}
              />
              Won
            </label>
            <button
              onClick={() => remove(i)}
              className="ml-auto text-xs text-red-600 hover:underline"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={add}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
        >
          + Add stage
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save pipeline"}
        </button>
      </div>
    </div>
  );
}
