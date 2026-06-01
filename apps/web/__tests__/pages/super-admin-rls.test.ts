import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { testDb } from "@adserve/database/test-helpers";
import { aiUsageSummary, tenants, withTenant, withSuperAdminBypass } from "@adserve/database";
import { currentPeriod } from "@adserve/ai-service";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";
import {
  loadSuperAdminAiUsageDetail,
  loadSuperAdminAiUsageList,
  loadSuperAdminDashboard,
  loadSuperAdminModuleDetail,
  loadSuperAdminTenantDetail,
  loadSuperAdminTenantForEdit,
  loadSuperAdminTenantsList,
  loadSuperAdminUsers,
} from "@/lib/super-admin/loaders";

/**
 * Cross-tenant RLS coverage for the /super-admin/** data paths. Each loader
 * owns its own withSuperAdminBypass(); the tests run under the NOBYPASSRLS
 * adserve_app role. The cross-tenant assertions are LOAD-BEARING: if a loader's
 * bypass were removed, it would run with no tenant context and RLS (NULLIF
 * guard → NULL) would scope it to nothing, so "sees both tenants" / "loads
 * tenant B" would fail rather than silently pass. An explicit bypass-vs-
 * no-bypass control on `tenants` demonstrates the mechanism directly.
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

async function seedSummary(crm: CrmTestSetup, cost: number) {
  const { start, end } = currentPeriod();
  await testDb.insert(aiUsageSummary).values({
    tenantId: crm.tenantId,
    periodStart: start,
    periodEnd: end,
    totalTokens: 10,
    totalCostMicros: cost,
    requestCount: 1,
  });
}

describe("super-admin bypass surface — cross-tenant visibility under enforced RLS", () => {
  test("CONTROL: bypass sees both tenants; withTenant(A) sees only A (mechanism)", async () => {
    const all = await withSuperAdminBypass((tx) => tx.select({ id: tenants.id }).from(tenants));
    const ids = all.map((t) => t.id);
    expect(ids).toContain(tenantA.tenantId);
    expect(ids).toContain(tenantB.tenantId); // bypass = cross-tenant

    const scoped = await withTenant(tenantA.tenantId, (tx) => tx.select({ id: tenants.id }).from(tenants));
    const scopedIds = scoped.map((t) => t.id);
    expect(scopedIds).toContain(tenantA.tenantId);
    expect(scopedIds).not.toContain(tenantB.tenantId); // no bypass = scoped → a forgotten bypass fails
  });

  test("dashboard: counts + recent tenants span both tenants", async () => {
    const d = await loadSuperAdminDashboard();
    expect(d.activeTenants).toBeGreaterThanOrEqual(2);
    const ids = d.recentTenants.map((t) => t.id);
    // recentTenants is limited to 5 newest; A & B were just created, so present.
    expect(ids).toContain(tenantA.tenantId);
    expect(ids).toContain(tenantB.tenantId);
  });

  test("tenants list shows both tenants", async () => {
    const rows = await loadSuperAdminTenantsList();
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(tenantA.tenantId);
    expect(ids).toContain(tenantB.tenantId);
  });

  test("tenant detail loads ANY tenant by id (cross-tenant)", async () => {
    const data = await loadSuperAdminTenantDetail(tenantB.tenantId);
    expect(data).not.toBeNull();
    expect(data!.tenant.id).toBe(tenantB.tenantId);
    expect(data!.members.length).toBeGreaterThan(0); // tenant_memberships visible cross-tenant
  });

  test("tenant edit loads ANY tenant by id (cross-tenant)", async () => {
    const tenant = await loadSuperAdminTenantForEdit(tenantB.tenantId);
    expect(tenant).not.toBeNull();
    expect(tenant!.id).toBe(tenantB.tenantId);
  });

  test("module detail lists every tenant with the module enabled (cross-tenant tenant_modules)", async () => {
    const data = await loadSuperAdminModuleDetail("crm");
    expect(data).not.toBeNull();
    const ids = data!.enabledTenants.map((t) => t.tenantId);
    expect(ids).toContain(tenantA.tenantId);
    expect(ids).toContain(tenantB.tenantId);
  });

  test("users list spans both tenants' memberships (cross-tenant tenant_memberships)", async () => {
    const { userRows, memberships } = await loadSuperAdminUsers();
    const userIds = userRows.map((u) => u.id);
    expect(userIds).toContain(tenantA.owner.id);
    expect(userIds).toContain(tenantB.owner.id);
    const memberTenantIds = new Set(memberships.map((m) => m.tenantId));
    expect(memberTenantIds.has(tenantA.tenantId)).toBe(true);
    expect(memberTenantIds.has(tenantB.tenantId)).toBe(true);
  });

  test("ai-usage list spans both tenants (cross-tenant ai_usage_summary)", async () => {
    await seedSummary(tenantA, 1000);
    await seedSummary(tenantB, 2000);
    const rows = await loadSuperAdminAiUsageList();
    const byTenant = new Map(rows.map((r) => [r.tenantId, r.totalCostMicros]));
    expect(byTenant.has(tenantA.tenantId)).toBe(true);
    expect(byTenant.has(tenantB.tenantId)).toBe(true);
    expect(byTenant.get(tenantA.tenantId)).toBe(1000);
    expect(byTenant.get(tenantB.tenantId)).toBe(2000);
  });

  test("ai-usage detail loads ANY tenant's usage by id (cross-tenant)", async () => {
    await seedSummary(tenantB, 4242);
    const data = await loadSuperAdminAiUsageDetail(tenantB.tenantId);
    expect(data).not.toBeNull();
    expect(data!.tenant.id).toBe(tenantB.tenantId);
    expect(data!.summary?.totalCostMicros).toBe(4242);
  });
});
