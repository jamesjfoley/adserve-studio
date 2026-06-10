"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type LayoutItem =
  | { fieldId: string; span?: number }
  | { spacer: true; span?: number };
interface LayoutSection {
  title: string;
  columns: 1 | 2 | 3 | 4;
  fieldIds: string[];
  items?: LayoutItem[];
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

// Working item: every cell carries a concrete span so the editor can render a
// WYSIWYG grid. `spacer` cells are empty gaps; field cells reference a real id.
type WorkItem =
  | { fieldId: string; spacer?: false; span: number }
  | { fieldId?: undefined; spacer: true; span: number };
interface WorkSection extends Omit<LayoutSection, "items" | "fieldIds"> {
  items: WorkItem[];
}

function isSpacer(it: WorkItem): it is { spacer: true; span: number } {
  return it.spacer === true;
}

// Preview field labels for read-only widget panels. The panel itself owns and
// renders these on the detail page; here we just show the admin what's inside.
const WIDGET_PREVIEW: Record<string, string[]> = {
  brands: ["Brand", "Brand Category", "Brand Values"],
  history: ["Field Name", "New Value", "Old Value", "Changed By", "Date & Time"],
};

// Derive working items for a section. Widget sections never place fields, so
// they keep an empty item list. Non-widget sections adopt existing `items` if
// present, otherwise derive span-1 field cells from `fieldIds`.
function toWorkItems(section: LayoutSection): WorkItem[] {
  if (section.widget) return [];
  if (section.items && section.items.length > 0) {
    return section.items.map((it) => {
      if ("spacer" in it && it.spacer) {
        return { spacer: true, span: Math.max(1, it.span ?? 1) };
      }
      const fieldId = (it as { fieldId: string }).fieldId;
      return { fieldId, span: Math.max(1, it.span ?? 1) };
    });
  }
  return (section.fieldIds ?? []).map((fieldId) => ({ fieldId, span: 1 }));
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
  const [sections, setSections] = useState<WorkSection[]>(() =>
    (initialConfig.sections ?? []).map((s) => ({
      title: s.title,
      columns: s.columns,
      hidden: s.hidden,
      widget: s.widget,
      items: toWorkItems(s),
    }))
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Active drag: a cell being dragged from a section (with its index) or a field
  // from the "unplaced" pool (from === null). Used to move cells row-major.
  const [drag, setDrag] = useState<{
    id: string | null; // fieldId for field/pool drags; null for spacers
    spacer: boolean;
    from: number | null;
    index: number | null;
  } | null>(null);
  // The drop target currently under the cursor, for a visual indicator.
  const [dropAt, setDropAt] = useState<{ section: number; index: number } | null>(
    null
  );

  const nameById = new Map(fields.map((f) => [f.id, f.name]));
  // A field is "placed" if it appears as a field cell in any non-widget section.
  const placed = new Set(
    sections
      .filter((s) => !s.widget)
      .flatMap((s) => s.items.filter((it) => !isSpacer(it)).map((it) => it.fieldId!))
  );
  const unplaced = fields.filter((f) => !placed.has(f.id));

  function clampSpan(span: number, columns: number) {
    return Math.min(Math.max(1, Math.floor(span)), columns);
  }

  function setSection(i: number, patch: Partial<WorkSection>) {
    setSections(sections.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function moveSection(i: number, dir: -1 | 1) {
    const t = i + dir;
    if (t < 0 || t >= sections.length) return;
    const next = sections.slice();
    [next[i], next[t]] = [next[t], next[i]];
    setSections(next);
  }
  function moveItem(si: number, ii: number, dir: -1 | 1) {
    const t = ii + dir;
    const items = sections[si].items.slice();
    if (t < 0 || t >= items.length) return;
    [items[ii], items[t]] = [items[t], items[ii]];
    setSection(si, { items });
  }
  function removeItem(si: number, ii: number) {
    setSection(si, { items: sections[si].items.filter((_, idx) => idx !== ii) });
  }
  function setItemSpan(si: number, ii: number, span: number) {
    const cols = sections[si].columns;
    const items = sections[si].items.map((it, idx) =>
      idx === ii ? { ...it, span: clampSpan(span, cols) } : it
    );
    setSection(si, { items });
  }
  function setColumns(si: number, columns: 1 | 2 | 3 | 4) {
    // Re-clamp every span to the new column count.
    const items = sections[si].items.map((it) => ({
      ...it,
      span: clampSpan(it.span, columns),
    }));
    setSection(si, { columns, items });
  }
  function addField(si: number, id: string) {
    if (!id) return;
    setSection(si, { items: [...sections[si].items, { fieldId: id, span: 1 }] });
  }
  function addSpacer(si: number) {
    setSection(si, { items: [...sections[si].items, { spacer: true, span: 1 }] });
  }
  function addRowBreak(si: number) {
    const section = sections[si];
    const cols = section.columns;
    const used = section.items.reduce((sum, it) => sum + it.span, 0);
    const remainder = used % cols;
    // Remainder 0 means the last row is full (or empty) — a full-width spacer
    // starts a fresh empty row. Otherwise fill the rest of the current row.
    const span = remainder === 0 ? cols : cols - remainder;
    setSection(si, { items: [...section.items, { spacer: true, span }] });
  }

  // Core of drag-and-drop: move a cell to `targetSection` at `targetIndex`,
  // removing it from its source section first. `fromSection === null` means a
  // field dragged from the unplaced pool (nothing to remove). Index null appends.
  function moveItemTo(
    payload: { id: string | null; spacer: boolean },
    fromSection: number | null,
    fromIndex: number | null,
    targetSection: number,
    targetIndex: number | null
  ) {
    setSections((prev) => {
      const next = prev.map((s) => ({ ...s, items: s.items.slice() }));
      let moved: WorkItem | null = null;
      let removedBefore = false;
      if (fromSection !== null && fromIndex !== null) {
        const src = next[fromSection].items;
        if (fromIndex >= 0 && fromIndex < src.length) {
          moved = src[fromIndex];
          src.splice(fromIndex, 1);
          if (
            fromSection === targetSection &&
            targetIndex !== null &&
            fromIndex < targetIndex
          ) {
            removedBefore = true;
          }
        }
      }
      // From the pool: build a fresh field cell.
      if (!moved) {
        moved = payload.spacer
          ? { spacer: true, span: 1 }
          : { fieldId: payload.id!, span: 1 };
      }
      const dst = next[targetSection].items;
      // Guard: don't duplicate a field that's already placed elsewhere when it
      // came from the pool.
      if (
        !payload.spacer &&
        fromSection === null &&
        dst.some((it) => !isSpacer(it) && it.fieldId === payload.id)
      ) {
        return next;
      }
      // Re-clamp the moved cell's span to the destination's columns.
      moved = { ...moved, span: clampSpan(moved.span, next[targetSection].columns) };
      const insertAt =
        targetIndex === null
          ? dst.length
          : Math.max(0, targetIndex - (removedBefore ? 1 : 0));
      dst.splice(insertAt, 0, moved);
      return next;
    });
  }

  function onCellDrop(targetSection: number, targetIndex: number | null) {
    if (drag) {
      moveItemTo(
        { id: drag.id, spacer: drag.spacer },
        drag.from,
        drag.index,
        targetSection,
        targetIndex
      );
    }
    setDrag(null);
    setDropAt(null);
  }
  function addSection() {
    setSections([
      ...sections,
      { title: "New section", columns: 2, items: [] },
    ]);
  }
  function removeSection(i: number) {
    setSections(sections.filter((_, idx) => idx !== i));
  }

  // Serialise working sections back to the save contract: non-widget sections
  // emit BOTH `items` (arranged cells) and `fieldIds` (field cells in order);
  // widget sections save their original shape (no items, empty fieldIds).
  function serialise(): LayoutSection[] {
    return sections.map((s) => {
      if (s.widget) {
        return {
          title: s.title,
          columns: s.columns,
          fieldIds: [],
          ...(s.hidden ? { hidden: true } : {}),
          widget: s.widget,
        };
      }
      const items: LayoutItem[] = s.items.map((it) =>
        isSpacer(it)
          ? { spacer: true, span: it.span }
          : { fieldId: it.fieldId!, span: it.span }
      );
      const fieldIds = s.items
        .filter((it) => !isSpacer(it))
        .map((it) => it.fieldId!);
      return {
        title: s.title,
        columns: s.columns,
        fieldIds,
        items,
        ...(s.hidden ? { hidden: true } : {}),
      };
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/crm/layouts/${layoutId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { sections: serialise() } }),
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
                onDragStart={() =>
                  setDrag({ id: f.id, spacer: false, from: null, index: null })
                }
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
          const previewFields = isWidget
            ? WIDGET_PREVIEW[section.widget!] ?? []
            : [];
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
                        setColumns(si, Number(e.target.value) as 1 | 2 | 3 | 4)
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

              {isWidget && previewFields.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-[var(--muted-foreground)]">
                    Panel fields (managed by the panel)
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {previewFields.map((label) => (
                      <span
                        key={label}
                        className="rounded-md border border-dashed border-[var(--border)] bg-[var(--muted)] px-2 py-1 text-xs text-[var(--muted-foreground)]"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {!isWidget && (
                <>
                  {/* WYSIWYG grid: cells are laid out row-major in the section's
                      column count, each spanning `span` columns, exactly as the
                      detail page renders `items`. Drag a cell to reorder / move
                      it between sections. Spacers render as dashed gaps. */}
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
                      setDropAt({ section: si, index: section.items.length });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      onCellDrop(si, null);
                    }}
                  >
                    {section.items.map((it, ii) => {
                      const isDropTarget =
                        dropAt?.section === si && dropAt.index === ii;
                      const isDragging =
                        drag?.from === si && drag.index === ii;
                      const span = clampSpan(it.span, section.columns);
                      const spacer = isSpacer(it);
                      const cellLabel = spacer
                        ? "Empty cell"
                        : `Field ${nameById.get(it.fieldId!) ?? it.fieldId}`;
                      return (
                        <div
                          key={ii}
                          draggable
                          onDragStart={(e) => {
                            e.stopPropagation();
                            setDrag({
                              id: spacer ? null : it.fieldId!,
                              spacer,
                              from: si,
                              index: ii,
                            });
                          }}
                          onDragEnd={() => {
                            setDrag(null);
                            setDropAt(null);
                          }}
                          onDragOver={(e) => {
                            if (!drag) return;
                            e.preventDefault();
                            e.stopPropagation();
                            // Dropping onto a cell inserts before it.
                            setDropAt({ section: si, index: ii });
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onCellDrop(si, ii);
                          }}
                          style={{ gridColumn: `span ${span}` }}
                          className={`flex cursor-grab items-center gap-2 rounded-md border px-2 py-1 text-sm ${
                            spacer
                              ? "border-dashed bg-[var(--muted)] text-[var(--muted-foreground)]"
                              : "bg-[var(--background)]"
                          } ${
                            isDropTarget
                              ? "border-[var(--accent)] ring-2 ring-[var(--accent)]"
                              : "border-[var(--border)]"
                          } ${isDragging ? "opacity-40" : ""}`}
                          aria-label={cellLabel}
                        >
                          <span
                            aria-hidden
                            className="text-[var(--muted-foreground)]"
                          >
                            ⠿
                          </span>
                          <span className="flex-1 truncate">
                            {spacer ? (
                              <span className="italic">empty</span>
                            ) : (
                              nameById.get(it.fieldId!) ?? (
                                <span className="text-red-600">unknown field</span>
                              )
                            )}
                          </span>
                          {/* Span control: width in columns, clamped to the
                              section's column count. */}
                          <label className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                            <span aria-hidden>w</span>
                            <select
                              className="rounded border border-[var(--border)] bg-[var(--background)] px-1 text-xs"
                              value={span}
                              onChange={(e) =>
                                setItemSpan(si, ii, Number(e.target.value))
                              }
                              aria-label={`Width for ${cellLabel}`}
                            >
                              {Array.from(
                                { length: section.columns },
                                (_, n) => n + 1
                              ).map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </label>
                          {/* Keyboard/click fallback: reorder + remove without a mouse. */}
                          <button
                            onClick={() => moveItem(si, ii, -1)}
                            disabled={ii === 0}
                            className="rounded border border-[var(--border)] px-1 text-xs disabled:opacity-30"
                            aria-label="Move up"
                          >
                            ↑
                          </button>
                          <button
                            onClick={() => moveItem(si, ii, 1)}
                            disabled={ii === section.items.length - 1}
                            className="rounded border border-[var(--border)] px-1 text-xs disabled:opacity-30"
                            aria-label="Move down"
                          >
                            ↓
                          </button>
                          <button
                            onClick={() => removeItem(si, ii)}
                            className="text-xs text-[var(--muted-foreground)] hover:text-red-600"
                            aria-label="Remove cell"
                          >
                            remove
                          </button>
                        </div>
                      );
                    })}
                    {section.items.length === 0 && (
                      <p className="col-span-full rounded-md border border-dashed border-[var(--border)] px-2 py-3 text-center text-xs text-[var(--muted-foreground)]">
                        Drop a field here, or use “+ Add field” below.
                      </p>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {unplaced.length > 0 && (
                      <select
                        className={input}
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
                    <button
                      onClick={() => addSpacer(si)}
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                    >
                      Add empty cell
                    </button>
                    <button
                      onClick={() => addRowBreak(si)}
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                    >
                      Add row break
                    </button>
                  </div>
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
