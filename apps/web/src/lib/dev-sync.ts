import { currentUser } from "@clerk/nextjs/server";
import { db, users } from "@adserve/database";

export type SyncedUser = typeof users.$inferSelect;

export class DevSyncError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function syncCurrentUser(): Promise<SyncedUser> {
  const clerkUser = await currentUser();
  if (!clerkUser) {
    throw new DevSyncError("Clerk user not found", 401);
  }

  const primaryEmail = clerkUser.emailAddresses[0]?.emailAddress;
  if (!primaryEmail) {
    throw new DevSyncError("Clerk user has no email address", 400);
  }

  const fullName =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
    primaryEmail;

  // Role separation: do not touch is_super_admin from this dev endpoint.
  // New rows default to is_super_admin = false; the conflict update only
  // refreshes profile fields. Super admin accounts are provisioned separately.
  const [record] = await db
    .insert(users)
    .values({
      email: primaryEmail,
      fullName,
      avatarUrl: clerkUser.imageUrl,
      authProviderId: clerkUser.id,
      status: "active",
    })
    .onConflictDoUpdate({
      target: users.authProviderId,
      set: {
        email: primaryEmail,
        fullName,
        avatarUrl: clerkUser.imageUrl,
        updatedAt: new Date(),
      },
    })
    .returning();

  return record;
}
