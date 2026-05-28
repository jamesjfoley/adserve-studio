import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
  users,
  tenantMemberships,
  withSuperAdminBypass,
} from "@adserve/database";
import { eq } from "drizzle-orm";

export type SuperAdminUser = typeof users.$inferSelect;

export async function getSuperAdminOrNull(): Promise<SuperAdminUser | null> {
  const { userId } = await auth();
  if (!userId) return null;

  // The tenant_memberships sanity-check below hits an RLS-protected table.
  // Wrap in bypass since this resolves super-admin identity, not a tenant
  // context. users is non-RLS but stays inside the same tx for atomicity.
  return withSuperAdminBypass(async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.authProviderId, userId));

    if (!user || !user.isSuperAdmin) return null;

    // Role separation: a super admin account must never belong to a tenant.
    // If a record somehow has both is_super_admin and a tenant membership,
    // refuse to treat it as a super admin until the data is cleaned up.
    const [membership] = await tx
      .select({ id: tenantMemberships.id })
      .from(tenantMemberships)
      .where(eq(tenantMemberships.userId, user.id))
      .limit(1);
    if (membership) return null;

    return user;
  });
}

export async function requireSuperAdmin(): Promise<SuperAdminUser> {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const user = await getSuperAdminOrNull();
  if (!user) {
    redirect("/dashboard");
  }
  return user;
}

export type ApiSuperAdminAuth =
  | { user: SuperAdminUser; error: null }
  | { user: null; error: NextResponse };

export async function apiRequireSuperAdmin(): Promise<ApiSuperAdminAuth> {
  const user = await getSuperAdminOrNull();
  if (!user) {
    return {
      user: null,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { user, error: null };
}
