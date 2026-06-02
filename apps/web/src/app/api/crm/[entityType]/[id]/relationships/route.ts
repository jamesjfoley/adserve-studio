import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import {
  records,
  recordRelationships,
  schemaRelationships,
  withTenant,
} from "@adserve/database";
import { resolveCrmEntitySlug } from "@adserve/crm";
import { getEntityTypeBySlug } from "@adserve/module-framework";
import {
  getTenantContextOrNull,
  type TenantContext,
} from "@/lib/permissions";
import { writeAuditLog } from "@/lib/crm/audit";
import { createRecordLink } from "@/lib/crm/link-records";

type Params = { params: Promise<{ entityType: string; id: string }> };

/**
 * WS2 — record-to-record link/unlink write API.
 *
 * The route is scoped to an OWNING record (`[entityType]/[id]`), which is the
 * SOURCE side of the relationship being mutated (contact→account,
 * opportunity→contact, opportunity→account). `targetRecordId` is the record on
 * the TARGET side. Both the owning record and the target are resolved under the
 * caller's `withTenant` context, so a target belonging to another tenant
 * returns zero rows under RLS → 404 (never a cross-tenant link).
 *
 * One `withTenant` transaction per call. See the plan
 * (docs/plans/crm-relationships-conversion-design-system.md, WS2) for the four
 * resolved decisions implemented here.
 */

interface LinkBody {
  relationshipName?: unknown;
  targetRecordId?: unknown;
  isPrimary?: unknown;
}

/**
 * Resolve the tenant context without an up-front permission check, so the
 * caller can apply the permission-OR-ownership rule. 401 if not signed in,
 * 403 if not a tenant user. Mirrors `[id]/route.ts`.
 */
async function resolveCtx(): Promise<
  { ctx: TenantContext; error: null } | { ctx: null; error: NextResponse }
> {
  const { userId } = await auth();
  if (!userId) {
    return {
      ctx: null,
      error: NextResponse.json({ error: "Unauthenticated" }, { status: 401 }),
    };
  }
  const ctx = await getTenantContextOrNull();
  if (!ctx) {
    return {
      ctx: null,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ctx, error: null };
}

/**
 * Permission-or-owner gate for mutations. Identical semantics to
 * `[id]/route.ts`: a user may act if they hold the permission OR they own the
 * record. Null `ownedBy` never grants access via ownership.
 */
function canMutate(
  ctx: TenantContext,
  permissionKey: string,
  ownedBy: string | null
): boolean {
  if (ctx.permissions.has(permissionKey)) return true;
  return ownedBy !== null && ownedBy === ctx.user.id;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * POST /api/crm/[entityType]/[id]/relationships
 * Body: { relationshipName, targetRecordId, isPrimary? }
 *
 * Creates (201) or idempotently no-ops (200) a link. Honours the cardinality
 * guard (replace semantics for many_to_one) and the single-primary invariant.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { entityType: segment, id } = await params;
  const owningSlug = resolveCrmEntitySlug(segment);
  if (!owningSlug) {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }

  const guard = await resolveCtx();
  if (guard.error) return guard.error;
  const { ctx } = guard;
  const { tenant, user } = ctx;

  let body: LinkBody;
  try {
    body = (await req.json()) as LinkBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const relationshipName = str(body.relationshipName);
  const targetRecordId = str(body.targetRecordId);
  const isPrimary = body.isPrimary === true;
  if (!relationshipName || !targetRecordId) {
    return NextResponse.json(
      { error: "relationshipName and targetRecordId are required" },
      { status: 400 }
    );
  }

  const outcome = await withTenant(tenant.id, async (tx) => {
    const owningEntity = await getEntityTypeBySlug(tx, {
      tenantId: tenant.id,
      slug: owningSlug,
    });
    if (!owningEntity) return { kind: "not_found" as const };

    // Resolve the OWNING (source) record under the caller's tenant context.
    const [owningRecord] = await tx
      .select()
      .from(records)
      .where(
        and(
          eq(records.id, id),
          eq(records.tenantId, tenant.id),
          eq(records.entityTypeId, owningEntity.id)
        )
      );
    if (!owningRecord) return { kind: "not_found" as const };

    // Authorization: permission-OR-ownership on the OWNING record.
    if (!canMutate(ctx, `${owningSlug}.update`, owningRecord.ownedBy ?? null)) {
      return { kind: "forbidden" as const };
    }

    // Resolve the relationship spec for this tenant by name.
    const [rel] = await tx
      .select()
      .from(schemaRelationships)
      .where(
        and(
          eq(schemaRelationships.tenantId, tenant.id),
          eq(schemaRelationships.name, relationshipName)
        )
      );
    if (!rel) return { kind: "unknown_relationship" as const };

    // The owning record must be the SOURCE side of the relationship.
    if (rel.sourceEntityTypeId !== owningEntity.id) {
      return { kind: "type_mismatch" as const };
    }

    // Resolve the TARGET record under the caller's tenant context. A target in
    // another tenant returns zero rows under RLS → 404, never a cross-tenant
    // link.
    const [targetRecord] = await tx
      .select()
      .from(records)
      .where(
        and(
          eq(records.id, targetRecordId),
          eq(records.tenantId, tenant.id)
        )
      );
    if (!targetRecord) return { kind: "not_found" as const };

    // Validate the target's entity type matches the relationship's target side.
    if (targetRecord.entityTypeId !== rel.targetEntityTypeId) {
      return { kind: "type_mismatch" as const };
    }

    // Cardinality guard, single-primary invariant, idempotent insert, and the
    // audit row all live in the shared link writer so the contact-create
    // combined endpoint (WS3) applies identical semantics.
    const { linkId, isNew } = await createRecordLink(tx, {
      tenantId: tenant.id,
      userId: user.id,
      relationship: rel,
      sourceRecordId: owningRecord.id,
      targetRecordId: targetRecord.id,
      isPrimary,
    });

    return { kind: "ok" as const, linkId, isNew };
  });

  switch (outcome.kind) {
    case "not_found":
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    case "forbidden":
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    case "unknown_relationship":
      return NextResponse.json(
        { error: "Unknown relationship" },
        { status: 422 }
      );
    case "type_mismatch":
      return NextResponse.json(
        { error: "Relationship does not connect these record types" },
        { status: 422 }
      );
    case "ok":
      return NextResponse.json(
        { linkId: outcome.linkId },
        { status: outcome.isNew ? 201 : 200 }
      );
  }
}

/**
 * DELETE /api/crm/[entityType]/[id]/relationships
 * Body: { relationshipName, targetRecordId }
 *
 * Removes only the targeted link and returns 200. Unlinking the sole link is
 * allowed (leaves the record orphaned — no server block).
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { entityType: segment, id } = await params;
  const owningSlug = resolveCrmEntitySlug(segment);
  if (!owningSlug) {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }

  const guard = await resolveCtx();
  if (guard.error) return guard.error;
  const { ctx } = guard;
  const { tenant, user } = ctx;

  let body: LinkBody;
  try {
    body = (await req.json()) as LinkBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const relationshipName = str(body.relationshipName);
  const targetRecordId = str(body.targetRecordId);
  if (!relationshipName || !targetRecordId) {
    return NextResponse.json(
      { error: "relationshipName and targetRecordId are required" },
      { status: 400 }
    );
  }

  const outcome = await withTenant(tenant.id, async (tx) => {
    const owningEntity = await getEntityTypeBySlug(tx, {
      tenantId: tenant.id,
      slug: owningSlug,
    });
    if (!owningEntity) return { kind: "not_found" as const };

    const [owningRecord] = await tx
      .select()
      .from(records)
      .where(
        and(
          eq(records.id, id),
          eq(records.tenantId, tenant.id),
          eq(records.entityTypeId, owningEntity.id)
        )
      );
    if (!owningRecord) return { kind: "not_found" as const };

    if (!canMutate(ctx, `${owningSlug}.update`, owningRecord.ownedBy ?? null)) {
      return { kind: "forbidden" as const };
    }

    const [rel] = await tx
      .select({ id: schemaRelationships.id })
      .from(schemaRelationships)
      .where(
        and(
          eq(schemaRelationships.tenantId, tenant.id),
          eq(schemaRelationships.name, relationshipName)
        )
      );
    if (!rel) return { kind: "unknown_relationship" as const };

    const deleted = await tx
      .delete(recordRelationships)
      .where(
        and(
          eq(recordRelationships.tenantId, tenant.id),
          eq(recordRelationships.relationshipId, rel.id),
          eq(recordRelationships.sourceRecordId, owningRecord.id),
          eq(recordRelationships.targetRecordId, targetRecordId)
        )
      )
      .returning({ id: recordRelationships.id });

    if (deleted.length === 0) {
      return { kind: "link_not_found" as const };
    }

    await writeAuditLog(tx, {
      tenantId: tenant.id,
      userId: user.id,
      action: "unlink",
      resourceType: "relationship",
      resourceId: deleted[0].id,
      changes: {
        relationshipName,
        sourceRecordId: owningRecord.id,
        targetRecordId,
      },
    });

    return { kind: "ok" as const };
  });

  switch (outcome.kind) {
    case "not_found":
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    case "forbidden":
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    case "unknown_relationship":
      return NextResponse.json(
        { error: "Unknown relationship" },
        { status: 422 }
      );
    case "link_not_found":
      return NextResponse.json({ error: "Link not found" }, { status: 404 });
    case "ok":
      return NextResponse.json({ ok: true }, { status: 200 });
  }
}
