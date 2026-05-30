"use client";

import { useState } from "react";

/**
 * Task 1.7c — "Summarize recent activity" for an account. Self-contained:
 * a button that POSTs to the summarize endpoint and renders the returned
 * 2–3 paragraph summary, with loading + error states (incl. the 429 cap
 * message). No coupling into the detail page's write paths.
 */
export function AiActivitySummary({ accountId }: { accountId: string }) {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function summarize() {
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch(`/api/crm/accounts/${accountId}/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = (await res.json().catch(() => ({}))) as {
        summary?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? `Summary failed (${res.status})`);
        return;
      }
      setSummary(body.summary ?? "");
    } catch {
      setError("Network error while generating the summary.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={summarize}
        disabled={loading}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--muted)] disabled:opacity-50"
      >
        {loading ? "Summarizing…" : "Summarize recent activity"}
      </button>
      {error && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {summary && (
        <div className="mt-2 whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-3 text-sm">
          {summary}
        </div>
      )}
    </div>
  );
}
