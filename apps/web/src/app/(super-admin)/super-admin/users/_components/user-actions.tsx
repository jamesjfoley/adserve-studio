"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type UserStatus = "active" | "invited" | "disabled";

type Props = {
  userId: string;
  status: UserStatus;
  isSelf: boolean;
};

export function UserActions({ userId, status, isSelf }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/super-admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? `Request failed (${res.status})`);
      return;
    }
    startTransition(() => router.refresh());
  }

  const canDisable = status === "active" && !isSelf;
  const canEnable = status === "disabled";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canDisable && (
        <button
          type="button"
          onClick={() => patch({ status: "disabled" })}
          disabled={pending}
          className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--muted)] disabled:opacity-50"
        >
          Disable
        </button>
      )}
      {canEnable && (
        <button
          type="button"
          onClick={() => patch({ status: "active" })}
          disabled={pending}
          className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--muted)] disabled:opacity-50"
        >
          Enable
        </button>
      )}
      {isSelf && (
        <span className="text-xs italic text-[var(--muted-foreground)]">
          (you)
        </span>
      )}
      {error && (
        <span className="text-xs text-red-600" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
