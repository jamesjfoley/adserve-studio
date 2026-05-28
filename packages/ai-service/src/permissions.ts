/**
 * Platform-level permissions added by Phase 3's AI service.
 *
 * Seeded into the `permissions` table with `module_id = NULL` (platform
 * permission, not module-scoped) alongside the existing platform perms
 * in `packages/database/src/seed/index.ts`. Task 0.8's metering work
 * wires this into the seed.
 *
 * Naming follows the existing 2-part `resource.action` convention
 * (checked at runtime as `ctx.permissions.has("ai_usage.read")`).
 */
export const AI_PLATFORM_PERMISSIONS = [
  {
    resource: "ai_usage",
    action: "read",
    description: "View the tenant's own AI usage stats",
  },
] as const;

export type AIPlatformPermission =
  (typeof AI_PLATFORM_PERMISSIONS)[number];
