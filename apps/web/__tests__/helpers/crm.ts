import { eq } from "drizzle-orm";
import {
  testDb,
  createTestTenant,
  createTestUser,
  createTestRole,
  createTestMembership,
  deleteTestTenant,
} from "@adserve/database/test-helpers";
import { tenants } from "@adserve/database";
import { activateCrmForTenant } from "@adserve/crm";

/**
 * Shared setup for CRM route integration tests. Creates a tenant with an
 * owner role (all CRM perms) and a member role (read-only + activities),
 * a user in each, then activates CRM (entity types + perms + grants).
 *
 * The CRM routes own their own transactions via withTenant on the app
 * client, so this commits real rows — tear down with `teardownCrmTenant`.
 */
export interface CrmTestSetup {
  tenantId: string;
  clerkOrgId: string;
  owner: { id: string; authProviderId: string; roleId: string };
  member: { id: string; authProviderId: string; roleId: string };
}

export async function setupCrmTenant(): Promise<CrmTestSetup> {
  const tenant = await createTestTenant(testDb);
  const ownerRole = await createTestRole(testDb, tenant.id, {
    name: "Owner",
    slug: "owner",
  });
  const memberRole = await createTestRole(testDb, tenant.id, {
    name: "Member",
    slug: "member",
  });
  const ownerUser = await createTestUser(testDb);
  const memberUser = await createTestUser(testDb);
  await createTestMembership(testDb, {
    tenantId: tenant.id,
    userId: ownerUser.id,
    roleId: ownerRole.id,
  });
  await createTestMembership(testDb, {
    tenantId: tenant.id,
    userId: memberUser.id,
    roleId: memberRole.id,
  });

  await activateCrmForTenant(testDb, { tenantId: tenant.id });

  const [row] = await testDb
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenant.id));
  const clerkOrgId = (row.settings as { clerkOrgId?: string }).clerkOrgId!;

  return {
    tenantId: tenant.id,
    clerkOrgId,
    owner: {
      id: ownerUser.id,
      authProviderId: ownerUser.authProviderId,
      roleId: ownerRole.id,
    },
    member: {
      id: memberUser.id,
      authProviderId: memberUser.authProviderId,
      roleId: memberRole.id,
    },
  };
}

export async function teardownCrmTenant(tenantId: string): Promise<void> {
  await deleteTestTenant(testDb, tenantId);
}
