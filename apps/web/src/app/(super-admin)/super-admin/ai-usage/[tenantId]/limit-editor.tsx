"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Edit a tenant's monthly cost cap. Input is in whole US dollars (the cap
 * is a USD figure); we convert to microdollars for the API. Calls
 * PATCH /api/super-admin/ai-usage/[tenantId]/limits.
 */
export function LimitEditor({
  tenantId,
  initialCostMicros,
}: {
  tenantId: string;
  initialCostMicros: number;
}) {
  const router = useRouter();
  const [dollars, setDollars] = useState(
    (initialCostMicros / 1_000_000).toFixed(2)
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    const parsed = Number(dollars);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setMessage("Enter a non-negative dollar amount.");
      setSaving(false);
      return;
    }
    const monthlyCostLimitMicros = Math.round(parsed * 1_000_000);
    try {
      const res = await fetch(
        `/api/super-admin/ai-usage/${tenantId}/limits`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ monthlyCostLimitMicros }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setMessage(body.error ?? "Failed to update limit.");
      } else {
        setMessage("Saved.");
        router.refresh();
      }
    } catch {
      setMessage("Network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--muted-foreground)]">
          Monthly cap (USD)
        </span>
        <div className="flex items-center gap-1">
          <span className="text-[var(--muted-foreground)]">$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={dollars}
            onChange={(e) => setDollars(e.target.value)}
            className="w-32 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1"
          />
        </div>
      </label>
      <button
        onClick={save}
        disabled={saving}
        className="rounded-md bg-brand-700 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save cap"}
      </button>
      {message && (
        <span className="text-sm text-[var(--muted-foreground)]">{message}</span>
      )}
    </div>
  );
}
