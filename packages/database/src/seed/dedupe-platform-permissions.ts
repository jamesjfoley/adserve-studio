import "dotenv/config";
import { db, migrationClient } from "../client";
import { sql } from "drizzle-orm";

/**
 * One-off cleanup: collapse duplicate platform-level permission rows.
 *
 * Phase 1 left the permissions table with duplicate rows for every
 * platform-level permission (module_id IS NULL). The unique index
 * idx_permissions_unique uses Postgres's default NULLS DISTINCT
 * semantics, so two rows with module_id = NULL + the same (resource,
 * action) are both permitted. Repeated runs of the seed therefore
 * created duplicates.
 *
 * For each (resource, action) with duplicates we keep the lowest-id
 * row as canonical, re-point any role_permissions grants to it, then
 * delete the duplicate permission rows. role_permissions has ON DELETE
 * CASCADE, so the dup grants are cleaned up automatically.
 *
 * Idempotent: running on already-deduped data is a no-op.
 */
async function dedupe() {
  console.log("🧹 Deduping platform permissions...\n");

  // Count duplicates before
  const beforeResult = await db.execute(sql`
    SELECT COUNT(*) - COUNT(DISTINCT (resource, action)) AS dup_count
    FROM permissions
    WHERE module_id IS NULL
  `);
  const dupCountBefore = Number(
    (beforeResult as unknown as Array<{ dup_count: string }>)[0]?.dup_count ?? 0
  );
  console.log(`  Found ${dupCountBefore} duplicate platform permission row(s).`);

  if (dupCountBefore === 0) {
    console.log("  Nothing to do.\n");
    await migrationClient.end();
    process.exit(0);
  }

  // Step 1: re-point grants to the canonical (lowest-id) row for each (resource, action).
  // The composite PK on role_permissions makes the insert a no-op when the canonical
  // grant already exists.
  await db.execute(sql`
    WITH canonical AS (
      SELECT DISTINCT ON (resource, action) id AS canon_id, resource, action
      FROM permissions
      WHERE module_id IS NULL
      ORDER BY resource, action, id
    ),
    dups AS (
      SELECT p.id AS dup_id, c.canon_id
      FROM permissions p
      JOIN canonical c ON c.resource = p.resource AND c.action = p.action
      WHERE p.module_id IS NULL AND p.id <> c.canon_id
    )
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT rp.role_id, d.canon_id
    FROM role_permissions rp
    JOIN dups d ON d.dup_id = rp.permission_id
    ON CONFLICT DO NOTHING
  `);
  console.log("  Step 1/2: re-pointed grants to canonical permission rows.");

  // Step 2: delete the duplicate permission rows. CASCADE removes any orphan grants.
  const deleted = await db.execute(sql`
    WITH canonical AS (
      SELECT DISTINCT ON (resource, action) id AS canon_id, resource, action
      FROM permissions
      WHERE module_id IS NULL
      ORDER BY resource, action, id
    )
    DELETE FROM permissions p
    USING canonical c
    WHERE p.module_id IS NULL
      AND p.resource = c.resource
      AND p.action = c.action
      AND p.id <> c.canon_id
  `);
  const deletedCount = Number((deleted as unknown as { count?: number }).count ?? "n/a");
  console.log(`  Step 2/2: deleted ${deletedCount} duplicate permission row(s).\n`);

  // Verify
  const afterResult = await db.execute(sql`
    SELECT COUNT(*) - COUNT(DISTINCT (resource, action)) AS dup_count
    FROM permissions
    WHERE module_id IS NULL
  `);
  const dupCountAfter = Number(
    (afterResult as unknown as Array<{ dup_count: string }>)[0]?.dup_count ?? 0
  );
  if (dupCountAfter > 0) {
    console.error(`❌ Still ${dupCountAfter} duplicates. Something went wrong.`);
    await migrationClient.end();
    process.exit(1);
  }

  console.log("✅ Dedupe complete — 0 duplicate platform permissions remain.\n");
  await migrationClient.end();
  process.exit(0);
}

dedupe().catch(async (err) => {
  console.error("❌ Dedupe failed:", err);
  await migrationClient.end().catch(() => {});
  process.exit(1);
});
