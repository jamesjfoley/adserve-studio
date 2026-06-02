import { and, eq, inArray, or } from "drizzle-orm";
import {
  entityTypes,
  recordRelationships,
  records,
  schemaRelationships,
  type db,
} from "@adserve/database";
import { serializeRecord, type SerializedRecord } from "./serialize";

/**
 * A related record plus the relationship-edge metadata that connects it to
 * the anchor record. Carries the relationship's `name` slug, the raw junction
 * `metadata`, and the derived `isPrimary` flag so the detail tabs can order
 * primary-linked records first and distinguish relationship types (WS3 /
 * Condition 7). Extends `SerializedRecord` so existing consumers that only
 * read the record fields keep working.
 */
export interface RelatedRecord extends SerializedRecord {
  /** The `relationships.name` slug of the edge (e.g. "contact_belongs_to_account"). */
  relationshipName: string;
  /** Raw `record_relationships.metadata` JSONB for this edge. */
  metadata: Record<string, unknown>;
  /** Derived from `metadata.isPrimary === true` — the primary-link marker. */
  isPrimary: boolean;
}

export interface RecordWithRelationships {
  record: SerializedRecord;
  /** Related records grouped by their entity-type slug, with edge metadata. */
  relationships: Record<string, RelatedRecord[]>;
}

/**
 * Load a record plus its related records, grouped by the related entity
 * type's slug. Archived related records are kept (the soft-delete
 * decision) — callers/UI flag them via `isArchived`.
 *
 * Each related entry also carries the relationship-edge metadata
 * (`relationshipName`, `metadata`, `isPrimary`) so callers can sort
 * primary-first and distinguish relationship types (WS3 / Condition 7).
 *
 * Bounded query count regardless of how many records are related: the
 * record itself (1) + relationship rows joined to the relationship registry
 * for the `name` (1) + all related records in one `inArray` (1) + entity-type
 * slug lookup (1) = 4 queries. The relationship `name` is resolved by a JOIN
 * on the EXISTING rels SELECT — additive columns + a join, NOT a 5th
 * round-trip. It never fans out per relationship row.
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

  // Query 2: relationship edges touching this record. The relationship `name`
  // is resolved via an inner JOIN onto the `relationships` registry — this is
  // additional columns on the EXISTING edge query (one round-trip), keeping the
  // bounded count at 4 (no separate registry lookup).
  const rels = await tx
    .select({
      sourceRecordId: recordRelationships.sourceRecordId,
      targetRecordId: recordRelationships.targetRecordId,
      metadata: recordRelationships.metadata,
      relationshipId: recordRelationships.relationshipId,
      relationshipName: schemaRelationships.name,
    })
    .from(recordRelationships)
    .innerJoin(
      schemaRelationships,
      eq(recordRelationships.relationshipId, schemaRelationships.id)
    )
    .where(
      and(
        eq(recordRelationships.tenantId, tenantId),
        or(
          eq(recordRelationships.sourceRecordId, recordId),
          eq(recordRelationships.targetRecordId, recordId)
        )
      )
    );

  // Map each related record id → the edge metadata that connects it here.
  // A record could in principle be linked by more than one relationship; the
  // first edge wins for grouping/labelling (the detail UI groups by the
  // related record's entity type, not the edge type).
  const edgeByOtherId = new Map<
    string,
    { relationshipName: string; metadata: Record<string, unknown> }
  >();
  for (const r of rels) {
    const otherId =
      r.sourceRecordId === recordId ? r.targetRecordId : r.sourceRecordId;
    if (!edgeByOtherId.has(otherId)) {
      edgeByOtherId.set(otherId, {
        relationshipName: r.relationshipName,
        metadata: (r.metadata as Record<string, unknown>) ?? {},
      });
    }
  }

  const otherIds = Array.from(edgeByOtherId.keys());
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

  const relationships: Record<string, RelatedRecord[]> = {};
  for (const r of related) {
    const slug = slugById.get(r.entityTypeId) ?? "unknown";
    const edge = edgeByOtherId.get(r.id);
    const metadata = edge?.metadata ?? {};
    (relationships[slug] ??= []).push({
      ...serializeRecord(r),
      relationshipName: edge?.relationshipName ?? "",
      metadata,
      isPrimary: metadata.isPrimary === true,
    });
  }

  return { record: serializeRecord(record), relationships };
}
