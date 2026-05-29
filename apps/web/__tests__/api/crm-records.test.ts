import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { testDb } from "@adserve/database/test-helpers";
import { records } from "@adserve/database";
import { getEntityTypeBySlug } from "@adserve/module-framework";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

import { GET as listRecords, POST as createRecord } from "@/app/api/crm/[entityType]/route";
import {
  PATCH as patchRecord,
  DELETE as archiveRecord,
} from "@/app/api/crm/[entityType]/[id]/route";

let crm: CrmTestSetup;
let tokenCounter = 0;

function uniqueToken(): string {
  tokenCounter += 1;
  return `lc-${Date.now().toString(36)}-${tokenCounter}`;
}

function actAs(authProviderId: string) {
  authMock.mockResolvedValue({
    userId: authProviderId,
    orgId: crm.clerkOrgId,
  });
}

function listReq(qs: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/crm/accounts");
  for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

function jsonReq(method: string, body: unknown) {
  return new NextRequest("http://localhost/api/crm/accounts", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const accountsParams = { params: Promise.resolve({ entityType: "accounts" }) };
function idParams(id: string) {
  return { params: Promise.resolve({ entityType: "accounts", id }) };
}

async function createAccount(
  data: Record<string, unknown>,
  ownedBy?: string
): Promise<string> {
  const res = await createRecord(jsonReq("POST", { data, ownedBy }), accountsParams);
  expect(res.status).toBe(201);
  const body = await res.json();
  return body.record.id as string;
}

beforeAll(async () => {
  crm = await setupCrmTenant();
});
afterAll(async () => {
  if (crm?.tenantId) await teardownCrmTenant(crm.tenantId);
});

describe("CRM records — lifecycle (owner)", () => {
  test("create → filter → sort → patch → archive → archived visibility", async () => {
    actAs(crm.owner.authProviderId);
    const token = uniqueToken();

    const acmeId = await createAccount({
      name: `${token} Acme`,
      status: "active",
      employeeCount: 50,
    });
    await createAccount({
      name: `${token} Globex`,
      status: "prospect",
      employeeCount: 10,
    });

    // Filter by our unique token (so other tests' rows don't interfere).
    const tokenFilter = { fieldSlug: "name", operator: "contains", value: token };

    // List all in this batch.
    let res = await listRecords(
      listReq({ filters: JSON.stringify([tokenFilter]) }),
      accountsParams
    );
    expect(res.status).toBe(200);
    let body = await res.json();
    expect(body.pagination.total).toBe(2);

    // Filter status = active → only Acme.
    res = await listRecords(
      listReq({
        filters: JSON.stringify([
          tokenFilter,
          { fieldSlug: "status", operator: "is", value: "active" },
        ]),
      }),
      accountsParams
    );
    body = await res.json();
    expect(body.records).toHaveLength(1);
    expect(body.records[0].data.name).toBe(`${token} Acme`);

    // Sort employeeCount desc → Acme (50) before Globex (10).
    res = await listRecords(
      listReq({
        filters: JSON.stringify([tokenFilter]),
        sort: JSON.stringify({ fieldSlug: "employeeCount", direction: "desc" }),
      }),
      accountsParams
    );
    body = await res.json();
    expect(body.records.map((r: { data: { name: string } }) => r.data.name)).toEqual([
      `${token} Acme`,
      `${token} Globex`,
    ]);

    // Patch Acme.
    res = await patchRecord(
      jsonReq("PATCH", { data: { employeeCount: 99 } }),
      idParams(acmeId)
    );
    expect(res.status).toBe(200);
    expect((await res.json()).record.data.employeeCount).toBe(99);

    // Archive Acme.
    res = await archiveRecord(new NextRequest("http://localhost"), idParams(acmeId));
    expect(res.status).toBe(200);
    expect((await res.json()).record.isArchived).toBe(true);

    // Default list excludes archived → only Globex in this batch.
    res = await listRecords(
      listReq({ filters: JSON.stringify([tokenFilter]) }),
      accountsParams
    );
    expect((await res.json()).pagination.total).toBe(1);

    // includeArchived → both back.
    res = await listRecords(
      listReq({ filters: JSON.stringify([tokenFilter]), includeArchived: "true" }),
      accountsParams
    );
    expect((await res.json()).pagination.total).toBe(2);
  });

  test("create with missing required field → 422", async () => {
    actAs(crm.owner.authProviderId);
    const res = await createRecord(
      jsonReq("POST", { data: { status: "active" } }), // no name
      accountsParams
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.fieldErrors.name).toMatch(/required/i);
  });

  test("bad filter operator → 400", async () => {
    actAs(crm.owner.authProviderId);
    const res = await listRecords(
      listReq({
        filters: JSON.stringify([
          { fieldSlug: "name", operator: "gt", value: "1" },
        ]),
      }),
      accountsParams
    );
    expect(res.status).toBe(400);
  });
});

describe("CRM records — permission + ownership matrix (member)", () => {
  test("member cannot create (no account.create) → 403", async () => {
    actAs(crm.member.authProviderId);
    const res = await createRecord(
      jsonReq("POST", { data: { name: "Nope", status: "active" } }),
      accountsParams
    );
    expect(res.status).toBe(403);
  });

  test("member CAN patch a record they own (owner override)", async () => {
    actAs(crm.owner.authProviderId);
    const ownedId = await createAccount(
      { name: `${uniqueToken()} Owned`, status: "active" },
      crm.member.id // ownedBy = member
    );

    actAs(crm.member.authProviderId);
    const res = await patchRecord(
      jsonReq("PATCH", { data: { status: "inactive" } }),
      idParams(ownedId)
    );
    expect(res.status).toBe(200);
    expect((await res.json()).record.data.status).toBe("inactive");
  });

  test("member CANNOT patch a record owned by someone else → 403", async () => {
    actAs(crm.owner.authProviderId);
    const notOwnedId = await createAccount(
      { name: `${uniqueToken()} NotOwned`, status: "active" },
      crm.owner.id // ownedBy = owner
    );

    actAs(crm.member.authProviderId);
    const res = await patchRecord(
      jsonReq("PATCH", { data: { status: "inactive" } }),
      idParams(notOwnedId)
    );
    expect(res.status).toBe(403);
  });

  test("null ownedBy does NOT grant the override → 403", async () => {
    // Insert a record with ownedBy = null directly (POST always stamps an owner).
    const accountEntity = await getEntityTypeBySlug(testDb, {
      tenantId: crm.tenantId,
      slug: "account",
    });
    const [row] = await testDb
      .insert(records)
      .values({
        tenantId: crm.tenantId,
        entityTypeId: accountEntity!.id,
        data: { name: `${uniqueToken()} Orphan`, status: "active" },
        ownedBy: null,
      })
      .returning();

    actAs(crm.member.authProviderId);
    const res = await patchRecord(
      jsonReq("PATCH", { data: { status: "inactive" } }),
      idParams(row.id)
    );
    expect(res.status).toBe(403);

    // Cleanup the directly-inserted row (not owned by the cascade test flow).
    await testDb.delete(records).where(and(eq(records.id, row.id)));
  });
});
