import { eq } from "drizzle-orm";
import {
  roles,
  tenantMemberships,
  tenants,
  users,
} from "../schema/tenants";
import { modules } from "../schema/modules";
import { entityTypes } from "../schema/schema-engine";
import type { testDb } from "./transaction";

/**
 * Helpers for creating disposable test data. All return real DB rows so
 * tests can assert against them. All take `tx` so the test owns the
 * transaction (use `withTestTransaction` to get one).
 */

type Tx = typeof testDb;

let counter = 0;
function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

export interface TestTenant {
  id: string;
  name: string;
  slug: string;
}

export async function createTestTenant(
  tx: Tx,
  overrides: Partial<{ name: string; slug: string }> = {}
): Promise<TestTenant> {
  const suffix = uniqueSuffix();
  const [tenant] = await tx
    .insert(tenants)
    .values({
      name: overrides.name ?? `Test Tenant ${suffix}`,
      slug: overrides.slug ?? `test-tenant-${suffix}`,
      status: "active",
      settings: { clerkOrgId: `test_org_${suffix}` },
    })
    .returning();
  return { id: tenant.id, name: tenant.name, slug: tenant.slug };
}

export interface TestUser {
  id: string;
  email: string;
  authProviderId: string;
}

export async function createTestUser(
  tx: Tx,
  overrides: Partial<{ email: string; authProviderId: string }> = {}
): Promise<TestUser> {
  const suffix = uniqueSuffix();
  const [user] = await tx
    .insert(users)
    .values({
      email: overrides.email ?? `test-${suffix}@example.com`,
      fullName: `Test User ${suffix}`,
      authProviderId: overrides.authProviderId ?? `user_test_${suffix}`,
      status: "active",
    })
    .returning();
  return {
    id: user.id,
    email: user.email,
    authProviderId: user.authProviderId!,
  };
}

export interface TestRole {
  id: string;
  slug: string;
}

export async function createTestRole(
  tx: Tx,
  tenantId: string,
  overrides: Partial<{ name: string; slug: string }> = {}
): Promise<TestRole> {
  const suffix = uniqueSuffix();
  const [role] = await tx
    .insert(roles)
    .values({
      tenantId,
      name: overrides.name ?? `Test Role ${suffix}`,
      slug: overrides.slug ?? `test-role-${suffix}`,
      description: "Created by test harness",
      isSystem: false,
    })
    .returning();
  return { id: role.id, slug: role.slug };
}

export async function createTestMembership(
  tx: Tx,
  args: { tenantId: string; userId: string; roleId: string }
): Promise<void> {
  await tx.insert(tenantMemberships).values({
    tenantId: args.tenantId,
    userId: args.userId,
    roleId: args.roleId,
    status: "active",
    joinedAt: new Date(),
  });
}

/**
 * One-shot helper: create a tenant + user + owner-like role + membership
 * and return all four. The most common test setup.
 */
export async function setupTestContext(tx: Tx): Promise<{
  tenant: TestTenant;
  user: TestUser;
  role: TestRole;
}> {
  const tenant = await createTestTenant(tx);
  const user = await createTestUser(tx);
  const role = await createTestRole(tx, tenant.id, {
    name: "Owner",
    slug: "owner",
  });
  await createTestMembership(tx, {
    tenantId: tenant.id,
    userId: user.id,
    roleId: role.id,
  });
  return { tenant, user, role };
}

/**
 * Cascading delete of a test tenant — for use by integration tests that
 * can't use transaction rollback (because the route handler under test
 * owns its own transactions via withTenant). Call from afterAll.
 *
 * Uses the testDb (not a tx) since this runs OUTSIDE any test
 * transaction.
 */
export async function deleteTestTenant(
  db: Tx,
  tenantId: string
): Promise<void> {
  // FK ON DELETE CASCADE on tenant_id columns handles most cleanup;
  // this is just the top-level delete.
  await db.delete(tenants).where(eq(tenants.id, tenantId));
}

export interface TestEntityType {
  id: string;
  slug: string;
  moduleId: string;
}

/**
 * Look up a module by its slug (e.g. "crm"). The seed creates modules
 * before any tests run, so within a test transaction we can read them.
 */
export async function getModuleBySlug(
  tx: Tx,
  slug: string
): Promise<{ id: string; slug: string }> {
  const [mod] = await tx
    .select({ id: modules.id, slug: modules.slug })
    .from(modules)
    .where(eq(modules.slug, slug));
  if (!mod) {
    throw new Error(
      `Test setup: module "${slug}" not found. Did you run pnpm db:seed?`
    );
  }
  return mod;
}

/**
 * Create a test entity type scoped to a tenant and a (seeded) module.
 * Returns the inserted row's id + slug for use in subsequent inserts.
 */
export async function createTestEntityType(
  tx: Tx,
  args: {
    tenantId: string;
    moduleId: string;
    slug?: string;
    name?: string;
  }
): Promise<TestEntityType> {
  const suffix = Date.now().toString(36);
  const slug = args.slug ?? `test-entity-${suffix}`;
  const [row] = await tx
    .insert(entityTypes)
    .values({
      tenantId: args.tenantId,
      moduleId: args.moduleId,
      name: args.name ?? `Test Entity ${suffix}`,
      slug,
      description: "Created by test harness",
    })
    .returning();
  return { id: row.id, slug: row.slug, moduleId: row.moduleId };
}
