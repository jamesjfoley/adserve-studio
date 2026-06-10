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
import {
  CONTACT_BELONGS_TO_ACCOUNT,
  CONTACT_RELATED_TO_ACCOUNT,
} from "@adserve/crm";
import {
  setupCrmTenant,
  teardownCrmTenant,
  type CrmTestSetup,
} from "../helpers/crm";

/**
 * Combined contact-create endpoint — primary (`account`, many_to_one) +
 * `relatedAccounts` (many_to_many). Runs under the ENFORCED `adserve_app`
 * harness, so the route's `withTenant` queries are subject to RLS as in prod.
 * Asserts the new model: one primary + N related, create-new + uniqueness,
 * self-overlap filtering, and atomic rollback (a cross-tenant id → no contact).
 * The legacy `accountIds[]` multi-primary path is gone — multi-account is now
 * `relatedAccounts`.
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
      data: { name: uniqueToken(), status: "Active" },
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
  return (await targetsByRel(crm, contactId, CONTACT_BELONGS_TO_ACCOUNT.name))
    .length;
}

/** Target account ids linked to a contact by a given relationship name. */
async function targetsByRel(
  crm: CrmTestSetup,
  contactId: string,
  relName: string
): Promise<string[]> {
  const [rel] = await testDb
    .select({ id: schemaRelationships.id })
    .from(schemaRelationships)
    .where(
      and(
        eq(schemaRelationships.tenantId, crm.tenantId),
        eq(schemaRelationships.name, relName)
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
  return rows.map((r) => r.target);
}

/** Related (M2M) account ids for a contact. */
function relatedTargets(crm: CrmTestSetup, contactId: string): Promise<string[]> {
  return targetsByRel(crm, contactId, CONTACT_RELATED_TO_ACCOUNT.name);
}

beforeAll(async () => {
  tenantA = await setupCrmTenant();
  tenantB = await setupCrmTenant();
});
afterAll(async () => {
  if (tenantA?.tenantId) await teardownCrmTenant(tenantA.tenantId);
  if (tenantB?.tenantId) await teardownCrmTenant(tenantB.tenantId);
});

describe("contact create — N accounts → 1 primary + (N-1) related", () => {
  test("primary + related set → exactly one primary, the rest related", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const primary = await seedAccount(tenantA);
    const relatedA = await seedAccount(tenantA);
    const relatedB = await seedAccount(tenantA);
    const lastName = uniqueToken();

    const res = await createContact(
      jsonReq({
        data: { firstName: "Multi", lastName, status: "Active" },
        accountId: primary,
        relatedAccounts: [{ accountId: relatedA }, { accountId: relatedB }],
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.primaryAccountId).toBe(primary);
    expect(body.relatedAccountCount).toBe(2);

    expect(await contactCount(tenantA, lastName)).toBe(1);
    expect(await linksFor(tenantA, body.record.id)).toBe(1); // one primary
    expect(await linkedAccountId(tenantA, body.record.id)).toBe(primary);
    expect((await relatedTargets(tenantA, body.record.id)).sort()).toEqual(
      [relatedA, relatedB].sort()
    );
  });

  test("zero accounts → an unlinked contact", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const lastName = uniqueToken();
    const res = await createContact(
      jsonReq({ data: { firstName: "Solo", lastName, status: "Active" } })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(await contactCount(tenantA, lastName)).toBe(1);
    expect(await linksFor(tenantA, body.record.id)).toBe(0);
    expect(await relatedTargets(tenantA, body.record.id)).toHaveLength(0);
  });

  test("self-overlap: a related entry equal to the primary is filtered out", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const primary = await seedAccount(tenantA);
    const lastName = uniqueToken();

    const res = await createContact(
      jsonReq({
        data: { firstName: "Overlap", lastName, status: "Active" },
        accountId: primary,
        relatedAccounts: [{ accountId: primary }], // same as primary → dropped
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.relatedAccountCount).toBe(0);
    expect(await linkedAccountId(tenantA, body.record.id)).toBe(primary);
    expect(await relatedTargets(tenantA, body.record.id)).toHaveLength(0);
  });

  test("atomic: a cross-tenant related accountId rejects → NO contact", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const primary = await seedAccount(tenantA);
    const foreignAccount = await seedAccount(tenantB);
    const lastName = uniqueToken();

    const res = await createContact(
      jsonReq({
        data: { firstName: "Atomic", lastName, status: "Active" },
        accountId: primary,
        relatedAccounts: [{ accountId: foreignAccount }],
      })
    );
    expect(res.status).toBe(422);

    // Whole tx rolled back — no contact, no link to the foreign account.
    expect(await contactCount(tenantA, lastName)).toBe(0);
    const foreignLinks = await testDb
      .select({ id: recordRelationships.id })
      .from(recordRelationships)
      .where(eq(recordRelationships.targetRecordId, foreignAccount));
    expect(foreignLinks).toHaveLength(0);
  });

  test("cross-tenant: a foreign PRIMARY accountId rejects → NO contact", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const foreignAccount = await seedAccount(tenantB);
    const lastName = uniqueToken();

    const res = await createContact(
      jsonReq({
        data: { firstName: "Cross", lastName, status: "Active" },
        accountId: foreignAccount,
      })
    );
    expect(res.status).toBe(422);
    expect(await contactCount(tenantA, lastName)).toBe(0);
  });
});

describe("contact create — primary single account + inline create-new", () => {
  test("single existing accountId → contact + exactly 1 primary link", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const accountId = await seedAccount(tenantA);
    const lastName = uniqueToken();

    const res = await createContact(
      jsonReq({
        data: { firstName: "Single", lastName, status: "Active" },
        accountId,
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.primaryAccountId).toBe(accountId);
    expect(await linksFor(tenantA, body.record.id)).toBe(1);
    expect(await linkedAccountId(tenantA, body.record.id)).toBe(accountId);
  });

  test("create-new primary: typed name → account created + linked, atomically", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const newName = `New Co ${uniqueToken()}`;
    const lastName = uniqueToken();

    const res = await createContact(
      jsonReq({
        data: { firstName: "Maker", lastName, status: "Active" },
        newAccountName: newName,
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.primaryAccountId).toBeTruthy();
    expect(await accountCountByName(tenantA, newName)).toBe(1);
    expect(await linkedAccountId(tenantA, body.record.id)).toBe(
      body.primaryAccountId
    );
  });

  test("create-new related: typed names become related accounts", async () => {
    actAs(tenantA, tenantA.owner.authProviderId);
    const relName = `Rel Co ${uniqueToken()}`;
    const lastName = uniqueToken();

    const res = await createContact(
      jsonReq({
        data: { firstName: "RelMaker", lastName, status: "Active" },
        relatedAccounts: [{ newAccountName: relName }],
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.relatedAccountCount).toBe(1);
    expect(await accountCountByName(tenantA, relName)).toBe(1);
    expect(await relatedTargets(tenantA, body.record.id)).toHaveLength(1);
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
      data: { name: baseName, status: "Active" },
    });
    const lastName = uniqueToken();

    const res = await createContact(
      jsonReq({
        data: { firstName: "Dupe", lastName, status: "Active" },
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
      data: { name: sharedName, status: "Active" },
    });

    actAs(tenantA, tenantA.owner.authProviderId);
    const lastName = uniqueToken();
    const res = await createContact(
      jsonReq({
        data: { firstName: "Iso", lastName, status: "Active" },
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
        data: { firstName: "NoPerm", lastName, status: "Active" },
        newAccountName: newName,
      })
    );
    expect(res.status).toBe(403);
    expect(await accountCountByName(tenantA, newName)).toBe(0);
    expect(await contactCount(tenantA, lastName)).toBe(0);
  });
});
