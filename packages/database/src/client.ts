import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// ============================================================
// Base connection (for migrations and admin operations)
// ============================================================

/**
 * DATABASE_URL accepts two formats:
 *
 * 1. Plain URL string — `postgresql://user:pass@host:5432/db?sslmode=require`.
 *    Used in local dev and in any environment that injects the value
 *    directly.
 *
 * 2. JSON blob — `{"engine":"postgres","host":"…","port":5432,
 *    "username":"…","password":"…","dbname":"…","sslmode":"require"}`.
 *    Produced by AWS Secrets Manager when the secret is rotated by the
 *    `SecretsManagerRDSPostgreSQLRotation*` Lambda. The blob is injected
 *    into the container as `DATABASE_URL` via ECS task definition.
 *
 * Exported so the parser can be unit-tested without instantiating a
 * Drizzle client.
 */
export function resolveConnectionString(raw: string): string {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("{")) return raw;

  const blob = JSON.parse(trimmed) as {
    host?: string;
    port?: number | string;
    username?: string;
    password?: string;
    dbname?: string;
    sslmode?: string;
  };
  const need = (key: keyof typeof blob): string => {
    const v = blob[key];
    if (v === undefined || v === null || v === "") {
      throw new Error(
        `DATABASE_URL JSON is missing required field '${String(key)}'`
      );
    }
    return String(v);
  };
  const user = encodeURIComponent(need("username"));
  const pass = encodeURIComponent(need("password"));
  const host = need("host");
  const port = need("port");
  const db = need("dbname");
  const sslmode = blob.sslmode ?? "require";
  return `postgresql://${user}:${pass}@${host}:${port}/${db}?sslmode=${sslmode}`;
}

const connectionString = resolveConnectionString(process.env.DATABASE_URL!);

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
 * Sets `app.current_tenant_id` for the duration of a transaction. The
 * tenant_isolation policy on every tenant-scoped table checks this
 * value to restrict visible rows. SET LOCAL auto-resets on commit/rollback.
 *
 * NOTE: as of Task 8 the policies are configured but the app DATABASE_URL
 * still connects as a Postgres superuser in dev, which bypasses RLS. See
 * docs/02-rls.md for the production switchover.
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
    await tx.execute(
      `SET LOCAL app.current_tenant_id = '${tenantId}'`
    );
    return callback(tx as unknown as typeof db);
  });
}

/**
 * Execute a callback with the RLS bypass flag set, so that policies on
 * tenant-scoped tables allow access across all tenants. Use ONLY for
 * super admin code paths where cross-tenant visibility is required
 * (e.g. /super-admin pages and APIs).
 *
 * The bypass is scoped to the transaction via SET LOCAL.
 */
export async function withSuperAdminBypass<T>(
  callback: (tx: typeof db) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(`SET LOCAL app.bypass_rls = 'on'`);
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
