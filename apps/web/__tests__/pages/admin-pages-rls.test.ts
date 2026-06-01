import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { testDb } from "@adserve/database/test-helpers";
import {
  aiUsageSummary,
  fieldDefinitions,
  roles,
  tenantMemberships,
  withTenant,
} from "@adserve/database";
import { getEntityTypeBySlug, listFieldDefinitions } from "@adserve/module-framework";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";

/**
 * RLS coverage for the /admin/** page reads that touch RLS tables (roles,
 * tenant_memberships, ai_usage_*, field_definitions). Each "strong" test runs
 * a query with NO explicit tenant predicate under tenant A's withTenant()
 * context as `adserve_app` — so only RLS can scope the result. If RLS were not
 * enforced (or context not set), tenant B's rows would leak.
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

describe("/admin/roles + /admin/users reads under enforced RLS", () => {
  test("STRONG: roles query with no tenant predicate returns only tenant A's roles", async () => {
    // setupCrmTenant creates owner + member roles per tenant.
    const visible = await withTenant(tenantA.tenantId, (tx) => tx.select().from(roles));
    const tenantIds = new Set(visible.map((r) => r.tenantId));
    expect(visible.length).toBeGreaterThan(0); // positive: context + grants work
    expect([...tenantIds]).toEqual([tenantA.tenantId]); // isolation: only A
    expect(tenantIds.has(tenantB.tenantId)).toBe(false);
  });

  test("STRONG: tenant_memberships with no predicate returns only tenant A's", async () => {
    const visible = await withTenant(tenantA.tenantId, (tx) =>
      tx.select().from(tenantMemberships)
    );
    const tenantIds = new Set(visible.map((m) => m.tenantId));
    expect(visible.length).toBeGreaterThan(0);
    expect([...tenantIds]).toEqual([tenantA.tenantId]);
  });
});

describe("/admin/ai-usage reads under enforced RLS (metering tables)", () => {
  test("STRONG: ai_usage_summary with no predicate returns only tenant A's", async () => {
    const period = { periodStart: "2026-06-01", periodEnd: "2026-06-30" };
    await testDb.insert(aiUsageSummary).values({
      tenantId: tenantA.tenantId,
      ...period,
      totalTokens: 100,
      totalCostMicros: 5000,
      requestCount: 1,
    });
    await testDb.insert(aiUsageSummary).values({
      tenantId: tenantB.tenantId,
      ...period,
      totalTokens: 999,
      totalCostMicros: 99999,
      requestCount: 9,
    });

    const visible = await withTenant(tenantA.tenantId, (tx) =>
      tx.select().from(aiUsageSummary)
    );
    const tenantIds = new Set(visible.map((s) => s.tenantId));
    expect(tenantIds.has(tenantA.tenantId)).toBe(true); // positive
    expect(tenantIds.has(tenantB.tenantId)).toBe(false); // isolation
  });
});

describe("/admin/crm/fields read under enforced RLS", () => {
  test("listFieldDefinitions returns tenant A's account fields (positive)", async () => {
    const entity = await getEntityTypeBySlug(testDb, {
      tenantId: tenantA.tenantId,
      slug: "account",
    });
    const fields = await withTenant(tenantA.tenantId, (tx) =>
      listFieldDefinitions(tx, { tenantId: tenantA.tenantId, entityTypeId: entity!.id })
    );
    expect(fields.length).toBeGreaterThan(0);

    // STRONG: field_definitions with no predicate, under A's context, is A-only.
    const allVisible = await withTenant(tenantA.tenantId, (tx) =>
      tx.select().from(fieldDefinitions)
    );
    const tenantIds = new Set(allVisible.map((f) => f.tenantId));
    expect([...tenantIds]).toEqual([tenantA.tenantId]);
  });
});
