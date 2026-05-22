import "dotenv/config";
import { db, migrationClient } from "../client";
import { modules, permissions } from "../schema";
import { and, eq, isNull } from "drizzle-orm";

async function seed() {
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
    await db
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
    const [existing] = await db
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
      await db.insert(permissions).values(perm);
    }
  }

  console.log(`  ✓ ${platformPerms.length} platform permissions ensured\n`);

  // ========================================
  // CRM module permissions
  // ========================================
  console.log("  Creating CRM module permissions...");

  const [crmModule] = await db
    .select()
    .from(modules)
    .where(eq(modules.slug, "crm"));

  if (crmModule) {
    const crmPerms = [
      { resource: "contacts", action: "read", description: "View contacts" },
      { resource: "contacts", action: "create", description: "Create contacts" },
      { resource: "contacts", action: "update", description: "Edit contacts" },
      { resource: "contacts", action: "delete", description: "Archive contacts" },
      { resource: "contacts", action: "export", description: "Export contacts" },
      { resource: "companies", action: "read", description: "View companies" },
      { resource: "companies", action: "create", description: "Create companies" },
      { resource: "companies", action: "update", description: "Edit companies" },
      { resource: "companies", action: "delete", description: "Archive companies" },
      { resource: "companies", action: "export", description: "Export companies" },
      { resource: "deals", action: "read", description: "View deals" },
      { resource: "deals", action: "create", description: "Create deals" },
      { resource: "deals", action: "update", description: "Edit deals" },
      { resource: "deals", action: "delete", description: "Archive deals" },
      { resource: "deals", action: "export", description: "Export deals" },
      { resource: "ai", action: "use", description: "Use AI features in CRM" },
    ];

    for (const perm of crmPerms) {
      await db
        .insert(permissions)
        .values({ ...perm, moduleId: crmModule.id })
        .onConflictDoNothing();
    }

    console.log(`  ✓ ${crmPerms.length} CRM permissions created\n`);
  }

  console.log("✅ Seed complete!\n");

  // Close the connection
  await migrationClient.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
