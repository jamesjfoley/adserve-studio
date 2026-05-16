"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Props = {
  tenantId: string;
  status: "active" | "suspended" | "cancelled";
};

export function TenantStatusActions({ tenantId, status }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function patchStatus(next: "active" | "suspended" | "cancelled") {
    if (next === "cancelled") {
      const ok = window.confirm(
        "Cancel this tenant? Users will lose access. This is reversible."
      );
      if (!ok) return;
    }

    setError(null);
    const res = await fetch(`/api/super-admin/tenants/${tenantId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Request failed (${res.status})`);
      return;
    }

    startTransition(() => router.refresh());
  }

  return (
    <div className="flex items-center gap-2">
      {status === "active" && (
        <button
          type="button"
          onClick={() => patchStatus("suspended")}
          disabled={pending}
          className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--muted)] disabled:opacity-50"
        >
          Pause
        </button>
      )}
      {(status === "suspended" || status === "cancelled") && (
        <button
          type="button"
          onClick={() => patchStatus("active")}
          disabled={pending}
          className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--muted)] disabled:opacity-50"
        >
          Reactivate
        </button>
      )}
      {status !== "cancelled" && (
        <button
          type="button"
          onClick={() => patchStatus("cancelled")}
          disabled={pending}
          className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Cancel
        </button>
      )}
      {error && (
        <span className="text-xs text-red-600" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
