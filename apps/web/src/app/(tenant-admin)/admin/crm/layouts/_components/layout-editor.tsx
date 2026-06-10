"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";

type LayoutItem =
  | { fieldId: string; span?: number; row?: number; col?: number }
  | { spacer: true; span?: number; row?: number; col?: number };
interface LayoutSection {
  title: string;
  columns: 1 | 2 | 3 | 4;
  fieldIds: string[];
  rows?: number;
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

/**
 * Absolute-position grid model.
 *
 * Each field section is a fixed `rows × columns` matrix of cells. A cell holds
 * one field (with a column `span`) or is empty (`null`). Fields are pinned to
 * their exact (row, col); the ONLY way a field moves is the admin dragging it.
 *
 * Drag semantics — no reflow, ever:
 *   - drop on an empty cell  → the field moves there; its old cell empties.
 *   - drop on a filled cell  → the two fields SWAP cells. Nothing else moves.
 *   - drop from the pool      → placed in the target cell (any occupant returns
 *                               to the pool). No other cell changes.
 */
type GridCell = { fieldId: string; span: number } | null;
interface WorkSection {
  title: string;
  columns: 1 | 2 | 3 | 4;
  rows: number;
  cells: GridCell[];
  hidden?: boolean;
  widget?: string;
}

const idx = (r: number, c: number, cols: number) => r * cols + c;

function clampSpan(span: number, max: number) {
  return Math.min(Math.max(1, Math.floor(span)), Math.max(1, max));
}

// Largest span a field at (r,c) can take without colliding with the next
// occupied cell in its row (or the row's end).
function maxSpanAt(cells: GridCell[], r: number, c: number, cols: number) {
  let next = cols;
  for (let cc = c + 1; cc < cols; cc++) {
    if (cells[idx(r, cc, cols)] != null) {
      next = cc;
      break;
    }
  }
  return next - c;
}

// Clamp every field's span so it never overlaps another field — the single
// invariant that keeps the grid non-overlapping after any move.
function normalize(cells: GridCell[], rows: number, cols: number): GridCell[] {
  const next = cells.slice();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = next[idx(r, c, cols)];
      if (cell) {
        const span = clampSpan(cell.span, maxSpanAt(next, r, c, cols));
        if (span !== cell.span) next[idx(r, c, cols)] = { ...cell, span };
      }
    }
  }
  return next;
}

// Preview field labels for read-only widget panels. The panel itself owns and
// renders these on the detail page; here we just show the admin what's inside.
const WIDGET_PREVIEW: Record<string, string[]> = {
  brands: ["Brand", "Brand Category", "Brand Values"],
  history: ["Field Name", "New Value", "Old Value", "Changed By", "Date & Time"],
  notes: ["Type", "Name", "Details", "Added by", "Date"],
};

/**
 * Build the working matrix for a section. Coordinate `items` are placed at their
 * exact (row, col); legacy flow `items` are converted row-major (honouring
 * spans) as a starting grid; bare `fieldIds` become a span-1 row-major grid.
 */
function toWork(section: LayoutSection): WorkSection {
  const base = {
    title: section.title,
    columns: section.columns,
    hidden: section.hidden,
    widget: section.widget,
  };
  if (section.widget) return { ...base, rows: 0, cells: [] };

  const cols = section.columns;
  const placements: { fieldId: string; span: number; row: number; col: number }[] =
    [];

  const items = section.items;
  if (items && items.length > 0) {
    const anyCoords = items.some(
      (it) => typeof it.row === "number" && typeof it.col === "number"
    );
    if (anyCoords) {
      for (const it of items) {
        if ("spacer" in it && it.spacer) continue;
        const fieldId = (it as { fieldId?: string }).fieldId;
        if (!fieldId) continue;
        const col = Math.min(Math.max(0, it.col ?? 0), cols - 1);
        placements.push({
          fieldId,
          span: clampSpan(it.span ?? 1, cols - col),
          row: Math.max(0, it.row ?? 0),
          col,
        });
      }
    } else {
      // Legacy flow → assign coordinates row-major.
      let r = 0;
      let c = 0;
      for (const it of items) {
        const span = clampSpan(it.span ?? 1, cols);
        if (c + span > cols) {
          r++;
          c = 0;
        }
        const eff = Math.min(span, cols - c);
        if (!("spacer" in it && it.spacer)) {
          const fieldId = (it as { fieldId?: string }).fieldId;
          if (fieldId) placements.push({ fieldId, span: eff, row: r, col: c });
        }
        c += eff;
        if (c >= cols) {
          r++;
          c = 0;
        }
      }
    }
  } else {
    (section.fieldIds ?? []).forEach((fieldId, i) => {
      placements.push({
        fieldId,
        span: 1,
        row: Math.floor(i / cols),
        col: i % cols,
      });
    });
  }

  const maxRow = placements.reduce((m, p) => Math.max(m, p.row), -1);
  const rows = Math.max(section.rows ?? 0, maxRow + 1, 1);
  const cells: GridCell[] = Array(rows * cols).fill(null);
  for (const p of placements) {
    const i = idx(p.row, p.col, cols);
    if (i >= 0 && i < cells.length && cells[i] == null) {
      cells[i] = { fieldId: p.fieldId, span: p.span };
    } else {
      // Out of range / collision → drop into the first free cell rather than
      // lose the field.
      const free = cells.findIndex((x) => x == null);
      if (free >= 0) {
        cells[free] = { fieldId: p.fieldId, span: clampSpan(p.span, cols - (free % cols)) };
      }
    }
  }
  return { ...base, rows, cells: normalize(cells, rows, cols) };
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
    (initialConfig.sections ?? []).map(toWork)
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Active drag: a field from a section grid (`from` = section index, `index` =
  // cell index) or from the unplaced pool (`from` = null).
  const [drag, setDrag] = useState<{
    fieldId: string;
    from: number | null;
    index: number | null;
  } | null>(null);
  const [dropAt, setDropAt] = useState<{ section: number; index: number } | null>(
    null
  );

  const nameById = new Map(fields.map((f) => [f.id, f.name]));
  const placed = new Set(
    sections
      .filter((s) => !s.widget)
      .flatMap((s) => s.cells.filter((c): c is NonNullable<GridCell> => c != null).map((c) => c.fieldId))
  );
  const unplaced = fields.filter((f) => !placed.has(f.id));

  function setSection(i: number, patch: Partial<WorkSection>) {
    setSections(sections.map((s, idxn) => (idxn === i ? { ...s, ...patch } : s)));
  }
  function moveSection(i: number, dir: -1 | 1) {
    const t = i + dir;
    if (t < 0 || t >= sections.length) return;
    const next = sections.slice();
    [next[i], next[t]] = [next[t], next[i]];
    setSections(next);
  }

  function setColumns(si: number, columns: 1 | 2 | 3 | 4) {
    const s = sections[si];
    const cells: GridCell[] = Array(s.rows * columns).fill(null);
    for (let r = 0; r < s.rows; r++) {
      for (let c = 0; c < s.columns; c++) {
        const cell = s.cells[idx(r, c, s.columns)];
        if (cell && c < columns) {
          cells[idx(r, c, columns)] = { ...cell, span: clampSpan(cell.span, columns - c) };
        }
        // Fields beyond the new width are unplaced (return to the pool).
      }
    }
    setSection(si, { columns, cells: normalize(cells, s.rows, columns) });
  }

  function addRow(si: number) {
    const s = sections[si];
    setSection(si, {
      rows: s.rows + 1,
      cells: [...s.cells, ...Array(s.columns).fill(null)],
    });
  }
  function removeLastRow(si: number) {
    const s = sections[si];
    if (s.rows <= 1) return;
    const lastRowStart = (s.rows - 1) * s.columns;
    const lastRowEmpty = s.cells.slice(lastRowStart).every((c) => c == null);
    if (!lastRowEmpty) return;
    setSection(si, { rows: s.rows - 1, cells: s.cells.slice(0, lastRowStart) });
  }

  function removeFieldAt(si: number, i: number) {
    const cells = sections[si].cells.slice();
    cells[i] = null;
    setSection(si, { cells });
  }
  function setSpanAt(si: number, i: number, span: number) {
    const s = sections[si];
    const cell = s.cells[i];
    if (!cell) return;
    const r = Math.floor(i / s.columns);
    const c = i % s.columns;
    const cells = s.cells.slice();
    cells[i] = { ...cell, span: clampSpan(span, maxSpanAt(cells, r, c, s.columns)) };
    setSection(si, { cells });
  }
  function addFieldToFirstFree(si: number, fieldId: string) {
    if (!fieldId) return;
    setSections((prev) =>
      prev.map((s, k) => {
        if (k !== si) return s;
        let cells = s.cells.slice();
        let rows = s.rows;
        let free = cells.findIndex((c) => c == null);
        if (free < 0) {
          // No free cell → grow by a row.
          cells = [...cells, ...Array(s.columns).fill(null)];
          rows += 1;
          free = (rows - 1) * s.columns;
        }
        cells[free] = { fieldId, span: 1 };
        return { ...s, rows, cells: normalize(cells, rows, s.columns) };
      })
    );
  }

  // The one move primitive: drop the active drag onto (targetSi, targetIdx).
  function dropOnCell(targetSi: number, targetIdx: number) {
    if (!drag) return;
    setSections((prev) => {
      const next = prev.map((s) => ({ ...s, cells: s.cells.slice() }));

      if (drag.from === null) {
        // From the pool: place into the target. Any occupant is displaced back
        // to the pool (simply overwritten). Nothing else moves.
        next[targetSi].cells[targetIdx] = { fieldId: drag.fieldId, span: 1 };
      } else {
        // Grid → grid: swap the two cells' contents (move-to-empty is a swap
        // with an empty cell). No other cell is touched.
        const srcCells = next[drag.from].cells;
        const dstCells = next[targetSi].cells;
        const srcContent = srcCells[drag.index!];
        const dstContent = dstCells[targetIdx];
        dstCells[targetIdx] = srcContent;
        srcCells[drag.index!] = dstContent;
      }

      // Re-clamp spans in the affected sections (positions may have changed).
      for (const si of new Set([targetSi, drag.from].filter((x) => x != null))) {
        const s = next[si as number];
        next[si as number] = {
          ...s,
          cells: normalize(s.cells, s.rows, s.columns),
        };
      }
      return next;
    });
    setDrag(null);
    setDropAt(null);
  }

  function addSection() {
    setSections([
      ...sections,
      { title: "New section", columns: 2, rows: 2, cells: Array(4).fill(null) },
    ]);
  }
  function removeSection(i: number) {
    setSections(sections.filter((_, idxn) => idxn !== i));
  }

  // Serialise to the save contract: field sections emit absolute-positioned
  // `items` (+ row-major `fieldIds` + explicit `rows`); widget sections keep
  // their shape.
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
      const items: LayoutItem[] = [];
      const fieldIds: string[] = [];
      for (let r = 0; r < s.rows; r++) {
        for (let c = 0; c < s.columns; c++) {
          const cell = s.cells[idx(r, c, s.columns)];
          if (!cell) continue;
          items.push({ fieldId: cell.fieldId, span: cell.span, row: r, col: c });
          fieldIds.push(cell.fieldId);
        }
      }
      return {
        title: s.title,
        columns: s.columns,
        rows: s.rows,
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
            Unplaced fields: drag one onto a cell below, or use “+ Add field”.
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {unplaced.map((f) => (
              <span
                key={f.id}
                draggable
                onDragStart={() =>
                  setDrag({ fieldId: f.id, from: null, index: null })
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
          const cols = section.columns;
          // Cells covered by a wider field to their left — not rendered as their
          // own droppable cell (they live "inside" the spanning field).
          const covered = new Set<number>();
          if (!isWidget) {
            for (let r = 0; r < section.rows; r++) {
              for (let c = 0; c < cols; c++) {
                const cell = section.cells[idx(r, c, cols)];
                if (cell) {
                  for (let cc = c + 1; cc < c + cell.span && cc < cols; cc++) {
                    covered.add(idx(r, cc, cols));
                  }
                }
              }
            }
          }
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
                    onChange={(e) => setSection(si, { hidden: e.target.checked })}
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
                  {/* WYSIWYG absolute grid: every (row, col) is a cell. Fields are
                      pinned to their position; drag onto an empty cell to move
                      (nothing else shifts) or onto a field to swap the two. */}
                  <div
                    data-testid={`grid-${si}`}
                    data-columns={cols}
                    data-rows={section.rows}
                    className="mt-3 grid gap-2"
                    style={{
                      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                      gridTemplateRows: `repeat(${section.rows}, minmax(2.5rem, auto))`,
                    }}
                  >
                    {Array.from({ length: section.rows * cols }, (_, i) => {
                      if (covered.has(i)) return null;
                      const r = Math.floor(i / cols);
                      const c = i % cols;
                      const cell = section.cells[i];
                      const isDropTarget =
                        dropAt?.section === si && dropAt.index === i;
                      const isDragging =
                        drag?.from === si && drag.index === i;
                      const span = cell ? clampSpan(cell.span, cols - c) : 1;
                      const cellStyle: CSSProperties = {
                        gridColumn: `${c + 1} / span ${span}`,
                        gridRowStart: r + 1,
                      };
                      const dropHandlers = {
                        onDragOver: (e: React.DragEvent) => {
                          if (!drag) return;
                          e.preventDefault();
                          e.stopPropagation();
                          setDropAt({ section: si, index: i });
                        },
                        onDrop: (e: React.DragEvent) => {
                          e.preventDefault();
                          e.stopPropagation();
                          dropOnCell(si, i);
                        },
                      };

                      if (!cell) {
                        // Empty cell — a precise drop target.
                        return (
                          <div
                            key={i}
                            {...dropHandlers}
                            style={cellStyle}
                            aria-label={`Empty cell row ${r + 1} column ${c + 1}`}
                            className={`flex items-center justify-center rounded-md border border-dashed text-xs text-[var(--muted-foreground)] ${
                              isDropTarget
                                ? "border-[var(--accent)] bg-[var(--accent)]/10 ring-2 ring-[var(--accent)]"
                                : "border-[var(--border)]"
                            }`}
                          >
                            <span className="italic opacity-70">empty</span>
                          </div>
                        );
                      }

                      const name = nameById.get(cell.fieldId);
                      const cellLabel = `Field ${name ?? cell.fieldId}`;
                      return (
                        <div
                          key={i}
                          draggable
                          onDragStart={(e) => {
                            e.stopPropagation();
                            setDrag({ fieldId: cell.fieldId, from: si, index: i });
                          }}
                          onDragEnd={() => {
                            setDrag(null);
                            setDropAt(null);
                          }}
                          {...dropHandlers}
                          style={cellStyle}
                          className={`flex cursor-grab items-center gap-2 rounded-md border bg-[var(--background)] px-2 py-1 text-sm ${
                            isDropTarget
                              ? "border-[var(--accent)] ring-2 ring-[var(--accent)]"
                              : "border-[var(--border)]"
                          } ${isDragging ? "opacity-40" : ""}`}
                          aria-label={cellLabel}
                        >
                          <span aria-hidden className="text-[var(--muted-foreground)]">
                            ⠿
                          </span>
                          <span className="flex-1 truncate">
                            {name ?? (
                              <span className="text-red-600">unknown field</span>
                            )}
                          </span>
                          {/* Width in columns, capped so it can't overlap the
                              next field in the row. */}
                          <label className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                            <span aria-hidden>w</span>
                            <select
                              className="rounded border border-[var(--border)] bg-[var(--background)] px-1 text-xs"
                              value={span}
                              onChange={(e) =>
                                setSpanAt(si, i, Number(e.target.value))
                              }
                              aria-label={`Width for ${cellLabel}`}
                            >
                              {Array.from(
                                { length: maxSpanAt(section.cells, r, c, cols) },
                                (_, n) => n + 1
                              ).map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            onClick={() => removeFieldAt(si, i)}
                            className="text-xs text-[var(--muted-foreground)] hover:text-red-600"
                            aria-label={`Remove ${cellLabel} from layout`}
                          >
                            remove
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {unplaced.length > 0 && (
                      <select
                        className={input}
                        value=""
                        onChange={(e) => addFieldToFirstFree(si, e.target.value)}
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
                      onClick={() => addRow(si)}
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                    >
                      Add row
                    </button>
                    <button
                      onClick={() => removeLastRow(si)}
                      disabled={
                        section.rows <= 1 ||
                        section.cells
                          .slice((section.rows - 1) * cols)
                          .some((c) => c != null)
                      }
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-40"
                    >
                      Remove last row
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
