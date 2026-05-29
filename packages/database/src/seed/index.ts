import "dotenv/config";
import { db } from "../client";
import { modules, permissions } from "../schema";
import { and, eq, isNull } from "drizzle-orm";

type Database = typeof db;

/**
 * Seed the global, tenant-independent baseline: the module registry and
 * the platform-level permission rows.
 *
 * Idempotent — safe to run repeatedly. Accepts a `database` handle so it
 * can run inside a test transaction; defaults to the app client for the
 * `pnpm db:seed` runner (`./run.ts`).
 *
 * NOTE: this seed deliberately does NOT create CRM (or any module's)
 * permission rows. Module permissions are seeded when the module is
 * activated for a tenant — CRM's land in `activateCrmForTenant`
 * (@adserve/crm). The Phase-2 placeholder CRM perms
 * (contacts/companies/deals/ai) were removed in Task 1.1; 1.9a deletes
 * any that remain in live databases. `ai_usage.read` is seeded by 0.8.
 */
export async function seed(database: Database = db) {
  console.log("🌱 Seeding database...\n");

  // ========================================
  // Modules
  // ========================================
  console.log("  Creating modules...");

  const moduleData = [
    { slug: "crm", name: "CRM", description: "Contact and deal management", status: "active" as const, icon: "users", displayOrder: 1 },
    { slug: "campaigns", name: "Campaign planning", description: "Plan and schedule advertising campaigns", status: "coming_soon" as const, icon: "calendar", displayOrder: 2 },
    { slug: "trafficking", name: "Trafficking", description: "Ad trafficking and delivery management", status: "coming_soon" as const, icon: "truck", displayOrder: 3 },
    { slug: "audience", name: "Audience measurement", description: "Audience data and analytics", status: "coming_soon" as const, icon: "chart-bar", displayOrder: 4 },
    { slug: "reporting", name: "Reporting", description: "Cross-module reporting and dashboards", status: "coming_soon" as const, icon: "file", displayOrder: 5 },
    { slug: "revenue", name: "Revenue management", description: "Revenue tracking and forecasting", status: "coming_soon" as const, icon: "currency-pound", displayOrder: 6 },
    { slug: "pricebooks", name: "Price books", description: "Rate cards and pricing management", status: "coming_soon" as const, icon: "book", displayOrder: 7 },
  ];

  for (const mod of moduleData) {
    await database
      .insert(modules)
      .values(mod)
      .onConflictDoNothing({ target: modules.slug });
  }

  console.log(`  ✓ ${moduleData.length} modules created\n`);

  // ========================================
  // Platform permissions
  // ========================================
  console.log("  Creating platform permissions...");

  const platformPerms = [
    { moduleId: null, resource: "tenant", action: "admin", description: "Full tenant administration" },
    { moduleId: null, resource: "admin", action: "access", description: "Access the tenant admin panel" },
    { moduleId: null, resource: "users", action: "read", description: "View tenant users" },
    { moduleId: null, resource: "users", action: "admin", description: "Invite, edit, remove users" },
    { moduleId: null, resource: "roles", action: "read", description: "View roles" },
    { moduleId: null, resource: "roles", action: "admin", description: "Create and edit roles" },
    { moduleId: null, resource: "schema", action: "read", description: "View entity type definitions" },
    { moduleId: null, resource: "schema", action: "admin", description: "Create and modify entity types and fields" },
    { moduleId: null, resource: "settings", action: "read", description: "View tenant settings" },
    { moduleId: null, resource: "settings", action: "admin", description: "Modify tenant settings" },
    { moduleId: null, resource: "audit", action: "read", description: "View audit log" },
  ];

  // The unique index idx_permissions_unique(module_id, resource, action) uses
  // Postgres's default NULLS DISTINCT semantics, so it does NOT prevent
  // duplicate rows when module_id IS NULL. Use an explicit existence check
  // here so re-running the seed is truly idempotent for platform permissions.
  for (const perm of platformPerms) {
    const [existing] = await database
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(
          isNull(permissions.moduleId),
          eq(permissions.resource, perm.resource),
          eq(permissions.action, perm.action)
        )
      )
      .limit(1);
    if (!existing) {
      await database.insert(permissions).values(perm);
    }
  }

  console.log(`  ✓ ${platformPerms.length} platform permissions ensured\n`);

  // ========================================
  // Module permissions (CRM etc.) are NOT seeded here — they are created
  // at tenant activation time. See activateCrmForTenant in @adserve/crm.
  // ========================================

  console.log("✅ Seed complete!\n");
}
