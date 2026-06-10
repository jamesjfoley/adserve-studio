import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));

import { POST as createRecord } from "@/app/api/crm/[entityType]/route";
import { PATCH as patchRecord } from "@/app/api/crm/[entityType]/[id]/route";
import { GET as getHistory } from "@/app/api/crm/[entityType]/[id]/history/route";

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
function jsonReq(method: "POST" | "PATCH", body: unknown) {
  return new NextRequest("http://localhost", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface HistoryRow {
  id: string;
  action: string;
  changes: unknown;
  userId: string | null;
  userName: string | null;
  createdAt: string;
}

async function createAccount(t: CrmTestSetup, name: string): Promise<string> {
  actAsOwner(t);
  const res = await createRecord(jsonReq("POST", { data: { name, status: "active" } }), {
    params: Promise.resolve({ entityType: "accounts" }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).record.id as string;
}

async function updateAccount(t: CrmTestSetup, id: string, name: string) {
  actAsOwner(t);
  const res = await patchRecord(jsonReq("PATCH", { data: { name } }), {
    params: Promise.resolve({ entityType: "accounts", id }),
  });
  expect(res.status).toBe(200);
}

async function fetchHistory(
  t: CrmTestSetup,
  id: string
): Promise<{ status: number; entries: HistoryRow[] }> {
  actAsOwner(t);
  const res = await getHistory(new NextRequest("http://localhost"), {
    params: Promise.resolve({ entityType: "accounts", id }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, entries: (body.entries ?? []) as HistoryRow[] };
}

describe("CRM record history endpoint", () => {
  test("returns audit rows (create + update) newest first", async () => {
    const id = await createAccount(A, "History Co");
    await updateAccount(A, id, "History Co Renamed");

    const { status, entries } = await fetchHistory(A, id);
    expect(status).toBe(200);
    // At least the create and update rows exist.
    expect(entries.length).toBeGreaterThanOrEqual(2);

    const actions = entries.map((e) => e.action);
    expect(actions).toContain("create");
    expect(actions).toContain("update");

    // Newest first: createdAt is non-increasing.
    for (let i = 1; i < entries.length; i++) {
      expect(new Date(entries[i - 1].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(entries[i].createdAt).getTime()
      );
    }

    // The update row carries a { before, after } changes shape.
    const update = entries.find((e) => e.action === "update");
    expect(update).toBeTruthy();
    const changes = update!.changes as { before?: unknown; after?: unknown };
    expect(changes.before).toBeTruthy();
    expect(changes.after).toBeTruthy();

    // Changed-by display name is resolved from the users table.
    expect(update!.userName).toBeTruthy();
  });

  test("404 for an unknown entity type", async () => {
    const id = await createAccount(A, "Type Probe Co");
    actAsOwner(A);
    const res = await getHistory(new NextRequest("http://localhost"), {
      params: Promise.resolve({ entityType: "not-a-real-entity", id }),
    });
    expect(res.status).toBe(404);
  });

  test("tenant B cannot see tenant A's record history (RLS isolation)", async () => {
    const aId = await createAccount(A, "Tenant A Private");
    await updateAccount(A, aId, "Tenant A Private v2");

    // B requests A's record id under B's tenant — RLS hides A's audit rows.
    const { status, entries } = await fetchHistory(B, aId);
    expect(status).toBe(200);
    expect(entries).toHaveLength(0);
  });
});
