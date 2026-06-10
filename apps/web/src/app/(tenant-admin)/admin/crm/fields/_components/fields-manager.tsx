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
  options?: { choices?: SelectChoice[] } | null;
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

/** Editor row: tracks whether the value was hand-edited so blank values
 * auto-derive from the label until the admin takes manual control. */
interface OptionDraft {
  label: string;
  value: string;
  valueTouched: boolean;
}

/** lowercase, non-alphanumeric → underscore, collapse repeats, trim edges. */
function slugifyValue(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Resolve the value a draft row should submit (explicit, else derived). */
function resolvedValue(d: OptionDraft): string {
  const v = d.value.trim();
  return v !== "" ? v : slugifyValue(d.label);
}

function emptyOption(): OptionDraft {
  return { label: "", value: "", valueTouched: false };
}

/** Shared rows-based options editor for select / multi_select fields.
 * Top-level (not nested in FieldsManager) so its identity is stable across
 * parent re-renders — otherwise React remounts it on each keystroke and the
 * input loses focus after one character. */
function OptionsEditor({
  options,
  setOptions,
  inputCls,
  busy,
}: {
  options: OptionDraft[];
  setOptions: (next: OptionDraft[]) => void;
  inputCls: string;
  busy: boolean;
}) {
  function update(i: number, patch: Partial<OptionDraft>) {
    setOptions(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }
  return (
    <div className="mt-3 rounded-md border border-[var(--border)] p-3">
      <p className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">
        Options
      </p>
      <div className="flex flex-col gap-2">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              aria-label={`Option ${i + 1} label`}
              placeholder="Label"
              className={`${inputCls} flex-1`}
              value={opt.label}
              onChange={(e) => update(i, { label: e.target.value })}
            />
            <input
              aria-label={`Option ${i + 1} value`}
              placeholder={
                opt.valueTouched || opt.value
                  ? "Value"
                  : slugifyValue(opt.label) || "value"
              }
              className={`${inputCls} flex-1 font-mono`}
              value={opt.value}
              onChange={(e) =>
                update(i, { value: e.target.value, valueTouched: true })
              }
            />
            <button
              type="button"
              onClick={() =>
                setOptions(
                  options.length > 1
                    ? options.filter((_, idx) => idx !== i)
                    : [emptyOption()]
                )
              }
              disabled={busy}
              aria-label={`Remove option ${i + 1}`}
              className="rounded border border-[var(--border)] px-2 py-1 text-xs text-red-600 disabled:opacity-30"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setOptions([...options, emptyOption()])}
        disabled={busy}
        className="mt-2 rounded-md border border-[var(--border)] px-2.5 py-1 text-xs disabled:opacity-50"
      >
        + Add option
      </button>
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
  const [addOptions, setAddOptions] = useState<OptionDraft[]>([emptyOption()]);
  // Per-field options editor state when editing an existing select field.
  const [editingOptionsFor, setEditingOptionsFor] = useState<string | null>(
    null
  );
  const [editOptions, setEditOptions] = useState<OptionDraft[]>([]);

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

  function buildChoices(drafts: OptionDraft[]): SelectChoice[] {
    return drafts
      .filter((d) => d.label.trim() !== "" || d.value.trim() !== "")
      .map((d) => ({ value: resolvedValue(d), label: d.label.trim() }))
      .filter((c) => c.value !== "");
  }

  async function addField() {
    const isSelect = SELECT_TYPES.has(form.fieldType);
    let optionsPayload: { choices: SelectChoice[] } | undefined;
    if (isSelect) {
      const choices = buildChoices(addOptions);
      if (choices.length === 0) {
        setError("Add at least one option for a select field.");
        return;
      }
      optionsPayload = { choices };
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
      setAddOptions([emptyOption()]);
      setAdding(false);
      refresh();
    }
  }

  async function saveEditOptions(id: string) {
    const choices = buildChoices(editOptions);
    if (choices.length === 0) {
      setError("Add at least one option for a select field.");
      return;
    }
    if (await call(`/api/admin/crm/fields/${id}`, "PATCH", {
      options: { choices },
    })) {
      setEditingOptionsFor(null);
      setEditOptions([]);
      refresh();
    }
  }

  function openEditOptions(f: FieldRow) {
    const existing = f.options?.choices ?? [];
    setEditOptions(
      existing.length > 0
        ? existing.map((c) => ({
            label: c.label,
            value: c.value,
            valueTouched: true,
          }))
        : [emptyOption()]
    );
    setEditingOptionsFor(f.id);
    setError(null);
  }

  async function patchField(id: string, body: Record<string, unknown>) {
    if (await call(`/api/admin/crm/fields/${id}`, "PATCH", body)) refresh();
  }

  async function deleteField(id: string) {
    if (await call(`/api/admin/crm/fields/${id}`, "DELETE")) refresh();
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
                options={addOptions}
                setOptions={setAddOptions}
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
                  <div className="flex items-center justify-end gap-3">
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
                      options={editOptions}
                      setOptions={setEditOptions}
                      inputCls={input}
                      busy={busy}
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        onClick={() => {
                          setEditingOptionsFor(null);
                          setEditOptions([]);
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
