import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { testDb } from "@adserve/database/test-helpers";
import { activities, records } from "@adserve/database";
import { getEntityTypeBySlug } from "@adserve/module-framework";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";
import {
  leadConversionFunnel,
  pipelineValueByStage,
  recentlyModifiedRecords,
  revenueForecast,
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
  { slug: "Qualification", name: "Qualification" },
  { slug: "Proposal", name: "Proposal" },
];

describe("pipelineValueByStage", () => {
  test("sums amounts by stage, coalesces missing amounts, ignores archived, buckets unknown", async () => {
    await insertRecord("opportunity", { name: "A", stage: "Qualification", amount: { amount: 1000, currency: "GBP" } });
    await insertRecord("opportunity", { name: "B", stage: "Qualification", amount: { amount: 500, currency: "GBP" } });
    await insertRecord("opportunity", { name: "C", stage: "Qualification" }); // no amount → 0
    await insertRecord("opportunity", { name: "D", stage: "Proposal", amount: { amount: 2000, currency: "GBP" } });
    await insertRecord("opportunity", { name: "E", stage: "Qualification", amount: { amount: 9999, currency: "GBP" } }, { archived: true }); // ignored
    await insertRecord("opportunity", { name: "F", stage: "weird", amount: { amount: 100, currency: "GBP" } }); // unknown stage

    const result = await pipelineValueByStage(testDb, {
      tenantId: crm.tenantId,
      opportunityEntityTypeId: await entityId("opportunity"),
      stages: STAGES,
    });

    const bySlug = new Map(result.map((r) => [r.slug, r]));
    expect(bySlug.get("Qualification")).toMatchObject({ total: 1500, count: 3 });
    expect(bySlug.get("Proposal")).toMatchObject({ total: 2000, count: 1 });
    expect(bySlug.get("__other__")).toMatchObject({ total: 100, count: 1 });
  });

  test("configured stage with zero opportunities still renders at 0", async () => {
    const result = await pipelineValueByStage(testDb, {
      tenantId: crm.tenantId,
      opportunityEntityTypeId: await entityId("opportunity"),
      stages: STAGES,
    });
    expect(result.find((r) => r.slug === "Qualification")).toMatchObject({ total: 0, count: 0 });
    expect(result.some((r) => r.slug === "__other__")).toBe(false);
  });
});

describe("upcomingActivities", () => {
  test("returns in-window task dueDates ascending; excludes out-of-window, no-dueDate, and non-task", async () => {
    const rec = await insertRecord("account", { name: "Acme", status: "Active" });
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
    const acct = await insertRecord("account", { name: "Acme", status: "Active" });
    const opp = await insertRecord("opportunity", { name: "Big deal", stage: "Qualification" });
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

describe("leadConversionFunnel", () => {
  test("counts leads per funnel stage in order; excludes lost + archived", async () => {
    await insertRecord("lead", { name: "n1", status: "New" });
    await insertRecord("lead", { name: "n2", status: "New" });
    await insertRecord("lead", { name: "n3", status: "New" });
    await insertRecord("lead", { name: "c1", status: "Contacted" });
    await insertRecord("lead", { name: "c2", status: "Contacted" });
    await insertRecord("lead", { name: "q1", status: "Qualified" });
    await insertRecord("lead", { name: "cv1", status: "Converted" });
    await insertRecord("lead", { name: "lost1", status: "Lost" }); // off-funnel
    await insertRecord("lead", { name: "arch", status: "New" }, { archived: true });

    const funnel = await leadConversionFunnel(testDb, {
      tenantId: crm.tenantId,
      leadEntityTypeId: await entityId("lead"),
    });

    expect(funnel.map((s) => [s.status, s.count])).toEqual([
      ["New", 3],
      ["Contacted", 2],
      ["Qualified", 1],
      ["Converted", 1],
    ]);
  });

  test("returns all four stages at 0 when there are no leads", async () => {
    const funnel = await leadConversionFunnel(testDb, {
      tenantId: crm.tenantId,
      leadEntityTypeId: await entityId("lead"),
    });
    expect(funnel.map((s) => s.count)).toEqual([0, 0, 0, 0]);
  });
});

describe("revenueForecast", () => {
  function ymd(offsetDays: number): string {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  test("weights amount × probability/100 within cumulative close-date windows", async () => {
    const amt = (n: number) => ({ amount: n, currency: "GBP" });
    // +10d, £1000 @ 50% → 500  (in 30/60/90)
    await insertRecord("opportunity", { name: "soon", stage: "Proposal", amount: amt(1000), probability: 50, closeDate: ymd(10) });
    // +45d, £2000 @ 25% → 500  (in 60/90)
    await insertRecord("opportunity", { name: "mid", stage: "Proposal", amount: amt(2000), probability: 25, closeDate: ymd(45) });
    // +80d, £4000 @ 100% → 4000 (in 90)
    await insertRecord("opportunity", { name: "late", stage: "Negotiation", amount: amt(4000), probability: 100, closeDate: ymd(80) });
    // +200d → outside all windows
    await insertRecord("opportunity", { name: "far", stage: "Proposal", amount: amt(9999), probability: 100, closeDate: ymd(200) });
    // past → excluded (closeDate < today)
    await insertRecord("opportunity", { name: "past", stage: "Proposal", amount: amt(9999), probability: 100, closeDate: ymd(-5) });
    // archived → excluded
    await insertRecord("opportunity", { name: "arch", stage: "Proposal", amount: amt(9999), probability: 100, closeDate: ymd(5) }, { archived: true });
    // missing probability → contributes 0
    await insertRecord("opportunity", { name: "noprob", stage: "Proposal", amount: amt(9999), closeDate: ymd(5) });

    const f = await revenueForecast(testDb, {
      tenantId: crm.tenantId,
      opportunityEntityTypeId: await entityId("opportunity"),
      today: ymd(0),
      d30: ymd(30),
      d60: ymd(60),
      d90: ymd(90),
    });

    expect(f.next30).toBe(500); // soon
    expect(f.next60).toBe(1000); // soon + mid
    expect(f.next90).toBe(5000); // soon + mid + late (500 + 500 + 4000)
  });

  test("returns zeroes when there are no opportunities", async () => {
    const f = await revenueForecast(testDb, {
      tenantId: crm.tenantId,
      opportunityEntityTypeId: await entityId("opportunity"),
      today: ymd(0),
      d30: ymd(30),
      d60: ymd(60),
      d90: ymd(90),
    });
    expect(f).toEqual({ next30: 0, next60: 0, next90: 0 });
  });
});
