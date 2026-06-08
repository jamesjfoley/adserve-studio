import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { testDb } from "@adserve/database/test-helpers";
import {
  records,
  recordRelationships,
  schemaRelationships,
} from "@adserve/database";
import { getEntityTypeBySlug } from "@adserve/module-framework";
import { CONTACT_BELONGS_TO_ACCOUNT } from "@adserve/crm";
import {
  setupCrmTenant,
  teardownCrmTenant,
  type CrmTestSetup,
} from "../helpers/crm";

/**
 * WS3 — combined contact-create-with-accounts endpoint (acceptance 11).
 *
 * Runs under the ENFORCED `adserve_app` harness, so the route's `withTenant`
 * queries are subject to RLS exactly as in prod. Asserts:
 *  - N selected accounts → contact created + exactly N contact↔account links,
 *  - the create+link is ATOMIC (a cross-tenant accountId rejects → zero contact
 *    AND zero links — no half-created contact),
 *  - zero accounts → an unlinked contact,
 *  - cross-tenant accountIds never create a cross-tenant link.
 */

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

import { POST as createContact } from "@/app/api/crm/contacts/with-accounts/route";

let tenantA: CrmTestSetup;
let tenantB: CrmTestSetup;
let tokenCounter = 0;

function uniqueToken(): string {
  tokenCounter += 1;
  return `cc-${Date.now().toString(36)}-${tokenCounter}`;
}

function actAs(crm: CrmTestSetup, authProviderId: string) {
  authMock.mockResolvedValue({ userId: authProviderId, orgId: crm.clerkOrgId });
}

function jsonReq(body: unknown) {
  return new NextRequest("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function seedAccount(crm: CrmTestSetup): Promise<string> {
  const entity = await getEntityTypeBySlug(testDb, {
    tenantId: crm.tenantId,
    slug: "account",
  });
  const [row] = await testDb
    .insert(records)
    .values({
      tenantId: crm.tenantId,
      entityTypeId: entity!.id,
      data: { name: uniqueToken(), status: "active" },
    })
    .returning();
  return row.id;
}

async function contactCount(crm: CrmTestSetup, lastName: string): Promise<number> {
  const entity = await getEntityTypeBySlug(testDb, {
    tenantId: crm.tenantId,
    slug: "contact",
  });
  const rows = await testDb
    .select({ id: records.id })
    .from(records)
    .where(
      and(
        eq(records.tenantId, crm.tenantId),
        eq(records.entityTypeId, entity!.id)
      )
    );
  // Filter by the unique lastName so parallel tests don't collide.
  const matching = [];
  for (const r of rows) {
    const [full] = await testDb
      .select({ data: records.data })
      .from(records)
      .where(eq(records.id, r.id));
    if ((full.data as { lastName?: string }).lastName === lastName) {
      matching.push(r);
    }
  }
  return matching.length;
}

/** Count non-archived accounts in the tenant whose normalised name matches. */
async function accountCountByName(
  crm: CrmTestSetup,
  name: string
): Promise<number> {
  const entity = await getEntityTypeBySlug(testDb, {
    tenantId: crm.tenantId,
    slug: "account",
  });
  const rows = await testDb
    .select({ data: records.data })
    .from(records)
    .where(
      and(
        eq(records.tenantId, crm.tenantId),
        eq(records.entityTypeId, entity!.id)
      )
    );
  const norm = name.trim().toLowerCase();
  return rows.filter(
    (r) =>
      ((r.data as { name?: string }).name ?? "").trim().toLowerCase() === norm
  ).length;
}

/** The id of the single account a contact is linked to (or null). */
async function linkedAccountId(
  crm: CrmTestSetup,
  contactId: string
): Promise<string | null> {
  const [rel] = await testDb
    .select({ id: schemaRelationships.id })
    .from(schemaRelationships)
    .where(
      and(
        eq(schemaRelationships.tenantId, crm.tenantId),
        eq(schemaRelationships.name, CONTACT_BELONGS_TO_ACCOUNT.name)
      )
    );
  const rows = await testDb
    .select({ target: recordRelationships.targetRecordId })
    .from(recordRelationships)
    .where(
      and(
        eq(recordRelationships.relationshipId, rel.id),
        eq(recordRelationships.sourceRecordId, contactId)
      )
    );
  return rows[0]?.target ?? null;
}

async function linksFor(crm: CrmTestSetup, contactId: string): Promise<number> {
  const [rel] = await testDb
    .select({ id: schemaRelationships.id })
    .from(schemaRelationships)
    .where(
      and(
        eq(schemaRelationships.tenantId, crm.tenantId),
        eq(schemaRelationships.name, CONTACT_BELONGS_TO_ACCOUNT.name)
      )
    );
  const rows = await testDb
    .select({ id: recordRelationships.id })
    .from(recordRelationships)
    .where(
      and(
        eq(recordRelationships.relationshipId, rel.id),
        eq(recordRelationships.sourceRecordId, contactId)
      )
    );
  return rows.length;
}

beforeAll(async () => {
  tenantA = await setupCrmTenant();
  tenantB = await setupCrmTenant();
});
afterAll(async () => {
  if (tenantA?.tenantId) await teardownCrmTenant(tenantA.tenantId);
  if (tenantB?.tenantId) await teardownCrmTenant(tenantB.tenantId);
});

describe("WS3 — contact create with N accounts (AC 11)", () => {
  test("N accounts → contact + exactly N links", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const accountIds = [
      await seedAccount(tenantA),
      await seedAccount(tenantA),
      await seedAccount(tenantA),
    ];
    const lastName = uniqueToken();

    const res = await createContact(
      jsonReq({
        data: { firstName: "Multi", lastName, status: "active" },
        accountIds,
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.linkedAccountCount).toBe(3);

    expect(await contactCount(tenantA, lastName)).toBe(1);
    expect(await linksFor(tenantA, body.record.id)).toBe(3);
  });

  test("zero accounts → an unlinked contact", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const lastName = uniqueToken();
    const res = await createContact(
      jsonReq({ data: { firstName: "Solo", lastName, status: "active" } })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(await contactCount(tenantA, lastName)).toBe(1);
    expect(await linksFor(tenantA, body.record.id)).toBe(0);
  });

  test("atomic: a cross-tenant accountId rejects → NO contact, NO links", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const goodAccount = await seedAccount(tenantA);
    const foreignAccount = await seedAccount(tenantB);
    const lastName = uniqueToken();

    const res = await createContact(
      jsonReq({
        data: { firstName: "Atomic", lastName, status: "active" },
        // One valid + one cross-tenant id → whole tx must abort.
        accountIds: [goodAccount, foreignAccount],
      })
    );
    expect(res.status).toBe(422);

    // No half-created contact, and no cross-tenant link to the foreign account.
    expect(await contactCount(tenantA, lastName)).toBe(0);
    const foreignLinks = await testDb
      .select({ id: recordRelationships.id })
      .from(recordRelationships)
      .where(eq(recordRelationships.targetRecordId, foreignAccount));
    expect(foreignLinks).toHaveLength(0);
  });

  test("cross-tenant: a foreign accountId alone never links and rejects", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const foreignAccount = await seedAccount(tenantB);
    const lastName = uniqueToken();

    const res = await createContact(
      jsonReq({
        data: { firstName: "Cross", lastName, status: "active" },
        accountIds: [foreignAccount],
      })
    );
    expect(res.status).toBe(422);
    expect(await contactCount(tenantA, lastName)).toBe(0);
    const foreignLinks = await testDb
      .select({ id: recordRelationships.id })
      .from(recordRelationships)
      .where(eq(recordRelationships.targetRecordId, foreignAccount));
    expect(foreignLinks).toHaveLength(0);
  });
});

describe("prototype — single account + inline create-new", () => {
  test("single existing accountId → contact + exactly 1 link to it", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const accountId = await seedAccount(tenantA);
    const lastName = uniqueToken();

    const res = await createContact(
      jsonReq({
        data: { firstName: "Single", lastName, status: "active" },
        accountId,
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.linkedAccountCount).toBe(1);
    expect(await linksFor(tenantA, body.record.id)).toBe(1);
    expect(await linkedAccountId(tenantA, body.record.id)).toBe(accountId);
  });

  test("create-new: typed name → account created + contact linked, atomically", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const newName = `New Co ${uniqueToken()}`;
    const lastName = uniqueToken();

    const res = await createContact(
      jsonReq({
        data: { firstName: "Maker", lastName, status: "active" },
        newAccountName: newName,
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.createdAccount).toBeTruthy();
    expect(body.createdAccount.data.name).toBe(newName);
    expect(body.linkedAccountCount).toBe(1);
    expect(await accountCountByName(tenantA, newName)).toBe(1);
    expect(await linkedAccountId(tenantA, body.record.id)).toBe(
      body.createdAccount.id
    );
  });

  test("create-new duplicate (case/space-insensitive) → 409, nothing written", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const baseName = `Dup Co ${uniqueToken()}`;
    // Seed an existing account with the canonical name.
    const accountEntity = await getEntityTypeBySlug(testDb, {
      tenantId: tenantA.tenantId,
      slug: "account",
    });
    await testDb.insert(records).values({
      tenantId: tenantA.tenantId,
      entityTypeId: accountEntity!.id,
      data: { name: baseName, status: "active" },
    });
    const lastName = uniqueToken();

    const res = await createContact(
      jsonReq({
        data: { firstName: "Dupe", lastName, status: "active" },
        // Different case + surrounding whitespace → still a duplicate.
        newAccountName: `   ${baseName.toUpperCase()}   `,
      })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.existing?.name).toBe(baseName);
    // No second account, no contact.
    expect(await accountCountByName(tenantA, baseName)).toBe(1);
    expect(await contactCount(tenantA, lastName)).toBe(0);
  });

  test("create-new is tenant-scoped: a same-named account in tenant B does not block tenant A", async () => {
    const sharedName = `Shared Co ${uniqueToken()}`;
    // Seed the name in tenant B only.
    const bAccountEntity = await getEntityTypeBySlug(testDb, {
      tenantId: tenantB.tenantId,
      slug: "account",
    });
    await testDb.insert(records).values({
      tenantId: tenantB.tenantId,
      entityTypeId: bAccountEntity!.id,
      data: { name: sharedName, status: "active" },
    });

    actAs(tenantA, tenantA.owner.authProviderId);
    const lastName = uniqueToken();
    const res = await createContact(
      jsonReq({
        data: { firstName: "Iso", lastName, status: "active" },
        newAccountName: sharedName,
      })
    );
    // Uniqueness is per-tenant under RLS — tenant A may create its own.
    expect(res.status).toBe(201);
    expect(await accountCountByName(tenantA, sharedName)).toBe(1);
    expect(await accountCountByName(tenantB, sharedName)).toBe(1);
  });

  test("authz: a member without contact.create is rejected (create-new writes nothing)", async () => {
    actAs(tenantA, tenantA.member.authProviderId);
    const newName = `Denied Co ${uniqueToken()}`;
    const lastName = uniqueToken();

    const res = await createContact(
      jsonReq({
        data: { firstName: "NoPerm", lastName, status: "active" },
        newAccountName: newName,
      })
    );
    expect(res.status).toBe(403);
    expect(await accountCountByName(tenantA, newName)).toBe(0);
    expect(await contactCount(tenantA, lastName)).toBe(0);
  });
});
