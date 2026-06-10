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
    /** The pipeline entity's entity_type id (campaign or opportunity). */
    entityTypeId?: string;
    /**
     * Back-compat alias for `entityTypeId` (opportunity-only callers). Either
     * this or `entityTypeId` must be supplied.
     */
    opportunityEntityTypeId?: string;
    /** Currency field slug summed for the value: `value` / `amount`. */
    valueField?: string;
    stages: PipelineStageRef[];
  }
): Promise<PipelineStageValue[]> {
  const { tenantId, stages } = args;
  const entityTypeId = args.entityTypeId ?? args.opportunityEntityTypeId;
  const valueField = args.valueField ?? "amount";
  if (!entityTypeId) {
    throw new Error("pipelineValueByStage requires entityTypeId");
  }

  const rows = await tx
    .select({
      stage: sql<string | null>`${records.data} ->> 'stage'`,
      total: sql<string>`coalesce(sum(coalesce(nullif(${records.data} -> ${valueField} ->> 'amount', '')::numeric, 0)), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(records)
    .where(
      and(
        eq(records.tenantId, tenantId),
        eq(records.entityTypeId, entityTypeId),
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

// ============================================================
// Task 1.6b — lead conversion funnel
// ============================================================

export interface LeadFunnelStage {
  status: string;
  label: string;
  count: number;
}

/**
 * The lead conversion funnel: count of non-archived leads currently in each
 * of the four funnel statuses, in order (new → contacted → qualified →
 * converted). `lost` is a terminal off-funnel state and is deliberately
 * excluded. Statuses with no leads return a 0 count so the funnel always
 * renders all four stages.
 */
const LEAD_FUNNEL_STAGES: { status: string; label: string }[] = [
  { status: "new", label: "New" },
  { status: "contacted", label: "Contacted" },
  { status: "qualified", label: "Qualified" },
  { status: "converted", label: "Converted" },
];

export async function leadConversionFunnel(
  tx: typeof db,
  args: { tenantId: string; leadEntityTypeId: string }
): Promise<LeadFunnelStage[]> {
  const { tenantId, leadEntityTypeId } = args;

  const rows = await tx
    .select({
      status: sql<string | null>`${records.data} ->> 'status'`,
      count: sql<number>`count(*)::int`,
    })
    .from(records)
    .where(
      and(
        eq(records.tenantId, tenantId),
        eq(records.entityTypeId, leadEntityTypeId),
        eq(records.isArchived, false)
      )
    )
    .groupBy(sql`${records.data} ->> 'status'`);

  const byStatus = new Map(rows.map((r) => [r.status ?? "", r.count]));
  return LEAD_FUNNEL_STAGES.map((s) => ({
    status: s.status,
    label: s.label,
    count: byStatus.get(s.status) ?? 0,
  }));
}

// ============================================================
// Task 1.6b — weighted revenue forecast
// ============================================================

export interface RevenueForecast {
  /** Expected revenue (Σ amount × probability/100) closing within N days. */
  next30: number;
  next60: number;
  next90: number;
}

/**
 * Weighted revenue forecast: for non-archived opportunities whose `closeDate`
 * falls between `today` and today+N (inclusive), sum `amount × probability/100`.
 * Windows are cumulative (next30 ⊆ next60 ⊆ next90). `today`/`d30`/`d60`/`d90`
 * are `YYYY-MM-DD` strings computed by the caller (keeps the windows
 * timezone-stable and the function unit-testable). Missing/malformed amount or
 * probability coalesce to 0 (a 0-probability opp contributes nothing).
 */
export async function revenueForecast(
  tx: typeof db,
  args: {
    tenantId: string;
    opportunityEntityTypeId: string;
    today: string;
    d30: string;
    d60: string;
    d90: string;
  }
): Promise<RevenueForecast> {
  const { tenantId, opportunityEntityTypeId, today, d30, d60, d90 } = args;

  const weighted = sql`coalesce(nullif(${records.data} -> 'amount' ->> 'amount', '')::numeric, 0) * coalesce(nullif(${records.data} ->> 'probability', '')::numeric, 0) / 100`;
  const cd = sql`(${records.data} ->> 'closeDate')::date`;

  const [row] = await tx
    .select({
      next30: sql<string>`coalesce(sum(${weighted}) filter (where ${cd} <= ${d30}::date), 0)`,
      next60: sql<string>`coalesce(sum(${weighted}) filter (where ${cd} <= ${d60}::date), 0)`,
      next90: sql<string>`coalesce(sum(${weighted}) filter (where ${cd} <= ${d90}::date), 0)`,
    })
    .from(records)
    .where(
      and(
        eq(records.tenantId, tenantId),
        eq(records.entityTypeId, opportunityEntityTypeId),
        eq(records.isArchived, false),
        sql`${records.data} ->> 'closeDate' is not null`,
        sql`${cd} >= ${today}::date`
      )
    );

  return {
    next30: Number(row?.next30 ?? 0),
    next60: Number(row?.next60 ?? 0),
    next90: Number(row?.next90 ?? 0),
  };
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

// `formatCurrency` moved to ./format (client-safe, no @adserve/database
// import). Re-exported here so existing server-side importers are unaffected.
export { formatCurrency } from "./format";
