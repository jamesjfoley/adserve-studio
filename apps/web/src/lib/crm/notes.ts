/**
 * Notes & Attachments — notes, web-links and (small) file attachments associated
 * with a CRM record (Account / Contact).
 *
 * Storage: a `notesAttachments` array on the record's `records.data` JSONB. This
 * deliberately avoids a new table + RLS policy (a standing human gate) — the
 * items inherit the record's tenant isolation. Attachments are stored as capped
 * data URLs (prototype only — production should use object storage + a
 * dedicated table; see the SPEC).
 */

export type NoteType = "note" | "link" | "attachment";

export interface NoteItem {
  id: string;
  type: NoteType;
  /** Title (note) / link label / file display name. */
  name: string;
  /** Note description (note type). */
  body?: string;
  /** Web-link URL (link) or attachment data URL (attachment). */
  url?: string;
  /** Original file name + size (attachment). */
  fileName?: string;
  fileSize?: number;
  addedById: string;
  addedByName: string;
  createdAt: string; // ISO
  updatedAt?: string; // ISO
}

export const NOTE_TYPES: readonly NoteType[] = ["note", "link", "attachment"];

/** Cap a base64 data URL to ~500KB of decoded bytes (prototype guard). */
export const MAX_ATTACHMENT_DATAURL_CHARS = 700_000;

/** Read the notes array off a record's data, defensively. */
export function readNoteItems(data: unknown): NoteItem[] {
  const arr = (data as { notesAttachments?: unknown } | null)?.notesAttachments;
  return Array.isArray(arr) ? (arr as NoteItem[]) : [];
}

/** Newest-first ordering for display. */
export function sortNotesNewestFirst(items: NoteItem[]): NoteItem[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
