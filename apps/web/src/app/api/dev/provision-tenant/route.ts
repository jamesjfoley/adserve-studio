import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import {
  tenants,
  roles,
  permissions,
  rolePermissions,
  tenantMemberships,
  tenantModules,
  modules,
  withSuperAdminBypass,
} from "@adserve/database";
import { eq, sql } from "drizzle-orm";
import { activateCrmForTenant } from "@adserve/crm";
import { DevSyncError, syncCurrentUser } from "@/lib/dev-sync";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { userId, orgId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  if (!orgId) {
    return NextResponse.json(
      { error: "No Clerk organization selected" },
      { status: 400 }
    );
  }

  let user;
  try {
    user = await syncCurrentUser();
  } catch (err) {
    if (err instanceof DevSyncError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  // Role separation: super admin accounts must never belong to a tenant.
  // Refuse to provision a tenant when the calling user is a super admin.
  if (user.isSuperAdmin) {
    return NextResponse.json(
      {
        error:
          "Super admin accounts cannot be added to tenants. Sign in with a separate non-super-admin account to provision a tenant.",
      },
      { status: 403 }
    );
  }

  const client = await clerkClient();
  const clerkOrg = await client.organizations.getOrganization({
    organizationId: orgId,
  });
  const orgName = clerkOrg.name || clerkOrg.slug || orgId;
  const orgSlug = clerkOrg.slug || orgId;

  // withSuperAdminBypass provides its own transaction — flatten the
  // existing db.transaction() into this callback. No nested tx.
  const result = await withSuperAdminBypass(async (tx) => {
    // ---- Tenant (idempotent on settings.clerkOrgId) ----
    const existing = await tx
      .select()
      .from(tenants)
      .where(sql`${tenants.settings}->>'clerkOrgId' = ${orgId}`);

    let tenant = existing[0];
    let tenantCreated = false;
    if (!tenant) {
      const [created] = await tx
        .insert(tenants)
        .values({
          name: orgName,
          slug: orgSlug,
          status: "active",
          settings: {
            clerkOrgId: orgId,
            timezone: "Europe/London",
            locale: "en-GB",
            currency: "GBP",
          },
        })
        .returning();
      tenant = created;
      tenantCreated = true;
    }

    // ---- Roles (idempotent on (tenantId, slug)) ----
    const roleSpecs = [
      {
        name: "Owner",
        slug: "owner",
        description: "Full access. Can manage billing and delete tenant.",
      },
      {
        name: "Admin",
        slug: "admin",
        description: "Full access except tenant deletion and billing.",
      },
      {
        name: "Member",
        slug: "member",
        description:
          "Access to assigned modules. Cannot manage users or schema.",
      },
    ];

    const roleRecords = await Promise.all(
      roleSpecs.map(async (spec) => {
        const [row] = await tx
          .insert(roles)
          .values({
            tenantId: tenant.id,
            name: spec.name,
            slug: spec.slug,
            description: spec.description,
            isSystem: true,
          })
          .onConflictDoUpdate({
            target: [roles.tenantId, roles.slug],
            set: { updatedAt: new Date() },
          })
          .returning();
        return row;
      })
    );

    const ownerRole = roleRecords.find((r) => r.slug === "owner")!;
    const adminRole = roleRecords.find((r) => r.slug === "admin")!;

    // ---- Permission grants ----
    const allPerms = await tx.select().from(permissions);

    const ownerGrants = allPerms.map((p) => ({
      roleId: ownerRole.id,
      permissionId: p.id,
    }));
    const adminGrants = allPerms
      .filter((p) => !(p.resource === "tenant" && p.action === "admin"))
      .map((p) => ({
        roleId: adminRole.id,
        permissionId: p.id,
      }));

    if (ownerGrants.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(ownerGrants)
        .onConflictDoNothing();
    }
    if (adminGrants.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(adminGrants)
        .onConflictDoNothing();
    }

    // ---- Owner membership ----
    await tx
      .insert(tenantMemberships)
      .values({
        tenantId: tenant.id,
        userId: user.id,
        roleId: ownerRole.id,
        status: "active",
        joinedAt: new Date(),
      })
      .onConflictDoNothing();

    // ---- CRM module enablement ----
    const [crmModule] = await tx
      .select()
      .from(modules)
      .where(eq(modules.slug, "crm"));

    if (!crmModule) {
      throw new Error("CRM module not seeded — run pnpm db:seed");
    }

    await tx
      .insert(tenantModules)
      .values({
        tenantId: tenant.id,
        moduleId: crmModule.id,
        enabled: true,
      })
      .onConflictDoNothing();

    // ---- CRM activation (entity types, fields, layouts, relationships,
    // pipeline). Idempotent — safe on re-provision. Permission grants +
    // ai_usage_limits are owned by Tasks 1.1/1.9a and 0.8 respectively. ----
    await activateCrmForTenant(tx, { tenantId: tenant.id });

    return { tenant, tenantCreated };
  });

  return NextResponse.json({
    tenant: result.tenant,
    created: result.tenantCreated,
    orgId,
  });
}
