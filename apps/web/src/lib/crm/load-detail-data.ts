import { and, desc, eq } from "drizzle-orm";
import { activities, withTenant } from "@adserve/database";
import { loadEntityForm } from "./load-entity-form";
import { loadRecordWithRelationships } from "./relationships";
import { loadPrimaryAccountsForContacts } from "./contact-account";

/**
 * Server-side data path for the CRM detail page (/crm/[entityType]/[id]).
 *
 * Extracted from the page component so it is testable under enforced RLS
 * (hardening step 2). Owns the `withTenant()` call. Returns null when the
 * entity type isn't activated OR the record id is not visible in this tenant's
 * RLS context (→ the page 404s) — which is the cross-tenant isolation guard:
 * requesting another tenant's record id resolves to null, not their data.
 */
export async function loadCrmDetailData(args: {
  tenantId: string;
  slug: string;
  recordId: string;
  canViewActivities: boolean;
}) {
  const { tenantId, slug, recordId, canViewActivities } = args;
  return withTenant(tenantId, async (tx) => {
    const bundle = await loadEntityForm(tx, { tenantId, slug });
    if (!bundle) return null;

    const loaded = await loadRecordWithRelationships(tx, {
      tenantId,
      entityTypeId: bundle.entity.id,
      recordId,
    });
    if (!loaded) return null;

    const activityRows = canViewActivities
      ? await tx
          .select()
          .from(activities)
          .where(
            and(eq(activities.tenantId, tenantId), eq(activities.recordId, recordId))
          )
          .orderBy(desc(activities.createdAt))
      : [];

    // For the account detail's contact tables, resolve each listed contact's
    // PRIMARY account (the "Account" column). Only the contacts linked to this
    // account are involved → bounded.
    const contactPrimaryAccounts =
      slug === "account"
        ? await loadPrimaryAccountsForContacts(tx, {
            tenantId,
            contactIds: (loaded.relationships.contact ?? []).map((c) => c.id),
          })
        : {};

    return { bundle, loaded, activityRows, contactPrimaryAccounts };
  });
}
