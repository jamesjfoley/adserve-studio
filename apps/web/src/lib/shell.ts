import { and, asc, eq } from "drizzle-orm";
import { modules, tenantModules, withTenant } from "@adserve/database";

/**
 * Platform shell data — the title bar that sits ABOVE every module surface.
 *
 * The shell is module-agnostic: it lists the tenant's licensed modules (the
 * candy box), the personalisation logo, the active module name, and the user
 * roundel. New modules plug in by adding a `modules` row + a `tenant_modules`
 * enablement and a `MODULE_HOME` entry — no shell changes.
 */

/** App/shell version surfaced in the user menu (kept in sync with package.json). */
export const APP_VERSION = "0.1.0";

/**
 * Landing route per module slug (the candy box navigates here). Only modules
 * with a home AND an enabled `active` licence are clickable; the rest render as
 * "coming soon".
 */
export const MODULE_HOME: Record<string, string> = {
  crm: "/dashboard",
};

export type TitleBarMode = "always" | "auto-hide";

export interface ShellConfig {
  logoUrl: string | null;
  titleBarMode: TitleBarMode;
}

/**
 * Pure resolver for the shell's per-tenant settings (mirrors readTenantPalette /
 * readCrmModuleConfig): branding logo + title-bar display mode, from the
 * tenant's `settings` JSONB. No DB access, no caching.
 */
export function readShellConfig(settings: unknown): ShellConfig {
  const s = (settings as { branding?: { logoUrl?: unknown }; shell?: { titleBarMode?: unknown } } | null) ?? {};
  const logoUrl =
    typeof s.branding?.logoUrl === "string" && s.branding.logoUrl !== ""
      ? s.branding.logoUrl
      : null;
  const titleBarMode: TitleBarMode =
    s.shell?.titleBarMode === "auto-hide" ? "auto-hide" : "always";
  return { logoUrl, titleBarMode };
}

/** A module entry for the candy box. */
export interface ShellModule {
  slug: string;
  name: string;
  /** Landing route, or null when the module has no surface yet. */
  href: string | null;
  /** Licensed (enabled) for this tenant AND active AND routable → clickable. */
  available: boolean;
}

/** Derive a 1–2 char initials roundel from a display name (fallback: email). */
export function userInitials(
  fullName: string | null | undefined,
  email?: string | null
): string {
  const name = (fullName ?? "").trim();
  if (name !== "") {
    const parts = name.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    const initials = (first + last).toUpperCase();
    if (initials !== "") return initials;
  }
  const e = (email ?? "").trim();
  if (e !== "") return e.slice(0, 2).toUpperCase();
  return "?";
}

/**
 * The tenant's module catalogue for the candy box: every registered module with
 * its enablement for this tenant. Enabled + active + routable modules are
 * `available` (clickable); the rest show as "coming soon". Read inside
 * withTenant so the tenant-scoped `tenant_modules` rows resolve under RLS.
 */
export async function getTenantModules(tenantId: string): Promise<ShellModule[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({
        slug: modules.slug,
        name: modules.name,
        status: modules.status,
        enabled: tenantModules.enabled,
        displayOrder: modules.displayOrder,
      })
      .from(modules)
      .leftJoin(
        tenantModules,
        and(
          eq(tenantModules.moduleId, modules.id),
          eq(tenantModules.tenantId, tenantId)
        )
      )
      .orderBy(asc(modules.displayOrder), asc(modules.name))
  );

  return rows.map((r) => {
    const href = MODULE_HOME[r.slug] ?? null;
    return {
      slug: r.slug,
      name: r.name,
      href,
      available: r.enabled === true && r.status === "active" && href !== null,
    };
  });
}
