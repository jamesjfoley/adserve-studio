import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { records, withTenant, type db } from "@adserve/database";
import { resolveCrmEntitySlug } from "@adserve/crm";
import {
  coerceFieldValue,
  getEntityTypeBySlug,
  listFieldDefinitions,
} from "@adserve/module-framework";
import { apiRequirePermission, type TenantContext } from "@/lib/permissions";
import { isActiveMember } from "@/lib/crm/members";
import { writeAuditLog } from "@/lib/crm/audit";

type Params = { params: Promise<{ entityType: string }> };

type BulkAction = "assignOwner" | "changeStatus" | "archive";

interface BulkBody {
  action?: BulkAction;
  recordIds?: unknown;
  /** assignOwner: target user id, or null to unassign. */
  ownedBy?: string | null;
  /** changeStatus: single-select field slug (defaults to "status"). */
  field?: string;
  /** changeStatus: the new value (coerced + validated against the field). */
  value?: unknown;
}

/** The permission each action requires (no per-record owner override for bulk). */
const ACTION_PERMISSION: Record<BulkAction, "update" | "delete"> = {
  assignOwner: "update",
  changeStatus: "update",
  archive: "delete",
};

/**
 * POST /api/crm/[entityType]/bulk — apply one mutation across many records.
 *
 * Strict permission gate (no edit-own override — bulk is a cross-record
 * admin action). All-or-nothing: a recordId that is missing, cross-tenant,
 * or of the wrong entity fails the whole batch with zero writes. Records
 * already in the target state are skipped (idempotent), so `updated`
 * reflects real changes and no redundant audit rows are written.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { entityType: segment } = await params;
  const slug = resolveCrmEntitySlug(segment);
  if (!slug) {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }

  let body: BulkBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action;
  if (action !== "assignOwner" && action !== "changeStatus" && action !== "archive") {
    return NextResponse.json(
      { error: "action must be assignOwner | changeStatus | archive" },
      { status: 400 }
    );
  }

  if (!Array.isArray(body.recordIds) || body.recordIds.length === 0) {
    return NextResponse.json(
      { error: "recordIds must be a non-empty array" },
      { status: 400 }
    );
  }
  if (!body.recordIds.every((id) => typeof id === "string")) {
    return NextResponse.json(
      { error: "recordIds must be strings" },
      { status: 400 }
    );
  }
  const recordIds = Array.from(new Set(body.recordIds as string[]));

  const guard = await apiRequirePermission(`${slug}.${ACTION_PERMISSION[action]}`);
  if (guard.error) return guard.error;
  const { tenant, user } = guard.ctx;

  const outcome = await withTenant(tenant.id, (tx) =>
    runBulk(tx, { ctx: guard.ctx, slug, action, recordIds, body, userId: user.id })
  );

  switch (outcome.kind) {
    case "not_found":
      return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
    case "bad_ids":
      return NextResponse.json(
        { error: "Some recordIds are not valid for this entity", missing: outcome.missing },
        { status: 400 }
      );
    case "invalid_owner":
      return NextResponse.json(
        { error: "ownedBy must be an active member of this tenant" },
        { status: 400 }
      );
    case "bad_field":
      return NextResponse.json({ error: outcome.message }, { status: 400 });
    case "invalid_value":
      return NextResponse.json(
        { error: "Validation failed", fieldErrors: outcome.fieldErrors },
        { status: 422 }
      );
    case "ok":
      return NextResponse.json({ updated: outcome.updated });
  }
}

type BulkOutcome =
  | { kind: "not_found" }
  | { kind: "bad_ids"; missing: string[] }
  | { kind: "invalid_owner" }
  | { kind: "bad_field"; message: string }
  | { kind: "invalid_value"; fieldErrors: Record<string, string> }
  | { kind: "ok"; updated: number };

interface RunBulkArgs {
  ctx: TenantContext;
  slug: string;
  action: BulkAction;
  recordIds: string[];
  body: BulkBody;
  userId: string;
}

async function runBulk(
  tx: typeof db,
  args: RunBulkArgs
): Promise<BulkOutcome> {
  const { ctx, slug, action, recordIds, body, userId } = args;
  const tenantId = ctx.tenant.id;

  const entity = await getEntityTypeBySlug(tx, { tenantId, slug });
  if (!entity) return { kind: "not_found" };

  // Tenant + entity isolation is load-bearing (dev superuser bypasses RLS):
  // the explicit predicate scopes the IN, and the count check rejects any
  // id that is missing, cross-tenant, or of another entity — before any write.
  const rows = await tx
    .select({
      id: records.id,
      data: records.data,
      ownedBy: records.ownedBy,
      isArchived: records.isArchived,
    })
    .from(records)
    .where(
      and(
        eq(records.tenantId, tenantId),
        eq(records.entityTypeId, entity.id),
        inArray(records.id, recordIds)
      )
    );

  if (rows.length !== recordIds.length) {
    const found = new Set(rows.map((r) => r.id));
    return { kind: "bad_ids", missing: recordIds.filter((id) => !found.has(id)) };
  }

  if (action === "assignOwner") {
    const newOwner = body.ownedBy ?? null;
    if (newOwner !== null) {
      const ok = await isActiveMember(tx, tenantId, newOwner);
      if (!ok) return { kind: "invalid_owner" };
    }
    let updated = 0;
    for (const row of rows) {
      if ((row.ownedBy ?? null) === newOwner) continue; // already in target state
      await tx
        .update(records)
        .set({ ownedBy: newOwner, updatedBy: userId, updatedAt: new Date() })
        .where(and(eq(records.id, row.id), eq(records.tenantId, tenantId)));
      await writeAuditLog(tx, {
        tenantId,
        userId,
        action: "update",
        resourceType: slug,
        resourceId: row.id,
        changes: { before: { ownedBy: row.ownedBy ?? null }, after: { ownedBy: newOwner } },
      });
      updated += 1;
    }
    return { kind: "ok", updated };
  }

  if (action === "changeStatus") {
    const fieldSlug = body.field ?? "status";
    const fields = await listFieldDefinitions(tx, {
      tenantId,
      entityTypeId: entity.id,
    });
    const field = fields.find((f) => f.slug === fieldSlug);
    if (!field) {
      return { kind: "bad_field", message: `Field "${fieldSlug}" does not exist for ${slug}` };
    }
    if (field.fieldType !== "select") {
      return {
        kind: "bad_field",
        message: `Field "${fieldSlug}" is not a single-select field`,
      };
    }
    const coerced = coerceFieldValue(field, body.value);
    if (!coerced.ok) {
      return { kind: "invalid_value", fieldErrors: { [fieldSlug]: coerced.error.message } };
    }
    const newValue = coerced.value;
    let updated = 0;
    for (const row of rows) {
      const data = (row.data as Record<string, unknown>) ?? {};
      if (data[fieldSlug] === newValue) continue; // already in target state
      const before = data[fieldSlug] ?? null;
      const nextData = { ...data, [fieldSlug]: newValue };
      await tx
        .update(records)
        .set({ data: nextData, updatedBy: userId, updatedAt: new Date() })
        .where(and(eq(records.id, row.id), eq(records.tenantId, tenantId)));
      await writeAuditLog(tx, {
        tenantId,
        userId,
        action: "update",
        resourceType: slug,
        resourceId: row.id,
        changes: { before: { [fieldSlug]: before }, after: { [fieldSlug]: newValue } },
      });
      updated += 1;
    }
    return { kind: "ok", updated };
  }

  // archive
  let updated = 0;
  for (const row of rows) {
    if (row.isArchived) continue; // already archived
    await tx
      .update(records)
      .set({ isArchived: true, updatedBy: userId, updatedAt: new Date() })
      .where(and(eq(records.id, row.id), eq(records.tenantId, tenantId)));
    await writeAuditLog(tx, {
      tenantId,
      userId,
      action: "archive",
      resourceType: slug,
      resourceId: row.id,
      changes: { before: { isArchived: false }, after: { isArchived: true } },
    });
    updated += 1;
  }
  return { kind: "ok", updated };
}
