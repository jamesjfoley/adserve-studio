import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db, users } from "@adserve/database";
import { eq } from "drizzle-orm";

export type SuperAdminUser = typeof users.$inferSelect;

export async function getSuperAdminOrNull(): Promise<SuperAdminUser | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.authProviderId, userId));

  if (!user || !user.isSuperAdmin) return null;
  return user;
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
