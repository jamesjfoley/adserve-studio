"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface FieldRow {
  id: string;
  name: string;
  slug: string;
  fieldType: string;
  isRequired: boolean;
  isFilterable: boolean;
  isSystem: boolean;
  description: string;
}

const NEW_FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "currency",
  "date",
  "datetime",
  "boolean",
  "select",
  "multi_select",
  "email",
  "phone",
  "url",
];

export function FieldsManager({
  entityType,
  fields,
}: {
  entityType: string;
  fields: FieldRow[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    name: "",
    slug: "",
    fieldType: "text",
    isRequired: false,
    isFilterable: false,
    description: "",
  });

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function call(
    url: string,
    method: string,
    body?: unknown
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? `${method} failed (${res.status})`);
        return false;
      }
      return true;
    } catch {
      setError("Network error.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addField() {
    const ok = await call("/api/admin/crm/fields", "POST", {
      entityType,
      ...form,
    });
    if (ok) {
      setForm({
        name: "",
        slug: "",
        fieldType: "text",
        isRequired: false,
        isFilterable: false,
        description: "",
      });
      setAdding(false);
      refresh();
    }
  }

  async function patchField(id: string, body: Record<string, unknown>) {
    if (await call(`/api/admin/crm/fields/${id}`, "PATCH", body)) refresh();
  }

  async function deleteField(id: string) {
    if (await call(`/api/admin/crm/fields/${id}`, "DELETE")) refresh();
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= fields.length) return;
    const ids = fields.map((f) => f.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    if (
      await call("/api/admin/crm/fields", "PATCH", {
        entityType,
        orderedFieldIds: ids,
      })
    )
      refresh();
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

      <div className="mb-4">
        {adding ? (
          <div className="rounded-lg border border-[var(--border)] p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
                Name
                <input
                  className={input}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
                Slug (lower_snake_case)
                <input
                  className={input}
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
                Type
                <select
                  className={input}
                  value={form.fieldType}
                  onChange={(e) =>
                    setForm({ ...form, fieldType: e.target.value })
                  }
                >
                  {NEW_FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
                Description
                <input
                  className={input}
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="mt-3 flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={form.isRequired}
                  onChange={(e) =>
                    setForm({ ...form, isRequired: e.target.checked })
                  }
                />
                Required
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={form.isFilterable}
                  onChange={(e) =>
                    setForm({ ...form, isFilterable: e.target.checked })
                  }
                />
                Filterable
              </label>
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => setAdding(false)}
                  className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={addField}
                  disabled={busy}
                  className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  Add field
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white"
          >
            + Add field
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs uppercase tracking-wider text-[var(--muted-foreground)]">
            <tr>
              <th className="px-3 py-2 font-medium">Order</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Slug</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Required</th>
              <th className="px-3 py-2 font-medium">Filterable</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {fields.map((f, i) => (
              <tr key={f.id}>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <button
                      onClick={() => move(i, -1)}
                      disabled={i === 0 || busy}
                      className="rounded border border-[var(--border)] px-1.5 disabled:opacity-30"
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => move(i, 1)}
                      disabled={i === fields.length - 1 || busy}
                      className="rounded border border-[var(--border)] px-1.5 disabled:opacity-30"
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                  </div>
                </td>
                <td className="px-3 py-2 font-medium">
                  {f.name}
                  {f.isSystem && (
                    <span className="ml-2 rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
                      system
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--muted-foreground)]">
                  {f.slug}
                </td>
                <td className="px-3 py-2 text-[var(--muted-foreground)]">
                  {f.fieldType}
                </td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={f.isRequired}
                    disabled={busy}
                    onChange={(e) =>
                      patchField(f.id, { isRequired: e.target.checked })
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={f.isFilterable}
                    disabled={busy}
                    onChange={(e) =>
                      patchField(f.id, { isFilterable: e.target.checked })
                    }
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  {!f.isSystem && (
                    <button
                      onClick={() => deleteField(f.id)}
                      disabled={busy}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
