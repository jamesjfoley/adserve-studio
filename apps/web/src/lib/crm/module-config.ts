import { db, tenants } from "@adserve/database";
import { eq } from "drizzle-orm";

/**
 * CRM media-first module visibility + Lead-convert target.
 *
 * Stored as a JSONB value at `tenants.settings.modules.crm` — mirroring the
 * WS6 palette precedent (`tenants.settings.theme.palette`): a settings key, NOT
 * a separate table, resolved per request with no caching. There is therefore
 * NO migration, NO seed and NO backfill — an absent key resolves to the default
 * profile below.
 *
 * Accounts + Contacts (and the Notes & Activities that ride with them) are
 * ALWAYS on and are not represented here. Only Leads / Campaigns /
 * Opportunities are toggleable; `convertTarget` selects which deal record Lead
 * Convert creates when BOTH pipeline entities are enabled.
 */

export type ConvertTarget = "campaign" | "opportunity";

/** The raw, stored toggles (what the admin writes). */
export interface CrmModuleToggles {
  leads: boolean;
  campaigns: boolean;
  opportunities: boolean;
  convertTarget: ConvertTarget;
}

/** Toggles + derived flags, as consumers read them. */
export interface CrmModuleConfig extends CrmModuleToggles {
  /** Pipeline + CRM dashboard appear when either pipeline entity is on. */
  showPipeline: boolean;
  showDashboard: boolean;
  /**
   * Which deal record Lead Convert creates, given the current toggles:
   *   both on   → the admin's `convertTarget`
   *   one on    → that entity
   *   neither   → null (convert produces Account + Contact only)
   */
  effectiveConvertTarget: ConvertTarget | null;
}

/** Default local profile when `settings.modules.crm` is absent. */
export const DEFAULT_CRM_MODULE_TOGGLES: CrmModuleToggles = {
  leads: true,
  campaigns: true,
  opportunities: false,
  convertTarget: "campaign",
};

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/**
 * Pure resolver: derive the config from a tenant's `settings` JSONB. Mirrors
 * `readTenantPalette(settings)` — no DB access, no caching. Use this on the
 * per-request path where `ctx.tenant.settings` is already loaded.
 */
export function readCrmModuleConfig(settings: unknown): CrmModuleConfig {
  const raw =
    (settings as { modules?: { crm?: Partial<CrmModuleToggles> } } | null)
      ?.modules?.crm ?? {};

  const leads = bool(raw.leads, DEFAULT_CRM_MODULE_TOGGLES.leads);
  const campaigns = bool(raw.campaigns, DEFAULT_CRM_MODULE_TOGGLES.campaigns);
  const opportunities = bool(
    raw.opportunities,
    DEFAULT_CRM_MODULE_TOGGLES.opportunities
  );
  const convertTarget: ConvertTarget =
    raw.convertTarget === "opportunity" ? "opportunity" : "campaign";

  const showPipeline = campaigns || opportunities;
  const effectiveConvertTarget: ConvertTarget | null =
    campaigns && opportunities
      ? convertTarget
      : campaigns
        ? "campaign"
        : opportunities
          ? "opportunity"
          : null;

  return {
    leads,
    campaigns,
    opportunities,
    convertTarget,
    showPipeline,
    showDashboard: showPipeline,
    effectiveConvertTarget,
  };
}

/**
 * Read a tenant's CRM module config by id (per request, no caching). For
 * call sites that only have a tenantId (route guards, the convert endpoint).
 * Where `ctx.tenant.settings` is already in hand, prefer `readCrmModuleConfig`.
 */
export async function getCrmModuleConfig(
  tenantId: string
): Promise<CrmModuleConfig> {
  const [row] = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return readCrmModuleConfig(row?.settings);
}

/** Is a given CRM entity slug currently visible per the config? */
export function isCrmEntityEnabled(
  config: CrmModuleConfig,
  slug: string
): boolean {
  switch (slug) {
    case "account":
    case "contact":
      return true; // always on
    case "lead":
      return config.leads;
    case "campaign":
      return config.campaigns;
    case "opportunity":
      return config.opportunities;
    default:
      return false;
  }
}
