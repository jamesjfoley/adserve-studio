import {
  db,
  tenants,
  roles,
  permissions,
  rolePermissions,
} from "@adserve/database";

export type TenantSettings = {
  clerkOrgId?: string;
  timezone?: string;
  locale?: string;
  currency?: string;
};

export type ProvisionTenantInput = {
  name: string;
  slug: string;
  settings?: TenantSettings;
};

export type ProvisionedTenant = typeof tenants.$inferSelect;

/**
 * Create a tenant with its 3 default roles and standard permission grants.
 * Owner gets all permissions; admin gets all except tenant.admin; member
 * gets none. Takes a `tx` so the caller owns the RLS wrapper (typically
 * `withSuperAdminBypass`) — atomicity comes from the wrapper's transaction.
 */
export async function provisionTenant(
  tx: typeof db,
  input: ProvisionTenantInput
): Promise<ProvisionedTenant> {
  const [tenant] = await tx
    .insert(tenants)
    .values({
      name: input.name,
      slug: input.slug,
      status: "active",
      settings: input.settings ?? {},
    })
    .returning();

  const insertedRoles = await tx
    .insert(roles)
    .values([
      {
        tenantId: tenant.id,
        name: "Owner",
        slug: "owner",
        description: "Full access. Can manage billing and delete tenant.",
        isSystem: true,
      },
      {
        tenantId: tenant.id,
        name: "Admin",
        slug: "admin",
        description: "Full access except tenant deletion and billing.",
        isSystem: true,
      },
      {
        tenantId: tenant.id,
        name: "Member",
        slug: "member",
        description:
          "Access to assigned modules. Cannot manage users or schema.",
        isSystem: true,
      },
    ])
    .returning();

  const ownerRole = insertedRoles.find((r) => r.slug === "owner")!;
  const adminRole = insertedRoles.find((r) => r.slug === "admin")!;

  const allPerms = await tx.select().from(permissions);

  const ownerGrants = allPerms.map((p) => ({
    roleId: ownerRole.id,
    permissionId: p.id,
  }));
  const adminGrants = allPerms
    .filter((p) => !(p.resource === "tenant" && p.action === "admin"))
    .map((p) => ({ roleId: adminRole.id, permissionId: p.id }));

  if (ownerGrants.length > 0) {
    await tx.insert(rolePermissions).values(ownerGrants);
  }
  if (adminGrants.length > 0) {
    await tx.insert(rolePermissions).values(adminGrants);
  }

  return tenant;
}
