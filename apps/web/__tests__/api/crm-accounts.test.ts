import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  testDb,
  deleteTestTenant,
  setupTestContext,
  type TestTenant,
  type TestUser,
} from "@adserve/database/test-helpers";

/**
 * Skeleton integration test for the CRM accounts list endpoint.
 *
 * Pattern this test demonstrates:
 *   1. Create a tenant + user + membership in `beforeAll` (kept around
 *      for the test run, NOT wrapped in a rolling-back transaction —
 *      the route handler under test owns its own transactions via
 *      withTenant() so we can't share one).
 *   2. Mock Clerk's `auth()` to return the test user's authProviderId
 *      and the tenant's clerkOrgId.
 *   3. Import and call the route handler directly with a NextRequest.
 *   4. `afterAll` cascades a delete of the test tenant.
 *
 * This will fail until Task 1.2 creates the route file. That is the
 * point — it documents the contract.
 */

// Mock Clerk before any module that imports it.
const authMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
  clerkClient: vi.fn(),
}));

describe("GET /api/crm/accounts", () => {
  let tenant: TestTenant;
  let user: TestUser;

  beforeAll(async () => {
    const ctx = await setupTestContext(testDb);
    tenant = ctx.tenant;
    user = ctx.user;

    authMock.mockResolvedValue({
      userId: user.authProviderId,
      orgId: (tenant as { id: string } & Record<string, string>).slug
        ? `test_org_${tenant.slug}`
        : undefined,
    });
  });

  afterAll(async () => {
    if (tenant?.id) {
      await deleteTestTenant(testDb, tenant.id);
    }
  });

  // test.fails() pattern (see field-engine.test.ts header for rationale).
  test.fails("returns 200 and an empty list for a new tenant", async () => {
    // TODO(task-1.2): this import will resolve once the route file
    // exists at apps/web/src/app/api/crm/accounts/route.ts.
    const { GET } = await import(
      // @ts-expect-error — route does not exist yet (Task 1.2)
      "@/app/api/crm/accounts/route"
    );

    // Minimal NextRequest stub — the route only reads .url and .headers
    // through Next's helpers, both of which a plain Request satisfies.
    const request = new Request("http://localhost/api/crm/accounts");

    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual({ accounts: [] });
  });
});
