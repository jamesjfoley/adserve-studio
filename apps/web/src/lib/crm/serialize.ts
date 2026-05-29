import type { RecordRow } from "@adserve/module-framework";

/**
 * The wire shape for a record. `id` / `data` / `isArchived` match the
 * `DynamicTableRecord` prop the table consumes; timestamps + ownedBy are
 * extra context the table ignores but detail pages use.
 */
export interface SerializedRecord {
  id: string;
  data: Record<string, unknown>;
  isArchived: boolean;
  ownedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export function serializeRecord(row: RecordRow): SerializedRecord {
  return {
    id: row.id,
    data: (row.data as Record<string, unknown>) ?? {},
    isArchived: row.isArchived,
    ownedBy: row.ownedBy ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
