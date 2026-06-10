/**
 * Default visible columns for each CRM entity's list view (Task 1.3).
 *
 * These are field slugs, in display order. The list page intersects this
 * list with the tenant's actual field definitions, so a slug that doesn't
 * exist for a given tenant (custom-field drift) is simply skipped — it
 * never renders an empty table.
 *
 * Per-user column customization (persisting a different visible set) is a
 * Phase 1b concern; these are the Phase-1a defaults only.
 */
export const DEFAULT_LIST_COLUMNS: Record<string, string[]> = {
  account: ["name", "status", "industry", "website", "annualRevenue"],
  contact: ["firstName", "lastName", "email", "phone", "status"],
  lead: ["firstName", "lastName", "company", "source", "status", "estimatedValue"],
  opportunity: ["name", "stage", "amount", "closeDate", "probability"],
  campaign: ["name", "stage", "value", "flightStart", "flightEnd"],
};
