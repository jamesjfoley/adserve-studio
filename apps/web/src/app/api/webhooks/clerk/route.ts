import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { db } from "@adserve/database";
import {
  tenants,
  users,
  tenantMemberships,
  roles,
  permissions,
  rolePermissions,
  tenantModules,
  modules,
} from "@adserve/database";
import { eq, and } from "drizzle-orm";

// Clerk sends webhook events for organization and user lifecycle.
// This handler syncs those events to our internal database.
//
// Set up in Clerk Dashboard → Webhooks:
//   URL: https://your-domain.com/api/webhooks/clerk
//   Events: organization.created, organizationMembership.created, user.created, user.updated

export async function POST(req: NextRequest) {
  const body = await req.text();
  const headerPayload = Object.fromEntries(req.headers);

  // In production, verify the webhook signature using Svix.
  // For now, we'll process the events directly.
  // TODO: Add CLERK_WEBHOOK_SECRET to .env and verify here.

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = event.type as string;

  try {
    switch (eventType) {
      // ================================================
      // A new Clerk user signed up
      // ================================================
      case "user.created":
      case "user.updated": {
        const { id, email_addresses, first_name, last_name, image_url } =
          event.data;
        const primaryEmail = email_addresses?.[0]?.email_address;

        if (!primaryEmail) break;

        await db
          .insert(users)
          .values({
            email: primaryEmail,
            fullName: [first_name, last_name].filter(Boolean).join(" ") || primaryEmail,
            avatarUrl: image_url,
            authProviderId: id,
            status: "active",
          })
          .onConflictDoUpdate({
            target: users.authProviderId,
            set: {
              email: primaryEmail,
              fullName: [first_name, last_name].filter(Boolean).join(" ") || primaryEmail,
              avatarUrl: image_url,
            },
          });

        break;
      }

      // ================================================
      // A new Clerk organization was created (= new tenant)
      // ================================================
      case "organization.created": {
        const { id, name, slug, created_by } = event.data;

        // Create the tenant
        const [tenant] = await db
          .insert(tenants)
          .values({
            name,
            slug: slug || id,
            status: "active",
            settings: {
              clerkOrgId: id,
              timezone: "Europe/London",
              locale: "en-GB",
              currency: "GBP",
            },
          })
          .returning();

        // Create default roles
        const [ownerRole] = await db
          .insert(roles)
          .values({
            tenantId: tenant.id,
            name: "Owner",
            slug: "owner",
            description: "Full access. Can manage billing and delete tenant.",
            isSystem: true,
          })
          .returning();

        const [adminRole] = await db
          .insert(roles)
          .values({
            tenantId: tenant.id,
            name: "Admin",
            slug: "admin",
            description: "Full access except tenant deletion and billing.",
            isSystem: true,
          })
          .returning();

        await db.insert(roles).values({
          tenantId: tenant.id,
          name: "Member",
          slug: "member",
          description: "Access to assigned modules. Cannot manage users or schema.",
          isSystem: true,
        });

        // Assign all permissions to owner role
        const allPerms = await db.select().from(permissions);
        if (allPerms.length > 0) {
          await db.insert(rolePermissions).values(
            allPerms.map((p) => ({
              roleId: ownerRole.id,
              permissionId: p.id,
            }))
          );
        }

        // Assign non-tenant-admin permissions to admin role
        const adminPerms = allPerms.filter(
          (p) => !(p.resource === "tenant" && p.action === "admin")
        );
        if (adminPerms.length > 0) {
          await db.insert(rolePermissions).values(
            adminPerms.map((p) => ({
              roleId: adminRole.id,
              permissionId: p.id,
            }))
          );
        }

        // Enable the CRM module by default
        const [crmModule] = await db
          .select()
          .from(modules)
          .where(eq(modules.slug, "crm"));

        if (crmModule) {
          await db.insert(tenantModules).values({
            tenantId: tenant.id,
            moduleId: crmModule.id,
            enabled: true,
          });
        }

        // Create the owner's membership (if we know who created the org)
        if (created_by) {
          const [creator] = await db
            .select()
            .from(users)
            .where(eq(users.authProviderId, created_by));

          if (creator) {
            await db
              .insert(tenantMemberships)
              .values({
                tenantId: tenant.id,
                userId: creator.id,
                roleId: ownerRole.id,
                status: "active",
                joinedAt: new Date(),
              })
              .onConflictDoNothing();
          }
        }

        // TODO: Call install_crm_schema() to set up default CRM entity types
        // This will be done once we have the TypeScript version of that function

        break;
      }

      // ================================================
      // A member was added to a Clerk organization
      // ================================================
      case "organizationMembership.created": {
        const { organization, public_user_data, role } = event.data;

        // Find the tenant
        const [tenant] = await db
          .select()
          .from(tenants)
          .where(eq(tenants.slug, organization.slug));

        if (!tenant) break;

        // Find the user
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.authProviderId, public_user_data.user_id));

        if (!user) break;

        // Map Clerk role to our role (admin → admin, member → member)
        const roleSlug = role === "admin" ? "admin" : "member";
        const [memberRole] = await db
          .select()
          .from(roles)
          .where(
            and(eq(roles.tenantId, tenant.id), eq(roles.slug, roleSlug))
          );

        if (!memberRole) break;

        await db
          .insert(tenantMemberships)
          .values({
            tenantId: tenant.id,
            userId: user.id,
            roleId: memberRole.id,
            status: "active",
            joinedAt: new Date(),
          })
          .onConflictDoNothing();

        break;
      }

      default:
        // Unhandled event type — that's fine, just log it
        console.log(`Unhandled Clerk webhook event: ${eventType}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error(`Webhook handler error for ${eventType}:`, error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
