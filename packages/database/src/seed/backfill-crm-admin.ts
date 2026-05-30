import "dotenv/config";
import { db, migrationClient } from "../client";
import { modules, permissions, roles, rolePermissions } from "../schema";
import { and, eq, inArray, sql } from "drizzle-orm";

/**
 * Grant the CRM-scoped permission `crm.admin` to every existing Owner and
 * Admin role across all tenants (Task 1.8).
 *
 * Unlike `backfill-ai-usage-read` (a PLATFORM permission seeded by db:seed),
 * `crm.admin` is MODULE-scoped — its `permissions` row is created per the CRM
 * module at activation. For tenants activated before 1.8 the row won't exist,
 * so this script ENSURES the `crm.admin` row first (insert-on-conflict against
 * the CRM module), then grants it. New tenants pick it up automatically via
 * activation (it's now in CRM_PERMISSIONS) + provisioning's wildcard grant.
 *
 * Idempotent: re-running has no effect.
 */
async function backfill() {
  console.log("🔁 Backfilling crm.admin for existing Owner/Admin roles...\n");

  const [crmModule] = await db
    .select({ id: modules.id })
    .from(modules)
    .where(eq(modules.slug, "crm"));
  if (!crmModule) {
    console.error(
      "❌ CRM module not found. Run `pnpm db:seed` first (it seeds modules)."
    );
    await migrationClient.end();
    process.exit(1);
  }

  // Ensure the crm.admin permission row exists for the CRM module.
  await db
    .insert(permissions)
    .values({
      moduleId: crmModule.id,
      resource: "crm",
      action: "admin",
      description: "Manage CRM configuration (fields, layouts, pipeline stages)",
    })
    .onConflictDoNothing();

  const [crmAdmin] = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(
      and(
        eq(permissions.moduleId, crmModule.id),
        eq(permissions.resource, "crm"),
        eq(permissions.action, "admin")
      )
    );
  if (!crmAdmin) {
    console.error("❌ Failed to ensure the crm.admin permission row.");
    await migrationClient.end();
    process.exit(1);
  }

  const targetRoles = await db
    .select()
    .from(roles)
    .where(inArray(roles.slug, ["owner", "admin"]));

  if (targetRoles.length === 0) {
    console.log("  No Owner/Admin roles found. Nothing to backfill.\n");
    await migrationClient.end();
    process.exit(0);
  }

  const rows = targetRoles.map((r) => ({
    roleId: r.id,
    permissionId: crmAdmin.id,
  }));

  const result = await db
    .insert(rolePermissions)
    .values(rows)
    .onConflictDoNothing()
    .returning();

  console.log(
    `  ✓ Considered ${rows.length} Owner/Admin role(s); inserted ${result.length} new grant(s).\n`
  );

  const tenantCount = await db.execute(sql`
    SELECT COUNT(DISTINCT r.tenant_id) AS n
    FROM ${roles} r
    JOIN ${rolePermissions} rp ON rp.role_id = r.id
    WHERE rp.permission_id = ${crmAdmin.id}
  `);
  const n = (tenantCount as unknown as Array<{ n: string }>)[0]?.n ?? "0";
  console.log(`  Tenants with at least one role granting crm.admin: ${n}\n`);

  console.log("✅ Backfill complete.\n");
  await migrationClient.end();
  process.exit(0);
}

backfill().catch(async (err) => {
  console.error("❌ Backfill failed:", err);
  await migrationClient.end().catch(() => {});
  process.exit(1);
});
