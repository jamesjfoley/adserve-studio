"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PALETTES, PALETTE_IDS, type PaletteId } from "@/lib/theme/palettes";

/**
 * WS6 — accent-palette picker. Cosmetic gating only (`canEdit`); the write is
 * authorised server-side by /api/admin/theme. On success it refreshes so the
 * server layout re-renders with the new data-palette.
 */
export function PaletteForm({
  current,
  canEdit,
}: {
  current: PaletteId;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<PaletteId>(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(id: PaletteId) {
    if (!canEdit || saving || id === selected) return;
    const previous = selected;
    setSelected(id);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/theme", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ palette: id }),
      });
      if (!res.ok) {
        setSelected(previous);
        setError("Could not save the palette. Please try again.");
        return;
      }
      router.refresh();
    } catch {
      setSelected(previous);
      setError("Could not save the palette. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Accent palette"
        className="flex flex-wrap gap-3"
      >
        {PALETTE_IDS.map((id) => {
          const p = PALETTES[id];
          const active = id === selected;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={!canEdit || saving}
              onClick={() => choose(id)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                active
                  ? "border-[var(--accent)] ring-2 ring-[var(--accent)]"
                  : "border-[var(--border)] hover:bg-[var(--muted)]"
              }`}
            >
              <span
                aria-hidden="true"
                className="h-4 w-4 rounded-full"
                style={{ backgroundColor: p.accent }}
              />
              {p.label}
            </button>
          );
        })}
      </div>
      {!canEdit && (
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          View only. Your role cannot change the palette.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
