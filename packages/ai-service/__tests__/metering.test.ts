import { afterAll, describe, expect, test } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  createTestTenant,
  setupTestContext,
  testClient,
  withTestTransaction,
} from "@adserve/database/test-helpers";
import { aiUsageLimits, aiUsageLog, aiUsageSummary } from "@adserve/database";
import {
  checkLimits,
  recordUsage,
  getCurrentPeriodSummary,
  getUsageLimits,
  setUsageLimits,
  currentPeriod,
} from "../src/metering";
import type { TokenUsage } from "../src/types";

afterAll(async () => {
  await testClient.end();
});

const USAGE: TokenUsage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 };

function successRecord(tenantId: string, over: Record<string, unknown> = {}) {
  return {
    // Empty → stored as NULL (user_id is nullable); avoids needing a real
    // user row. Individual tests pass a real user.id when they care.
    tenantId,
    userId: "",
    module: "crm",
    capability: "record_creation" as const,
    model: "claude-sonnet-4-6",
    tokenUsage: USAGE,
    costMicros: 1_000,
    durationMs: 200,
    status: "success" as const,
    ...over,
  };
}

describe("recordUsage", () => {
  test("success: writes a log row AND upserts the period summary", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant, user } = await setupTestContext(tx);

      const rec = await recordUsage(
        successRecord(tenant.id, { userId: user.id }),
        tx
      );
      expect(rec.status).toBe("success");

      const logs = await tx
        .select()
        .from(aiUsageLog)
        .where(eq(aiUsageLog.tenantId, tenant.id));
      expect(logs).toHaveLength(1);
      expect(logs[0].costMicros).toBe(1_000);
      expect(logs[0].totalTokens).toBe(150);

      const summary = await getCurrentPeriodSummary({ tenantId: tenant.id }, tx);
      expect(summary).not.toBeNull();
      expect(summary!.totalCostMicros).toBe(1_000);
      expect(summary!.totalTokens).toBe(150);
      expect(summary!.requestCount).toBe(1);
      expect(summary!.breakdown).toMatchObject({
        "crm.record_creation": { count: 1, tokens: 150, costMicros: 1_000 },
      });
    });
  });

  test("two successes (same capability) accumulate atomically in the summary", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      await recordUsage(successRecord(tenant.id), tx);
      await recordUsage(successRecord(tenant.id, { costMicros: 2_500 }), tx);

      const summary = await getCurrentPeriodSummary({ tenantId: tenant.id }, tx);
      expect(summary!.totalCostMicros).toBe(3_500);
      expect(summary!.totalTokens).toBe(300);
      expect(summary!.requestCount).toBe(2);
      expect(summary!.breakdown).toMatchObject({
        "crm.record_creation": { count: 2, tokens: 300, costMicros: 3_500 },
      });
    });
  });

  test("breakdown gains a NEW key for a different capability (first-touch merge)", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      await recordUsage(successRecord(tenant.id), tx); // record_creation
      await recordUsage(
        successRecord(tenant.id, {
          capability: "smart_search",
          costMicros: 700,
        }),
        tx
      );

      const summary = await getCurrentPeriodSummary({ tenantId: tenant.id }, tx);
      expect(summary!.requestCount).toBe(2);
      expect(summary!.totalCostMicros).toBe(1_700);
      expect(summary!.breakdown).toMatchObject({
        "crm.record_creation": { count: 1, costMicros: 1_000 },
        "crm.smart_search": { count: 1, costMicros: 700 },
      });
    });
  });

  test("error: writes a log row but does NOT move the summary", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      await recordUsage(
        successRecord(tenant.id, {
          status: "error",
          costMicros: 0,
          errorMessage: "boom",
        }),
        tx
      );

      const logs = await tx
        .select()
        .from(aiUsageLog)
        .where(eq(aiUsageLog.tenantId, tenant.id));
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe("error");
      expect(logs[0].errorMessage).toBe("boom");

      const summary = await getCurrentPeriodSummary({ tenantId: tenant.id }, tx);
      expect(summary).toBeNull();
    });
  });

  test("over_limit: logs the attempt but does NOT move the summary", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      await recordUsage(
        successRecord(tenant.id, { status: "over_limit", costMicros: 0 }),
        tx
      );
      const logs = await tx
        .select()
        .from(aiUsageLog)
        .where(eq(aiUsageLog.tenantId, tenant.id));
      expect(logs[0].status).toBe("over_limit");
      const summary = await getCurrentPeriodSummary({ tenantId: tenant.id }, tx);
      expect(summary).toBeNull();
    });
  });
});

describe("checkLimits", () => {
  test("allows when usage is under the cap", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      await setUsageLimits(
        { tenantId: tenant.id, monthlyCostLimitMicros: 10_000 },
        tx
      );
      await recordUsage(successRecord(tenant.id, { costMicros: 5_000 }), tx);

      const res = await checkLimits({ tenantId: tenant.id }, tx);
      expect(res.ok).toBe(true);
    });
  });

  test("blocks at-or-over the cap", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      await setUsageLimits(
        { tenantId: tenant.id, monthlyCostLimitMicros: 5_000 },
        tx
      );
      await recordUsage(successRecord(tenant.id, { costMicros: 5_000 }), tx);

      const res = await checkLimits({ tenantId: tenant.id }, tx);
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error("unreachable");
      expect(res.reason).toBe("over_limit");
    });
  });

  test("falls back to the default cap when no limits row exists (fail-safe)", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      // No setUsageLimits — record just over the $50 default (50_000_000).
      await recordUsage(
        successRecord(tenant.id, { costMicros: 50_000_000 }),
        tx
      );
      const res = await checkLimits({ tenantId: tenant.id }, tx);
      expect(res.ok).toBe(false);
    });
  });

  test("enforces the optional token cap", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);
      await setUsageLimits(
        {
          tenantId: tenant.id,
          monthlyCostLimitMicros: 1_000_000_000,
          monthlyTokenLimit: 100,
        },
        tx
      );
      await recordUsage(successRecord(tenant.id), tx); // 150 tokens > 100
      const res = await checkLimits({ tenantId: tenant.id }, tx);
      expect(res.ok).toBe(false);
    });
  });
});

describe("setUsageLimits / getUsageLimits", () => {
  test("creates then updates a tenant's limits", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);

      const created = await setUsageLimits(
        { tenantId: tenant.id, monthlyCostLimitMicros: 25_000_000 },
        tx
      );
      expect(created.monthlyCostLimitMicros).toBe(25_000_000);

      const updated = await setUsageLimits(
        { tenantId: tenant.id, monthlyCostLimitMicros: 99_000_000 },
        tx
      );
      expect(updated.monthlyCostLimitMicros).toBe(99_000_000);

      // Only one row exists (upsert, not insert).
      const rows = await tx
        .select()
        .from(aiUsageLimits)
        .where(eq(aiUsageLimits.tenantId, tenant.id));
      expect(rows).toHaveLength(1);

      const fetched = await getUsageLimits({ tenantId: tenant.id }, tx);
      expect(fetched!.monthlyCostLimitMicros).toBe(99_000_000);
    });
  });
});

describe("currentPeriod", () => {
  test("returns the calendar-month bounds in UTC as YYYY-MM-DD", () => {
    const { start, end } = currentPeriod(new Date(Date.UTC(2026, 1, 15)));
    expect(start).toBe("2026-02-01");
    expect(end).toBe("2026-02-28");
  });
});

// ---------------------------------------------------------------------------
// RLS enforcement — the prod-only path. Local dev / the test connection are
// superuser and bypass RLS, so we drop to the non-superuser `adserve_rls_test`
// role (created by sql/002-create-rls-test-role.sql) to exercise the policy
// WITH CHECK that protects against cross-tenant writes in production.
// ---------------------------------------------------------------------------
describe("RLS enforcement (non-superuser role)", () => {
  test("a tenant-scoped session cannot write a row for ANOTHER tenant", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx); // tenant A
      const tenantB = await createTestTenant(tx); // exists, so FK is satisfied

      // Scope the session to tenant A, then drop superuser.
      await tx.execute(
        sql`SELECT set_config('app.current_tenant_id', ${tenant.id}, true)`
      );
      await tx.execute(sql`SET LOCAL ROLE adserve_rls_test`);

      // Writing a row for tenant B violates the WITH CHECK policy.
      await expect(
        tx.insert(aiUsageLog).values({
          tenantId: tenantB.id,
          module: "crm",
          capability: "record_creation",
          model: "claude-sonnet-4-6",
          status: "success",
        })
      ).rejects.toThrow();
    });
  });

  test("a tenant-scoped session CAN write a row for its own tenant", async () => {
    await withTestTransaction(async (tx) => {
      const { tenant } = await setupTestContext(tx);

      await tx.execute(
        sql`SELECT set_config('app.current_tenant_id', ${tenant.id}, true)`
      );
      await tx.execute(sql`SET LOCAL ROLE adserve_rls_test`);

      const inserted = await tx
        .insert(aiUsageLog)
        .values({
          tenantId: tenant.id,
          module: "crm",
          capability: "record_creation",
          model: "claude-sonnet-4-6",
          status: "success",
        })
        .returning({ id: aiUsageLog.id });
      expect(inserted).toHaveLength(1);

      // And RLS scopes reads to the same tenant.
      const visible = await tx
        .select()
        .from(aiUsageLog)
        .where(eq(aiUsageLog.tenantId, tenant.id));
      expect(visible).toHaveLength(1);
    });
  });
});
