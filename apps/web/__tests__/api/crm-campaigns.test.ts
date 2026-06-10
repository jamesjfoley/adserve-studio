import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { testDb } from "@adserve/database/test-helpers";
import { recordRelationships, schemaRelationships } from "@adserve/database";
import { CAMPAIGN_BELONGS_TO_ACCOUNT, CAMPAIGN_HAS_PRIMARY_CONTACT } from "@adserve/crm";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

import { POST as createWithAccount } from "@/app/api/crm/campaigns/with-account/route";
import { POST as createRecord } from "@/app/api/crm/[entityType]/route";
import { GET as getRecord } from "@/app/api/crm/[entityType]/[id]/route";

let A: CrmTestSetup;
let B: CrmTestSetup;

beforeAll(async () => {
  A = await setupCrmTenant();
  B = await setupCrmTenant();
});
afterAll(async () => {
  if (A?.tenantId) await teardownCrmTenant(A.tenantId);
  if (B?.tenantId) await teardownCrmTenant(B.tenantId);
});

function actAsOwner(t: CrmTestSetup) {
  authMock.mockResolvedValue({ userId: t.owner.authProviderId, orgId: t.clerkOrgId });
}
function actAsMember(t: CrmTestSetup) {
  authMock.mockResolvedValue({ userId: t.member.authProviderId, orgId: t.clerkOrgId });
}
function jsonReq(body: unknown) {
  return new NextRequest("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createAccount(t: CrmTestSetup, name: string): Promise<string> {
  actAsOwner(t);
  const res = await createRecord(jsonReq({ data: { name, status: "Active" } }), {
    params: Promise.resolve({ entityType: "accounts" }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).record.id as string;
}

async function createContact(t: CrmTestSetup): Promise<string> {
  actAsOwner(t);
  const res = await createRecord(
    jsonReq({ data: { firstName: "Pat", lastName: "Buyer", status: "Active" } }),
    { params: Promise.resolve({ entityType: "contacts" }) }
  );
  expect(res.status).toBe(201);
  return (await res.json()).record.id as string;
}

async function linkExists(
  tenantId: string,
  relName: string,
  sourceId: string,
  targetId: string
): Promise<{ isPrimary: boolean } | null> {
  const [rel] = await testDb
    .select({ id: schemaRelationships.id })
    .from(schemaRelationships)
    .where(
      and(
        eq(schemaRelationships.tenantId, tenantId),
        eq(schemaRelationships.name, relName)
      )
    );
  if (!rel) return null;
  const [row] = await testDb
    .select({ metadata: recordRelationships.metadata })
    .from(recordRelationships)
    .where(
      and(
        eq(recordRelationships.relationshipId, rel.id),
        eq(recordRelationships.sourceRecordId, sourceId),
        eq(recordRelationships.targetRecordId, targetId)
      )
    );
  if (!row) return null;
  return { isPrimary: (row.metadata as { isPrimary?: boolean })?.isPrimary === true };
}

describe("Campaign create-with-account (Task 1)", () => {
  test("creates a campaign + links a NEW account atomically", async () => {
    actAsOwner(A);
    const res = await createWithAccount(
      jsonReq({
        data: { name: "Spring Brand Push", stage: "Brief" },
        newAccountName: "Northwind Media",
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    const campaignId = body.record.id as string;
    expect(body.accountId).toBeTruthy();

    const link = await linkExists(
      A.tenantId,
      CAMPAIGN_BELONGS_TO_ACCOUNT.name,
      campaignId,
      body.accountId
    );
    expect(link).not.toBeNull();
  });

  test("links an EXISTING account + an optional primary contact", async () => {
    const accountId = await createAccount(A, "Existing Advertiser");
    const contactId = await createContact(A);
    actAsOwner(A);
    const res = await createWithAccount(
      jsonReq({
        data: { name: "Q3 Always-On", stage: "Planning" },
        accountId,
        primaryContactId: contactId,
      })
    );
    expect(res.status).toBe(201);
    const campaignId = (await res.json()).record.id as string;

    expect(
      await linkExists(A.tenantId, CAMPAIGN_BELONGS_TO_ACCOUNT.name, campaignId, accountId)
    ).not.toBeNull();
    const pc = await linkExists(
      A.tenantId,
      CAMPAIGN_HAS_PRIMARY_CONTACT.name,
      campaignId,
      contactId
    );
    expect(pc?.isPrimary).toBe(true);
  });

  test("rejects a campaign with NO account (422)", async () => {
    actAsOwner(A);
    const res = await createWithAccount(
      jsonReq({ data: { name: "No Account", stage: "Brief" } })
    );
    expect(res.status).toBe(422);
  });
});

describe("Campaign tenant isolation + authz (Tasks 1/7)", () => {
  test("a cross-tenant accountId resolves to nothing under RLS (422)", async () => {
    const aAccount = await createAccount(A, "Tenant A Co");
    // B tries to attach A's account — invisible under RLS → invalid_account.
    actAsOwner(B);
    const res = await createWithAccount(
      jsonReq({ data: { name: "B campaign", stage: "Brief" }, accountId: aAccount })
    );
    expect(res.status).toBe(422);
  });

  test("tenant B cannot read tenant A's campaign (404)", async () => {
    actAsOwner(A);
    const created = await createWithAccount(
      jsonReq({ data: { name: "A private", stage: "Live" }, newAccountName: "A Private Co" })
    );
    const campaignId = (await created.json()).record.id as string;

    actAsOwner(B);
    const res = await getRecord(new NextRequest("http://localhost"), {
      params: Promise.resolve({ entityType: "campaigns", id: campaignId }),
    });
    expect(res.status).toBe(404);
  });

  test("a member (no campaign.create) is forbidden from creating (403)", async () => {
    actAsMember(A);
    const res = await createWithAccount(
      jsonReq({ data: { name: "Member try", stage: "Brief" }, newAccountName: "Nope Inc" })
    );
    expect(res.status).toBe(403);
  });

  test("a member CAN read campaigns (campaign.read in member grant)", async () => {
    const accountId = await createAccount(A, "Readable Co");
    actAsOwner(A);
    const created = await createWithAccount(
      jsonReq({ data: { name: "Readable campaign", stage: "Brief" }, accountId })
    );
    const campaignId = (await created.json()).record.id as string;

    actAsMember(A);
    const res = await getRecord(new NextRequest("http://localhost"), {
      params: Promise.resolve({ entityType: "campaigns", id: campaignId }),
    });
    expect(res.status).toBe(200);
  });
});
