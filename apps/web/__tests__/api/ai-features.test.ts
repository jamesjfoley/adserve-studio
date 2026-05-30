import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import {
  testDb,
  createTestRole,
  createTestUser,
  createTestMembership,
} from "@adserve/database/test-helpers";
import { entityTypes, permissions, records, rolePermissions } from "@adserve/database";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";

const authMock = vi.hoisted(() => vi.fn());
const aiCompleteMock = vi.hoisted(() => vi.fn());
vi.mock("@clerk/nextjs/server", () => ({ auth: authMock }));
vi.mock("@adserve/ai-service", async (importActual) => {
  const actual =
    await importActual<typeof import("@adserve/ai-service")>();
  return { ...actual, aiComplete: aiCompleteMock };
});

import { POST as fromNl } from "@/app/api/crm/[entityType]/from-nl/route";
import { POST as suggestField } from "@/app/api/crm/[entityType]/suggest-field/route";
import { POST as smartSearch } from "@/app/api/crm/[entityType]/smart-search/route";
import { POST as summarize } from "@/app/api/crm/accounts/[id]/summarize/route";

let crm: CrmTestSetup;

function actAs(authProviderId: string) {
  authMock.mockResolvedValue({ userId: authProviderId, orgId: crm.clerkOrgId });
}

function ok(content: string) {
  aiCompleteMock.mockResolvedValue({
    ok: true,
    content,
    model: "claude-sonnet-4-6",
    tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    costMicros: 100,
    durationMs: 50,
  });
}
function fail(error: unknown) {
  aiCompleteMock.mockResolvedValue({ ok: false, error });
}

const entityParams = (entityType: string) => ({
  params: Promise.resolve({ entityType }),
});
function jsonReq(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function entityId(slug: string): Promise<string> {
  const [e] = await testDb
    .select({ id: entityTypes.id })
    .from(entityTypes)
    .where(and(eq(entityTypes.tenantId, crm.tenantId), eq(entityTypes.slug, slug)));
  return e.id;
}

async function createAccount(name: string): Promise<string> {
  const [row] = await testDb
    .insert(records)
    .values({ tenantId: crm.tenantId, entityTypeId: await entityId("account"), data: { name } })
    .returning({ id: records.id });
  return row.id;
}

/** Mint a user whose role grants exactly `keys` (e.g. ["account.update"]). */
let roleCounter = 0;
async function userWithPerms(keys: string[]): Promise<string> {
  roleCounter += 1;
  const role = await createTestRole(testDb, crm.tenantId, {
    name: `Custom ${roleCounter}`,
    slug: `custom-${roleCounter}`,
  });
  const user = await createTestUser(testDb);
  await createTestMembership(testDb, {
    tenantId: crm.tenantId,
    userId: user.id,
    roleId: role.id,
  });
  if (keys.length > 0) {
    const perms = await testDb.select().from(permissions);
    const idByKey = new Map(perms.map((p) => [`${p.resource}.${p.action}`, p.id]));
    const grants = keys
      .map((k) => idByKey.get(k))
      .filter((id): id is string => Boolean(id))
      .map((permissionId) => ({ roleId: role.id, permissionId }));
    if (grants.length > 0) {
      await testDb.insert(rolePermissions).values(grants).onConflictDoNothing();
    }
  }
  return user.authProviderId;
}

beforeAll(async () => {
  crm = await setupCrmTenant();
});
afterAll(async () => {
  if (crm?.tenantId) await teardownCrmTenant(crm.tenantId);
});
beforeEach(() => {
  aiCompleteMock.mockReset();
  ok("{}");
});

describe("POST /api/crm/[entityType]/from-nl (1.7a)", () => {
  test("parses NL into draft fields; calls aiComplete with crm/record_creation", async () => {
    actAs(crm.owner.authProviderId);
    ok('{"name":"Acme Corp"}');
    const res = await fromNl(
      jsonReq("http://localhost/api/crm/accounts/from-nl", {
        prompt: "Create Acme Corp, a tech company",
      }),
      entityParams("accounts")
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fields: { name: "Acme Corp" } });
    expect(aiCompleteMock).toHaveBeenCalledTimes(1);
    const arg = aiCompleteMock.mock.calls[0][0];
    expect(arg).toMatchObject({
      module: "crm",
      capability: "record_creation",
      tenantId: crm.tenantId,
    });
    expect(arg.messages[0].content).toContain("Create Acme Corp");
  });

  test("strips a ```json fence before parsing (success, not 502)", async () => {
    actAs(crm.owner.authProviderId);
    ok('```json\n{"name":"Fenced"}\n```');
    const res = await fromNl(
      jsonReq("http://localhost/api/crm/accounts/from-nl", { prompt: "x" }),
      entityParams("accounts")
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fields: { name: "Fenced" } });
  });

  test("malformed model JSON → 502", async () => {
    actAs(crm.owner.authProviderId);
    ok("not json at all");
    const res = await fromNl(
      jsonReq("http://localhost/api/crm/accounts/from-nl", { prompt: "x" }),
      entityParams("accounts")
    );
    expect(res.status).toBe(502);
  });

  test("over_limit → 429, and a user without create → 403 (no AI call)", async () => {
    actAs(crm.owner.authProviderId);
    fail({ code: "over_limit", message: "over" });
    let res = await fromNl(
      jsonReq("http://localhost/api/crm/accounts/from-nl", { prompt: "x" }),
      entityParams("accounts")
    );
    expect(res.status).toBe(429);

    aiCompleteMock.mockReset();
    actAs(crm.member.authProviderId); // member lacks account.create
    res = await fromNl(
      jsonReq("http://localhost/api/crm/accounts/from-nl", { prompt: "x" }),
      entityParams("accounts")
    );
    expect(res.status).toBe(403);
    expect(aiCompleteMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/crm/[entityType]/suggest-field (1.7b)", () => {
  test("returns a suggestion for a create-holder", async () => {
    actAs(crm.owner.authProviderId);
    ok("Acme Incorporated");
    const res = await suggestField(
      jsonReq("http://localhost/api/crm/accounts/suggest-field", {
        fieldSlug: "name",
        recordContext: { website: "acme.com" },
      }),
      entityParams("accounts")
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestion: "Acme Incorporated" });
    expect(aiCompleteMock.mock.calls[0][0]).toMatchObject({
      capability: "field_suggestion",
    });
  });

  test("an update-only holder may also suggest (create OR update)", async () => {
    const updater = await userWithPerms(["account.update"]);
    actAs(updater);
    ok("Suggested");
    const res = await suggestField(
      jsonReq("http://localhost/api/crm/accounts/suggest-field", {
        fieldSlug: "name",
        recordContext: {},
      }),
      entityParams("accounts")
    );
    expect(res.status).toBe(200);
  });

  test("a user with neither create nor update → 403", async () => {
    actAs(crm.member.authProviderId); // account.read only
    const res = await suggestField(
      jsonReq("http://localhost/api/crm/accounts/suggest-field", {
        fieldSlug: "name",
        recordContext: {},
      }),
      entityParams("accounts")
    );
    expect(res.status).toBe(403);
    expect(aiCompleteMock).not.toHaveBeenCalled();
  });

  test("unknown field → 400", async () => {
    actAs(crm.owner.authProviderId);
    const res = await suggestField(
      jsonReq("http://localhost/api/crm/accounts/suggest-field", {
        fieldSlug: "does_not_exist",
        recordContext: {},
      }),
      entityParams("accounts")
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/crm/accounts/[id]/summarize (1.7c)", () => {
  test("summarizes for a user with account.read + activity.read", async () => {
    actAs(crm.owner.authProviderId);
    ok("Two paragraph summary.");
    const accId = await createAccount("Summary Co");
    const res = await summarize(
      jsonReq(`http://localhost/api/crm/accounts/${accId}/summarize`),
      { params: Promise.resolve({ id: accId }) }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summary: "Two paragraph summary." });
    expect(aiCompleteMock.mock.calls[0][0]).toMatchObject({
      capability: "activity_summary",
    });
  });

  test("missing account → 404 (no AI call)", async () => {
    actAs(crm.owner.authProviderId);
    const res = await summarize(
      jsonReq("http://localhost/api/crm/accounts/00000000-0000-0000-0000-000000000000/summarize"),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) }
    );
    expect(res.status).toBe(404);
    expect(aiCompleteMock).not.toHaveBeenCalled();
  });

  test("account.read WITHOUT activity.read → 403 (no activity exfiltration)", async () => {
    const reader = await userWithPerms(["account.read"]);
    actAs(reader);
    const accId = await createAccount("Locked Co");
    const res = await summarize(
      jsonReq(`http://localhost/api/crm/accounts/${accId}/summarize`),
      { params: Promise.resolve({ id: accId }) }
    );
    expect(res.status).toBe(403);
    expect(aiCompleteMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/crm/[entityType]/smart-search (1.7d)", () => {
  test("returns parsed filter state", async () => {
    actAs(crm.owner.authProviderId);
    ok('{"filters":[{"field":"status","op":"eq","value":"active"}]}');
    const res = await smartSearch(
      jsonReq("http://localhost/api/crm/leads/smart-search", {
        query: "active leads",
      }),
      entityParams("leads")
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      filters: [{ field: "status", op: "eq", value: "active" }],
    });
    expect(aiCompleteMock.mock.calls[0][0]).toMatchObject({
      capability: "smart_search",
    });
  });

  test("model output without a filters array → 502", async () => {
    actAs(crm.owner.authProviderId);
    ok('{"nonsense":true}');
    const res = await smartSearch(
      jsonReq("http://localhost/api/crm/leads/smart-search", { query: "x" }),
      entityParams("leads")
    );
    expect(res.status).toBe(502);
  });
});
