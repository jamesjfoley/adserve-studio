import type { CurrencyValue } from "@adserve/module-framework";

/**
 * Canonical TypeScript shapes for what lives in `records.data` per CRM
 * entity type. Field definitions (declared in `./field-definitions.ts`)
 * are the source of truth for runtime validation; these types are the
 * compile-time mirror that consumers (API routes, UI) work with.
 *
 * Relationships (e.g. a contact's account) are stored in
 * `record_relationships`, NOT in `records.data`. They are intentionally
 * absent from these interfaces.
 *
 * The `[key: string]: unknown` index signature on each entity type
 * acknowledges tenant-added custom fields — the framework lets tenant
 * admins extend each entity beyond the system fields.
 */

export type AccountStatus = "active" | "inactive" | "prospect";

export interface AccountAddress {
  street?: string;
  city?: string;
  region?: string;
  postcode?: string;
  country?: string;
}

export interface AccountData {
  name: string;
  website?: string;
  industry?: string;
  status: AccountStatus;
  phone?: string;
  email?: string;
  address?: AccountAddress;
  // Default custom fields
  annualRevenue?: CurrencyValue;
  employeeCount?: number;
  description?: string;
  // Tenant-added fields
  [key: string]: unknown;
}

export type ContactStatus = "active" | "inactive";

export interface ContactData {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  title?: string;
  status: ContactStatus;
  department?: string;
  linkedinUrl?: string;
  notes?: string;
  [key: string]: unknown;
}

// Single-text option model: a select option is one text — the stored value
// IS the display label (see field-definitions.ts / pipeline.ts).
export type LeadSource =
  | "Web"
  | "Referral"
  | "Event"
  | "Cold outreach"
  | "Other";
export type LeadStatus =
  | "New"
  | "Contacted"
  | "Qualified"
  | "Converted"
  | "Lost";

export interface LeadData {
  firstName: string;
  lastName: string;
  email?: string;
  company?: string;
  source: LeadSource;
  status: LeadStatus;
  estimatedValue?: CurrencyValue;
  notes?: string;
  [key: string]: unknown;
}

export interface OpportunityData {
  name: string;
  /** Stage slug — references one of the tenant's pipeline stage rows. */
  stage: string;
  amount?: CurrencyValue;
  closeDate?: string; // ISO yyyy-mm-dd
  /** 0-100 inclusive. */
  probability?: number;
  description?: string;
  nextStep?: string;
  lostReason?: string;
  [key: string]: unknown;
}

/** Fixed campaign stage values — see CAMPAIGN_STAGES in ./pipeline.ts. */
export type CampaignStage =
  | "Brief"
  | "Planning"
  | "Booking"
  | "Live"
  | "PCA"
  | "Lost";

export interface CampaignData {
  name: string;
  /** One of the fixed CampaignStage slugs. */
  stage: CampaignStage;
  /** Value / budget. */
  value?: CurrencyValue;
  flightStart?: string; // ISO yyyy-mm-dd
  flightEnd?: string; // ISO yyyy-mm-dd
  products?: string;
  /** Set on entering the PCA (delivered) stage. */
  pcaOutcome?: string;
  /**
   * Stub reference to an operational campaign (Planning/Trafficking),
   * populated at Booking. No FK; not wired for the prototype.
   */
  opsCampaignId?: string | null;
  [key: string]: unknown;
}

export interface BrandData {
  name: string;
  category?: string;
  values?: string;
  [key: string]: unknown;
}

// ============================================================
// Activity types — separate from records, modeled in `activities` table
// ============================================================
export type CrmActivityType =
  | "call"
  | "email"
  | "meeting"
  | "task"
  | "note";

export interface CrmActivityBody {
  /** Free-text body of the activity. */
  text?: string;
  /** Duration in minutes (calls, meetings). */
  durationMinutes?: number;
  /** Outcome label, if applicable. */
  outcome?: string;
  [key: string]: unknown;
}
