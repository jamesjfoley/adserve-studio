/**
 * Tenant-admin helpers. Since Task 7, these are thin wrappers around the
 * permission-aware helpers in `./permissions`. The semantics of the
 * "tenant admin" track are: a tenant user whose role includes the
 * `admin.access` permission. See permissions.ts for the underlying lookup.
 */
import {
  apiRequirePermission,
  getTenantContextOrNull,
  requirePermission,
  type ApiPermissionAuth,
  type TenantContext,
  type TenantContextMembership,
  type TenantContextRole,
  type TenantContextTenant,
  type TenantContextUser,
} from "./permissions";

// Re-export the canonical shapes for existing callers (Tasks 2–6).
export type TenantAdminUser = TenantContextUser;
export type TenantAdminTenant = TenantContextTenant;
export type TenantAdminMembership = TenantContextMembership;
export type TenantAdminRole = TenantContextRole;
export type TenantAdminContext = TenantContext;
export type ApiTenantAdminAuth = ApiPermissionAuth;

/**
 * Resolve to a full tenant admin context, or null if the caller does not
 * have admin.access. Same shape as the Task 2 helper.
 */
export async function getTenantAdminContextOrNull(): Promise<TenantAdminContext | null> {
  const ctx = await getTenantContextOrNull();
  if (!ctx || !ctx.permissions.has("admin.access")) return null;
  return ctx;
}

/**
 * Page guard for /admin/*. Redirects to /sign-in if unauthenticated,
 * /dashboard if the user lacks admin.access (including super admins).
 */
export function requireTenantAdmin(): Promise<TenantAdminContext> {
  return requirePermission("admin.access");
}

/**
 * API guard for /api/admin/*. Returns 401 / 403 instead of redirecting.
 */
export function apiRequireTenantAdmin(): Promise<ApiTenantAdminAuth> {
  return apiRequirePermission("admin.access");
}
