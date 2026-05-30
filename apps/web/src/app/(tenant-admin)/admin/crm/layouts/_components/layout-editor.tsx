"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface LayoutSection {
  title: string;
  columns: 1 | 2 | 3;
  fieldIds: string[];
}
interface LayoutConfig {
  sections: LayoutSection[];
}
interface FieldRef {
  id: string;
  name: string;
}

export function LayoutEditor({
  layoutId,
  initialConfig,
  fields,
}: {
  layoutId: string;
  initialConfig: LayoutConfig;
  fields: FieldRef[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [sections, setSections] = useState<LayoutSection[]>(
    initialConfig.sections ?? []
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nameById = new Map(fields.map((f) => [f.id, f.name]));
  const placed = new Set(sections.flatMap((s) => s.fieldIds));
  const unplaced = fields.filter((f) => !placed.has(f.id));

  function setSection(i: number, patch: Partial<LayoutSection>) {
    setSections(sections.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function moveField(si: number, fi: number, dir: -1 | 1) {
    const t = fi + dir;
    const ids = sections[si].fieldIds.slice();
    if (t < 0 || t >= ids.length) return;
    [ids[fi], ids[t]] = [ids[t], ids[fi]];
    setSection(si, { fieldIds: ids });
  }
  function removeField(si: number, id: string) {
    setSection(si, {
      fieldIds: sections[si].fieldIds.filter((x) => x !== id),
    });
  }
  function addField(si: number, id: string) {
    if (!id) return;
    setSection(si, { fieldIds: [...sections[si].fieldIds, id] });
  }
  function addSection() {
    setSections([...sections, { title: "New section", columns: 2, fieldIds: [] }]);
  }
  function removeSection(i: number) {
    setSections(sections.filter((_, idx) => idx !== i));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/crm/layouts/${layoutId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { sections } }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? `Save failed (${res.status})`);
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

      {unplaced.length > 0 && (
        <p className="mb-3 text-xs text-[var(--muted-foreground)]">
          Unplaced fields:{" "}
          {unplaced.map((f) => f.name).join(", ")} — add them to a section
          below.
        </p>
      )}

      <div className="space-y-4">
        {sections.map((section, si) => (
          <div
            key={si}
            className="rounded-xl border border-[var(--border)] p-4"
          >
            <div className="flex flex-wrap items-center gap-3">
              <input
                className={`${input} flex-1 min-w-[12rem] font-medium`}
                value={section.title}
                onChange={(e) => setSection(si, { title: e.target.value })}
              />
              <label className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                Columns
                <select
                  className={input}
                  value={section.columns}
                  onChange={(e) =>
                    setSection(si, {
                      columns: Number(e.target.value) as 1 | 2 | 3,
                    })
                  }
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </label>
              <button
                onClick={() => removeSection(si)}
                className="ml-auto text-xs text-red-600 hover:underline"
              >
                Remove section
              </button>
            </div>

            <ul className="mt-3 space-y-1">
              {section.fieldIds.map((id, fi) => (
                <li
                  key={id}
                  className="flex items-center gap-2 rounded-md border border-[var(--border)] px-2 py-1 text-sm"
                >
                  <button
                    onClick={() => moveField(si, fi, -1)}
                    disabled={fi === 0}
                    className="rounded border border-[var(--border)] px-1 disabled:opacity-30"
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveField(si, fi, 1)}
                    disabled={fi === section.fieldIds.length - 1}
                    className="rounded border border-[var(--border)] px-1 disabled:opacity-30"
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <span className="flex-1">
                    {nameById.get(id) ?? (
                      <span className="text-red-600">unknown field</span>
                    )}
                  </span>
                  <button
                    onClick={() => removeField(si, id)}
                    className="text-xs text-[var(--muted-foreground)] hover:text-red-600"
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>

            {unplaced.length > 0 && (
              <select
                className={`${input} mt-2`}
                value=""
                onChange={(e) => addField(si, e.target.value)}
              >
                <option value="">+ Add field…</option>
                {unplaced.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={addSection}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
        >
          + Add section
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save layout"}
        </button>
      </div>
    </div>
  );
}
