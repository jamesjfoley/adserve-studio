import "dotenv/config";
import { db, migrationClient } from "../client";
import { permissions, roles, rolePermissions } from "../schema";
import { and, eq, inArray, sql } from "drizzle-orm";

/**
 * Grant the platform permission `ai_usage.read` to every existing Owner
 * and Admin role across all tenants.
 *
 * Tenants provisioned before Task 0.8 added `ai_usage.read` don't have it.
 * New tenants pick it up automatically because provisionTenant grants "all
 * permissions" to Owner and "all except tenant.admin" to Admin. This script
 * closes the gap for tenants that already exist. `ai_usage.read` is an
 * admin-panel view (/admin/ai-usage), so Owner + Admin is the right scope —
 * mirrors backfill-admin-access.ts.
 *
 * Idempotent: re-running has no effect (composite PK + onConflictDoNothing).
 */
async function backfill() {
  console.log("🔁 Backfilling ai_usage.read for existing Owner/Admin roles...\n");

  const [aiUsageRead] = await db
    .select()
    .from(permissions)
    .where(
      and(eq(permissions.resource, "ai_usage"), eq(permissions.action, "read"))
    );

  if (!aiUsageRead) {
    console.error(
      "❌ permissions row resource='ai_usage' action='read' not found.\n" +
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
    permissionId: aiUsageRead.id,
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
    WHERE rp.permission_id = ${aiUsageRead.id}
  `);
  const n = (tenantCount as unknown as Array<{ n: string }>)[0]?.n ?? "0";
  console.log(`  Tenants with at least one role granting ai_usage.read: ${n}\n`);

  console.log("✅ Backfill complete.\n");
  await migrationClient.end();
  process.exit(0);
}

backfill().catch(async (err) => {
  console.error("❌ Backfill failed:", err);
  await migrationClient.end().catch(() => {});
  process.exit(1);
});
