"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CollapsiblePanel } from "@/components/ui/collapsible-panel";
import {
  MAX_ATTACHMENT_DATAURL_CHARS,
  sortNotesNewestFirst,
  type NoteItem,
  type NoteType,
} from "@/lib/crm/notes";

/**
 * Notes & Attachments panel for a CRM record (Account / Contact).
 *
 * A collapsible widget — mirroring the Audit History panel — that lists the
 * notes, web-links and small file attachments hung off a record's
 * `data.notesAttachments` array (see @/lib/crm/notes). Users with edit rights
 * can add a note, a link or an attachment, and edit / delete existing items.
 *
 * Backed by `/api/crm/{entitySegment}/{recordId}/notes` (the lead owns the
 * route). Every mutation returns the full `{ items }` set, so we adopt that
 * response directly rather than re-fetching — keeping the table in lock-step
 * with the server's ordering / stamping without an extra round-trip.
 *
 * Token-driven throughout (Panel + CSS vars), matching the DynamicTable header
 * band + zebra + hover used across the CRM tables. No raw hex, no new deps.
 */

interface NotesAttachmentsPanelProps {
  /** Collection segment for the record (e.g. "accounts", "contacts"). */
  entitySegment: string;
  recordId: string;
  /** Whether the current user may add / edit / delete items. */
  canEdit: boolean;
  /** Panel heading (count is appended). Defaults to "Notes & Attachments". */
  title?: string;
}

const TYPE_LABEL: Record<NoteType, string> = {
  note: "Note",
  link: "Link",
  attachment: "Attachment",
};

const EMPTY = "—";

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Human-readable size from a byte count (best-effort, prototype). */
function formatBytes(bytes?: number): string {
  if (bytes == null || Number.isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\/\S+/i.test(value.trim());
}

/** Shared icon-button (edit / delete) styling. */
const iconBtnClass =
  "rounded-md px-1.5 py-1 text-sm leading-none text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

/** Header "+ Add …" button styling. */
const addBtnClass =
  "rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

const fieldClass =
  "mt-1 w-full rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-sm";

const primaryBtnClass =
  "rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:brightness-95 disabled:opacity-50";

const ghostBtnClass =
  "rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2 text-sm font-medium hover:bg-[var(--muted)] disabled:opacity-50";

const destructiveBtnClass =
  "rounded-md border border-red-300 bg-[var(--panel-bg)] px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50";

/** What the active modal is doing. */
type ModalKind =
  | { kind: "add"; type: NoteType }
  | { kind: "edit"; item: NoteItem }
  | { kind: "delete"; item: NoteItem }
  | null;

interface DetailsCellProps {
  item: NoteItem;
}

/** The "Details" column — varies by item type. */
function DetailsCell({ item }: DetailsCellProps) {
  if (item.type === "link") {
    if (!item.url) return <span className="text-[var(--muted-foreground)]">{EMPTY}</span>;
    return (
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[var(--accent)] hover:underline break-all"
      >
        {item.url}
      </a>
    );
  }
  if (item.type === "attachment") {
    if (!item.url) return <span className="text-[var(--muted-foreground)]">{EMPTY}</span>;
    const size = formatBytes(item.fileSize);
    const label = item.fileName ?? item.name;
    return (
      <a
        href={item.url}
        download={item.fileName ?? item.name}
        className="text-[var(--accent)] hover:underline break-all"
      >
        {label}
        {size ? ` (${size})` : ""}
      </a>
    );
  }
  // note
  return item.body ? (
    <span className="whitespace-pre-wrap">{item.body}</span>
  ) : (
    <span className="text-[var(--muted-foreground)]">{EMPTY}</span>
  );
}

export function NotesAttachmentsPanel({
  entitySegment,
  recordId,
  canEdit,
  title = "Notes & Attachments",
}: NotesAttachmentsPanelProps) {
  const [items, setItems] = useState<NoteItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);

  const endpoint = `/api/crm/${entitySegment}/${recordId}/notes`;

  // Initial load.
  useEffect(() => {
    let active = true;
    setError(null);
    setItems(null);
    fetch(endpoint)
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          items?: NoteItem[];
          error?: string;
        };
        if (!active) return;
        if (!res.ok) {
          setError(body.error ?? `Failed to load notes (${res.status})`);
          return;
        }
        setItems(body.items ?? []);
      })
      .catch(() => {
        if (active) setError("Network error while loading notes.");
      });
    return () => {
      active = false;
    };
  }, [endpoint]);

  // A single helper for every mutation. Adopts the returned `{ items }` set.
  // Returns an error string on failure, or null on success.
  const mutate = useCallback(
    async (init: RequestInit): Promise<string | null> => {
      try {
        const res = await fetch(endpoint, {
          headers: { "Content-Type": "application/json" },
          ...init,
        });
        const body = (await res.json().catch(() => ({}))) as {
          items?: NoteItem[];
          error?: string;
        };
        if (!res.ok) {
          return body.error ?? `Request failed (${res.status})`;
        }
        setItems(body.items ?? []);
        return null;
      } catch {
        return "Network error. Please try again.";
      }
    },
    [endpoint]
  );

  const sorted = useMemo(
    () => (items == null ? [] : sortNotesNewestFirst(items)),
    [items]
  );
  const count = items?.length ?? 0;

  const cellClass = "px-3 py-1.5 text-xs align-top leading-tight";
  const headClass = "px-3 py-1.5 text-left text-[11px] font-medium";

  const headerActions = canEdit ? (
    <>
      <button
        type="button"
        className={addBtnClass}
        onClick={() => setModal({ kind: "add", type: "note" })}
      >
        + Add Note
      </button>
      <button
        type="button"
        className={addBtnClass}
        onClick={() => setModal({ kind: "add", type: "attachment" })}
      >
        + Add Attachment
      </button>
      <button
        type="button"
        className={addBtnClass}
        onClick={() => setModal({ kind: "add", type: "link" })}
      >
        + Add Link
      </button>
    </>
  ) : null;

  return (
    <>
      <CollapsiblePanel
        as="section"
        aria-label={title}
        title={`${title} (${count})`}
        actions={headerActions}
        collapsible
        defaultOpen
      >
        {error ? (
          <p className="mt-1 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : items == null ? (
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            No notes or attachments yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-xs">
              <thead className="border-b border-[var(--border)] bg-[var(--table-header-bg)] text-left text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr>
                  {canEdit ? <th className={headClass}>Actions</th> : null}
                  <th className={headClass}>Type</th>
                  <th className={headClass}>Name</th>
                  <th className={headClass}>Details</th>
                  <th className={headClass}>Added by</th>
                  <th className={headClass}>Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {sorted.map((item) => (
                  <tr
                    key={item.id}
                    className="even:bg-[var(--row-alt)] hover:bg-[var(--row-hover)]"
                  >
                    {canEdit ? (
                      <td className={`${cellClass} whitespace-nowrap`}>
                        <button
                          type="button"
                          aria-label={`Edit ${item.name}`}
                          title="Edit"
                          className={iconBtnClass}
                          onClick={() => setModal({ kind: "edit", item })}
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${item.name}`}
                          title="Delete"
                          className={`${iconBtnClass} hover:text-red-600`}
                          onClick={() => setModal({ kind: "delete", item })}
                        >
                          🗑
                        </button>
                      </td>
                    ) : null}
                    <td className={`${cellClass} whitespace-nowrap`}>
                      {TYPE_LABEL[item.type]}
                    </td>
                    <td className={`${cellClass} font-medium`}>{item.name}</td>
                    <td className={`${cellClass} max-w-xs`}>
                      <DetailsCell item={item} />
                    </td>
                    <td className={`${cellClass} whitespace-nowrap`}>
                      {item.addedByName}
                    </td>
                    <td className={`${cellClass} whitespace-nowrap`}>
                      {formatTimestamp(item.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsiblePanel>

      {modal?.kind === "add" ? (
        <AddModal
          type={modal.type}
          onClose={() => setModal(null)}
          mutate={mutate}
        />
      ) : null}
      {modal?.kind === "edit" ? (
        <EditModal
          item={modal.item}
          onClose={() => setModal(null)}
          mutate={mutate}
        />
      ) : null}
      {modal?.kind === "delete" ? (
        <DeleteModal
          item={modal.item}
          onClose={() => setModal(null)}
          mutate={mutate}
        />
      ) : null}
    </>
  );
}

type Mutate = (init: RequestInit) => Promise<string | null>;

/* --------------------------------------------------------------------------
 * Modal shell — overlay + focus management (prototype-grade focus trap).
 * ------------------------------------------------------------------------ */

interface ModalShellProps {
  heading: string;
  onClose: () => void;
  children: ReactNode;
}

function ModalShell({ heading, onClose, children }: ModalShellProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Move focus into the dialog on open; restore on close. Close on Escape.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    const focusable = node?.querySelector<HTMLElement>(
      'input, textarea, select, button, a[href], [tabindex]:not([tabindex="-1"])'
    );
    focusable?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = Array.from(
        node.querySelectorAll<HTMLElement>(
          'input, textarea, select, button, a[href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute("disabled"));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  // Portal to <body>: this panel is rendered as a widget INSIDE the record's
  // DynamicForm <form>, and the modal contains its own <form>. A nested <form>
  // is invalid HTML — the browser drops the inner form, so the modal's submit
  // never fires (notes appeared to "not save"). Portaling escapes the parent
  // form so the modal's form submits normally.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl bg-[var(--panel-bg)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2
            id={titleId}
            className="text-lg font-semibold tracking-tight text-[var(--foreground)]"
          >
            {heading}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

/* --------------------------------------------------------------------------
 * Add modal — Note / Link / Attachment variants.
 * ------------------------------------------------------------------------ */

interface AddModalProps {
  type: NoteType;
  onClose: () => void;
  mutate: Mutate;
}

function AddModal({ type, onClose, mutate }: AddModalProps) {
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const heading =
    type === "note"
      ? "Add Note"
      : type === "link"
        ? "Add Link"
        : "Add Attachment";

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFormError(null);
    const file = e.target.files?.[0];
    if (!file) {
      setDataUrl(null);
      setFileName(null);
      setFileSize(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (result.length > MAX_ATTACHMENT_DATAURL_CHARS) {
        setFormError(
          "That file is too large for a prototype attachment (max ~500KB). Please choose a smaller file."
        );
        setDataUrl(null);
        setFileName(null);
        setFileSize(null);
        return;
      }
      setDataUrl(result);
      setFileName(file.name);
      setFileSize(file.size);
      // Default the display name to the file name if the user hasn't typed one.
      setName((prev) => (prev.trim() === "" ? file.name : prev));
    };
    reader.onerror = () => setFormError("Could not read that file.");
    reader.readAsDataURL(file);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (name.trim() === "") {
      setFormError(
        type === "link" ? "A label is required." : "A title is required."
      );
      return;
    }

    let payload: Record<string, unknown>;
    if (type === "note") {
      payload = { type: "note", name: name.trim(), body: body.trim() || undefined };
    } else if (type === "link") {
      if (!looksLikeUrl(url)) {
        setFormError("Enter a valid URL starting with http:// or https://.");
        return;
      }
      payload = { type: "link", name: name.trim(), url: url.trim() };
    } else {
      if (!dataUrl) {
        setFormError("Choose a file to attach.");
        return;
      }
      payload = {
        type: "attachment",
        name: name.trim(),
        url: dataUrl,
        fileName: fileName ?? name.trim(),
        fileSize: fileSize ?? undefined,
      };
    }

    setBusy(true);
    const err = await mutate({ method: "POST", body: JSON.stringify(payload) });
    setBusy(false);
    if (err) {
      setFormError(err);
      return;
    }
    onClose();
  }

  return (
    <ModalShell heading={heading} onClose={onClose}>
      <form className="mt-4 space-y-3" onSubmit={onSubmit}>
        <label className="block text-sm">
          <span className="font-medium">
            {type === "link" ? "Label" : "Title"}{" "}
            <span className="text-red-600">*</span>
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={fieldClass}
          />
        </label>

        {type === "note" ? (
          <label className="block text-sm">
            <span className="font-medium">Description</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className={fieldClass}
            />
          </label>
        ) : null}

        {type === "link" ? (
          <label className="block text-sm">
            <span className="font-medium">
              URL <span className="text-red-600">*</span>
            </span>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              className={fieldClass}
            />
          </label>
        ) : null}

        {type === "attachment" ? (
          <div className="space-y-2">
            <label className="block text-sm">
              <span className="font-medium">
                File <span className="text-red-600">*</span>
              </span>
              <input
                type="file"
                onChange={onFileChange}
                className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border file:border-[var(--border)] file:bg-[var(--panel-bg)] file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-[var(--muted)]"
              />
            </label>
            {fileName ? (
              <p className="text-xs text-[var(--muted-foreground)]">
                {fileName}
                {fileSize != null ? ` (${formatBytes(fileSize)})` : ""}
              </p>
            ) : (
              <p className="text-xs text-[var(--muted-foreground)]">
                Small files only (max ~500KB for this prototype).
              </p>
            )}
          </div>
        ) : null}

        {formError ? (
          <p className="text-sm text-red-600" role="alert">
            {formError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className={ghostBtnClass}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" className={primaryBtnClass} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/* --------------------------------------------------------------------------
 * Edit modal — name always; body for notes; url for links.
 * ------------------------------------------------------------------------ */

interface EditModalProps {
  item: NoteItem;
  onClose: () => void;
  mutate: Mutate;
}

function EditModal({ item, onClose, mutate }: EditModalProps) {
  const [name, setName] = useState(item.name);
  const [body, setBody] = useState(item.body ?? "");
  const [url, setUrl] = useState(item.url ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (name.trim() === "") {
      setFormError(
        item.type === "link" ? "A label is required." : "A title is required."
      );
      return;
    }

    const payload: Record<string, unknown> = { id: item.id, name: name.trim() };
    if (item.type === "note") {
      payload.body = body.trim();
    } else if (item.type === "link") {
      if (!looksLikeUrl(url)) {
        setFormError("Enter a valid URL starting with http:// or https://.");
        return;
      }
      payload.url = url.trim();
    }

    setBusy(true);
    const err = await mutate({ method: "PATCH", body: JSON.stringify(payload) });
    setBusy(false);
    if (err) {
      setFormError(err);
      return;
    }
    onClose();
  }

  return (
    <ModalShell heading={`Edit ${TYPE_LABEL[item.type]}`} onClose={onClose}>
      <form className="mt-4 space-y-3" onSubmit={onSubmit}>
        <label className="block text-sm">
          <span className="font-medium">
            {item.type === "link" ? "Label" : "Name"}{" "}
            <span className="text-red-600">*</span>
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={fieldClass}
          />
        </label>

        {item.type === "note" ? (
          <label className="block text-sm">
            <span className="font-medium">Description</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className={fieldClass}
            />
          </label>
        ) : null}

        {item.type === "link" ? (
          <label className="block text-sm">
            <span className="font-medium">
              URL <span className="text-red-600">*</span>
            </span>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className={fieldClass}
            />
          </label>
        ) : null}

        {item.type === "attachment" ? (
          <p className="text-xs text-[var(--muted-foreground)]">
            The file itself can&apos;t be changed — only its display name. To
            replace the file, delete this attachment and add a new one.
          </p>
        ) : null}

        {formError ? (
          <p className="text-sm text-red-600" role="alert">
            {formError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className={ghostBtnClass}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" className={primaryBtnClass} disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/* --------------------------------------------------------------------------
 * Delete modal — confirm, then DELETE { id }.
 * ------------------------------------------------------------------------ */

interface DeleteModalProps {
  item: NoteItem;
  onClose: () => void;
  mutate: Mutate;
}

function DeleteModal({ item, onClose, mutate }: DeleteModalProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onConfirm() {
    setFormError(null);
    setBusy(true);
    const err = await mutate({
      method: "DELETE",
      body: JSON.stringify({ id: item.id }),
    });
    setBusy(false);
    if (err) {
      setFormError(err);
      return;
    }
    onClose();
  }

  return (
    <ModalShell heading={`Delete ${TYPE_LABEL[item.type]}`} onClose={onClose}>
      <p className="mt-4 text-sm text-[var(--foreground)]">
        Delete <span className="font-medium">{item.name}</span>? This
        can&apos;t be undone.
      </p>
      {formError ? (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {formError}
        </p>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className={ghostBtnClass}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={destructiveBtnClass}
          disabled={busy}
        >
          {busy ? "Deleting…" : "Delete"}
        </button>
      </div>
    </ModalShell>
  );
}
