import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { setupCrmTenant, teardownCrmTenant, type CrmTestSetup } from "../helpers/crm";

/**
 * Integration test for the CRM list endpoint (Task 1.2). Formerly an
 * expected-fail skeleton — now exercises the real
 * `/api/crm/[entityType]` route end to end.
 *
 * The route owns its own transaction via withTenant on the app client,
 * so we create a committed tenant (with CRM activated + owner grants),
 * mock Clerk `auth()` to that tenant/user, call the handler, and cascade
 * a delete in `afterAll`.
 */
const authMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
}));

describe("GET /api/crm/[entityType]", () => {
  let crm: CrmTestSetup;

  beforeAll(async () => {
    crm = await setupCrmTenant();
    authMock.mockResolvedValue({
      userId: crm.owner.authProviderId,
      orgId: crm.clerkOrgId,
    });
  });

  afterAll(async () => {
    if (crm?.tenantId) await teardownCrmTenant(crm.tenantId);
  });

  test("returns 200 with an empty record list + pagination for a new tenant", async () => {
    const { GET } = await import("@/app/api/crm/[entityType]/route");

    const request = new NextRequest("http://localhost/api/crm/accounts");
    const response = await GET(request, {
      params: Promise.resolve({ entityType: "accounts" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.records).toEqual([]);
    expect(body.pagination).toEqual({ offset: 0, limit: 50, total: 0 });
  });

  test("unknown entity type returns 404", async () => {
    const { GET } = await import("@/app/api/crm/[entityType]/route");
    const request = new NextRequest("http://localhost/api/crm/widgets");
    const response = await GET(request, {
      params: Promise.resolve({ entityType: "widgets" }),
    });
    expect(response.status).toBe(404);
  });
});
