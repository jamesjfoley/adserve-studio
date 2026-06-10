import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { testDb } from "@adserve/database/test-helpers";
import { records, recordRelationships, schemaRelationships } from "@adserve/database";
import { CAMPAIGN_BELONGS_TO_ACCOUNT, CAMPAIGN_HAS_PRIMARY_CONTACT } from "@adserve/crm";
import {
  setupCrmTenant,
  teardownCrmTenant,
  setCrmModuleConfig,
  type CrmTestSetup,
} from "../helpers/crm";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

import { POST as createRecord } from "@/app/api/crm/[entityType]/route";
import { DELETE as deleteRecord } from "@/app/api/crm/[entityType]/[id]/route";
import { POST as linkRel } from "@/app/api/crm/[entityType]/[id]/relationships/route";
import { POST as convertLead } from "@/app/api/crm/leads/[id]/convert/route";

let T: CrmTestSetup;

beforeAll(async () => {
  T = await setupCrmTenant();
  authMock.mockResolvedValue({ userId: T.owner.authProviderId, orgId: T.clerkOrgId });
});
afterAll(async () => {
  if (T?.tenantId) await teardownCrmTenant(T.tenantId);
});

function jsonReq(body: unknown) {
  return new NextRequest("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const bare = () => new NextRequest("http://localhost");

async function createLead(data: Record<string, unknown>): Promise<string> {
  const res = await createRecord(
    jsonReq({ data: { firstName: "Lee", lastName: "Add", source: "Web", status: "New", ...data } }),
    { params: Promise.resolve({ entityType: "leads" }) }
  );
  expect(res.status).toBe(201);
  return (await res.json()).record.id as string;
}

async function linkCount(tenantId: string, relName: string, sourceId: string): Promise<number> {
  const [rel] = await testDb
    .select({ id: schemaRelationships.id })
    .from(schemaRelationships)
    .where(and(eq(schemaRelationships.tenantId, tenantId), eq(schemaRelationships.name, relName)));
  if (!rel) return 0;
  const rows = await testDb
    .select({ id: recordRelationships.id })
    .from(recordRelationships)
    .where(
      and(
        eq(recordRelationships.relationshipId, rel.id),
        eq(recordRelationships.sourceRecordId, sourceId)
      )
    );
  return rows.length;
}

describe("Lead convert — config-driven target (Task 5)", () => {
  test("campaign target (default) creates a Campaign, sets convertedTo.campaignId", async () => {
    await setCrmModuleConfig(T.tenantId, {
      campaigns: true,
      opportunities: false,
      convertTarget: "campaign",
    });
    const leadId = await createLead({ company: "Brightwave", estimatedValue: { amount: 5000, currency: "GBP" } });

    const res = await convertLead(jsonReq({ confirm: true }), {
      params: Promise.resolve({ id: leadId }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.target).toBe("campaign");
    expect(body.campaign).toBeTruthy();
    expect(body.opportunity).toBeUndefined();

    const campaignId = body.campaign.id as string;
    expect(body.campaign.data.name).toMatch(/^Brightwave \d{4}-\d{2}-\d{2}$/);
    expect(body.campaign.data.stage).toBe("Brief");
    // Carries the lead's estimated value as the campaign value.
    expect(body.campaign.data.value).toEqual({ amount: 5000, currency: "GBP" });

    // Linked to account + primary contact.
    expect(await linkCount(T.tenantId, CAMPAIGN_BELONGS_TO_ACCOUNT.name, campaignId)).toBe(1);
    expect(await linkCount(T.tenantId, CAMPAIGN_HAS_PRIMARY_CONTACT.name, campaignId)).toBe(1);

    // convertedTo carries the campaign id (no opportunity id).
    const [lead] = await testDb.select().from(records).where(eq(records.id, leadId));
    const convertedTo = (lead.data as { convertedTo?: Record<string, unknown> }).convertedTo!;
    expect(convertedTo.campaignId).toBe(campaignId);
    expect(convertedTo.opportunityId).toBeUndefined();
    expect((lead.data as { status?: string }).status).toBe("Converted");
  });

  test("null target (no pipeline entity) creates Account + Contact only", async () => {
    await setCrmModuleConfig(T.tenantId, { campaigns: false, opportunities: false });
    const leadId = await createLead({ company: "Quietco" });

    const res = await convertLead(jsonReq({ confirm: true }), {
      params: Promise.resolve({ id: leadId }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.target).toBeNull();
    expect(body.account).toBeTruthy();
    expect(body.contact).toBeTruthy();
    expect(body.campaign).toBeUndefined();
    expect(body.opportunity).toBeUndefined();

    const [lead] = await testDb.select().from(records).where(eq(records.id, leadId));
    const convertedTo = (lead.data as { convertedTo?: Record<string, unknown> }).convertedTo!;
    expect(convertedTo.accountId).toBeTruthy();
    expect(convertedTo.contactId).toBeTruthy();
    expect(convertedTo.campaignId).toBeUndefined();
    expect(convertedTo.opportunityId).toBeUndefined();
  });
});

describe("AC 24 extended — converted lead read-only across PATCH/DELETE/link (Task 5)", () => {
  test("a converted lead cannot be archived (DELETE → 409) or relinked (POST → 409)", async () => {
    await setCrmModuleConfig(T.tenantId, { campaigns: true, opportunities: false });
    const leadId = await createLead({ company: "Lockwood" });
    const conv = await convertLead(jsonReq({ confirm: true }), {
      params: Promise.resolve({ id: leadId }),
    });
    expect(conv.status).toBe(201);

    // DELETE (archive) is blocked.
    const del = await deleteRecord(bare(), {
      params: Promise.resolve({ entityType: "leads", id: leadId }),
    });
    expect(del.status).toBe(409);

    // Relationship link/unlink is blocked (any target/relationship).
    const link = await linkRel(
      jsonReq({ relationshipName: "lead_anything", targetRecordId: leadId }),
      { params: Promise.resolve({ entityType: "leads", id: leadId }) }
    );
    expect(link.status).toBe(409);
  });
});
