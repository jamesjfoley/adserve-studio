import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { db, withSuperAdminBypass } from "@adserve/database";
import {
  tenants,
  users,
  tenantMemberships,
  tenantInvitations,
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
//   Events: organization.created, organizationMembership.created,
//           user.created, user.updated, user.deleted

export async function POST(req: NextRequest) {
  const body = await req.text();
  const headerPayload = Object.fromEntries(req.headers);

  // Verify the Svix signature before processing anything. This endpoint is
  // (or will be) publicly reachable; without verification, anyone could
  // post forged events and create tenants / users.
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error("CLERK_WEBHOOK_SECRET is not configured");
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 500 }
    );
  }

  // svix.verify returns the parsed webhook payload, which is a discriminated
  // union of differently-shaped Clerk event types (user.*, organization.*,
  // organizationMembership.*). We narrow on event.type in the switch below.
  // Tightening this to Clerk's WebhookEvent type would require restructuring
  // the switch with explicit type guards on each case; out of scope here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any;
  try {
    const wh = new Webhook(secret);
    // svix.verify reads the three svix-* headers from this object,
    // checks the signature against the raw body, and returns the parsed
    // payload. It throws on missing headers, bad signature, or stale
    // timestamp (replay protection).
    event = wh.verify(body, headerPayload);
  } catch (err) {
    console.error("Clerk webhook signature verification failed:", err);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      // A Clerk user was deleted
      //
      // No deleted_at column on the users table, so this is a hard delete.
      // FK cascades take care of:
      //   - tenant_memberships.user_id  → ON DELETE CASCADE (removed)
      //   - tenant_invitations.invited_by → ON DELETE SET NULL
      // ================================================
      case "user.deleted": {
        const { id } = event.data;
        if (!id) break;

        const removed = await db
          .delete(users)
          .where(eq(users.authProviderId, id))
          .returning({ id: users.id, email: users.email });

        if (removed.length === 0) {
          console.log(`user.deleted: Clerk user ${id} had no matching local row`);
        } else {
          console.log(
            `user.deleted: removed local user ${removed[0].id} (${removed[0].email}) for Clerk id ${id}`
          );
        }

        break;
      }

      // ================================================
      // A new Clerk organization was created (= new tenant)
      // ================================================
      case "organization.created": {
        const { id, name, slug, created_by } = event.data;

        await withSuperAdminBypass(async (tx) => {
          // Create the tenant
          const [tenant] = await tx
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
          const [ownerRole] = await tx
            .insert(roles)
            .values({
              tenantId: tenant.id,
              name: "Owner",
              slug: "owner",
              description: "Full access. Can manage billing and delete tenant.",
              isSystem: true,
            })
            .returning();

          const [adminRole] = await tx
            .insert(roles)
            .values({
              tenantId: tenant.id,
              name: "Admin",
              slug: "admin",
              description: "Full access except tenant deletion and billing.",
              isSystem: true,
            })
            .returning();

          await tx.insert(roles).values({
            tenantId: tenant.id,
            name: "Member",
            slug: "member",
            description: "Access to assigned modules. Cannot manage users or schema.",
            isSystem: true,
          });

          // Assign all permissions to owner role
          const allPerms = await tx.select().from(permissions);
          if (allPerms.length > 0) {
            await tx.insert(rolePermissions).values(
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
            await tx.insert(rolePermissions).values(
              adminPerms.map((p) => ({
                roleId: adminRole.id,
                permissionId: p.id,
              }))
            );
          }

          // Enable the CRM module by default
          const [crmModule] = await tx
            .select()
            .from(modules)
            .where(eq(modules.slug, "crm"));

          if (crmModule) {
            await tx.insert(tenantModules).values({
              tenantId: tenant.id,
              moduleId: crmModule.id,
              enabled: true,
            });
          }

          // Create the owner's membership (if we know who created the org)
          if (created_by) {
            const [creator] = await tx
              .select()
              .from(users)
              .where(eq(users.authProviderId, created_by));

            if (creator) {
              await tx
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
        });

        break;
      }

      // ================================================
      // A member was added to a Clerk organization
      // ================================================
      case "organizationMembership.created": {
        const { organization, public_user_data, role } = event.data;

        await withSuperAdminBypass(async (tx) => {
          // Find the tenant
          const [tenant] = await tx
            .select()
            .from(tenants)
            .where(eq(tenants.slug, organization.slug));

          if (!tenant) return;

          // Find the user
          const [user] = await tx
            .select()
            .from(users)
            .where(eq(users.authProviderId, public_user_data.user_id));

          if (!user) return;

          // Map Clerk role to our role (admin → admin, member → member)
          const roleSlug = role === "admin" ? "admin" : "member";
          const [memberRole] = await tx
            .select()
            .from(roles)
            .where(
              and(eq(roles.tenantId, tenant.id), eq(roles.slug, roleSlug))
            );

          if (!memberRole) return;

          await tx
            .insert(tenantMemberships)
            .values({
              tenantId: tenant.id,
              userId: user.id,
              roleId: memberRole.id,
              status: "active",
              joinedAt: new Date(),
            })
            .onConflictDoNothing();

          // If this user joined via a tenant_invitations row we created
          // (Task 3 invite flow), mark that row accepted so it disappears
          // from the pending list.
          await tx
            .update(tenantInvitations)
            .set({ status: "accepted", updatedAt: new Date() })
            .where(
              and(
                eq(tenantInvitations.tenantId, tenant.id),
                eq(tenantInvitations.email, user.email),
                eq(tenantInvitations.status, "pending")
              )
            );
        });

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
