import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { testDb } from "@adserve/database/test-helpers";
import { records } from "@adserve/database";
import { getEntityTypeBySlug } from "@adserve/module-framework";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";
import { loadCrmDetailData } from "@/lib/crm/load-detail-data";

/**
 * Page-level RLS test for /crm/[entityType]/[id]. Runs the real data path
 * (loadCrmDetailData → withTenant) as the NOBYPASSRLS `adserve_app` role.
 * The cross-tenant guard: requesting another tenant's record id under our
 * context must resolve to null (404), never their data.
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

async function seedAccount(crm: CrmTestSetup, name: string): Promise<string> {
  const entity = await getEntityTypeBySlug(testDb, {
    tenantId: crm.tenantId,
    slug: "account",
  });
  const [row] = await testDb
    .insert(records)
    .values({
      tenantId: crm.tenantId,
      entityTypeId: entity!.id,
      data: { name },
      ownedBy: crm.owner.id,
    })
    .returning();
  return row.id;
}

describe("CRM detail page data path under enforced RLS (adserve_app)", () => {
  test("tenant A loads its own record by id (positive)", async () => {
    const aId = await seedAccount(tenantA, "Acme A");
    const data = await loadCrmDetailData({
      tenantId: tenantA.tenantId,
      slug: "account",
      recordId: aId,
      canViewActivities: true,
    });
    expect(data).not.toBeNull();
    expect(data!.loaded.record.id).toBe(aId);
  });

  test("tenant A requesting tenant B's record id → null (isolation)", async () => {
    const bId = await seedAccount(tenantB, "Beta B");
    const data = await loadCrmDetailData({
      tenantId: tenantA.tenantId,
      slug: "account",
      recordId: bId,
      canViewActivities: true,
    });
    // RLS hides B's record from A's context → not found, NOT B's data.
    expect(data).toBeNull();
  });
});
