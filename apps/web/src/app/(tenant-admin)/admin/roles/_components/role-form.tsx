"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type PermissionRow = {
  id: string;
  moduleId: string | null;
  moduleSlug: string | null;
  moduleName: string | null;
  resource: string;
  action: string;
  description: string | null;
};

type Mode =
  | { kind: "create" }
  | { kind: "edit"; roleId: string; isSystem: boolean; isOwner: boolean };

type Props = {
  mode: Mode;
  initialName: string;
  initialDescription: string;
  initialPermissionIds: string[];
  allPermissions: PermissionRow[];
};

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

export function RoleForm({
  mode,
  initialName,
  initialDescription,
  initialPermissionIds,
  allPermissions,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialPermissionIds)
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const readOnly = mode.kind === "edit" && mode.isOwner;
  const nameDescLocked =
    mode.kind === "edit" && (mode.isSystem || mode.isOwner);
  const permsLocked = readOnly;

  // Group permissions by module → resource for rendering
  const grouped = useMemo(() => {
    type Bucket = {
      moduleId: string | null;
      moduleName: string;
      moduleOrder: number;
      byResource: Map<string, PermissionRow[]>;
    };
    const buckets = new Map<string, Bucket>();
    for (const p of allPermissions) {
      const key = p.moduleId ?? "__platform__";
      let b = buckets.get(key);
      if (!b) {
        b = {
          moduleId: p.moduleId,
          moduleName: p.moduleId
            ? p.moduleName ?? p.moduleSlug ?? "Module"
            : "Platform",
          moduleOrder: p.moduleId ? 1 : 0,
          byResource: new Map(),
        };
        buckets.set(key, b);
      }
      const list = b.byResource.get(p.resource) ?? [];
      list.push(p);
      b.byResource.set(p.resource, list);
    }
    return Array.from(buckets.values()).sort(
      (a, b) =>
        a.moduleOrder - b.moduleOrder ||
        a.moduleName.localeCompare(b.moduleName)
    );
  }, [allPermissions]);

  function toggle(id: string) {
    if (permsLocked) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleResource(perms: PermissionRow[], checkAll: boolean) {
    if (permsLocked) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of perms) {
        if (checkAll) next.add(p.id);
        else next.delete(p.id);
      }
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const url =
        mode.kind === "create"
          ? "/api/admin/roles"
          : `/api/admin/roles/${mode.roleId}`;
      const method = mode.kind === "create" ? "POST" : "PATCH";
      const body: Record<string, unknown> = {
        permissionIds: Array.from(selected),
      };
      if (!nameDescLocked) {
        body.name = name;
        body.description = description.trim() === "" ? null : description;
      }
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? `Request failed (${res.status})`);
        return;
      }
      startTransition(() => {
        router.push("/admin/roles");
        router.refresh();
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {readOnly && (
        <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          The Owner role is read-only. It always has full access by design.
        </div>
      )}
      {mode.kind === "edit" && mode.isSystem && !mode.isOwner && (
        <div className="mb-6 rounded-md border border-[var(--border)] bg-[var(--muted)] px-4 py-3 text-sm">
          This is a system role. Its name and description cannot be changed,
          but you can adjust its permissions.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)]">
            Name
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={nameDescLocked}
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm disabled:opacity-60"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)]">
            Description
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={nameDescLocked}
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm disabled:opacity-60"
          />
        </div>
      </div>

      <h2 className="mt-8 text-lg font-semibold tracking-tight">Permissions</h2>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Only permissions for modules enabled in your tenant are shown.
      </p>

      <div className="mt-4 space-y-6">
        {grouped.map((bucket) => (
          <div
            key={bucket.moduleId ?? "platform"}
            className="rounded-xl border border-[var(--border)] overflow-hidden"
          >
            <div className="bg-[var(--muted)] px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              {bucket.moduleName}
            </div>
            <div className="divide-y divide-[var(--border)]">
              {Array.from(bucket.byResource.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([resource, perms]) => {
                  const sortedPerms = [...perms].sort((a, b) =>
                    a.action.localeCompare(b.action)
                  );
                  const allChecked = sortedPerms.every((p) =>
                    selected.has(p.id)
                  );
                  const anyChecked = sortedPerms.some((p) =>
                    selected.has(p.id)
                  );
                  return (
                    <div key={resource} className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {titleCase(resource)}
                        </span>
                        {!permsLocked && (
                          <button
                            type="button"
                            onClick={() =>
                              toggleResource(sortedPerms, !allChecked)
                            }
                            className="text-xs text-[var(--muted-foreground)] hover:underline"
                          >
                            {allChecked
                              ? "Clear"
                              : anyChecked
                                ? "Select all"
                                : "Select all"}
                          </button>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                        {sortedPerms.map((p) => (
                          <label
                            key={p.id}
                            className="inline-flex items-center gap-2 text-sm"
                            title={p.description ?? ""}
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(p.id)}
                              onChange={() => toggle(p.id)}
                              disabled={permsLocked}
                            />
                            <span>
                              {p.action}
                              <span className="ml-1 text-[var(--muted-foreground)]">
                                ({p.resource}.{p.action})
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push("/admin/roles")}
          className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm font-medium hover:bg-[var(--muted)]"
        >
          {readOnly ? "Back" : "Cancel"}
        </button>
        {!readOnly && (
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {submitting
              ? "Saving…"
              : mode.kind === "create"
                ? "Create role"
                : "Save changes"}
          </button>
        )}
      </div>
    </form>
  );
}
