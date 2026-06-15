import postgres from "postgres";

/**
 * Global test teardown — safety net against leaked fixture data.
 *
 * Most tests create data inside `withTestTransaction` (always rolled back), so
 * nothing persists. But a few integration tests must COMMIT — they exercise
 * real route handlers that use the app's own DB connection and so can't see an
 * uncommitted test transaction (e.g. provision-tenant-activation, ai-features).
 * If such a test crashes mid-run — or doesn't fully clean up — its committed
 * fixture rows persist in the shared dev DB and accumulate over time. That is
 * exactly how ~26k orphaned `test-*@example.com` users once built up.
 *
 * This teardown runs once after every vitest invocation and deletes anything
 * matching the fixture naming patterns minted by `test-helpers/tenant.ts`
 * (`Test Tenant …` / `test-tenant-…` / `test_org_…`, and `test-…@example.com` /
 * `user_test_…` / `…@example.test`). It is scoped STRICTLY to those patterns and
 * explicitly skips super-admins, so it can never touch real data such as
 * "My Organization", "adserve", or the real logins. Tenant deletes cascade to
 * all child rows (records, roles, memberships, entity types, …) via
 * ON DELETE CASCADE.
 *
 * Wired via `globalSetup` in vitest.shared.ts. Failures here only warn — a
 * teardown problem must never fail an otherwise-green suite.
 */
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://jamesfoley@localhost:5432/adserve";

export default async function globalSetup() {
  // No setup work needed; the value we return is the teardown hook.
  return async function teardown() {
    const sql = postgres(TEST_DB_URL, { max: 1 });
    try {
      const tenants = await sql`
        DELETE FROM tenants
        WHERE slug LIKE 'test-tenant-%'
           OR name LIKE 'Test Tenant %'
           OR settings->>'clerkOrgId' LIKE 'test_org_%'
        RETURNING id`;
      const users = await sql`
        DELETE FROM users
        WHERE is_super_admin = false
          AND ( email LIKE 'test-%@example.com'
             OR email LIKE '%@example.test'
             OR auth_provider_id LIKE 'user_test_%' )
        RETURNING id`;
      if (tenants.length || users.length) {
        console.log(
          `[global-teardown] purged ${tenants.length} test tenant(s) and ${users.length} test user(s)`
        );
      }
    } catch (err) {
      console.warn(
        "[global-teardown] test-data cleanup skipped:",
        (err as Error).message
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  };
}
