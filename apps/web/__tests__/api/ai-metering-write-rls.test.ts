import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { testDb } from "@adserve/database/test-helpers";
import { aiUsageLog, aiUsageSummary, withTenant } from "@adserve/database";
import {
  aiComplete,
  calculateCostMicros,
  currentPeriod,
  DEFAULT_MONTHLY_COST_LIMIT_MICROS,
  resolveModelForCapability,
  type AIServiceDeps,
} from "@adserve/ai-service";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";

/**
 * Coverage gap #2: the metering WRITE path under enforced RLS.
 *
 * The AI feature tests mock aiComplete wholesale, so recordUsage's INSERT into
 * the RLS-protected ai_usage_log (+ the ai_usage_summary upsert + checkLimits
 * read) never execute. This test runs the REAL metering path: it mocks ONLY the
 * Anthropic API call (deps.client), leaving checkLimits/recordUsage at their
 * defaults — which open their own withTenant() on the app db client. In this
 * harness that client is the NOBYPASSRLS `adserve_app` role, so the writes are
 * subject to RLS exactly as in prod. If the insert silently failed under RLS
 * (wrong context / missing grant / policy blocking the tenant insert), the
 * read-backs below find nothing and these tests fail — surfacing the prod
 * empty-metering symptom.
 */
let tenantA: CrmTestSetup;
let tenantB: CrmTestSetup;

beforeEach(async () => {
  tenantA = await setupCrmTenant();
  tenantB = await setupCrmTenant();
});
afterEach(async () => {
  if (tenantA?.tenantId) await teardownCrmTenant(tenantA.tenantId);
  if (tenantB?.tenantId) await teardownCrmTenant(tenantB.tenantId);
});

/** Fake Anthropic client — the ONLY thing mocked (the HTTP/model boundary). */
function fakeAnthropic(inputTokens: number, outputTokens: number) {
  const create = vi.fn(async () => ({
    content: [{ type: "text", text: "ok" }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  }));
  const deps: AIServiceDeps = {
    client: { messages: { create } } as unknown as AIServiceDeps["client"],
  };
  return { deps, create };
}

const summarizeReq = (crm: CrmTestSetup) => ({
  tenantId: crm.tenantId,
  userId: crm.owner.id,
  module: "crm",
  capability: "activity_summary" as const,
  messages: [{ role: "user" as const, content: "Summarize this." }],
});

// Locked cost math (mirrors cost.test.ts): sonnet-4-6 = $3/$15 per MTok.
// 1000 in + 500 out = 3_000 + 7_500 = 10_500 micros.
const SONNET_1K_500 = 10_500;

describe("metering write path under enforced RLS (adserve_app)", () => {
  test("DECISIVE: recordUsage INSERT actually lands for tenant A", async () => {
    const { deps, create } = fakeAnthropic(1000, 500);
    const res = await aiComplete(summarizeReq(tenantA), deps);

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error(res.error.message);
    expect(create).toHaveBeenCalledTimes(1);

    const model = resolveModelForCapability("activity_summary");
    expect(calculateCostMicros(model, { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 })).toBe(SONNET_1K_500);
    expect(res.costMicros).toBe(SONNET_1K_500);

    // Read the log back as adserve_app under tenant A's context — proves the
    // row landed under enforced RLS (no-predicate select; RLS scopes to A).
    const rows = await withTenant(tenantA.tenantId, (tx) => tx.select().from(aiUsageLog));
    expect(rows.length).toBe(1);
    expect(rows[0].tenantId).toBe(tenantA.tenantId);
    expect(rows[0].totalTokens).toBe(1500);
    expect(rows[0].costMicros).toBe(SONNET_1K_500);
    expect(rows[0].status).toBe("success");
  });

  test("summary accumulates across multiple successful calls", async () => {
    await aiComplete(summarizeReq(tenantA), fakeAnthropic(1000, 500).deps);
    await aiComplete(summarizeReq(tenantA), fakeAnthropic(1000, 500).deps);

    const { start } = currentPeriod();
    const [summary] = await withTenant(tenantA.tenantId, (tx) =>
      tx.select().from(aiUsageSummary)
    );
    expect(summary).toBeTruthy();
    expect(summary.periodStart).toBe(start);
    expect(summary.requestCount).toBe(2);
    expect(summary.totalTokens).toBe(3000);
    expect(summary.totalCostMicros).toBe(SONNET_1K_500 * 2);
  });

  test("ISOLATION: tenant A's usage is invisible to tenant B (STRONG, no predicate)", async () => {
    await aiComplete(summarizeReq(tenantA), fakeAnthropic(1000, 500).deps);

    // Under B's context, a no-predicate select sees none of A's rows — only RLS
    // does the scoping here.
    const logB = await withTenant(tenantB.tenantId, (tx) => tx.select().from(aiUsageLog));
    expect(logB.length).toBe(0);
    const sumB = await withTenant(tenantB.tenantId, (tx) => tx.select().from(aiUsageSummary));
    expect(sumB.length).toBe(0);

    // Sanity: A does see its own.
    const logA = await withTenant(tenantA.tenantId, (tx) => tx.select().from(aiUsageLog));
    expect(logA.length).toBe(1);
  });
});

describe("cap as a runtime gate (checkLimits) — currency-consistent in microdollars", () => {
  async function seedSummaryCost(crm: CrmTestSetup, totalCostMicros: number) {
    const { start, end } = currentPeriod();
    await testDb.insert(aiUsageSummary).values({
      tenantId: crm.tenantId,
      periodStart: start,
      periodEnd: end,
      totalTokens: 0,
      totalCostMicros,
      requestCount: 1,
    });
  }

  test("at/over the $50 cap → next call BLOCKED, Anthropic never called", async () => {
    // No limits row → default cap applies (fail-safe). Seed usage AT the cap.
    await seedSummaryCost(tenantA, DEFAULT_MONTHLY_COST_LIMIT_MICROS);
    const { deps, create } = fakeAnthropic(1000, 500);
    const res = await aiComplete(summarizeReq(tenantA), deps);

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected over_limit");
    expect(res.error.code).toBe("over_limit");
    expect(create).not.toHaveBeenCalled(); // short-circuited before the API
  });

  test("just UNDER the cap (cap-1 micros) → allowed — comparison is micro-exact", async () => {
    await seedSummaryCost(tenantA, DEFAULT_MONTHLY_COST_LIMIT_MICROS - 1);
    const { deps, create } = fakeAnthropic(1000, 500);
    const res = await aiComplete(summarizeReq(tenantA), deps);

    expect(res.ok).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("currency consistency: cap is $50 in microdollars, same unit as cost", () => {
    // cost.ts computes cost in MICRODOLLARS (calculateCostMicros). The cap is
    // 50_000_000 micros = $50 USD. checkLimits compares totalCostMicros (micros)
    // >= cap (micros) — same unit end to end. GBP is display-only; there is NO
    // £-vs-$ unit mismatch between cost.ts and the cap check. The boundary tests
    // above (cap-1 allowed, cap blocked) prove the comparison is micro-exact.
    expect(DEFAULT_MONTHLY_COST_LIMIT_MICROS).toBe(50_000_000);
  });
});
