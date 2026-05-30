import {
  aiUsageLimits,
  aiUsageLog,
  aiUsageSummary,
  withTenant,
  withSuperAdminBypass,
  type Database,
} from "@adserve/database";
import { and, eq, sql } from "drizzle-orm";

import type {
  UsageRecord,
  UsageSummary,
  UsageLimit,
  TokenUsage,
  AICapability,
  AIModel,
  UsageStatus,
} from "./types";
import { DEFAULT_MONTHLY_COST_LIMIT_MICROS } from "./cost";

/**
 * Metering layer (Task 0.8). Backed by the RLS-protected tables
 * `ai_usage_log`, `ai_usage_summary`, `ai_usage_limits`.
 *
 * Each function accepts an OPTIONAL `tx`. In production the metering
 * functions are called from `aiComplete` with no ambient transaction, so
 * they open their own `withTenant()` / `withSuperAdminBypass()`. Tests
 * pass the `withTestTransaction` rollback handle as `tx` to run against a
 * transaction that never commits. The extra optional param keeps these
 * assignable to the `CheckLimitsFn` / `RecordUsageFn` seam types in
 * `client.ts`.
 *
 * RLS note: every tenant-scoped write sets `tenant_id` to the same id the
 * `withTenant()` session is scoped to, so the policy WITH CHECK passes in
 * production (local dev is superuser and bypasses RLS silently).
 */

// ============================================================
// Period helper — calendar month, UTC. Single source of truth so the
// read path (checkLimits / getCurrentPeriodSummary) and the write path
// (recordUsage) always agree on the period bucket.
// ============================================================

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Current calendar-month period as `YYYY-MM-DD` start/end strings (UTC). */
export function currentPeriod(now: Date = new Date()): {
  start: string;
  end: string;
} {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return {
    start: isoDate(new Date(Date.UTC(y, m, 1))),
    end: isoDate(new Date(Date.UTC(y, m + 1, 0))), // last day of month
  };
}

// ============================================================
// Context helpers
// ============================================================

async function inTenant<T>(
  tenantId: string,
  tx: Database | undefined,
  fn: (db: Database) => Promise<T>
): Promise<T> {
  if (tx) return fn(tx);
  return withTenant(tenantId, (t) => fn(t as Database));
}

async function inBypass<T>(
  tx: Database | undefined,
  fn: (db: Database) => Promise<T>
): Promise<T> {
  if (tx) return fn(tx);
  return withSuperAdminBypass((t) => fn(t as Database));
}

function toUsageRecord(row: typeof aiUsageLog.$inferSelect): UsageRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId ?? "",
    module: row.module,
    capability: row.capability as AICapability,
    model: row.model as AIModel,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    costMicros: row.costMicros,
    durationMs: row.durationMs,
    status: row.status as UsageStatus,
    errorMessage: row.errorMessage,
    requestMetadata:
      (row.requestMetadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
  };
}

// ============================================================
// checkLimits — called before every API call
// ============================================================

/**
 * Whether the tenant is within its cost (and optional token) cap for the
 * current period. Returns `over_limit` to short-circuit the call.
 *
 * Fail-safe: a missing limits row falls back to the default cap (never
 * unlimited); a missing summary row means zero usage so far.
 */
export async function checkLimits(
  args: { tenantId: string },
  tx?: Database
): Promise<{ ok: true } | { ok: false; reason: "over_limit" }> {
  const { tenantId } = args;
  return inTenant(tenantId, tx, async (db) => {
    const [limit] = await db
      .select()
      .from(aiUsageLimits)
      .where(eq(aiUsageLimits.tenantId, tenantId))
      .limit(1);

    const costCap =
      limit?.monthlyCostLimitMicros ?? DEFAULT_MONTHLY_COST_LIMIT_MICROS;
    const tokenCap = limit?.monthlyTokenLimit ?? null;

    const { start } = currentPeriod();
    const [summary] = await db
      .select()
      .from(aiUsageSummary)
      .where(
        and(
          eq(aiUsageSummary.tenantId, tenantId),
          eq(aiUsageSummary.periodStart, start)
        )
      )
      .limit(1);

    const usedCost = summary?.totalCostMicros ?? 0;
    const usedTokens = summary?.totalTokens ?? 0;

    if (usedCost >= costCap) return { ok: false, reason: "over_limit" };
    if (tokenCap != null && usedTokens >= tokenCap) {
      return { ok: false, reason: "over_limit" };
    }
    return { ok: true };
  });
}

// ============================================================
// recordUsage — called after every call (success / error / etc.)
// ============================================================

/**
 * Write one `ai_usage_log` row for the call. On `status === 'success'`
 * also roll the call up into the current period's `ai_usage_summary`
 * (atomic UPSERT). Error / rate-limit / over-limit attempts are logged
 * but do NOT move the summary (they carry zero billable cost).
 */
export async function recordUsage(
  record: {
    tenantId: string;
    userId: string;
    module: string;
    capability: AICapability;
    model: AIModel;
    tokenUsage: TokenUsage;
    costMicros: number;
    durationMs: number;
    status: UsageStatus;
    errorMessage?: string;
    requestMetadata?: Record<string, unknown>;
  },
  tx?: Database
): Promise<UsageRecord> {
  const {
    tenantId,
    userId,
    module,
    capability,
    model,
    tokenUsage,
    costMicros,
    durationMs,
    status,
    errorMessage,
    requestMetadata,
  } = record;

  return inTenant(tenantId, tx, async (db) => {
    const [logRow] = await db
      .insert(aiUsageLog)
      .values({
        tenantId,
        userId: userId || null,
        module,
        capability,
        model,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        totalTokens: tokenUsage.totalTokens,
        costMicros,
        durationMs,
        status,
        errorMessage: errorMessage ?? null,
        requestMetadata: requestMetadata ?? null,
      })
      .returning();

    if (status === "success") {
      const { start, end } = currentPeriod();
      const key = `${module}.${capability}`;

      await db
        .insert(aiUsageSummary)
        .values({
          tenantId,
          periodStart: start,
          periodEnd: end,
          totalTokens: tokenUsage.totalTokens,
          totalCostMicros: costMicros,
          requestCount: 1,
          breakdown: {
            [key]: {
              tokens: tokenUsage.totalTokens,
              costMicros,
              count: 1,
            },
          },
        })
        .onConflictDoUpdate({
          target: [aiUsageSummary.tenantId, aiUsageSummary.periodStart],
          set: {
            totalTokens: sql`${aiUsageSummary.totalTokens} + ${tokenUsage.totalTokens}`,
            totalCostMicros: sql`${aiUsageSummary.totalCostMicros} + ${costMicros}`,
            requestCount: sql`${aiUsageSummary.requestCount} + 1`,
            // Merge the per-capability entry. create_missing=true (4th arg)
            // handles the first time this module.capability key appears in
            // the period; coalesce handles accumulation onto an existing key.
            breakdown: sql`jsonb_set(
              coalesce(${aiUsageSummary.breakdown}, '{}'::jsonb),
              ARRAY[${key}],
              jsonb_build_object(
                'tokens', coalesce((${aiUsageSummary.breakdown} -> ${key} ->> 'tokens')::bigint, 0) + ${tokenUsage.totalTokens},
                'costMicros', coalesce((${aiUsageSummary.breakdown} -> ${key} ->> 'costMicros')::bigint, 0) + ${costMicros},
                'count', coalesce((${aiUsageSummary.breakdown} -> ${key} ->> 'count')::int, 0) + 1
              ),
              true
            )`,
            updatedAt: sql`now()`,
          },
        });
    }

    return toUsageRecord(logRow);
  });
}

// ============================================================
// Reads
// ============================================================

/** Current billing-period summary for a tenant (null if no usage yet). */
export async function getCurrentPeriodSummary(
  args: { tenantId: string },
  tx?: Database
): Promise<UsageSummary | null> {
  const { tenantId } = args;
  return inTenant(tenantId, tx, async (db) => {
    const { start } = currentPeriod();
    const [s] = await db
      .select()
      .from(aiUsageSummary)
      .where(
        and(
          eq(aiUsageSummary.tenantId, tenantId),
          eq(aiUsageSummary.periodStart, start)
        )
      )
      .limit(1);
    if (!s) return null;
    return {
      tenantId,
      periodStart: new Date(s.periodStart),
      periodEnd: new Date(s.periodEnd),
      totalTokens: s.totalTokens,
      totalCostMicros: s.totalCostMicros,
      requestCount: s.requestCount,
      breakdown: (s.breakdown as Record<string, unknown>) ?? {},
    };
  });
}

/** A tenant's configured usage limits (null if none seeded). */
export async function getUsageLimits(
  args: { tenantId: string },
  tx?: Database
): Promise<UsageLimit | null> {
  const { tenantId } = args;
  return inTenant(tenantId, tx, async (db) => {
    const [l] = await db
      .select()
      .from(aiUsageLimits)
      .where(eq(aiUsageLimits.tenantId, tenantId))
      .limit(1);
    if (!l) return null;
    return {
      tenantId,
      monthlyTokenLimit: l.monthlyTokenLimit ?? null,
      monthlyCostLimitMicros: l.monthlyCostLimitMicros,
    };
  });
}

// ============================================================
// Writes — super-admin
// ============================================================

/**
 * Create or update a tenant's usage limits. Super-admin only — runs under
 * `withSuperAdminBypass` since super admin is not a tenant member. Only
 * provided fields are updated; a fresh row gets the default cost cap.
 */
export async function setUsageLimits(
  args: {
    tenantId: string;
    monthlyTokenLimit?: number | null;
    monthlyCostLimitMicros?: number;
  },
  tx?: Database
): Promise<UsageLimit> {
  const { tenantId, monthlyTokenLimit, monthlyCostLimitMicros } = args;
  return inBypass(tx, async (db) => {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (monthlyCostLimitMicros !== undefined) {
      set.monthlyCostLimitMicros = monthlyCostLimitMicros;
    }
    if (monthlyTokenLimit !== undefined) {
      set.monthlyTokenLimit = monthlyTokenLimit;
    }

    const [row] = await db
      .insert(aiUsageLimits)
      .values({
        tenantId,
        monthlyCostLimitMicros:
          monthlyCostLimitMicros ?? DEFAULT_MONTHLY_COST_LIMIT_MICROS,
        monthlyTokenLimit: monthlyTokenLimit ?? null,
      })
      .onConflictDoUpdate({
        target: aiUsageLimits.tenantId,
        set,
      })
      .returning();

    return {
      tenantId,
      monthlyTokenLimit: row.monthlyTokenLimit ?? null,
      monthlyCostLimitMicros: row.monthlyCostLimitMicros,
    };
  });
}
