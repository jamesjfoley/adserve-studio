import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { testDb } from "@adserve/database/test-helpers";
import { records, withTenant } from "@adserve/database";
import { getEntityTypeBySlug } from "@adserve/module-framework";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";
import { loadCrmDashboardData } from "@/lib/crm/load-dashboard-data";
import { loadPipelineData } from "@/lib/crm/load-pipeline-data";

/**
 * End-to-end RLS coverage for the dashboard (/crm) and pipeline (/crm/pipeline)
 * pages: tests the EXTRACTED page data paths, which own each page's own
 * withTenant() — so a forgotten context fails the positive assertion (RLS
 * returns empty). Run as the NOBYPASSRLS adserve_app role.
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

async function seedRecord(
  crm: CrmTestSetup,
  slug: string,
  data: Record<string, unknown>
): Promise<string> {
  const entity = await getEntityTypeBySlug(testDb, { tenantId: crm.tenantId, slug });
  const [row] = await testDb
    .insert(records)
    .values({ tenantId: crm.tenantId, entityTypeId: entity!.id, data, ownedBy: crm.owner.id })
    .returning();
  return row.id;
}

const ALL_SLUGS = ["account", "contact", "lead", "opportunity"];

describe("/crm dashboard page data path (loadCrmDashboardData) under enforced RLS", () => {
  test("recently-modified shows tenant A's record (positive) and not B's (isolation)", async () => {
    const aId = await seedRecord(tenantA, "account", { name: "Acme A" });
    const bId = await seedRecord(tenantB, "account", { name: "Beta B" });

    const data = await loadCrmDashboardData({
      tenantId: tenantA.tenantId,
      readableSlugs: ALL_SLUGS,
      pipelineEntities: ["campaign", "opportunity"],
      canLead: true,
      canActivities: true,
      canForecast: true,
    });
    const recentIds = data.recent.map((r) => r.id);
    expect(recentIds).toContain(aId); // positive: page's withTenant established context
    expect(recentIds).not.toContain(bId); // isolation
  });
});

describe("/crm/pipeline page data path (loadPipelineData) under enforced RLS", () => {
  test("board shows tenant A's opportunities (positive) and not B's (isolation)", async () => {
    const aOpp = await seedRecord(tenantA, "opportunity", {
      stage: "qualification",
      amount: { amount: 1000, currency: "GBP" },
    });
    const bOpp = await seedRecord(tenantB, "opportunity", {
      stage: "qualification",
      amount: { amount: 2000, currency: "GBP" },
    });

    const data = await loadPipelineData({ tenantId: tenantA.tenantId });
    expect(data.board).not.toBeNull();
    const cardIds = data.board!.columns.flatMap((c) => c.cards.map((card) => card.id));
    expect(cardIds).toContain(aOpp);
    expect(cardIds).not.toContain(bOpp);
  });
});

describe("records table RLS (underlies all CRM pages)", () => {
  test("STRONG: SELECT records with no tenant predicate under A returns only A's", async () => {
    const aId = await seedRecord(tenantA, "account", { name: "Acme A" });
    const bId = await seedRecord(tenantB, "account", { name: "Beta B" });

    const rows = await withTenant(tenantA.tenantId, (tx) => tx.select().from(records));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(aId); // positive
    expect(ids).not.toContain(bId); // RLS alone keeps B out (no predicate used)
  });
});
