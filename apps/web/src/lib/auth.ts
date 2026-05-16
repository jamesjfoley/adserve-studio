import { auth } from "@clerk/nextjs/server";
import { createTenantDb, db } from "@adserve/database";
import { users, tenants, tenantMemberships } from "@adserve/database";
import { eq, and, sql } from "drizzle-orm";

/**
 * Get the current authenticated user's tenant context.
 *
 * Clerk's "Organizations" map to our tenants:
 * - Clerk orgId → tenant.auth_provider_id (or a mapping table)
 * - Clerk userId → users.auth_provider_id
 *
 * This function:
 * 1. Gets the Clerk session (orgId + userId)
 * 2. Looks up the internal tenant and user records
 * 3. Returns a tenant-scoped database client + user info
 */
export async function getTenantContext() {
  const { userId, orgId } = await auth();

  if (!userId) {
    throw new Error("Not authenticated");
  }

  if (!orgId) {
    // User is signed in but hasn't selected an organization.
    // Redirect to org selection or onboarding.
    return null;
  }

  // Look up the internal user by Clerk's user ID
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.authProviderId, userId));

  if (!user) {
    throw new Error("User not found in database");
  }

  // Look up the tenant by Clerk's org ID (stored in settings.clerkOrgId by the webhook / provision endpoint)
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(sql`${tenants.settings}->>'clerkOrgId' = ${orgId}`);

  if (!tenant) {
    throw new Error("Tenant not found");
  }

  // Verify the user has an active membership in this tenant
  const [membership] = await db
    .select()
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.tenantId, tenant.id),
        eq(tenantMemberships.userId, user.id),
        eq(tenantMemberships.status, "active")
      )
    );

  if (!membership) {
    throw new Error("User does not have access to this tenant");
  }

  return {
    tenant,
    user,
    membership,
    db: createTenantDb(tenant.id),
  };
}

/**
 * Lightweight version that just returns the tenant ID.
 * Use in API routes where you only need the scoped DB client.
 */
export async function requireTenantDb() {
  const ctx = await getTenantContext();
  if (!ctx) {
    throw new Error("No tenant selected");
  }
  return ctx.db;
}
