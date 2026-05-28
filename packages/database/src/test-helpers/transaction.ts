import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";

/**
 * Dedicated test client. `max: 1` means every query through this client
 * uses the same physical connection, which is what makes the
 * transaction wrap below work — the entire test executes inside one
 * tx that we always roll back.
 *
 * Resolution:
 *   1. TEST_DATABASE_URL  — recommended; set explicitly in CI
 *   2. DATABASE_URL       — fall back to your working database (warns)
 *   3. Local dev default  — last resort (warns)
 */
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://jamesfoley@localhost:5432/adserve";

if (!process.env.TEST_DATABASE_URL) {
  // One-line warning so a dev who forgot to set TEST_DATABASE_URL knows
  // their tests are running against their working database. Transaction
  // rollback should keep things clean, but it's polite to mention.
  console.warn(
    `[test-helpers] TEST_DATABASE_URL not set; using ${
      process.env.DATABASE_URL ? "DATABASE_URL" : "local dev default"
    }. Tests roll back, but a hard crash mid-test could leave dirty rows.`
  );
}

export const testClient = postgres(TEST_DB_URL, { max: 1 });
export const testDb = drizzle(testClient, { schema });

/**
 * Sentinel thrown to force a Drizzle transaction to roll back at the end
 * of a test. Drizzle commits if the callback resolves and rolls back if
 * it throws — we throw this, catch it outside, return the test result.
 */
class RollbackSignal extends Error {
  constructor(public result: unknown) {
    super("test rollback");
  }
}

/**
 * Run a test inside a transaction that is *always* rolled back, even if
 * the test passes. The test gets a `tx` parameter — pass it into any
 * engine function under test (the engines take `tx` per our Step-21
 * convention).
 *
 * Example:
 *   await withTestTransaction(async (tx) => {
 *     const tenant = await createTestTenant(tx);
 *     const field = await createFieldDefinition(tx, { tenantId: tenant.id, ... });
 *     expect(field).toMatchObject({ ... });
 *   });
 */
export async function withTestTransaction<T>(
  fn: (tx: typeof testDb) => Promise<T>
): Promise<T> {
  let captured: T;
  try {
    await testDb.transaction(async (tx) => {
      captured = await fn(tx as unknown as typeof testDb);
      throw new RollbackSignal(captured);
    });
  } catch (err) {
    if (err instanceof RollbackSignal) {
      return err.result as T;
    }
    throw err;
  }
  // Unreachable — the throw above always fires.
  return captured!;
}
