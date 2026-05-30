import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { testDb } from "@adserve/database/test-helpers";
import { activities, records } from "@adserve/database";
import { getEntityTypeBySlug } from "@adserve/module-framework";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";
import {
  pipelineValueByStage,
  recentlyModifiedRecords,
  upcomingActivities,
} from "@/lib/crm/dashboard";

// Fresh tenant per test — the aggregation queries sum across the whole
// tenant, so isolation is cleanest with a dedicated tenant each time.
let crm: CrmTestSetup;
beforeEach(async () => {
  crm = await setupCrmTenant();
});
afterEach(async () => {
  if (crm?.tenantId) await teardownCrmTenant(crm.tenantId);
});

async function entityId(slug: string): Promise<string> {
  const e = await getEntityTypeBySlug(testDb, { tenantId: crm.tenantId, slug });
  return e!.id;
}

async function insertRecord(
  slug: string,
  data: Record<string, unknown>,
  opts: { archived?: boolean; updatedAt?: Date } = {}
): Promise<string> {
  const entityTypeId = await entityId(slug);
  const [row] = await testDb
    .insert(records)
    .values({
      tenantId: crm.tenantId,
      entityTypeId,
      data,
      isArchived: opts.archived ?? false,
      ownedBy: crm.owner.id,
      ...(opts.updatedAt ? { updatedAt: opts.updatedAt } : {}),
    })
    .returning();
  return row.id;
}

async function insertTask(
  recordId: string,
  slug: string,
  dueDate: string | null,
  type = "task"
) {
  // The activity's entityTypeId must match the record's entity type — the
  // dashboard's permission boundary keys off it.
  const entityTypeId = await entityId(slug);
  await testDb.insert(activities).values({
    tenantId: crm.tenantId,
    recordId,
    entityTypeId,
    activityType: type as "task" | "call",
    subject: dueDate ? `Due ${dueDate}` : "No due",
    metadata: dueDate ? { dueDate } : {},
    performedBy: crm.owner.id,
  });
}

const STAGES = [
  { slug: "qualification", name: "Qualification" },
  { slug: "proposal", name: "Proposal" },
];

describe("pipelineValueByStage", () => {
  test("sums amounts by stage, coalesces missing amounts, ignores archived, buckets unknown", async () => {
    await insertRecord("opportunity", { name: "A", stage: "qualification", amount: { amount: 1000, currency: "GBP" } });
    await insertRecord("opportunity", { name: "B", stage: "qualification", amount: { amount: 500, currency: "GBP" } });
    await insertRecord("opportunity", { name: "C", stage: "qualification" }); // no amount → 0
    await insertRecord("opportunity", { name: "D", stage: "proposal", amount: { amount: 2000, currency: "GBP" } });
    await insertRecord("opportunity", { name: "E", stage: "qualification", amount: { amount: 9999, currency: "GBP" } }, { archived: true }); // ignored
    await insertRecord("opportunity", { name: "F", stage: "weird", amount: { amount: 100, currency: "GBP" } }); // unknown stage

    const result = await pipelineValueByStage(testDb, {
      tenantId: crm.tenantId,
      opportunityEntityTypeId: await entityId("opportunity"),
      stages: STAGES,
    });

    const bySlug = new Map(result.map((r) => [r.slug, r]));
    expect(bySlug.get("qualification")).toMatchObject({ total: 1500, count: 3 });
    expect(bySlug.get("proposal")).toMatchObject({ total: 2000, count: 1 });
    expect(bySlug.get("__other__")).toMatchObject({ total: 100, count: 1 });
  });

  test("configured stage with zero opportunities still renders at 0", async () => {
    const result = await pipelineValueByStage(testDb, {
      tenantId: crm.tenantId,
      opportunityEntityTypeId: await entityId("opportunity"),
      stages: STAGES,
    });
    expect(result.find((r) => r.slug === "qualification")).toMatchObject({ total: 0, count: 0 });
    expect(result.some((r) => r.slug === "__other__")).toBe(false);
  });
});

describe("upcomingActivities", () => {
  test("returns in-window task dueDates ascending; excludes out-of-window, no-dueDate, and non-task", async () => {
    const rec = await insertRecord("account", { name: "Acme", status: "active" });
    await insertTask(rec, "account", "2026-06-08"); // boundary in (to inclusive)
    await insertTask(rec, "account", "2026-06-03"); // in
    await insertTask(rec, "account", "2026-06-09"); // out (after to)
    await insertTask(rec, "account", null); // no dueDate
    await insertTask(rec, "account", "2026-06-04", "call"); // non-task, excluded

    const result = await upcomingActivities(testDb, {
      tenantId: crm.tenantId,
      from: "2026-06-01",
      to: "2026-06-08",
      entityTypeIds: [await entityId("account")],
    });

    expect(result.map((r) => r.dueDate)).toEqual(["2026-06-03", "2026-06-08"]);
    expect(result[0].recordTitle).toBe("Acme");
    expect(result[0].recordSlug).toBe("account");
  });

  test("permission boundary: tasks on a non-readable entity type are excluded", async () => {
    const acct = await insertRecord("account", { name: "Acme", status: "active" });
    const opp = await insertRecord("opportunity", { name: "Big deal", stage: "qualification" });
    await insertTask(acct, "account", "2026-06-03"); // readable
    await insertTask(opp, "opportunity", "2026-06-04"); // NOT readable below

    // Caller may read only accounts → the opportunity task must not surface.
    const result = await upcomingActivities(testDb, {
      tenantId: crm.tenantId,
      from: "2026-06-01",
      to: "2026-06-08",
      entityTypeIds: [await entityId("account")],
    });
    expect(result.map((r) => r.recordSlug)).toEqual(["account"]);

    // Empty readable set → no rows at all.
    const none = await upcomingActivities(testDb, {
      tenantId: crm.tenantId,
      from: "2026-06-01",
      to: "2026-06-08",
      entityTypeIds: [],
    });
    expect(none).toEqual([]);
  });
});

describe("recentlyModifiedRecords", () => {
  test("returns newest-first, limited, only from readable entity types", async () => {
    const acct = await entityId("account");
    const contact = await entityId("contact");

    await insertRecord("account", { name: "Old" }, { updatedAt: new Date("2026-01-01") });
    await insertRecord("account", { name: "New" }, { updatedAt: new Date("2026-05-01") });
    await insertRecord("contact", { firstName: "Hidden", lastName: "Contact" }, { updatedAt: new Date("2026-06-01") });

    // Only accounts are readable → the (newer) contact must NOT appear.
    const result = await recentlyModifiedRecords(testDb, {
      tenantId: crm.tenantId,
      entityTypeIds: [acct],
    });
    expect(result.map((r) => r.title)).toEqual(["New", "Old"]);
    expect(result.some((r) => r.title === "Hidden Contact")).toBe(false);
    void contact;
  });

  test("empty readable set short-circuits to no rows", async () => {
    await insertRecord("account", { name: "X" });
    const result = await recentlyModifiedRecords(testDb, {
      tenantId: crm.tenantId,
      entityTypeIds: [],
    });
    expect(result).toEqual([]);
  });
});
