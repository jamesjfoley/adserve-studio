"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Props = {
  roleId: string;
  roleName: string;
  isSystem: boolean;
  memberCount: number;
};

export function RolesListActions({
  roleId,
  roleName,
  isSystem,
  memberCount,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  async function handleDelete() {
    if (memberCount > 0) {
      alert(
        `Cannot delete "${roleName}": ${memberCount} user${memberCount === 1 ? " is" : "s are"} assigned to this role. Reassign them first.`
      );
      return;
    }
    if (!confirm(`Delete role "${roleName}"? This cannot be undone.`)) {
      return;
    }
    const res = await fetch(`/api/admin/roles/${roleId}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? `Delete failed (${res.status})`);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex justify-end gap-2">
      <Link
        href={`/admin/roles/${roleId}`}
        className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--muted)]"
      >
        {isSystem ? "View" : "Edit"}
      </Link>
      {!isSystem && (
        <button
          type="button"
          onClick={handleDelete}
          className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
        >
          Delete
        </button>
      )}
    </div>
  );
}
