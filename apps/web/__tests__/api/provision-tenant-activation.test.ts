import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import {
  testDb,
  createTestUser,
  deleteTestTenant,
  type TestUser,
} from "@adserve/database/test-helpers";
import { entityTypes, schemaRelationships } from "@adserve/database";

/**
 * Smoke test: the dev provisioning endpoint triggers CRM activation
 * end-to-end. After a successful provision, the new tenant should have
 * its 4 CRM entity types and 3 relationships registered (Task 0.6 wired
 * `activateCrmForTenant` into the route).
 *
 * The route owns its own transaction via `withSuperAdminBypass`, so we
 * can't share a rolling-back test transaction — we assert against the
 * committed rows and cascade-delete the tenant in `afterAll`.
 */

// Mock Clerk + dev-sync before importing the route (vi.mock is hoisted).
const authMock = vi.fn();
const getOrganizationMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
  clerkClient: vi.fn(async () => ({
    organizations: { getOrganization: getOrganizationMock },
  })),
}));

const syncCurrentUserMock = vi.fn();
vi.mock("@/lib/dev-sync", () => ({
  DevSyncError: class DevSyncError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  syncCurrentUser: syncCurrentUserMock,
}));

describe("GET /api/dev/provision-tenant → CRM activation", () => {
  let user: TestUser;
  let orgId: string;
  let tenantId: string | undefined;

  beforeAll(async () => {
    user = await createTestUser(testDb);
    orgId = `test_org_activate_${Date.now().toString(36)}`;

    authMock.mockResolvedValue({ userId: user.authProviderId, orgId });
    getOrganizationMock.mockResolvedValue({
      id: orgId,
      name: "Activation Smoke Org",
      slug: `activate-smoke-${Date.now().toString(36)}`,
    });
    syncCurrentUserMock.mockResolvedValue({
      id: user.id,
      isSuperAdmin: false,
    });

    vi.stubEnv("NODE_ENV", "development");
  });

  afterAll(async () => {
    if (tenantId) await deleteTestTenant(testDb, tenantId);
    vi.unstubAllEnvs();
  });

  test("provisioning a tenant registers 4 entity types + 3 relationships", async () => {
    const { GET } = await import(
      "@/app/api/dev/provision-tenant/route"
    );

    const response = await GET();
    expect(response.status).toBe(200);

    const body = (await response.json()) as { tenant: { id: string } };
    tenantId = body.tenant.id;
    expect(tenantId).toBeTruthy();

    const ets = await testDb
      .select()
      .from(entityTypes)
      .where(eq(entityTypes.tenantId, tenantId));
    expect(ets.map((e) => e.slug).sort()).toEqual([
      "account",
      "contact",
      "lead",
      "opportunity",
    ]);

    const rels = await testDb
      .select()
      .from(schemaRelationships)
      .where(eq(schemaRelationships.tenantId, tenantId));
    expect(rels).toHaveLength(3);
  });
});
