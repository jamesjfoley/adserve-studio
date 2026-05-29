import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  activities,
  recordRelationships,
  records,
  withTenant,
} from "@adserve/database";
import { getEntityTypeBySlug } from "@adserve/module-framework";
import { apiRequirePermission } from "@/lib/permissions";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/crm/accounts/[id]/activities — the activity timeline for an
 * account, including activities on its related contacts and
 * opportunities (reached via record_relationships). Bounded query count:
 * account (1) + relationships (1) + activities (1).
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const guard = await apiRequirePermission("activity.read");
  if (guard.error) return guard.error;
  const { tenant } = guard.ctx;

  const result = await withTenant(tenant.id, async (tx) => {
    const accountEntity = await getEntityTypeBySlug(tx, {
      tenantId: tenant.id,
      slug: "account",
    });
    if (!accountEntity) return null;

    const [account] = await tx
      .select({ id: records.id })
      .from(records)
      .where(
        and(
          eq(records.id, id),
          eq(records.tenantId, tenant.id),
          eq(records.entityTypeId, accountEntity.id)
        )
      );
    if (!account) return null;

    const rels = await tx
      .select({
        sourceRecordId: recordRelationships.sourceRecordId,
        targetRecordId: recordRelationships.targetRecordId,
      })
      .from(recordRelationships)
      .where(
        and(
          eq(recordRelationships.tenantId, tenant.id),
          or(
            eq(recordRelationships.sourceRecordId, id),
            eq(recordRelationships.targetRecordId, id)
          )
        )
      );

    const recordIds = Array.from(
      new Set([
        id,
        ...rels.map((r) =>
          r.sourceRecordId === id ? r.targetRecordId : r.sourceRecordId
        ),
      ])
    );

    const rows = await tx
      .select()
      .from(activities)
      .where(
        and(
          eq(activities.tenantId, tenant.id),
          inArray(activities.recordId, recordIds)
        )
      )
      .orderBy(desc(activities.createdAt));

    return rows;
  });

  if (result === null) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  return NextResponse.json({
    activities: result.map((a) => ({
      id: a.id,
      recordId: a.recordId,
      entityTypeId: a.entityTypeId,
      activityType: a.activityType,
      subject: a.subject,
      body: a.body,
      performedBy: a.performedBy,
      createdAt: a.createdAt.toISOString(),
    })),
  });
}
