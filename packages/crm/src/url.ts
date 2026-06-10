/**
 * URL segment ↔ entity-type slug mapping for CRM.
 *
 * CRM uses plural collection URLs (`/crm/accounts`, `/api/crm/accounts`)
 * but the `entity_types.slug` values are singular (`account`). This is
 * the single place that maps between them — shared by the API routes
 * (Task 1.2) and the list/detail pages (Task 1.3/1.4) so the two never
 * drift.
 *
 * `resolveCrmEntitySlug` accepts either the plural collection segment or
 * the singular slug and returns the canonical singular slug, or null for
 * anything that isn't a CRM entity.
 */

/** Canonical singular slug → plural collection segment. */
export const CRM_COLLECTION_SEGMENTS: Record<string, string> = {
  account: "accounts",
  contact: "contacts",
  lead: "leads",
  opportunity: "opportunities",
  campaign: "campaigns",
  brand: "brands",
};

const SEGMENT_TO_SLUG: Record<string, string> = Object.entries(
  CRM_COLLECTION_SEGMENTS
).reduce<Record<string, string>>((acc, [slug, plural]) => {
  acc[plural] = slug; // plural → slug
  acc[slug] = slug; // singular passthrough
  return acc;
}, {});

export function resolveCrmEntitySlug(segment: string): string | null {
  return SEGMENT_TO_SLUG[segment] ?? null;
}

/** Singular slug → plural collection segment (for building links). */
export function crmCollectionSegment(slug: string): string | null {
  return CRM_COLLECTION_SEGMENTS[slug] ?? null;
}
