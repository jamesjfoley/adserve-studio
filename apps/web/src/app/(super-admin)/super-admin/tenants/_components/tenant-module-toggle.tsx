"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Props = {
  tenantId: string;
  moduleSlug: string;
  enabled: boolean;
  disabled?: boolean;
};

export function TenantModuleToggle({
  tenantId,
  moduleSlug,
  enabled,
  disabled,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState(enabled);

  async function toggle() {
    if (disabled) return;
    const next = !optimistic;
    setOptimistic(next);
    setError(null);

    const res = await fetch(
      `/api/super-admin/tenants/${tenantId}/modules`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleSlug, enabled: next }),
      }
    );

    if (!res.ok) {
      setOptimistic(!next);
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Request failed (${res.status})`);
      return;
    }

    startTransition(() => router.refresh());
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={optimistic}
        onClick={toggle}
        disabled={pending || disabled}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          optimistic ? "bg-brand-500" : "bg-[var(--border)]"
        } ${pending || disabled ? "opacity-50" : ""}`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            optimistic ? "translate-x-5" : "translate-x-1"
          }`}
        />
      </button>
      {error && (
        <span className="text-xs text-red-600" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
