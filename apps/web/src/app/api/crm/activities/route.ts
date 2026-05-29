import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { activities, records, withTenant } from "@adserve/database";
import { apiRequirePermission } from "@/lib/permissions";

/** Activity types loggable through the CRM UI (subset of the DB enum). */
const ALLOWED_ACTIVITY_TYPES = new Set([
  "call",
  "email",
  "meeting",
  "task",
  "note",
]);

/**
 * POST /api/crm/activities — log an activity against any record. The
 * record's entity type is derived from the record itself. Activities are
 * a form of audit, so this does NOT write an audit_log row.
 */
export async function POST(req: NextRequest) {
  const guard = await apiRequirePermission("activity.create");
  if (guard.error) return guard.error;
  const { tenant, user } = guard.ctx;

  let body: {
    recordId?: string;
    activityType?: string;
    subject?: string;
    body?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.recordId || typeof body.recordId !== "string") {
    return NextResponse.json({ error: "recordId is required" }, { status: 400 });
  }
  if (!body.activityType || !ALLOWED_ACTIVITY_TYPES.has(body.activityType)) {
    return NextResponse.json(
      {
        error: `activityType must be one of: ${[...ALLOWED_ACTIVITY_TYPES].join(", ")}`,
      },
      { status: 400 }
    );
  }

  const outcome = await withTenant(tenant.id, async (tx) => {
    const [record] = await tx
      .select({ id: records.id, entityTypeId: records.entityTypeId })
      .from(records)
      .where(
        and(eq(records.id, body.recordId!), eq(records.tenantId, tenant.id))
      );
    if (!record) return { kind: "not_found" as const };

    const [row] = await tx
      .insert(activities)
      .values({
        tenantId: tenant.id,
        recordId: record.id,
        entityTypeId: record.entityTypeId,
        activityType: body.activityType as
          | "call"
          | "email"
          | "meeting"
          | "task"
          | "note",
        subject: body.subject ?? null,
        body: body.body ?? {},
        metadata: body.metadata ?? {},
        performedBy: user.id,
      })
      .returning();

    return { kind: "ok" as const, row };
  });

  if (outcome.kind === "not_found") {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      activity: {
        id: outcome.row.id,
        recordId: outcome.row.recordId,
        entityTypeId: outcome.row.entityTypeId,
        activityType: outcome.row.activityType,
        subject: outcome.row.subject,
        body: outcome.row.body,
        performedBy: outcome.row.performedBy,
        createdAt: outcome.row.createdAt.toISOString(),
      },
    },
    { status: 201 }
  );
}
