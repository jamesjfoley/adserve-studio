import { and, asc, eq } from "drizzle-orm";
import { tenantMemberships, users, type db } from "@adserve/database";

/** A tenant member as the list UI consumes it (owner filter + assign picker). */
export interface TenantMember {
  id: string;
  fullName: string;
  email: string;
}

/**
 * Active members of a tenant, ordered by name. Used to populate the owner
 * filter dropdown and the bulk "assign owner" picker, and (server-side) to
 * validate a bulk assign target. Runs inside the caller's transaction.
 */
export async function listActiveMembers(
  tx: typeof db,
  tenantId: string
): Promise<TenantMember[]> {
  return tx
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
    })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(
      and(
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.status, "active")
      )
    )
    .orderBy(asc(users.fullName));
}

/** True if `userId` is an active member of `tenantId`. */
export async function isActiveMember(
  tx: typeof db,
  tenantId: string,
  userId: string
): Promise<boolean> {
  const [row] = await tx
    .select({ id: tenantMemberships.id })
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.userId, userId),
        eq(tenantMemberships.status, "active")
      )
    )
    .limit(1);
  return row !== undefined;
}
