import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { testDb } from "@adserve/database/test-helpers";
import { records } from "@adserve/database";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

import { POST as createRecord } from "@/app/api/crm/[entityType]/route";
import { POST as bulkAction } from "@/app/api/crm/[entityType]/bulk/route";

let crm: CrmTestSetup;
let tokenCounter = 0;
function uniqueToken(): string {
  tokenCounter += 1;
  return `bulk-${Date.now().toString(36)}-${tokenCounter}`;
}

function actAs(authProviderId: string) {
  authMock.mockResolvedValue({ userId: authProviderId, orgId: crm.clerkOrgId });
}

const accountsParams = { params: Promise.resolve({ entityType: "accounts" }) };

function bulkReq(body: unknown) {
  return new NextRequest("http://localhost/api/crm/accounts/bulk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createAccount(data: Record<string, unknown>, ownedBy?: string) {
  const res = await createRecord(
    new NextRequest("http://localhost/api/crm/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data, ownedBy }),
    }),
    accountsParams
  );
  expect(res.status).toBe(201);
  return (await res.json()).record.id as string;
}

async function getRow(id: string) {
  const [row] = await testDb.select().from(records).where(eq(records.id, id));
  return row;
}

beforeAll(async () => {
  crm = await setupCrmTenant();
});
afterAll(async () => {
  if (crm?.tenantId) await teardownCrmTenant(crm.tenantId);
});

describe("CRM bulk actions", () => {
  test("assignOwner reassigns selected records, and is idempotent", async () => {
    actAs(crm.owner.authProviderId);
    const a = await createAccount({ name: `${uniqueToken()} A`, status: "active" }, crm.owner.id);
    const b = await createAccount({ name: `${uniqueToken()} B`, status: "active" }, crm.owner.id);

    let res = await bulkAction(
      bulkReq({ action: "assignOwner", recordIds: [a, b], ownedBy: crm.member.id }),
      accountsParams
    );
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(2);
    expect((await getRow(a)).ownedBy).toBe(crm.member.id);
    expect((await getRow(b)).ownedBy).toBe(crm.member.id);

    // Re-run — already in target state → zero updates.
    res = await bulkAction(
      bulkReq({ action: "assignOwner", recordIds: [a, b], ownedBy: crm.member.id }),
      accountsParams
    );
    expect((await res.json()).updated).toBe(0);
  });

  test("assignOwner with ownedBy:null unassigns", async () => {
    actAs(crm.owner.authProviderId);
    const a = await createAccount({ name: `${uniqueToken()} U`, status: "active" }, crm.owner.id);
    const res = await bulkAction(
      bulkReq({ action: "assignOwner", recordIds: [a], ownedBy: null }),
      accountsParams
    );
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(1);
    expect((await getRow(a)).ownedBy).toBeNull();
  });

  test("assignOwner to a non-member → 400", async () => {
    actAs(crm.owner.authProviderId);
    const a = await createAccount({ name: `${uniqueToken()} NM`, status: "active" }, crm.owner.id);
    const res = await bulkAction(
      bulkReq({
        action: "assignOwner",
        recordIds: [a],
        ownedBy: "00000000-0000-0000-0000-0000000000ff",
      }),
      accountsParams
    );
    expect(res.status).toBe(400);
    // Unchanged.
    expect((await getRow(a)).ownedBy).toBe(crm.owner.id);
  });

  test("changeStatus sets a single-select field; invalid value → 422", async () => {
    actAs(crm.owner.authProviderId);
    const a = await createAccount({ name: `${uniqueToken()} S`, status: "active" }, crm.owner.id);

    let res = await bulkAction(
      bulkReq({ action: "changeStatus", recordIds: [a], field: "status", value: "inactive" }),
      accountsParams
    );
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(1);
    expect((await getRow(a)).data).toMatchObject({ status: "inactive" });

    res = await bulkAction(
      bulkReq({ action: "changeStatus", recordIds: [a], field: "status", value: "not-a-choice" }),
      accountsParams
    );
    expect(res.status).toBe(422);
  });

  test("changeStatus on a non-existent field → 400", async () => {
    actAs(crm.owner.authProviderId);
    const a = await createAccount({ name: `${uniqueToken()} F`, status: "active" }, crm.owner.id);
    const res = await bulkAction(
      bulkReq({ action: "changeStatus", recordIds: [a], field: "ghost", value: "x" }),
      accountsParams
    );
    expect(res.status).toBe(400);
  });

  test("archive sets isArchived on selected records", async () => {
    actAs(crm.owner.authProviderId);
    const a = await createAccount({ name: `${uniqueToken()} Ar`, status: "active" }, crm.owner.id);
    const res = await bulkAction(
      bulkReq({ action: "archive", recordIds: [a] }),
      accountsParams
    );
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(1);
    expect((await getRow(a)).isArchived).toBe(true);
  });

  test("member without account.update → 403", async () => {
    actAs(crm.owner.authProviderId);
    const a = await createAccount({ name: `${uniqueToken()} P`, status: "active" }, crm.owner.id);

    actAs(crm.member.authProviderId);
    const res = await bulkAction(
      bulkReq({ action: "assignOwner", recordIds: [a], ownedBy: crm.member.id }),
      accountsParams
    );
    expect(res.status).toBe(403);
    // Strictly gated — no owner override for bulk. Record unchanged.
    expect((await getRow(a)).ownedBy).toBe(crm.owner.id);
  });

  test("a bad recordId fails the whole batch with zero writes (all-or-nothing)", async () => {
    actAs(crm.owner.authProviderId);
    const a = await createAccount({ name: `${uniqueToken()} AON`, status: "active" }, crm.owner.id);
    const bogus = "00000000-0000-0000-0000-0000000000aa";

    const res = await bulkAction(
      bulkReq({ action: "archive", recordIds: [a, bogus] }),
      accountsParams
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.missing).toContain(bogus);
    // The valid record must NOT have been archived.
    expect((await getRow(a)).isArchived).toBe(false);
  });

  test("cross-tenant recordIds are rejected (tenant isolation)", async () => {
    // A record in another tenant must be invisible to this tenant's bulk op.
    const other = await setupCrmTenant();
    try {
      // Act as the OTHER tenant's owner, scoped to the OTHER tenant's org.
      authMock.mockResolvedValue({
        userId: other.owner.authProviderId,
        orgId: other.clerkOrgId,
      });
      const foreignId = await createAccount(
        { name: `${uniqueToken()} Foreign`, status: "active" },
        other.owner.id
      );

      actAs(crm.owner.authProviderId);
      const res = await bulkAction(
        bulkReq({ action: "archive", recordIds: [foreignId] }),
        accountsParams
      );
      expect(res.status).toBe(400);
      // Foreign record untouched.
      const [foreign] = await testDb
        .select()
        .from(records)
        .where(and(inArray(records.id, [foreignId])));
      expect(foreign.isArchived).toBe(false);
    } finally {
      await teardownCrmTenant(other.tenantId);
    }
  });
});
