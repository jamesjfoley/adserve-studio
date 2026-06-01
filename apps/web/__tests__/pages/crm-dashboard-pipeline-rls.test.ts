import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { testDb } from "@adserve/database/test-helpers";
import { records, withTenant } from "@adserve/database";
import { getEntityTypeBySlug } from "@adserve/module-framework";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";
import { recentlyModifiedRecords } from "@/lib/crm/dashboard";
import { loadPipelineBoard } from "@/lib/crm/pipeline";

/**
 * RLS coverage for the dashboard (/crm) and pipeline (/crm/pipeline) page data
 * paths, run under the NOBYPASSRLS `adserve_app` role inside withTenant().
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

async function typeId(crm: CrmTestSetup, slug: string): Promise<string> {
  const e = await getEntityTypeBySlug(testDb, { tenantId: crm.tenantId, slug });
  return e!.id;
}

async function seedRecord(
  crm: CrmTestSetup,
  slug: string,
  data: Record<string, unknown>
): Promise<string> {
  const entityTypeId = await typeId(crm, slug);
  const [row] = await testDb
    .insert(records)
    .values({ tenantId: crm.tenantId, entityTypeId, data, ownedBy: crm.owner.id })
    .returning();
  return row.id;
}

describe("Dashboard recently-modified under enforced RLS", () => {
  test("STRONG isolation: B's record stays hidden even when B's type id is in the filter", async () => {
    const aAcct = await seedRecord(tenantA, "account", { name: "Acme A" });
    const bAcct = await seedRecord(tenantB, "account", { name: "Beta B" });
    const aTypeId = await typeId(tenantA, "account");
    const bTypeId = await typeId(tenantB, "account");

    // Run as tenant A, but deliberately pass BOTH type ids — only RLS can keep
    // B's row out (a type-id predicate alone would let it through).
    const rows = await withTenant(tenantA.tenantId, (tx) =>
      recentlyModifiedRecords(tx, {
        tenantId: tenantA.tenantId,
        entityTypeIds: [aTypeId, bTypeId],
      })
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(aAcct); // positive: context + grants work
    expect(ids).not.toContain(bAcct); // isolation: RLS blocks B
  });
});

describe("Pipeline board under enforced RLS", () => {
  test("tenant A's board shows its opportunities, not tenant B's", async () => {
    const aOpp = await seedRecord(tenantA, "opportunity", {
      stage: "qualification",
      amount: { amount: 1000, currency: "GBP" },
    });
    const bOpp = await seedRecord(tenantB, "opportunity", {
      stage: "qualification",
      amount: { amount: 2000, currency: "GBP" },
    });

    const board = await withTenant(tenantA.tenantId, (tx) =>
      loadPipelineBoard(tx, { tenantId: tenantA.tenantId })
    );
    expect(board).not.toBeNull();
    const cardIds = board!.columns.flatMap((c) => c.cards.map((card) => card.id));
    expect(cardIds).toContain(aOpp); // positive
    expect(cardIds).not.toContain(bOpp); // isolation
  });
});
