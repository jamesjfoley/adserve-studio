import { CRM_PERMISSION_KEYS } from "./permissions";

/**
 * Default CRM permission grants per system role. Task 1.1's seed inserts
 * `role_permissions` rows from this mapping at activation time. Existing
 * Phase 2 platform permissions (e.g. `tenant.admin`, `admin.access`) are
 * granted separately by the existing webhook bootstrap and are not in
 * this list.
 *
 * `member.write on records they own` is enforced at the route layer
 * (ownership check on the record) rather than via a separate
 * permission — that's why Member doesn't have account.update etc. here.
 */

export type SystemRoleSlug = "owner" | "admin" | "member";

export const DEFAULT_CRM_ROLE_PERMISSIONS: Record<SystemRoleSlug, string[]> = {
  // Owner — all CRM permissions.
  owner: [...CRM_PERMISSION_KEYS],

  // Admin — same as Owner for CRM scope. Owner's exclusive bit is
  // `tenant.admin`, which lives in the platform permissions (not here).
  admin: [...CRM_PERMISSION_KEYS],

  // Member — read on all CRM entities + create activities. Editing
  // records they own is allowed via row-level ownership check in the
  // route layer, not via permission grants.
  member: [
    "account.read",
    "contact.read",
    "lead.read",
    "opportunity.read",
    "campaign.read",
    "brand.read",
    "pipeline.read",
    "activity.read",
    "activity.create",
  ],
};
