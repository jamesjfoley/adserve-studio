/**
 * Test helpers for `@adserve/database`.
 *
 * Import via `@adserve/database/test-helpers`. Do NOT import these from
 * application code — they connect to a test database and bypass the
 * normal RLS-aware client.
 */
export {
  testClient,
  testDb,
  withTestTransaction,
} from "./transaction";

export {
  createTestTenant,
  createTestUser,
  createTestRole,
  createTestMembership,
  deleteTestTenant,
  setupTestContext,
  createTestEntityType,
  getModuleBySlug,
  type TestTenant,
  type TestUser,
  type TestRole,
  type TestEntityType,
} from "./tenant";
