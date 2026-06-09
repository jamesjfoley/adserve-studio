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
  CONTACT_REPORTS_TO_CONTACT,
} from "@adserve/crm";
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
import { POST as linkRel } from "@/app/api/crm/[entityType]/[id]/relationships/route";

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

/** Related (M2M) account ids for a contact. */
async function relatedTargets(contactId: string): Promise<string[]> {
  const [rel] = await testDb
    .select({ id: schemaRelationships.id })
    .from(schemaRelationships)
    .where(
      and(
        eq(schemaRelationships.tenantId, crm.tenantId),
        eq(schemaRelationships.name, CONTACT_RELATED_TO_ACCOUNT.name)
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

describe("related accounts — reconcile, self-overlap, loader split", () => {
  test("PATCH relatedAccounts reconciles to the desired set (add + remove)", async () => {
    actAs(crm.owner.authProviderId);
    const a = await seedAccount(`R-A ${uniqueToken()}`);
    const b = await seedAccount(`R-B ${uniqueToken()}`);
    const c = await seedAccount(`R-C ${uniqueToken()}`);
    const contactId = await createContactLinkedTo(await seedAccount());

    // Set related = {A, B}.
    let res = await patchRecord(
      jsonReq("PATCH", {
        data: {},
        relatedAccounts: [{ accountId: a }, { accountId: b }],
      }),
      contactParams(contactId)
    );
    expect(res.status).toBe(200);
    expect((await relatedTargets(contactId)).sort()).toEqual([a, b].sort());

    // Reconcile to {B, C} — A removed, C added, B kept.
    res = await patchRecord(
      jsonReq("PATCH", {
        data: {},
        relatedAccounts: [{ accountId: b }, { accountId: c }],
      }),
      contactParams(contactId)
    );
    expect(res.status).toBe(200);
    expect((await relatedTargets(contactId)).sort()).toEqual([b, c].sort());

    // Empty set removes all related links.
    res = await patchRecord(
      jsonReq("PATCH", { data: {}, relatedAccounts: [] }),
      contactParams(contactId)
    );
    expect(res.status).toBe(200);
    expect(await relatedTargets(contactId)).toHaveLength(0);
  });

  test("combined PATCH: primary + related applied together (related filtered vs primary)", async () => {
    actAs(crm.owner.authProviderId);
    const oldPrimary = await seedAccount(`old ${uniqueToken()}`);
    const newPrimary = await seedAccount(`new ${uniqueToken()}`);
    const rel = await seedAccount(`rel ${uniqueToken()}`);
    const contactId = await createContactLinkedTo(oldPrimary);

    const res = await patchRecord(
      jsonReq("PATCH", {
        data: {},
        account: { accountId: newPrimary },
        // newPrimary also listed as related → must be filtered (self-overlap).
        relatedAccounts: [{ accountId: rel }, { accountId: newPrimary }],
      }),
      contactParams(contactId)
    );
    expect(res.status).toBe(200);
    expect(await accountLinks(contactId)).toEqual([newPrimary]); // primary replaced
    expect(await relatedTargets(contactId)).toEqual([rel]); // newPrimary filtered out
  });

  test("WS2: relating a contact to its own primary account is rejected (422)", async () => {
    actAs(crm.owner.authProviderId);
    const primary = await seedAccount(`P ${uniqueToken()}`);
    const contactId = await createContactLinkedTo(primary);

    const res = await linkRel(
      jsonReq("POST", {
        relationshipName: CONTACT_RELATED_TO_ACCOUNT.name,
        targetRecordId: primary,
      }),
      contactParams(contactId)
    );
    expect(res.status).toBe(422);
    expect(await relatedTargets(contactId)).toHaveLength(0);
  });

  test("edge-driven loader: a contact's primary + related accounts surface as distinct edges", async () => {
    actAs(crm.owner.authProviderId);
    const primary = await seedAccount(`P ${uniqueToken()}`);
    const related = await seedAccount(`R ${uniqueToken()}`);
    const contactId = await createContactLinkedTo(primary);
    await patchRecord(
      jsonReq("PATCH", { data: {}, relatedAccounts: [{ accountId: related }] }),
      contactParams(contactId)
    );

    const res = await getRecord(
      new NextRequest("http://localhost"),
      contactParams(contactId)
    );
    const body = await res.json();
    const accountEdges = (body.relationships.account ?? []) as Array<{
      id: string;
      relationshipName: string;
    }>;
    const primaryEdge = accountEdges.find(
      (e) => e.relationshipName === CONTACT_BELONGS_TO_ACCOUNT.name
    );
    const relatedEdge = accountEdges.find(
      (e) => e.relationshipName === CONTACT_RELATED_TO_ACCOUNT.name
    );
    expect(primaryEdge?.id).toBe(primary);
    expect(relatedEdge?.id).toBe(related);
  });
});

/** Manager contact ids linked via contact_reports_to_contact (source=contact). */
async function reportsToTargets(contactId: string): Promise<string[]> {
  const [rel] = await testDb
    .select({ id: schemaRelationships.id })
    .from(schemaRelationships)
    .where(
      and(
        eq(schemaRelationships.tenantId, crm.tenantId),
        eq(schemaRelationships.name, CONTACT_REPORTS_TO_CONTACT.name)
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

/** Create a plain contact (no account) and return its id. */
async function createPlainContact(): Promise<string> {
  const res = await createContact(
    jsonReq("POST", {
      data: { firstName: "P", lastName: uniqueToken(), status: "active" },
    })
  );
  expect(res.status).toBe(201);
  return (await res.json()).record.id as string;
}

describe("reports-to hierarchy (contact → contact)", () => {
  test("create with reportsTo links to the manager", async () => {
    actAs(crm.owner.authProviderId);
    const manager = await createPlainContact();
    const res = await createContact(
      jsonReq("POST", {
        data: { firstName: "Sub", lastName: uniqueToken(), status: "active" },
        reportsTo: { contactId: manager },
      })
    );
    expect(res.status).toBe(201);
    const id = (await res.json()).record.id as string;
    expect(await reportsToTargets(id)).toEqual([manager]);
  });

  test("PATCH reportsTo replaces the manager (exactly one link)", async () => {
    actAs(crm.owner.authProviderId);
    const a = await createPlainContact();
    const b = await createPlainContact();
    const c = await createPlainContact();

    let res = await patchRecord(
      jsonReq("PATCH", { data: {}, reportsTo: { contactId: a } }),
      contactParams(c)
    );
    expect(res.status).toBe(200);
    expect(await reportsToTargets(c)).toEqual([a]);

    res = await patchRecord(
      jsonReq("PATCH", { data: {}, reportsTo: { contactId: b } }),
      contactParams(c)
    );
    expect(res.status).toBe(200);
    expect(await reportsToTargets(c)).toEqual([b]); // replaced, not added
  });

  test("self-reference is rejected (422)", async () => {
    actAs(crm.owner.authProviderId);
    const c = await createPlainContact();
    const res = await patchRecord(
      jsonReq("PATCH", { data: {}, reportsTo: { contactId: c } }),
      contactParams(c)
    );
    expect(res.status).toBe(422);
    expect(await reportsToTargets(c)).toEqual([]);
  });

  test("a non-existent manager id is rejected (422)", async () => {
    actAs(crm.owner.authProviderId);
    const c = await createPlainContact();
    const res = await patchRecord(
      jsonReq("PATCH", {
        data: {},
        reportsTo: { contactId: "00000000-0000-4000-8000-000000000000" },
      }),
      contactParams(c)
    );
    expect(res.status).toBe(422);
    expect(await reportsToTargets(c)).toEqual([]);
  });

  test("clearing reportsTo removes the manager link", async () => {
    actAs(crm.owner.authProviderId);
    const a = await createPlainContact();
    const c = await createPlainContact();
    await patchRecord(
      jsonReq("PATCH", { data: {}, reportsTo: { contactId: a } }),
      contactParams(c)
    );
    expect(await reportsToTargets(c)).toEqual([a]);
    const res = await patchRecord(
      jsonReq("PATCH", { data: {}, reportsTo: null }),
      contactParams(c)
    );
    expect(res.status).toBe(200);
    expect(await reportsToTargets(c)).toEqual([]);
  });
});

/** Seed an account carrying an address. */
async function seedAccountWithAddress(addr: {
  addressLine1: string;
  city: string;
  postcode: string;
}): Promise<string> {
  const entity = await getEntityTypeBySlug(testDb, {
    tenantId: crm.tenantId,
    slug: "account",
  });
  const [row] = await testDb
    .insert(records)
    .values({
      tenantId: crm.tenantId,
      entityTypeId: entity!.id,
      data: { name: uniqueToken(), status: "active", ...addr },
    })
    .returning();
  return row.id;
}

describe("Same as Site account address — inherit from the primary account", () => {
  test("create with the toggle copies the account's address onto the contact", async () => {
    actAs(crm.owner.authProviderId);
    const account = await seedAccountWithAddress({
      addressLine1: "1 Embankment",
      city: "London",
      postcode: "EC4Y 0HA",
    });

    const res = await createContact(
      jsonReq("POST", {
        data: {
          firstName: "Addr",
          lastName: uniqueToken(),
          status: "active",
          sameAsAccountAddress: true,
        },
        accountId: account,
      })
    );
    expect(res.status).toBe(201);
    const data = (await res.json()).record.data as Record<string, unknown>;
    expect(data.siteAddressLine1).toBe("1 Embankment");
    expect(data.city).toBe("London");
    expect(data.postcode).toBe("EC4Y 0HA");
  });

  test("PATCH with the toggle copies the current primary account's address", async () => {
    actAs(crm.owner.authProviderId);
    const account = await seedAccountWithAddress({
      addressLine1: "30 St Mary Axe",
      city: "London",
      postcode: "EC3A 8BF",
    });
    const contactId = await createContactLinkedTo(account);

    const res = await patchRecord(
      jsonReq("PATCH", { data: { sameAsAccountAddress: true } }),
      contactParams(contactId)
    );
    expect(res.status).toBe(200);
    const data = (await res.json()).record.data as Record<string, unknown>;
    expect(data.siteAddressLine1).toBe("30 St Mary Axe");
    expect(data.postcode).toBe("EC3A 8BF");
  });
});

describe("reactivation — never deleted, only inactive ↔ active", () => {
  test("PATCH isArchived:false reactivates an inactive contact", async () => {
    actAs(crm.owner.authProviderId);
    const entity = await getEntityTypeBySlug(testDb, {
      tenantId: crm.tenantId,
      slug: "contact",
    });
    const [c] = await testDb
      .insert(records)
      .values({
        tenantId: crm.tenantId,
        entityTypeId: entity!.id,
        data: { firstName: "Arch", lastName: uniqueToken(), status: "active" },
        isArchived: true,
      })
      .returning();

    const res = await patchRecord(
      jsonReq("PATCH", { data: {}, isArchived: false }),
      contactParams(c.id)
    );
    expect(res.status).toBe(200);
    const [row] = await testDb
      .select({ isArchived: records.isArchived })
      .from(records)
      .where(eq(records.id, c.id));
    expect(row.isArchived).toBe(false);
  });
});
