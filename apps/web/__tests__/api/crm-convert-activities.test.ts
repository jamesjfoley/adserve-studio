import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTestTransaction } from "@adserve/database/test-helpers";
import { records, recordRelationships, schemaRelationships } from "@adserve/database";
import { getEntityTypeBySlug } from "@adserve/module-framework";
import { CONTACT_BELONGS_TO_ACCOUNT } from "@adserve/crm";
import { loadRecordWithRelationships } from "@/lib/crm/relationships";
import {
  setupCrmTenant,
  teardownCrmTenant,
  setCrmModuleConfig,
  type CrmTestSetup,
} from "../helpers/crm";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

import { POST as createRecord } from "@/app/api/crm/[entityType]/route";
import { GET as getRecord } from "@/app/api/crm/[entityType]/[id]/route";
import { POST as convertLead } from "@/app/api/crm/leads/[id]/convert/route";
import { POST as logActivity } from "@/app/api/crm/activities/route";
import { GET as accountActivities } from "@/app/api/crm/accounts/[id]/activities/route";

let crm: CrmTestSetup;

function jsonReq(body: unknown) {
  return new NextRequest("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const bare = () => new NextRequest("http://localhost");

beforeAll(async () => {
  crm = await setupCrmTenant();
  // Pin to the opportunity convert target for this legacy suite.
  await setCrmModuleConfig(crm.tenantId, {
    opportunities: true,
    convertTarget: "opportunity",
  });
  authMock.mockResolvedValue({
    userId: crm.owner.authProviderId,
    orgId: crm.clerkOrgId,
  });
});
afterAll(async () => {
  if (crm?.tenantId) await teardownCrmTenant(crm.tenantId);
});

describe("POST /api/crm/leads/[id]/convert", () => {
  test("creates account + contact + opportunity, links them, marks lead converted", async () => {
    const leadRes = await createRecord(
      jsonReq({
        data: {
          firstName: "Dana",
          lastName: "Scully",
          company: "FBI",
          source: "web",
          status: "new",
          estimatedValue: { amount: 5000, currency: "GBP" },
        },
      }),
      { params: Promise.resolve({ entityType: "leads" }) }
    );
    expect(leadRes.status).toBe(201);
    const leadId = (await leadRes.json()).record.id as string;

    const res = await convertLead(bare(), {
      params: Promise.resolve({ id: leadId }),
    });
    expect(res.status).toBe(201);
    const { account, contact, opportunity } = await res.json();
    expect(account.data.name).toBe("FBI");
    expect(contact.data.firstName).toBe("Dana");
    expect(opportunity.data.stage).toBeTruthy();
    expect(opportunity.data.amount).toEqual({ amount: 5000, currency: "GBP" });

    // Lead is now converted.
    const leadDetail = await getRecord(bare(), {
      params: Promise.resolve({ entityType: "leads", id: leadId }),
    });
    expect((await leadDetail.json()).record.data.status).toBe("converted");

    // Account expands to its linked contact + opportunity.
    const acctDetail = await getRecord(bare(), {
      params: Promise.resolve({ entityType: "accounts", id: account.id }),
    });
    const acctBody = await acctDetail.json();
    expect(acctBody.relationships.contact).toHaveLength(1);
    expect(acctBody.relationships.opportunity).toHaveLength(1);

    // Second convert is rejected.
    const again = await convertLead(bare(), {
      params: Promise.resolve({ id: leadId }),
    });
    expect(again.status).toBe(409);
  });
});

describe("activities", () => {
  test("log an activity and read it back on the account timeline", async () => {
    const acctRes = await createRecord(
      jsonReq({ data: { name: "Timeline Co", status: "active" } }),
      { params: Promise.resolve({ entityType: "accounts" }) }
    );
    const acctId = (await acctRes.json()).record.id as string;

    const logged = await logActivity(
      jsonReq({ recordId: acctId, activityType: "note", subject: "Called them" })
    );
    expect(logged.status).toBe(201);

    const timeline = await accountActivities(bare(), {
      params: Promise.resolve({ id: acctId }),
    });
    expect(timeline.status).toBe(200);
    const body = await timeline.json();
    expect(body.activities.length).toBeGreaterThanOrEqual(1);
    expect(body.activities[0].subject).toBe("Called them");
  });

  test("rejects an activity type outside the allowed set", async () => {
    const acctRes = await createRecord(
      jsonReq({ data: { name: "Bad Activity Co", status: "active" } }),
      { params: Promise.resolve({ entityType: "accounts" }) }
    );
    const acctId = (await acctRes.json()).record.id as string;
    const res = await logActivity(
      jsonReq({ recordId: acctId, activityType: "system" })
    );
    expect(res.status).toBe(400);
  });
});

describe("relationship expansion is query-bounded", () => {
  test("N related contacts produce the same (bounded) query count", async () => {
    await withTestTransaction(async (tx) => {
      const accountEntity = await getEntityTypeBySlug(tx, {
        tenantId: crm.tenantId,
        slug: "account",
      });
      const contactEntity = await getEntityTypeBySlug(tx, {
        tenantId: crm.tenantId,
        slug: "contact",
      });
      const [rel] = await tx
        .select()
        .from(schemaRelationships)
        .where(
          and(
            eq(schemaRelationships.tenantId, crm.tenantId),
            eq(schemaRelationships.name, CONTACT_BELONGS_TO_ACCOUNT.name)
          )
        );

      async function accountWithContacts(n: number): Promise<string> {
        const [acct] = await tx
          .insert(records)
          .values({
            tenantId: crm.tenantId,
            entityTypeId: accountEntity!.id,
            data: { name: "Bounded", status: "active" },
          })
          .returning();
        for (let i = 0; i < n; i += 1) {
          const [c] = await tx
            .insert(records)
            .values({
              tenantId: crm.tenantId,
              entityTypeId: contactEntity!.id,
              data: { firstName: "C", lastName: String(i), status: "active" },
            })
            .returning();
          await tx.insert(recordRelationships).values({
            tenantId: crm.tenantId,
            relationshipId: rel.id,
            sourceRecordId: c.id,
            targetRecordId: acct.id,
          });
        }
        return acct.id;
      }

      const acct1 = await accountWithContacts(1);
      const acct3 = await accountWithContacts(3);

      const spy = vi.spyOn(tx, "select");

      spy.mockClear();
      await loadRecordWithRelationships(tx, {
        tenantId: crm.tenantId,
        entityTypeId: accountEntity!.id,
        recordId: acct1,
      });
      const callsForOne = spy.mock.calls.length;

      spy.mockClear();
      await loadRecordWithRelationships(tx, {
        tenantId: crm.tenantId,
        entityTypeId: accountEntity!.id,
        recordId: acct3,
      });
      const callsForThree = spy.mock.calls.length;

      spy.mockRestore();

      expect(callsForThree).toBe(callsForOne);
      expect(callsForOne).toBeLessThanOrEqual(4);
    });
  });
});
