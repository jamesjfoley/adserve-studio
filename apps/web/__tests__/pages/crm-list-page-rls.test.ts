import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { testDb } from "@adserve/database/test-helpers";
import { records } from "@adserve/database";
import { getEntityTypeBySlug } from "@adserve/module-framework";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";
import { parseListParams } from "@/lib/crm/query";
import { loadCrmListData } from "@/lib/crm/load-list-data";

/**
 * Page-level RLS test for /crm/[entityType] (the list page that crashed in
 * prod). Runs the page's real data path (loadCrmListData → withTenant) as the
 * NOBYPASSRLS `adserve_app` role (step-1 harness), with two tenants seeded
 * privileged.
 *
 * Asserts DATA CORRECTNESS, not just "doesn't throw":
 *   - tenant A's records ARE returned (positive — proves the page establishes
 *     RLS context AND adserve_app has the grants; with NULLIF a missing-context
 *     query would silently return empty),
 *   - tenant B's records are NOT visible (isolation holds).
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

async function seedAccount(
  crm: CrmTestSetup,
  name: string
): Promise<string> {
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

const defaultParsed = () => parseListParams(new URLSearchParams());

describe("CRM list page data path under enforced RLS (adserve_app)", () => {
  test("tenant A sees its own account rows (positive — context + grants work)", async () => {
    const a1 = await seedAccount(tenantA, "Acme A One");
    const a2 = await seedAccount(tenantA, "Acme A Two");

    const data = await loadCrmListData({
      tenantId: tenantA.tenantId,
      slug: "account",
      parsed: defaultParsed(),
      userId: tenantA.owner.id,
    });

    expect(data).not.toBeNull();
    const ids = data!.rows.map((r) => r.id);
    expect(ids).toContain(a1);
    expect(ids).toContain(a2);
    expect(data!.total).toBe(2);
  });

  test("tenant A does NOT see tenant B's accounts (isolation holds)", async () => {
    const a1 = await seedAccount(tenantA, "Acme A");
    const b1 = await seedAccount(tenantB, "Beta B");

    const data = await loadCrmListData({
      tenantId: tenantA.tenantId,
      slug: "account",
      parsed: defaultParsed(),
      userId: tenantA.owner.id,
    });

    const ids = data!.rows.map((r) => r.id);
    expect(ids).toContain(a1);
    expect(ids).not.toContain(b1);
    expect(data!.total).toBe(1);

    // And symmetrically, B sees only its own.
    const dataB = await loadCrmListData({
      tenantId: tenantB.tenantId,
      slug: "account",
      parsed: defaultParsed(),
      userId: tenantB.owner.id,
    });
    const idsB = dataB!.rows.map((r) => r.id);
    expect(idsB).toContain(b1);
    expect(idsB).not.toContain(a1);
    expect(dataB!.total).toBe(1);
  });

  test("a repeating text column yields an alphabetical facet", async () => {
    // name appears twice for "Acme" → repetition → eligible for a value picker.
    await seedAccount(tenantA, "Acme");
    await seedAccount(tenantA, "Acme");
    await seedAccount(tenantA, "Globex");

    const data = await loadCrmListData({
      tenantId: tenantA.tenantId,
      slug: "account",
      parsed: defaultParsed(),
      userId: tenantA.owner.id,
    });

    expect(data!.facets.name).toEqual(["Acme", "Globex"]);
  });

  test("an always-unique text column yields NO facet", async () => {
    // Every name distinct → no repetition → not offered as a filter.
    await seedAccount(tenantA, "Acme");
    await seedAccount(tenantA, "Globex");
    await seedAccount(tenantA, "Initech");

    const data = await loadCrmListData({
      tenantId: tenantA.tenantId,
      slug: "account",
      parsed: defaultParsed(),
      userId: tenantA.owner.id,
    });

    expect(data!.facets.name).toBeUndefined();
  });

  test("facets respect tenant isolation (only tenant A's values)", async () => {
    await seedAccount(tenantA, "Acme");
    await seedAccount(tenantA, "Acme");
    await seedAccount(tenantA, "Globex");
    await seedAccount(tenantB, "Beta");
    await seedAccount(tenantB, "Beta");
    await seedAccount(tenantB, "Zeta");

    const data = await loadCrmListData({
      tenantId: tenantA.tenantId,
      slug: "account",
      parsed: defaultParsed(),
      userId: tenantA.owner.id,
    });

    // Only tenant A's distinct values — never B's "Beta"/"Zeta".
    expect(data!.facets.name).toEqual(["Acme", "Globex"]);
  });

  test("unactivated entity type → null (page 404s)", async () => {
    const data = await loadCrmListData({
      tenantId: tenantA.tenantId,
      slug: "nonexistent-entity",
      parsed: defaultParsed(),
      userId: tenantA.owner.id,
    });
    expect(data).toBeNull();
  });
});
