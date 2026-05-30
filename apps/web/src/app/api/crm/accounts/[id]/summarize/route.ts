import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  activities,
  recordRelationships,
  records,
  withTenant,
} from "@adserve/database";
import { getEntityTypeBySlug } from "@adserve/module-framework";
import { aiComplete, activitySummaryPrompt } from "@adserve/ai-service";
import { apiRequirePermission } from "@/lib/permissions";
import { aiErrorResponse } from "@/lib/crm/ai-response";

type Params = { params: Promise<{ id: string }> };

const MAX_ACTIVITIES = 30;

/**
 * POST /api/crm/accounts/[id]/summarize — Task 1.7c. Summarise the account's
 * recent activity (including its related contacts/opportunities, reached via
 * record_relationships — mirroring the activity-timeline route). Gated on
 * BOTH account.read AND activity.read (the summary surfaces activity content,
 * so activity.read is required to avoid an exfiltration bypass). Metered as
 * crm/activity_summary via aiComplete.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  const guard = await apiRequirePermission("account.read");
  if (guard.error) return guard.error;
  const { tenant, user, permissions } = guard.ctx;
  if (!permissions.has("activity.read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const built = await withTenant(tenant.id, async (tx) => {
    const accountEntity = await getEntityTypeBySlug(tx, {
      tenantId: tenant.id,
      slug: "account",
    });
    if (!accountEntity) return null;

    const [account] = await tx
      .select({ id: records.id, data: records.data })
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
      .orderBy(desc(activities.createdAt))
      .limit(MAX_ACTIVITIES);

    const data = (account.data as Record<string, unknown>) ?? {};
    const recordName =
      typeof data.name === "string" && data.name.trim() !== ""
        ? data.name
        : id;

    return {
      prompt: activitySummaryPrompt.buildUserPrompt({
        entityType: "account",
        recordName,
        activities: rows.map((a) => ({
          type: a.activityType,
          subject: a.subject,
          body: a.body,
          createdAt: a.createdAt.toISOString(),
        })),
      }),
    };
  });

  if (!built) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const result = await aiComplete({
    tenantId: tenant.id,
    userId: user.id,
    module: "crm",
    capability: "activity_summary",
    messages: [{ role: "user", content: built.prompt }],
  });
  if (!result.ok) return aiErrorResponse(result.error);

  return NextResponse.json({ summary: result.content });
}
