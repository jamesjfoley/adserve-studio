import { NextRequest, NextResponse } from "next/server";
import { asc, desc, sql } from "drizzle-orm";
import { records, withTenant } from "@adserve/database";
import { resolveCrmEntitySlug } from "@adserve/crm";
import {
  coerceFieldValue,
  getEntityTypeBySlug,
  listFieldDefinitions,
} from "@adserve/module-framework";
import { apiRequirePermission } from "@/lib/permissions";
import {
  buildOrderBy,
  buildWhere,
  CrmQueryError,
  parseListParams,
} from "@/lib/crm/query";
import { serializeRecord } from "@/lib/crm/serialize";
import { writeAuditLog } from "@/lib/crm/audit";
import { isActiveMember } from "@/lib/crm/members";

type Params = { params: Promise<{ entityType: string }> };

/** GET /api/crm/[entityType] — list with JSONB filter/sort + offset pagination. */
export async function GET(req: NextRequest, { params }: Params) {
  const { entityType: segment } = await params;
  const slug = resolveCrmEntitySlug(segment);
  if (!slug) {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }

  const guard = await apiRequirePermission(`${slug}.read`);
  if (guard.error) return guard.error;
  const { tenant } = guard.ctx;

  let parsed;
  try {
    parsed = parseListParams(req.nextUrl.searchParams);
  } catch (err) {
    if (err instanceof CrmQueryError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const outcome = await withTenant(tenant.id, async (tx) => {
    const entity = await getEntityTypeBySlug(tx, {
      tenantId: tenant.id,
      slug,
    });
    if (!entity) return { kind: "not_found" as const };

    const fields = await listFieldDefinitions(tx, {
      tenantId: tenant.id,
      entityTypeId: entity.id,
    });

    let where;
    let orderBy;
    try {
      where = buildWhere(
        tenant.id,
        entity.id,
        fields,
        parsed.filters,
        parsed.includeArchived
      );
      orderBy = buildOrderBy(fields, parsed.sort);
    } catch (err) {
      if (err instanceof CrmQueryError) {
        return { kind: "bad_request" as const, message: err.message };
      }
      throw err;
    }

    const order = orderBy
      ? [orderBy, asc(records.id)]
      : [desc(records.createdAt), asc(records.id)];

    const rows = await tx
      .select()
      .from(records)
      .where(where)
      .orderBy(...order)
      .limit(parsed.limit)
      .offset(parsed.offset);

    const [countRow] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(records)
      .where(where);

    return { kind: "ok" as const, rows, total: countRow?.total ?? 0 };
  });

  if (outcome.kind === "not_found") {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }
  if (outcome.kind === "bad_request") {
    return NextResponse.json({ error: outcome.message }, { status: 400 });
  }

  return NextResponse.json({
    records: outcome.rows.map(serializeRecord),
    pagination: {
      offset: parsed.offset,
      limit: parsed.limit,
      total: outcome.total,
    },
  });
}

/** POST /api/crm/[entityType] — create a record (validates via field defs). */
export async function POST(req: NextRequest, { params }: Params) {
  const { entityType: segment } = await params;
  const slug = resolveCrmEntitySlug(segment);
  if (!slug) {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }

  const guard = await apiRequirePermission(`${slug}.create`);
  if (guard.error) return guard.error;
  const { tenant, user } = guard.ctx;

  let body: { data?: Record<string, unknown>; ownedBy?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const input = body.data ?? {};

  const outcome = await withTenant(tenant.id, async (tx) => {
    const entity = await getEntityTypeBySlug(tx, {
      tenantId: tenant.id,
      slug,
    });
    if (!entity) return { kind: "not_found" as const };

    const fields = await listFieldDefinitions(tx, {
      tenantId: tenant.id,
      entityTypeId: entity.id,
    });

    const data: Record<string, unknown> = {};
    const fieldErrors: Record<string, string> = {};
    for (const field of fields) {
      const result = coerceFieldValue(field, input[field.slug]);
      if (!result.ok) {
        fieldErrors[field.slug] = result.error.message;
      } else if (result.value !== null) {
        data[field.slug] = result.value;
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      return { kind: "invalid" as const, fieldErrors };
    }

    // A caller-supplied owner must be an active member of this tenant
    // (mirrors the bulk assignOwner check). Omitted → defaults to the
    // acting user, who is already an active member via the permission guard.
    if (body.ownedBy && !(await isActiveMember(tx, tenant.id, body.ownedBy))) {
      return { kind: "invalid_owner" as const };
    }

    const [row] = await tx
      .insert(records)
      .values({
        tenantId: tenant.id,
        entityTypeId: entity.id,
        data,
        createdBy: user.id,
        updatedBy: user.id,
        ownedBy: body.ownedBy ?? user.id,
      })
      .returning();

    await writeAuditLog(tx, {
      tenantId: tenant.id,
      userId: user.id,
      action: "create",
      resourceType: slug,
      resourceId: row.id,
      changes: { after: row.data },
    });

    return { kind: "ok" as const, row };
  });

  if (outcome.kind === "not_found") {
    return NextResponse.json({ error: "Unknown entity type" }, { status: 404 });
  }
  if (outcome.kind === "invalid") {
    return NextResponse.json(
      { error: "Validation failed", fieldErrors: outcome.fieldErrors },
      { status: 422 }
    );
  }
  if (outcome.kind === "invalid_owner") {
    return NextResponse.json(
      { error: "ownedBy must be an active member of this tenant" },
      { status: 400 }
    );
  }

  return NextResponse.json(
    { record: serializeRecord(outcome.row) },
    { status: 201 }
  );
}
