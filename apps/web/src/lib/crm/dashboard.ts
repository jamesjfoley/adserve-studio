import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { activities, entityTypes, records, type db } from "@adserve/database";

/**
 * Read models for the CRM dashboard widgets (Task 1.6a). Pure-ish query
 * functions taking an explicit `tenantId` so they are unit-testable and so
 * the page component does only context resolution + gating + presentation.
 * Every query carries the explicit `tenantId` predicate (dev superuser
 * bypasses RLS) — correct-by-construction, not part of the 44-site debt.
 */

export interface PipelineStageRef {
  slug: string;
  name: string;
}

export interface PipelineStageValue {
  slug: string;
  name: string;
  total: number;
  count: number;
}

/**
 * Sum non-archived opportunity `amount` grouped by `stage`. Returns one row
 * per configured stage (in the given order), with a £0 / 0-count entry for
 * stages that have no opportunities. Opportunities whose `stage` matches no
 * configured stage are bucketed into a trailing "Other" entry rather than
 * silently dropped. Missing/malformed amounts coalesce to 0.
 */
export async function pipelineValueByStage(
  tx: typeof db,
  args: {
    tenantId: string;
    opportunityEntityTypeId: string;
    stages: PipelineStageRef[];
  }
): Promise<PipelineStageValue[]> {
  const { tenantId, opportunityEntityTypeId, stages } = args;

  const rows = await tx
    .select({
      stage: sql<string | null>`${records.data} ->> 'stage'`,
      total: sql<string>`coalesce(sum(coalesce(nullif(${records.data} -> 'amount' ->> 'amount', '')::numeric, 0)), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(records)
    .where(
      and(
        eq(records.tenantId, tenantId),
        eq(records.entityTypeId, opportunityEntityTypeId),
        eq(records.isArchived, false)
      )
    )
    .groupBy(sql`${records.data} ->> 'stage'`);

  const byStage = new Map(rows.map((r) => [r.stage ?? "", r]));

  const result: PipelineStageValue[] = stages.map((s) => {
    const agg = byStage.get(s.slug);
    return {
      slug: s.slug,
      name: s.name,
      total: agg ? Number(agg.total) : 0,
      count: agg ? agg.count : 0,
    };
  });

  // Bucket any opportunities whose stage isn't a configured stage.
  const known = new Set(stages.map((s) => s.slug));
  let otherTotal = 0;
  let otherCount = 0;
  for (const r of rows) {
    const slug = r.stage ?? "";
    if (!known.has(slug)) {
      otherTotal += Number(r.total);
      otherCount += r.count;
    }
  }
  if (otherCount > 0) {
    result.push({ slug: "__other__", name: "Other", total: otherTotal, count: otherCount });
  }

  return result;
}

export interface UpcomingActivity {
  id: string;
  activityType: string;
  subject: string | null;
  dueDate: string;
  recordId: string;
  recordTitle: string;
  recordSlug: string;
}

/**
 * Task-type activities with a `metadata.dueDate` (stored as YYYY-MM-DD)
 * falling within [from, to] inclusive, ascending. Joined to their record
 * for a display title + entity slug. `from`/`to` are YYYY-MM-DD strings
 * computed by the caller (keeps the window timezone-stable + testable).
 *
 * **Permission boundary:** restricted to activities whose record is of an
 * entity type the caller may read (`entityTypeIds`) — an `activity.read`
 * holder must not see task subjects/titles/links for records they can't
 * otherwise read. An empty `entityTypeIds` short-circuits to no rows.
 */
export async function upcomingActivities(
  tx: typeof db,
  args: { tenantId: string; from: string; to: string; entityTypeIds: string[] }
): Promise<UpcomingActivity[]> {
  const { tenantId, from, to, entityTypeIds } = args;
  if (entityTypeIds.length === 0) return [];
  const due = sql`(${activities.metadata} ->> 'dueDate')`;

  const rows = await tx
    .select({
      id: activities.id,
      activityType: activities.activityType,
      subject: activities.subject,
      dueDate: sql<string>`${activities.metadata} ->> 'dueDate'`,
      recordId: activities.recordId,
      data: records.data,
      slug: entityTypes.slug,
    })
    .from(activities)
    .innerJoin(records, eq(records.id, activities.recordId))
    .innerJoin(entityTypes, eq(entityTypes.id, activities.entityTypeId))
    .where(
      and(
        eq(activities.tenantId, tenantId),
        inArray(activities.entityTypeId, entityTypeIds),
        eq(activities.activityType, "task"),
        sql`${due} is not null`,
        sql`${due}::date >= ${from}::date`,
        sql`${due}::date <= ${to}::date`
      )
    )
    .orderBy(sql`${due}::date asc`);

  return rows.map((r) => ({
    id: r.id,
    activityType: r.activityType,
    subject: r.subject,
    dueDate: r.dueDate,
    recordId: r.recordId,
    recordTitle: heuristicTitle(r.data as Record<string, unknown>, r.recordId),
    recordSlug: r.slug,
  }));
}

export interface RecentRecord {
  id: string;
  slug: string;
  title: string;
  updatedAt: string;
}

/**
 * The 10 most-recently-updated records across the entity types the caller
 * may read. An empty `entityTypeIds` short-circuits to no rows (rather than
 * emitting `IN ()`).
 */
export async function recentlyModifiedRecords(
  tx: typeof db,
  args: { tenantId: string; entityTypeIds: string[]; limit?: number }
): Promise<RecentRecord[]> {
  const { tenantId, entityTypeIds, limit = 10 } = args;
  if (entityTypeIds.length === 0) return [];

  const rows = await tx
    .select({
      id: records.id,
      data: records.data,
      updatedAt: records.updatedAt,
      slug: entityTypes.slug,
    })
    .from(records)
    .innerJoin(entityTypes, eq(entityTypes.id, records.entityTypeId))
    .where(
      and(
        eq(records.tenantId, tenantId),
        inArray(records.entityTypeId, entityTypeIds)
      )
    )
    .orderBy(desc(records.updatedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: heuristicTitle(r.data as Record<string, unknown>, r.id),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/**
 * Best-effort display title from a record's data, presentation-only
 * (consistent with the listing/sidebar heuristic, decision #38):
 * `name` → `firstName lastName` → id.
 */
export function heuristicTitle(
  data: Record<string, unknown>,
  fallbackId: string
): string {
  if (typeof data.name === "string" && data.name.trim() !== "") return data.name;
  const fn = typeof data.firstName === "string" ? data.firstName : "";
  const ln = typeof data.lastName === "string" ? data.lastName : "";
  const full = `${fn} ${ln}`.trim();
  return full !== "" ? full : fallbackId;
}

/** Format a numeric amount as a localized currency string (pure). */
export function formatCurrency(
  amount: number,
  locale: string,
  currency = "GBP"
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
