/**
 * Pure derivation of what the current user may do on a single CRM record,
 * from their permission set + record ownership. Kept free of any
 * request/DB context so it is unit-testable and so the detail page and any
 * future consumer agree on the rules.
 *
 * Edit/archive mirror the API route's `canMutate`: the permission OR
 * record ownership grants the action, and a **null `ownedBy` never grants
 * via ownership** — it falls back to the strict permission check.
 */
export interface RecordCapabilities {
  canEdit: boolean;
  canArchive: boolean;
  canConvert: boolean;
  canLogActivity: boolean;
  canViewActivities: boolean;
}

export function computeRecordCapabilities(args: {
  slug: string;
  permissions: Set<string>;
  userId: string;
  ownedBy: string | null;
}): RecordCapabilities {
  const { slug, permissions, userId, ownedBy } = args;
  const owns = ownedBy !== null && ownedBy === userId;
  return {
    canEdit: permissions.has(`${slug}.update`) || owns,
    canArchive: permissions.has(`${slug}.delete`) || owns,
    // Convert is lead-only and strictly permission-gated (no owner override).
    canConvert: slug === "lead" && permissions.has("lead.convert"),
    canLogActivity: permissions.has("activity.create"),
    canViewActivities: permissions.has("activity.read"),
  };
}
