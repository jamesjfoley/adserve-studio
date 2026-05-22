import "dotenv/config";
import { db, migrationClient } from "../client";
import { permissions, roles, rolePermissions } from "../schema";
import { and, eq, inArray, sql } from "drizzle-orm";

/**
 * Grant the platform permission `admin.access` to every existing Owner
 * and Admin role across all tenants.
 *
 * Phase 1 tenants were provisioned before the `admin.access` permission
 * existed. New tenants pick it up automatically because provisionTenant
 * grants "all permissions" to Owner and "all except tenant.admin" to Admin.
 * This script closes the gap for tenants that already exist.
 *
 * Idempotent: re-running has no effect (composite PK + onConflictDoNothing).
 */
async function backfill() {
  console.log("🔁 Backfilling admin.access for existing Owner/Admin roles...\n");

  const [adminAccess] = await db
    .select()
    .from(permissions)
    .where(and(eq(permissions.resource, "admin"), eq(permissions.action, "access")));

  if (!adminAccess) {
    console.error(
      "❌ permissions row resource='admin' action='access' not found.\n" +
        "   Run `pnpm db:seed` first."
    );
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
    permissionId: adminAccess.id,
  }));

  const result = await db
    .insert(rolePermissions)
    .values(rows)
    .onConflictDoNothing()
    .returning();

  console.log(
    `  ✓ Considered ${rows.length} Owner/Admin role(s); inserted ${result.length} new grant(s).\n`
  );

  // Sanity report: how many tenants now have at least one role with admin.access
  const tenantCount = await db.execute(sql`
    SELECT COUNT(DISTINCT r.tenant_id) AS n
    FROM ${roles} r
    JOIN ${rolePermissions} rp ON rp.role_id = r.id
    WHERE rp.permission_id = ${adminAccess.id}
  `);
  const n = (tenantCount as unknown as Array<{ n: string }>)[0]?.n ?? "0";
  console.log(`  Tenants with at least one role granting admin.access: ${n}\n`);

  console.log("✅ Backfill complete.\n");
  await migrationClient.end();
  process.exit(0);
}

backfill().catch(async (err) => {
  console.error("❌ Backfill failed:", err);
  await migrationClient.end().catch(() => {});
  process.exit(1);
});
