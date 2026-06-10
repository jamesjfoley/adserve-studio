"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface LayoutSection {
  title: string;
  columns: 1 | 2 | 3 | 4;
  fieldIds: string[];
  hidden?: boolean;
  widget?: string;
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
  // Active drag: a field being dragged from a section (with its index) or from
  // the "unplaced" pool (section === null). Used to move fields row-major.
  const [drag, setDrag] = useState<{
    id: string;
    from: number | null;
    index: number | null;
  } | null>(null);
  // The drop target currently under the cursor, for a visual indicator.
  const [dropAt, setDropAt] = useState<{ section: number; index: number } | null>(
    null
  );

  const nameById = new Map(fields.map((f) => [f.id, f.name]));
  // Only normal (non-widget) sections place fields; widget sections have none.
  const placed = new Set(
    sections.filter((s) => !s.widget).flatMap((s) => s.fieldIds)
  );
  const unplaced = fields.filter((f) => !placed.has(f.id));

  function setSection(i: number, patch: Partial<LayoutSection>) {
    setSections(sections.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function moveSection(i: number, dir: -1 | 1) {
    const t = i + dir;
    if (t < 0 || t >= sections.length) return;
    const next = sections.slice();
    [next[i], next[t]] = [next[t], next[i]];
    setSections(next);
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

  // Core of drag-and-drop: move `id` to `targetSection` at `targetIndex`,
  // removing it from its source section first. `fromSection === null` means the
  // field came from the unplaced pool (nothing to remove). Index null appends.
  function moveFieldTo(
    id: string,
    fromSection: number | null,
    targetSection: number,
    targetIndex: number | null
  ) {
    setSections((prev) => {
      const next = prev.map((s) => ({ ...s, fieldIds: s.fieldIds.slice() }));
      // Remove from source (if it lived in a section).
      let removedBefore = false;
      if (fromSection !== null) {
        const src = next[fromSection].fieldIds;
        const at = src.indexOf(id);
        if (at !== -1) {
          src.splice(at, 1);
          // If we removed from the same section before the insertion point,
          // the target index shifts left by one.
          if (fromSection === targetSection && targetIndex !== null && at < targetIndex) {
            removedBefore = true;
          }
        }
      }
      // Insert into target (guard against duplicates if dropped on itself).
      const dst = next[targetSection].fieldIds;
      if (!dst.includes(id)) {
        const insertAt =
          targetIndex === null
            ? dst.length
            : Math.max(0, targetIndex - (removedBefore ? 1 : 0));
        dst.splice(insertAt, 0, id);
      }
      return next;
    });
  }

  function onChipDrop(targetSection: number, targetIndex: number | null) {
    if (drag) moveFieldTo(drag.id, drag.from, targetSection, targetIndex);
    setDrag(null);
    setDropAt(null);
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
        <div className="mb-3">
          <p className="text-xs text-[var(--muted-foreground)]">
            Unplaced fields: drag one into a section below, or use “+ Add field”.
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {unplaced.map((f) => (
              <span
                key={f.id}
                draggable
                onDragStart={() => setDrag({ id: f.id, from: null, index: null })}
                onDragEnd={() => {
                  setDrag(null);
                  setDropAt(null);
                }}
                className="cursor-grab rounded-md border border-dashed border-[var(--border)] bg-[var(--muted)] px-2 py-1 text-xs text-[var(--muted-foreground)]"
              >
                {f.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {sections.map((section, si) => {
          const isWidget = Boolean(section.widget);
          return (
            <div
              key={si}
              className={`rounded-xl border border-[var(--border)] p-4 ${
                section.hidden ? "opacity-50" : ""
              }`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => moveSection(si, -1)}
                  disabled={si === 0}
                  className="rounded border border-[var(--border)] px-1 text-sm disabled:opacity-30"
                  aria-label="Move section up"
                >
                  ↑
                </button>
                <button
                  onClick={() => moveSection(si, 1)}
                  disabled={si === sections.length - 1}
                  className="rounded border border-[var(--border)] px-1 text-sm disabled:opacity-30"
                  aria-label="Move section down"
                >
                  ↓
                </button>
                <input
                  className={`${input} flex-1 min-w-[12rem] font-medium`}
                  value={section.title}
                  onChange={(e) => setSection(si, { title: e.target.value })}
                />
                {isWidget && (
                  <span className="rounded-md bg-[var(--muted)] px-2 py-1 text-xs text-[var(--muted-foreground)]">
                    {section.title} — panel ({section.widget})
                  </span>
                )}
                {section.hidden && (
                  <span className="rounded-md bg-[var(--muted)] px-2 py-1 text-xs font-medium text-[var(--muted-foreground)]">
                    Hidden
                  </span>
                )}
                {!isWidget && (
                  <label className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                    Columns
                    <select
                      className={input}
                      value={section.columns}
                      onChange={(e) =>
                        setSection(si, {
                          columns: Number(e.target.value) as 1 | 2 | 3 | 4,
                        })
                      }
                    >
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                      <option value={3}>3</option>
                      <option value={4}>4</option>
                    </select>
                  </label>
                )}
                <label className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                  <input
                    type="checkbox"
                    checked={Boolean(section.hidden)}
                    onChange={(e) =>
                      setSection(si, { hidden: e.target.checked })
                    }
                    aria-label="Hidden"
                  />
                  Hidden
                </label>
                <button
                  onClick={() => removeSection(si)}
                  className="ml-auto text-xs text-red-600 hover:underline"
                >
                  Remove section
                </button>
              </div>

              {!isWidget && (
                <>
                  {/* WYSIWYG grid: fields are laid out row-major in the
                      section's column count, exactly as the detail page renders
                      them. Drag a chip to reorder / move it between sections. */}
                  <div
                    data-testid={`grid-${si}`}
                    data-columns={section.columns}
                    className="mt-3 grid gap-2"
                    style={{
                      gridTemplateColumns: `repeat(${section.columns}, minmax(0, 1fr))`,
                    }}
                    onDragOver={(e) => {
                      if (!drag) return;
                      e.preventDefault();
                      // Dropping on empty grid area appends to the end.
                      setDropAt({ section: si, index: section.fieldIds.length });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      onChipDrop(si, null);
                    }}
                  >
                    {section.fieldIds.map((id, fi) => {
                      const isDropTarget =
                        dropAt?.section === si && dropAt.index === fi;
                      const isDragging = drag?.from === si && drag.index === fi;
                      return (
                        <div
                          key={id}
                          draggable
                          onDragStart={(e) => {
                            e.stopPropagation();
                            setDrag({ id, from: si, index: fi });
                          }}
                          onDragEnd={() => {
                            setDrag(null);
                            setDropAt(null);
                          }}
                          onDragOver={(e) => {
                            if (!drag) return;
                            e.preventDefault();
                            e.stopPropagation();
                            // Dropping onto a chip inserts before it.
                            setDropAt({ section: si, index: fi });
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onChipDrop(si, fi);
                          }}
                          className={`flex cursor-grab items-center gap-2 rounded-md border bg-[var(--background)] px-2 py-1 text-sm ${
                            isDropTarget
                              ? "border-[var(--accent)] ring-2 ring-[var(--accent)]"
                              : "border-[var(--border)]"
                          } ${isDragging ? "opacity-40" : ""}`}
                          aria-label={`Field ${nameById.get(id) ?? id}`}
                        >
                          <span aria-hidden className="text-[var(--muted-foreground)]">
                            ⠿
                          </span>
                          <span className="flex-1 truncate">
                            {nameById.get(id) ?? (
                              <span className="text-red-600">unknown field</span>
                            )}
                          </span>
                          {/* Keyboard/click fallback: reorder + remove without a mouse. */}
                          <button
                            onClick={() => moveField(si, fi, -1)}
                            disabled={fi === 0}
                            className="rounded border border-[var(--border)] px-1 text-xs disabled:opacity-30"
                            aria-label="Move up"
                          >
                            ↑
                          </button>
                          <button
                            onClick={() => moveField(si, fi, 1)}
                            disabled={fi === section.fieldIds.length - 1}
                            className="rounded border border-[var(--border)] px-1 text-xs disabled:opacity-30"
                            aria-label="Move down"
                          >
                            ↓
                          </button>
                          <button
                            onClick={() => removeField(si, id)}
                            className="text-xs text-[var(--muted-foreground)] hover:text-red-600"
                            aria-label="Remove field"
                          >
                            remove
                          </button>
                        </div>
                      );
                    })}
                    {section.fieldIds.length === 0 && (
                      <p className="col-span-full rounded-md border border-dashed border-[var(--border)] px-2 py-3 text-center text-xs text-[var(--muted-foreground)]">
                        Drop a field here, or use “+ Add field” below.
                      </p>
                    )}
                  </div>

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
                </>
              )}
            </div>
          );
        })}
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
          className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save layout"}
        </button>
      </div>
    </div>
  );
}
