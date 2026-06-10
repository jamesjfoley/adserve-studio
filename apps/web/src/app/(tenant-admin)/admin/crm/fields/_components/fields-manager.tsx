"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface SelectChoice {
  value: string;
  label: string;
}

interface FieldRow {
  id: string;
  name: string;
  slug: string;
  fieldType: string;
  isRequired: boolean;
  isFilterable: boolean;
  isSystem: boolean;
  description: string;
  // Present only when the page passes it through. Used to pre-populate the
  // options editor when editing an existing select / multi_select field.
  options?: {
    choices?: SelectChoice[];
    /** When true the choices are kept in alphabetical order. */
    sortAlphabetical?: boolean;
  } | null;
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

const SELECT_TYPES = new Set(["select", "multi_select"]);

/**
 * Turn the options textarea (one option per line) into stored choices. There's
 * no separate label/value — each line IS the option (value === label). Blank
 * lines are dropped, leading/trailing whitespace trimmed, duplicates removed
 * (first wins). When `sortAlpha` is set the choices are returned A→Z.
 */
function choicesFromText(text: string, sortAlpha: boolean): SelectChoice[] {
  const seen = new Set<string>();
  const choices: SelectChoice[] = [];
  for (const raw of text.split("\n")) {
    const v = raw.trim();
    if (v === "" || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    choices.push({ value: v, label: v });
  }
  if (sortAlpha) {
    choices.sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
    );
  }
  return choices;
}

/** Existing choices → textarea text (one option per line, label preferred). */
function textFromChoices(choices: SelectChoice[]): string {
  return choices.map((c) => c.label || c.value).join("\n");
}

/** Shared text-based options editor for select / multi_select fields. One
 * option per line — no separate label/value. Top-level (not nested in
 * FieldsManager) so its identity is stable across parent re-renders — otherwise
 * React remounts it on each keystroke and the textarea loses focus. */
function OptionsEditor({
  text,
  setText,
  sortAlpha,
  setSortAlpha,
  inputCls,
  busy,
}: {
  text: string;
  setText: (next: string) => void;
  sortAlpha: boolean;
  setSortAlpha: (next: boolean) => void;
  inputCls: string;
  busy: boolean;
}) {
  const lineCount = text === "" ? 0 : text.split("\n").length;
  // Compact: grow with content (one line per option), bounded so a long list
  // scrolls rather than dominating the page.
  const rows = Math.min(20, Math.max(4, lineCount + 1));
  return (
    <div className="mt-3 rounded-md border border-[var(--border)] p-3">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs font-medium text-[var(--muted-foreground)]">
          Options — one per line
        </p>
        <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
          <input
            type="checkbox"
            checked={sortAlpha}
            disabled={busy}
            onChange={(e) => setSortAlpha(e.target.checked)}
          />
          Sort alphabetically
        </label>
      </div>
      <textarea
        aria-label="Options (one per line)"
        placeholder={"gold\nsilver\nbronze"}
        className={`${inputCls} w-full resize-y font-normal`}
        rows={rows}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
        {sortAlpha
          ? "Displayed in alphabetical order."
          : "Displayed in the order entered."}
      </p>
    </div>
  );
}

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
  // Options editor state for the add form (used when type is select/multi_select).
  const [addOptionsText, setAddOptionsText] = useState("");
  const [addSortAlpha, setAddSortAlpha] = useState(false);
  // Per-field options editor state when editing an existing select field.
  const [editingOptionsFor, setEditingOptionsFor] = useState<string | null>(
    null
  );
  const [editOptionsText, setEditOptionsText] = useState("");
  const [editSortAlpha, setEditSortAlpha] = useState(false);
  // Inline rename (display name/label) — available for ANY field, system or not.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

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
    const isSelect = SELECT_TYPES.has(form.fieldType);
    let optionsPayload:
      | { choices: SelectChoice[]; sortAlphabetical: boolean }
      | undefined;
    if (isSelect) {
      const choices = choicesFromText(addOptionsText, addSortAlpha);
      if (choices.length === 0) {
        setError("Add at least one option for a select field.");
        return;
      }
      optionsPayload = { choices, sortAlphabetical: addSortAlpha };
    }

    const ok = await call("/api/admin/crm/fields", "POST", {
      entityType,
      ...form,
      ...(optionsPayload ? { options: optionsPayload } : {}),
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
      setAddOptionsText("");
      setAddSortAlpha(false);
      setAdding(false);
      refresh();
    }
  }

  async function saveEditOptions(id: string) {
    const choices = choicesFromText(editOptionsText, editSortAlpha);
    if (choices.length === 0) {
      setError("Add at least one option for a select field.");
      return;
    }
    if (await call(`/api/admin/crm/fields/${id}`, "PATCH", {
      options: { choices, sortAlphabetical: editSortAlpha },
    })) {
      setEditingOptionsFor(null);
      setEditOptionsText("");
      setEditSortAlpha(false);
      refresh();
    }
  }

  function openEditOptions(f: FieldRow) {
    const existing = f.options?.choices ?? [];
    setEditOptionsText(textFromChoices(existing));
    setEditSortAlpha(Boolean(f.options?.sortAlphabetical));
    setEditingOptionsFor(f.id);
    setError(null);
  }

  async function patchField(id: string, body: Record<string, unknown>) {
    if (await call(`/api/admin/crm/fields/${id}`, "PATCH", body)) refresh();
  }

  async function deleteField(id: string) {
    if (await call(`/api/admin/crm/fields/${id}`, "DELETE")) refresh();
  }

  function startRename(f: FieldRow) {
    setRenamingId(f.id);
    setRenameDraft(f.name);
    setError(null);
  }
  function cancelRename() {
    setRenamingId(null);
    setRenameDraft("");
  }
  async function saveRename(id: string) {
    const name = renameDraft.trim();
    if (name === "") {
      setError("Field name cannot be empty.");
      return;
    }
    // Send both `name` and `labels.en` so the visible label updates everywhere
    // (forms, tables) — the slug (data key) is intentionally NOT changed.
    if (
      await call(`/api/admin/crm/fields/${id}`, "PATCH", {
        name,
        labels: { en: name },
      })
    ) {
      cancelRename();
      refresh();
    }
  }

  // Display copy sorted by Name (case-insensitive, A→Z). We sort a copy so the
  // source `fields` order is left untouched for any other consumers; reorder
  // operates on this displayed order.
  const sortedFields = [...fields].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= sortedFields.length) return;
    const ids = sortedFields.map((f) => f.id);
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
            {SELECT_TYPES.has(form.fieldType) && (
              <OptionsEditor
                text={addOptionsText}
                setText={setAddOptionsText}
                sortAlpha={addSortAlpha}
                setSortAlpha={setAddSortAlpha}
                inputCls={input}
                busy={busy}
              />
            )}
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
                  className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  Add field
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
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
            {sortedFields.map((f, i) => (
              <Fragment key={f.id}>
              <tr>
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
                      disabled={i === sortedFields.length - 1 || busy}
                      className="rounded border border-[var(--border)] px-1.5 disabled:opacity-30"
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                  </div>
                </td>
                <td className="px-3 py-2 font-medium">
                  {renamingId === f.id ? (
                    <span className="flex items-center gap-2">
                      <input
                        autoFocus
                        aria-label={`Rename ${f.name}`}
                        className={`${input} w-44`}
                        value={renameDraft}
                        disabled={busy}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveRename(f.id);
                          if (e.key === "Escape") cancelRename();
                        }}
                      />
                      <button
                        onClick={() => saveRename(f.id)}
                        disabled={busy}
                        className="text-xs text-[var(--accent)] hover:underline disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelRename}
                        disabled={busy}
                        className="text-xs text-[var(--muted-foreground)] hover:underline disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <>
                      {f.name}
                      {f.isSystem && (
                        <span className="ml-2 rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
                          system
                        </span>
                      )}
                    </>
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
                  <div className="flex items-center justify-end gap-3">
                    {renamingId !== f.id && (
                      <button
                        onClick={() => startRename(f)}
                        disabled={busy}
                        className="text-xs text-[var(--accent)] hover:underline disabled:opacity-50"
                      >
                        Rename
                      </button>
                    )}
                    {SELECT_TYPES.has(f.fieldType) && (
                      <button
                        onClick={() =>
                          editingOptionsFor === f.id
                            ? setEditingOptionsFor(null)
                            : openEditOptions(f)
                        }
                        disabled={busy}
                        className="text-xs text-[var(--accent)] hover:underline disabled:opacity-50"
                      >
                        {editingOptionsFor === f.id ? "Close" : "Options"}
                      </button>
                    )}
                    {!f.isSystem && (
                      <button
                        onClick={() => deleteField(f.id)}
                        disabled={busy}
                        className="text-xs text-red-600 hover:underline disabled:opacity-50"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              {editingOptionsFor === f.id && (
                <tr>
                  <td colSpan={7} className="px-3 pb-3">
                    <OptionsEditor
                      text={editOptionsText}
                      setText={setEditOptionsText}
                      sortAlpha={editSortAlpha}
                      setSortAlpha={setEditSortAlpha}
                      inputCls={input}
                      busy={busy}
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        onClick={() => {
                          setEditingOptionsFor(null);
                          setEditOptionsText("");
                          setEditSortAlpha(false);
                        }}
                        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => saveEditOptions(f.id)}
                        disabled={busy}
                        className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                      >
                        Save options
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
