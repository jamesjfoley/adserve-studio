import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// ============================================================
// Base connection (for migrations and admin operations)
// ============================================================

const connectionString = process.env.DATABASE_URL!;

// Connection for migrations and seed scripts (no RLS)
export const migrationClient = postgres(connectionString, { max: 1 });

// Connection pool for the application
const queryClient = postgres(connectionString, {
  max: 20,
  idle_timeout: 20,
  connect_timeout: 10,
});

// Base Drizzle instance (used for admin/migration operations)
export const db = drizzle(queryClient, { schema });

// ============================================================
// Tenant-scoped database access
// ============================================================

/**
 * Execute a callback within a tenant's RLS context.
 *
 * This sets the `app.current_tenant` session variable before running
 * the callback, which activates PostgreSQL Row-Level Security policies.
 * The variable is scoped to the transaction, so it automatically resets.
 *
 * Usage:
 *   const contacts = await withTenant(tenantId, async (tx) => {
 *     return tx.query.records.findMany({
 *       where: eq(records.entityTypeId, contactTypeId),
 *     });
 *   });
 */
export async function withTenant<T>(
  tenantId: string,
  callback: (tx: typeof db) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    // Set the tenant context for this transaction
    // SET LOCAL is scoped to the current transaction only
    await tx.execute(
      `SET LOCAL app.current_tenant = '${tenantId}'`
    );
    return callback(tx as unknown as typeof db);
  });
}

/**
 * Create a tenant-scoped database instance for use in request handlers.
 *
 * This returns a wrapper that automatically sets the tenant context
 * on every query. Use this in API route handlers after extracting
 * the tenant ID from the authenticated user's session.
 *
 * Usage:
 *   const tenantDb = createTenantDb(tenantId);
 *   const contacts = await tenantDb.query(async (tx) => {
 *     return tx.query.records.findMany();
 *   });
 */
export function createTenantDb(tenantId: string) {
  return {
    /** Run a query within the tenant's RLS context */
    query: <T>(callback: (tx: typeof db) => Promise<T>) =>
      withTenant(tenantId, callback),

    /** The raw tenant ID for reference */
    tenantId,
  };
}

// ============================================================
// Type exports
// ============================================================

export type Database = typeof db;
export type TenantDb = ReturnType<typeof createTenantDb>;
