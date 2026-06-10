import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { testDb } from "@adserve/database/test-helpers";
import {
  auditLog,
  records,
  recordRelationships,
  schemaRelationships,
} from "@adserve/database";
import { getEntityTypeBySlug } from "@adserve/module-framework";
import { CONTACT_BELONGS_TO_ACCOUNT } from "@adserve/crm";
import {
  setupCrmTenant,
  teardownCrmTenant,
  setCrmModuleConfig,
  type CrmTestSetup,
} from "../helpers/crm";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

import { POST as createRecord } from "@/app/api/crm/[entityType]/route";
import { PATCH as patchRecord } from "@/app/api/crm/[entityType]/[id]/route";
import { POST as convertLead } from "@/app/api/crm/leads/[id]/convert/route";

let A: CrmTestSetup;
let B: CrmTestSetup;

function actAs(t: CrmTestSetup) {
  authMock.mockResolvedValue({ userId: t.owner.authProviderId, orgId: t.clerkOrgId });
}
function jsonReq(body: unknown, url = "http://localhost") {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const bare = (url = "http://localhost") => new NextRequest(url, { method: "POST" });

async function createLead(data: Record<string, unknown>): Promise<string> {
  // Leads require firstName/lastName/source/status — default them so callers
  // only specify what each scenario cares about.
  const full = {
    firstName: "Lead",
    lastName: "Person",
    source: "Web",
    status: "New",
    ...data,
  };
  const res = await createRecord(jsonReq({ data: full }), {
    params: Promise.resolve({ entityType: "leads" }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).record.id as string;
}
async function createRec(
  entityType: string,
  data: Record<string, unknown>
): Promise<string> {
  const res = await createRecord(jsonReq({ data }), {
    params: Promise.resolve({ entityType }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).record.id as string;
}
async function entityId(tenantId: string, slug: string): Promise<string> {
  const e = await getEntityTypeBySlug(testDb, { tenantId, slug });
  return e!.id;
}
async function countByEntity(tenantId: string, slug: string): Promise<number> {
  const rows = await testDb
    .select({ id: records.id })
    .from(records)
    .where(
      and(
        eq(records.tenantId, tenantId),
        eq(records.entityTypeId, await entityId(tenantId, slug))
      )
    );
  return rows.length;
}
async function leadData(id: string): Promise<Record<string, unknown>> {
  const [row] = await testDb.select({ data: records.data }).from(records).where(eq(records.id, id));
  return (row.data as Record<string, unknown>) ?? {};
}
async function linkContactToAccount(tenantId: string, contactId: string, accountId: string) {
  const [rel] = await testDb
    .select({ id: schemaRelationships.id })
    .from(schemaRelationships)
    .where(
      and(
        eq(schemaRelationships.tenantId, tenantId),
        eq(schemaRelationships.name, CONTACT_BELONGS_TO_ACCOUNT.name)
      )
    );
  await testDb.insert(recordRelationships).values({
    tenantId,
    relationshipId: rel.id,
    sourceRecordId: contactId,
    targetRecordId: accountId,
  });
}

beforeAll(async () => {
  A = await setupCrmTenant();
  B = await setupCrmTenant();
  // This suite asserts the OPPORTUNITY-target convert semantics (AC 20–24), so
  // pin both tenants to opportunities-enabled. (Campaign + null targets are
  // covered in crm-convert-targets.test.ts.)
  await setCrmModuleConfig(A.tenantId, { opportunities: true, convertTarget: "opportunity" });
  await setCrmModuleConfig(B.tenantId, { opportunities: true, convertTarget: "opportunity" });
});
afterAll(async () => {
  if (A?.tenantId) await teardownCrmTenant(A.tenantId);
  if (B?.tenantId) await teardownCrmTenant(B.tenantId);
});

describe("convert AC 20 — dated opportunity name", () => {
  test("opportunity name is `<Account> <YYYY-MM-DD>`", async () => {
    actAs(A);
    const leadId = await createLead({
      firstName: "Ada",
      lastName: "Lovelace",
      company: "Analytical Engines",
      status: "New",
    });
    const res = await convertLead(bare(), { params: Promise.resolve({ id: leadId }) });
    expect(res.status).toBe(201);
    const { opportunity } = await res.json();
    expect(opportunity.data.name).toMatch(/^Analytical Engines \d{4}-\d{2}-\d{2}$/);
    expect(opportunity.data.name).not.toContain("opportunity");
  });
});

describe("convert AC 21/22 — duplicate warnings write nothing (atomic)", () => {
  test("AC 21: existing account of that name → 409 account_exists, no records created", async () => {
    actAs(A);
    await createRec("accounts", { name: "Globex", status: "Active" });
    const leadId = await createLead({ company: "Globex", firstName: "Hank", status: "New" });

    const oppsBefore = await countByEntity(A.tenantId, "opportunity");
    const acctsBefore = await countByEntity(A.tenantId, "account");

    const res = await convertLead(bare(), { params: Promise.resolve({ id: leadId }) });
    expect(res.status).toBe(409);
    expect((await res.json()).warning).toBe("account_exists");

    // Atomic: nothing written.
    expect(await countByEntity(A.tenantId, "opportunity")).toBe(oppsBefore);
    expect(await countByEntity(A.tenantId, "account")).toBe(acctsBefore);
    expect((await leadData(leadId)).status).not.toBe("Converted");
  });

  test("AC 21 (normalised): a case+whitespace variant of an existing account name → 409 account_exists", async () => {
    actAs(A);
    await createRec("accounts", { name: "Umbrella Corp", status: "Active" });
    // Different case + leading/trailing whitespace — still a duplicate.
    const leadId = await createLead({
      company: "  umbrella corp  ",
      firstName: "Alice",
      status: "New",
    });
    const oppsBefore = await countByEntity(A.tenantId, "opportunity");

    const res = await convertLead(bare(), { params: Promise.resolve({ id: leadId }) });
    expect(res.status).toBe(409);
    expect((await res.json()).warning).toBe("account_exists");
    expect(await countByEntity(A.tenantId, "opportunity")).toBe(oppsBefore);
    expect((await leadData(leadId)).status).not.toBe("Converted");
  });

  test("AC 22: same-named contact already in that account → 409 contact_exists, no records created", async () => {
    actAs(A);
    const acctId = await createRec("accounts", { name: "Initech", status: "Active" });
    const contactId = await createRec("contacts", {
      firstName: "Peter",
      lastName: "Gibbons",
      status: "Active",
    });
    await linkContactToAccount(A.tenantId, contactId, acctId);

    const leadId = await createLead({
      company: "Initech",
      firstName: "Peter",
      lastName: "Gibbons",
      status: "New",
    });
    const oppsBefore = await countByEntity(A.tenantId, "opportunity");

    const res = await convertLead(bare(), { params: Promise.resolve({ id: leadId }) });
    expect(res.status).toBe(409);
    expect((await res.json()).warning).toBe("contact_exists");
    expect(await countByEntity(A.tenantId, "opportunity")).toBe(oppsBefore);
    expect((await leadData(leadId)).status).not.toBe("Converted");
  });
});

describe("convert AC 23 — confirmed links to existing, no duplicates", () => {
  test("confirmed convert links existing account+contact, creates opportunity, writes convertedTo", async () => {
    actAs(A);
    const acctId = await createRec("accounts", { name: "Hooli", status: "Active" });
    const contactId = await createRec("contacts", {
      firstName: "Richard",
      lastName: "Hendricks",
      status: "Active",
    });
    await linkContactToAccount(A.tenantId, contactId, acctId);
    const leadId = await createLead({
      company: "Hooli",
      firstName: "Richard",
      lastName: "Hendricks",
      status: "New",
    });

    const acctsBefore = await countByEntity(A.tenantId, "account");
    const contactsBefore = await countByEntity(A.tenantId, "contact");
    const oppsBefore = await countByEntity(A.tenantId, "opportunity");

    const res = await convertLead(bare("http://localhost?confirm=1"), {
      params: Promise.resolve({ id: leadId }),
    });
    expect(res.status).toBe(201);
    const { account, contact, opportunity } = await res.json();

    // Linked existing — no duplicate account/contact created.
    expect(account.id).toBe(acctId);
    expect(contact.id).toBe(contactId);
    expect(await countByEntity(A.tenantId, "account")).toBe(acctsBefore);
    expect(await countByEntity(A.tenantId, "contact")).toBe(contactsBefore);
    // Opportunity created.
    expect(await countByEntity(A.tenantId, "opportunity")).toBe(oppsBefore + 1);

    // Back-links written on the lead.
    const ld = await leadData(leadId);
    expect(ld.status).toBe("Converted");
    expect(ld.convertedTo).toEqual({
      accountId: acctId,
      contactId: contactId,
      opportunityId: opportunity.id,
    });

    // The convert emits a `link` audit row for the matched account (it linked
    // to the existing record rather than creating a new one).
    const acctAudit = await testDb
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(
        and(eq(auditLog.tenantId, A.tenantId), eq(auditLog.resourceId, acctId))
      );
    expect(acctAudit.some((r) => r.action === "link")).toBe(true);
  });
});

describe("convert AC 24 — converted lead is server-side read-only", () => {
  test("PATCH a converted lead → 409; PATCH a non-converted record/other entity still works", async () => {
    actAs(A);
    const leadId = await createLead({
      company: "Stark Industries",
      firstName: "Tony",
      status: "New",
    });
    expect(
      (await convertLead(bare(), { params: Promise.resolve({ id: leadId }) })).status
    ).toBe(201);

    // Converted lead is read-only.
    const blocked = await patchRecord(jsonReq({ data: { firstName: "Anthony" } }), {
      params: Promise.resolve({ entityType: "leads", id: leadId }),
    });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toMatch(/converted/i);
    expect((await leadData(leadId)).firstName).not.toBe("Anthony"); // unchanged

    // Control 1: a non-converted lead is still editable.
    const liveLead = await createLead({ company: "Wayne Ent", firstName: "Bruce", status: "New" });
    const okLead = await patchRecord(jsonReq({ data: { firstName: "Bruce W" } }), {
      params: Promise.resolve({ entityType: "leads", id: liveLead }),
    });
    expect(okLead.status).toBe(200);

    // Control 2: a different entity type is never blocked by the lead guard
    // (proves the guard is scoped to slug === "lead").
    const acctId = await createRec("accounts", { name: "Acme RO", status: "Active" });
    const okAcct = await patchRecord(jsonReq({ data: { name: "Acme RO renamed" } }), {
      params: Promise.resolve({ entityType: "accounts", id: acctId }),
    });
    expect(okAcct.status).toBe(200);
  });
});

describe("convert — duplicate checks are tenant-scoped (cross-tenant)", () => {
  test("a same-named account in tenant B does NOT trigger a warning in tenant A", async () => {
    // Tenant B owns an account named "Crossiant".
    actAs(B);
    await createRec("accounts", { name: "Crossiant", status: "Active" });

    // Tenant A has NO such account; converting a lead with that company succeeds.
    actAs(A);
    const leadId = await createLead({ company: "Crossiant", firstName: "Zoe", status: "New" });
    const res = await convertLead(bare(), { params: Promise.resolve({ id: leadId }) });
    expect(res.status).toBe(201); // no warn — B's account is invisible under RLS
    expect((await leadData(leadId)).status).toBe("Converted");
  });
});
