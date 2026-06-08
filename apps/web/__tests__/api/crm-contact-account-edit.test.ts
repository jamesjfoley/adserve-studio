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
import { accountSelectionFromRelationships } from "@/lib/crm/account-hydration";
import {
  setupCrmTenant,
  teardownCrmTenant,
  type CrmTestSetup,
} from "../helpers/crm";

/**
 * Detail + edit parity for the contact `account` relationship field, under the
 * ENFORCED `adserve_app` harness. Proves:
 *  (a) detail hydrates the existing link (GET → relationships → selection),
 *  (b) editing to a different account REPLACES the link (exactly one after),
 *  (c) create-new on edit validates uniqueness via the shared helper (409),
 *  + clearing the field removes the link.
 */

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

import { POST as createContact } from "@/app/api/crm/contacts/with-accounts/route";
import {
  GET as getRecord,
  PATCH as patchRecord,
} from "@/app/api/crm/[entityType]/[id]/route";

let crm: CrmTestSetup;
let tokenCounter = 0;

function uniqueToken(): string {
  tokenCounter += 1;
  return `ce-${Date.now().toString(36)}-${tokenCounter}`;
}

function actAs(authProviderId: string) {
  authMock.mockResolvedValue({ userId: authProviderId, orgId: crm.clerkOrgId });
}

function jsonReq(method: string, body: unknown) {
  return new NextRequest("http://localhost/api/crm/contacts", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function contactParams(id: string) {
  return { params: Promise.resolve({ entityType: "contacts", id }) };
}

async function seedAccount(name?: string): Promise<string> {
  const entity = await getEntityTypeBySlug(testDb, {
    tenantId: crm.tenantId,
    slug: "account",
  });
  const [row] = await testDb
    .insert(records)
    .values({
      tenantId: crm.tenantId,
      entityTypeId: entity!.id,
      data: { name: name ?? uniqueToken(), status: "active" },
    })
    .returning();
  return row.id;
}

/** Create a contact linked to a single account via the create endpoint. */
async function createContactLinkedTo(accountId: string): Promise<string> {
  const res = await createContact(
    jsonReq("POST", {
      data: { firstName: "Edit", lastName: uniqueToken(), status: "active" },
      accountId,
    })
  );
  expect(res.status).toBe(201);
  return (await res.json()).record.id as string;
}

async function accountLinks(contactId: string): Promise<string[]> {
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
  return rows.map((r) => r.target);
}

async function accountCountByName(name: string): Promise<number> {
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

beforeAll(async () => {
  crm = await setupCrmTenant();
});
afterAll(async () => {
  if (crm?.tenantId) await teardownCrmTenant(crm.tenantId);
});

describe("contact account field — detail + edit parity", () => {
  test("(a) detail hydrates the existing account link", async () => {
    actAs(crm.owner.authProviderId);
    const accountId = await seedAccount(`Hydrate ${uniqueToken()}`);
    const contactId = await createContactLinkedTo(accountId);

    const res = await getRecord(
      new NextRequest("http://localhost"),
      contactParams(contactId)
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    // The account link is present in the loaded relationships...
    const sel = accountSelectionFromRelationships(body.relationships);
    // ...and hydrates to the linked account as an existing selection.
    expect(sel).toEqual(
      expect.objectContaining({ kind: "existing", id: accountId })
    );
  });

  test("(b) editing to a different account REPLACES the link (exactly one)", async () => {
    actAs(crm.owner.authProviderId);
    const accountA = await seedAccount(`A ${uniqueToken()}`);
    const accountB = await seedAccount(`B ${uniqueToken()}`);
    const contactId = await createContactLinkedTo(accountA);
    expect(await accountLinks(contactId)).toEqual([accountA]);

    const res = await patchRecord(
      jsonReq("PATCH", { data: {}, account: { accountId: accountB } }),
      contactParams(contactId)
    );
    expect(res.status).toBe(200);

    // Exactly one link, now pointing to B (the prior A link was replaced).
    const links = await accountLinks(contactId);
    expect(links).toEqual([accountB]);
    expect(links).toHaveLength(1);
  });

  test("(c) create-new on edit validates uniqueness via the shared helper", async () => {
    actAs(crm.owner.authProviderId);
    const dupName = `Dup ${uniqueToken()}`;
    await seedAccount(dupName); // existing account with this name
    const accountA = await seedAccount(`A ${uniqueToken()}`);
    const contactId = await createContactLinkedTo(accountA);

    const res = await patchRecord(
      // Different case + whitespace — still a duplicate.
      jsonReq("PATCH", {
        data: {},
        account: { newAccountName: `  ${dupName.toUpperCase()}  ` },
      }),
      contactParams(contactId)
    );
    expect(res.status).toBe(409);

    // Nothing changed: no second account, link still points at A.
    expect(await accountCountByName(dupName)).toBe(1);
    expect(await accountLinks(contactId)).toEqual([accountA]);
  });

  test("create-new on edit creates + replaces the link", async () => {
    actAs(crm.owner.authProviderId);
    const accountA = await seedAccount(`A ${uniqueToken()}`);
    const contactId = await createContactLinkedTo(accountA);
    const newName = `Fresh ${uniqueToken()}`;

    const res = await patchRecord(
      jsonReq("PATCH", { data: {}, account: { newAccountName: newName } }),
      contactParams(contactId)
    );
    expect(res.status).toBe(200);

    expect(await accountCountByName(newName)).toBe(1);
    const links = await accountLinks(contactId);
    expect(links).toHaveLength(1);
    expect(links[0]).not.toBe(accountA);
  });

  test("clearing the field removes the link", async () => {
    actAs(crm.owner.authProviderId);
    const accountA = await seedAccount(`A ${uniqueToken()}`);
    const contactId = await createContactLinkedTo(accountA);
    expect(await accountLinks(contactId)).toEqual([accountA]);

    const res = await patchRecord(
      jsonReq("PATCH", { data: {}, account: null }),
      contactParams(contactId)
    );
    expect(res.status).toBe(200);
    expect(await accountLinks(contactId)).toEqual([]);
  });

  test("a PATCH WITHOUT an account key leaves the link untouched", async () => {
    actAs(crm.owner.authProviderId);
    const accountA = await seedAccount(`A ${uniqueToken()}`);
    const contactId = await createContactLinkedTo(accountA);

    const res = await patchRecord(
      jsonReq("PATCH", { data: { title: "VP" } }),
      contactParams(contactId)
    );
    expect(res.status).toBe(200);
    expect(await accountLinks(contactId)).toEqual([accountA]);
  });
});
