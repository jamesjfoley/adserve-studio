import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { records, withTenant } from "@adserve/database";
import { resolveCrmEntitySlug } from "@adserve/crm";
import {
  coerceFieldValue,
  getEntityTypeBySlug,
  listFieldDefinitions,
} from "@adserve/module-framework";
import {
  apiRequirePermission,
  getTenantContextOrNull,
  type TenantContext,
} from "@/lib/permissions";
import { loadRecordWithRelationships } from "@/lib/crm/relationships";
import { serializeRecord } from "@/lib/crm/serialize";
import { writeAuditLog } from "@/lib/crm/audit";

type Params = { params: Promise<{ entityType: string; id: string }> };

/**
 * Resolve the tenant context without an up-front permission check, so the
 * caller can apply a permission-OR-ownership rule. 401 if not signed in,
 * 403 if not a tenant user.
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
 * Permission-or-owner gate for mutations. A user may act if they hold the
 * permission, OR they own the record. Null `ownedBy` never grants access
 * via ownership — it falls back to the strict permission check.
 */
function canMutate(
  ctx: TenantContext,
  permissionKey: string,
  ownedBy: string | null
): boolean {
  if (ctx.permissions.has(permissionKey)) return true;
  return ownedBy !== null && ownedBy === ctx.user.id;
}

/** GET /api/crm/[entityType]/[id] — single record with relationships expanded. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { entityType: segment, id } = await params;
  const slug = resolveCrmEntitySlug(segment);
  if (!slug) {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }

  const guard = await apiRequirePermission(`${slug}.read`);
  if (guard.error) return guard.error;
  const { tenant } = guard.ctx;

  const result = await withTenant(tenant.id, async (tx) => {
    const entity = await getEntityTypeBySlug(tx, { tenantId: tenant.id, slug });
    if (!entity) return null;
    return loadRecordWithRelationships(tx, {
      tenantId: tenant.id,
      entityTypeId: entity.id,
      recordId: id,
    });
  });

  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}

/** PATCH /api/crm/[entityType]/[id] — partial update of a record's data. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { entityType: segment, id } = await params;
  const slug = resolveCrmEntitySlug(segment);
  if (!slug) {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }

  const guard = await resolveCtx();
  if (guard.error) return guard.error;
  const { ctx } = guard;
  const { tenant, user } = ctx;

  let body: { data?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const input = body.data ?? {};

  const outcome = await withTenant(tenant.id, async (tx) => {
    const entity = await getEntityTypeBySlug(tx, { tenantId: tenant.id, slug });
    if (!entity) return { kind: "not_found" as const };

    const [existing] = await tx
      .select()
      .from(records)
      .where(
        and(
          eq(records.id, id),
          eq(records.tenantId, tenant.id),
          eq(records.entityTypeId, entity.id)
        )
      );
    if (!existing) return { kind: "not_found" as const };

    if (!canMutate(ctx, `${slug}.update`, existing.ownedBy ?? null)) {
      return { kind: "forbidden" as const };
    }

    const fields = await listFieldDefinitions(tx, {
      tenantId: tenant.id,
      entityTypeId: entity.id,
    });
    const before = (existing.data as Record<string, unknown>) ?? {};
    const merged: Record<string, unknown> = { ...before };
    const fieldErrors: Record<string, string> = {};

    for (const field of fields) {
      if (!(field.slug in input)) continue; // partial update
      const result = coerceFieldValue(field, input[field.slug]);
      if (!result.ok) {
        fieldErrors[field.slug] = result.error.message;
      } else if (result.value === null) {
        delete merged[field.slug];
      } else {
        merged[field.slug] = result.value;
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      return { kind: "invalid" as const, fieldErrors };
    }

    const [row] = await tx
      .update(records)
      .set({ data: merged, updatedBy: user.id, updatedAt: new Date() })
      .where(and(eq(records.id, id), eq(records.tenantId, tenant.id)))
      .returning();

    await writeAuditLog(tx, {
      tenantId: tenant.id,
      userId: user.id,
      action: "update",
      resourceType: slug,
      resourceId: id,
      changes: { before, after: merged },
    });

    return { kind: "ok" as const, row };
  });

  if (outcome.kind === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (outcome.kind === "forbidden") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (outcome.kind === "invalid") {
    return NextResponse.json(
      { error: "Validation failed", fieldErrors: outcome.fieldErrors },
      { status: 422 }
    );
  }
  return NextResponse.json({ record: serializeRecord(outcome.row) });
}

/** DELETE /api/crm/[entityType]/[id] — soft delete (isArchived = true). */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { entityType: segment, id } = await params;
  const slug = resolveCrmEntitySlug(segment);
  if (!slug) {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }

  const guard = await resolveCtx();
  if (guard.error) return guard.error;
  const { ctx } = guard;
  const { tenant, user } = ctx;

  const outcome = await withTenant(tenant.id, async (tx) => {
    const entity = await getEntityTypeBySlug(tx, { tenantId: tenant.id, slug });
    if (!entity) return { kind: "not_found" as const };

    const [existing] = await tx
      .select()
      .from(records)
      .where(
        and(
          eq(records.id, id),
          eq(records.tenantId, tenant.id),
          eq(records.entityTypeId, entity.id)
        )
      );
    if (!existing) return { kind: "not_found" as const };

    if (!canMutate(ctx, `${slug}.delete`, existing.ownedBy ?? null)) {
      return { kind: "forbidden" as const };
    }

    const [row] = await tx
      .update(records)
      .set({ isArchived: true, updatedBy: user.id, updatedAt: new Date() })
      .where(and(eq(records.id, id), eq(records.tenantId, tenant.id)))
      .returning();

    await writeAuditLog(tx, {
      tenantId: tenant.id,
      userId: user.id,
      action: "archive",
      resourceType: slug,
      resourceId: id,
      changes: { before: { isArchived: false }, after: { isArchived: true } },
    });

    return { kind: "ok" as const, row };
  });

  if (outcome.kind === "not_found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (outcome.kind === "forbidden") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ record: serializeRecord(outcome.row) });
}
