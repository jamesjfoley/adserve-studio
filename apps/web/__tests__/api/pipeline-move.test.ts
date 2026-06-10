import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { testDb } from "@adserve/database/test-helpers";
import { auditLog, entityTypes, records } from "@adserve/database";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

import { PATCH as moveStage } from "@/app/api/crm/pipeline/[id]/route";

let crmA: CrmTestSetup;
let crmB: CrmTestSetup;

function actAs(authProviderId: string, clerkOrgId: string) {
  authMock.mockResolvedValue({ userId: authProviderId, orgId: clerkOrgId });
}

function moveReq(id: string, stage: unknown) {
  return new NextRequest(`http://localhost/api/crm/pipeline/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stage }),
  });
}
const paramsFor = (id: string) => ({ params: Promise.resolve({ id }) });

async function oppTypeId(tenantId: string): Promise<string> {
  const [row] = await testDb
    .select({ id: entityTypes.id })
    .from(entityTypes)
    .where(
      and(eq(entityTypes.tenantId, tenantId), eq(entityTypes.slug, "opportunity"))
    );
  return row.id;
}

async function createOpp(
  tenantId: string,
  data: Record<string, unknown>
): Promise<string> {
  const [row] = await testDb
    .insert(records)
    .values({ tenantId, entityTypeId: await oppTypeId(tenantId), data })
    .returning({ id: records.id });
  return row.id;
}

async function getData(id: string): Promise<Record<string, unknown>> {
  const [row] = await testDb.select().from(records).where(eq(records.id, id));
  return row.data as Record<string, unknown>;
}

beforeAll(async () => {
  crmA = await setupCrmTenant();
  crmB = await setupCrmTenant();
});
afterAll(async () => {
  if (crmA?.tenantId) await teardownCrmTenant(crmA.tenantId);
  if (crmB?.tenantId) await teardownCrmTenant(crmB.tenantId);
});

describe("PATCH /api/crm/pipeline/[id]", () => {
  test("moves stage AND auto-sets probability, preserving other data + audit", async () => {
    actAs(crmA.owner.authProviderId, crmA.clerkOrgId);
    const id = await createOpp(crmA.tenantId, {
      name: "Big deal",
      stage: "Qualification",
      probability: 10,
      amount: { amount: 5000, currency: "GBP" },
    });

    const res = await moveStage(moveReq(id, "Proposal"), paramsFor(id));
    expect(res.status).toBe(200);

    const data = await getData(id);
    expect(data.stage).toBe("Proposal");
    expect(data.probability).toBe(50); // proposal defaultProbability
    expect(data.name).toBe("Big deal"); // preserved
    expect(data.amount).toEqual({ amount: 5000, currency: "GBP" }); // preserved

    const audits = await testDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.resourceId, id), eq(auditLog.action, "update")));
    expect(audits.length).toBeGreaterThanOrEqual(1);
    const changes = audits[audits.length - 1].changes as {
      after?: { stage?: string; probability?: number };
    };
    expect(changes.after?.stage).toBe("Proposal");
    expect(changes.after?.probability).toBe(50);
  });

  test("rejects an unknown stage with 422", async () => {
    actAs(crmA.owner.authProviderId, crmA.clerkOrgId);
    const id = await createOpp(crmA.tenantId, { name: "x", stage: "Qualification" });
    const res = await moveStage(moveReq(id, "not_a_stage"), paramsFor(id));
    expect(res.status).toBe(422);
    expect((await getData(id)).stage).toBe("Qualification"); // unchanged
  });

  test("returns 404 for a missing opportunity", async () => {
    actAs(crmA.owner.authProviderId, crmA.clerkOrgId);
    const res = await moveStage(
      moveReq("00000000-0000-0000-0000-000000000000", "Proposal"),
      paramsFor("00000000-0000-0000-0000-000000000000")
    );
    expect(res.status).toBe(404);
  });

  test("forbids a user without pipeline.update (403)", async () => {
    actAs(crmA.member.authProviderId, crmA.clerkOrgId);
    const id = await createOpp(crmA.tenantId, { name: "y", stage: "Qualification" });
    const res = await moveStage(moveReq(id, "Proposal"), paramsFor(id));
    expect(res.status).toBe(403);
    expect((await getData(id)).stage).toBe("Qualification"); // unchanged
  });

  test("cross-tenant: cannot move another tenant's opportunity (404, no write)", async () => {
    // Opportunity belongs to tenant B; request made as tenant A's owner.
    const bOpp = await createOpp(crmB.tenantId, {
      name: "B deal",
      stage: "Qualification",
      probability: 10,
    });
    actAs(crmA.owner.authProviderId, crmA.clerkOrgId);

    const res = await moveStage(moveReq(bOpp, "Proposal"), paramsFor(bOpp));
    expect(res.status).toBe(404);

    const data = await getData(bOpp);
    expect(data.stage).toBe("Qualification"); // untouched
    expect(data.probability).toBe(10);
  });
});
