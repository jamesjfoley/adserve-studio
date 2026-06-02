import { and, eq, ne, sql } from "drizzle-orm";
import {
  recordRelationships,
  schemaRelationships,
  type db,
} from "@adserve/database";
import { writeAuditLog } from "./audit";

/**
 * Shared record-to-record link writer used by the WS2 link/unlink route and
 * the WS3 combined contact-create-with-accounts endpoint, so both apply the
 * SAME relationship semantics inside the caller's `withTenant` transaction:
 *
 *  - cardinality guard: a `many_to_one` source replaces any existing link of
 *    that relationship for that source (replace semantics),
 *  - single-primary invariant: setting `isPrimary` first clears it on every
 *    sibling link for the same (relationshipId, source), then sets it here
 *    (read-modify-write, racy under concurrent writers — accepted for v1),
 *  - idempotent insert on the unique (relationshipId, source, target) index,
 *  - an `action: "link"` audit row for the edge.
 *
 * It does NOT validate the target's existence or tenant — callers MUST resolve
 * the target record under their own `withTenant` context first (a cross-tenant
 * target returns zero rows under RLS and must be rejected before calling this).
 *
 * Returns the link id and whether a new row was created (vs. an idempotent
 * update of an existing link).
 */
export interface CreateLinkArgs {
  tenantId: string;
  userId: string | null;
  /** The resolved schema-relationship row. */
  relationship: {
    id: string;
    name: string;
    relationshipType: string;
  };
  sourceRecordId: string;
  targetRecordId: string;
  isPrimary?: boolean;
}

export interface CreateLinkResult {
  linkId: string;
  isNew: boolean;
}

export async function createRecordLink(
  tx: typeof db,
  args: CreateLinkArgs
): Promise<CreateLinkResult> {
  const {
    tenantId,
    userId,
    relationship,
    sourceRecordId,
    targetRecordId,
    isPrimary = false,
  } = args;

  // Distinguish a brand-new link (201) from an idempotent update (200).
  const [existingLink] = await tx
    .select({ id: recordRelationships.id })
    .from(recordRelationships)
    .where(
      and(
        eq(recordRelationships.tenantId, tenantId),
        eq(recordRelationships.relationshipId, relationship.id),
        eq(recordRelationships.sourceRecordId, sourceRecordId),
        eq(recordRelationships.targetRecordId, targetRecordId)
      )
    );

  // Cardinality guard: many_to_one means one target per source — replace any
  // existing link of this relationship for this source (except the one we're
  // about to (re)create) inside the same tx.
  if (relationship.relationshipType === "many_to_one") {
    await tx
      .delete(recordRelationships)
      .where(
        and(
          eq(recordRelationships.tenantId, tenantId),
          eq(recordRelationships.relationshipId, relationship.id),
          eq(recordRelationships.sourceRecordId, sourceRecordId),
          ne(recordRelationships.targetRecordId, targetRecordId)
        )
      );
  }

  // Single-primary invariant: clear isPrimary on ALL sibling links for the
  // same (relationshipId, source) before setting it on the target link.
  if (isPrimary) {
    await tx
      .update(recordRelationships)
      .set({ metadata: sql`${recordRelationships.metadata} - 'isPrimary'` })
      .where(
        and(
          eq(recordRelationships.tenantId, tenantId),
          eq(recordRelationships.relationshipId, relationship.id),
          eq(recordRelationships.sourceRecordId, sourceRecordId)
        )
      );
  }

  const metadata = isPrimary ? { isPrimary: true } : {};

  const inserted = await tx
    .insert(recordRelationships)
    .values({
      tenantId,
      relationshipId: relationship.id,
      sourceRecordId,
      targetRecordId,
      metadata,
    })
    .onConflictDoUpdate({
      target: [
        recordRelationships.relationshipId,
        recordRelationships.sourceRecordId,
        recordRelationships.targetRecordId,
      ],
      set: { metadata },
    })
    .returning({ id: recordRelationships.id });

  const [link] = inserted;

  await writeAuditLog(tx, {
    tenantId,
    userId,
    action: "link",
    resourceType: "relationship",
    resourceId: link.id,
    changes: {
      relationshipName: relationship.name,
      sourceRecordId,
      targetRecordId,
      isPrimary,
    },
  });

  return { linkId: link.id, isNew: !existingLink };
}

/**
 * Resolve a tenant's schema-relationship row by `name`, returning the fields
 * `createRecordLink` needs. Returns null when the relationship is not
 * activated for the tenant.
 */
export async function resolveRelationshipByName(
  tx: typeof db,
  tenantId: string,
  name: string
): Promise<{
  id: string;
  name: string;
  relationshipType: string;
  sourceEntityTypeId: string;
  targetEntityTypeId: string;
} | null> {
  const [rel] = await tx
    .select({
      id: schemaRelationships.id,
      name: schemaRelationships.name,
      relationshipType: schemaRelationships.relationshipType,
      sourceEntityTypeId: schemaRelationships.sourceEntityTypeId,
      targetEntityTypeId: schemaRelationships.targetEntityTypeId,
    })
    .from(schemaRelationships)
    .where(
      and(
        eq(schemaRelationships.tenantId, tenantId),
        eq(schemaRelationships.name, name)
      )
    );
  return rel ?? null;
}
