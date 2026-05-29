import { and, eq, inArray, or } from "drizzle-orm";
import {
  entityTypes,
  recordRelationships,
  records,
  type db,
} from "@adserve/database";
import { serializeRecord, type SerializedRecord } from "./serialize";

export interface RecordWithRelationships {
  record: SerializedRecord;
  /** Related records grouped by their entity-type slug. */
  relationships: Record<string, SerializedRecord[]>;
}

/**
 * Load a record plus its related records, grouped by the related entity
 * type's slug. Archived related records are kept (the soft-delete
 * decision) — callers/UI flag them via `isArchived`.
 *
 * Bounded query count regardless of how many records are related: the
 * record itself (1) + relationship rows (1) + all related records in one
 * `inArray` (1) + entity-type slug lookup (1) = 4 queries. It never fans
 * out per relationship row.
 */
export async function loadRecordWithRelationships(
  tx: typeof db,
  args: { tenantId: string; entityTypeId: string; recordId: string }
): Promise<RecordWithRelationships | null> {
  const { tenantId, entityTypeId, recordId } = args;

  const [record] = await tx
    .select()
    .from(records)
    .where(
      and(
        eq(records.id, recordId),
        eq(records.tenantId, tenantId),
        eq(records.entityTypeId, entityTypeId)
      )
    );
  if (!record) return null;

  const rels = await tx
    .select({
      sourceRecordId: recordRelationships.sourceRecordId,
      targetRecordId: recordRelationships.targetRecordId,
    })
    .from(recordRelationships)
    .where(
      and(
        eq(recordRelationships.tenantId, tenantId),
        or(
          eq(recordRelationships.sourceRecordId, recordId),
          eq(recordRelationships.targetRecordId, recordId)
        )
      )
    );

  const otherIds = Array.from(
    new Set(
      rels.map((r) =>
        r.sourceRecordId === recordId ? r.targetRecordId : r.sourceRecordId
      )
    )
  );
  if (otherIds.length === 0) {
    return { record: serializeRecord(record), relationships: {} };
  }

  const related = await tx
    .select()
    .from(records)
    .where(and(eq(records.tenantId, tenantId), inArray(records.id, otherIds)));

  const typeIds = Array.from(new Set(related.map((r) => r.entityTypeId)));
  const types = typeIds.length
    ? await tx
        .select({ id: entityTypes.id, slug: entityTypes.slug })
        .from(entityTypes)
        .where(
          and(
            eq(entityTypes.tenantId, tenantId),
            inArray(entityTypes.id, typeIds)
          )
        )
    : [];
  const slugById = new Map(types.map((t) => [t.id, t.slug]));

  const relationships: Record<string, SerializedRecord[]> = {};
  for (const r of related) {
    const slug = slugById.get(r.entityTypeId) ?? "unknown";
    (relationships[slug] ??= []).push(serializeRecord(r));
  }

  return { record: serializeRecord(record), relationships };
}
