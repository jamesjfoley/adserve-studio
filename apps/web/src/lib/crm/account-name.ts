import { and, eq, sql, type SQL } from "drizzle-orm";
import { records, type db } from "@adserve/database";

/**
 * Shared account-name normalisation for the CRM.
 *
 * The single source of truth for "two account names are the same" — a
 * case- and whitespace-insensitive comparison on `records.data->>'name'`
 * (`lower(btrim(...))` on both sides). Extracted from the lead-convert flow
 * (AC 21, `leads/[id]/convert/route.ts`) so the convert duplicate check and
 * the contact-create create-new branch enforce IDENTICAL uniqueness. Do not
 * re-inline this expression — change it here and both paths move together.
 *
 * NOTE: there is no DB-level unique constraint backing this (see the prototype
 * SPEC "ACCOUNT NAME UNIQUENESS IS RACY" production consideration). Callers run
 * a read-then-insert inside their own `withTenant` tx; concurrent creates can
 * still race. Production should add a unique expression index.
 */

/** Normalised (case/whitespace-insensitive) equality on an account's name. */
export function normalisedAccountNameEquals(name: string): SQL {
  return sql`lower(btrim(${records.data}->>'name')) = lower(btrim(${name}))`;
}

/**
 * Find a non-archived account in `tenantId` whose name matches `name`
 * (normalised). MUST be called inside `withTenant(tenantId, …)` so RLS scopes
 * the read to the caller's tenant. Returns the row, or null when none matches.
 */
export async function findAccountByName(
  tx: typeof db,
  args: { tenantId: string; accountEntityTypeId: string; name: string }
): Promise<typeof records.$inferSelect | null> {
  const [row] = await tx
    .select()
    .from(records)
    .where(
      and(
        eq(records.tenantId, args.tenantId),
        eq(records.entityTypeId, args.accountEntityTypeId),
        eq(records.isArchived, false),
        normalisedAccountNameEquals(args.name)
      )
    )
    .limit(1);
  return row ?? null;
}
