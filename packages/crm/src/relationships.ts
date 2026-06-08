/**
 * Default relationships between CRM entity types. Task 0.6 / 1.9a
 * creates rows in the `relationships` table from this spec at
 * activation time, then per-record links live in `record_relationships`.
 *
 * Naming convention: "{source}_{verb}_{target}". Used as the
 * `relationships.name` slug.
 */

export type RelationshipCardinality = "one_to_many" | "many_to_one" | "many_to_many";

export interface CrmRelationshipSpec {
  /** Stable identifier for the relationship type. */
  name: string;
  sourceEntitySlug: string;
  targetEntitySlug: string;
  cardinality: RelationshipCardinality;
  /** When the source row is archived, archive/cascade behavior on the target. */
  cascadeDelete: boolean;
  description: string;
}

export const CONTACT_BELONGS_TO_ACCOUNT: CrmRelationshipSpec = {
  name: "contact_belongs_to_account",
  sourceEntitySlug: "contact",
  targetEntitySlug: "account",
  // The PRIMARY (home/employer) account — exactly one per contact. WS1/007 had
  // overloaded this to many_to_many to capture the multi-account case; that case
  // now has its own relationship (CONTACT_RELATED_TO_ACCOUNT), so primary is a
  // true many_to_one. New tenants activate as M2O; existing tenants are flipped
  // by a gated migration (prod) / a local SQL UPDATE (prototype) — activate
  // skips-on-match by name and never reconciles cardinality.
  cardinality: "many_to_one",
  cascadeDelete: false,
  description: "A contact's primary (home/employer) account — exactly one",
};

export const CONTACT_RELATED_TO_ACCOUNT: CrmRelationshipSpec = {
  // The contact's RELATED accounts — accounts worked with but not belonged to
  // (e.g. an auditor's client accounts). Many-to-many: zero or many, add/remove,
  // no replace. Shares the record_relationships junction with the primary
  // relationship but is a distinct registry row (distinct relationshipId), so
  // the two never bleed. A contact may NOT be related to its own primary account
  // (self-overlap is rejected at write).
  name: "contact_related_to_account",
  sourceEntitySlug: "contact",
  targetEntitySlug: "account",
  cardinality: "many_to_many",
  cascadeDelete: false,
  description: "Accounts a contact works with but does not belong to",
};

export const OPPORTUNITY_BELONGS_TO_ACCOUNT: CrmRelationshipSpec = {
  name: "opportunity_belongs_to_account",
  sourceEntitySlug: "opportunity",
  targetEntitySlug: "account",
  cardinality: "many_to_one",
  cascadeDelete: false,
  description: "An opportunity belongs to one account",
};

export const OPPORTUNITY_HAS_PRIMARY_CONTACT: CrmRelationshipSpec = {
  // NOTE: the `name` slug and this exported constant identifier are LOAD-BEARING.
  // The convert route imports OPPORTUNITY_HAS_PRIMARY_CONTACT and resolves the
  // relationship row by `.name` ("opportunity_has_primary_contact"); a rename
  // would silently drop the opp↔contact link (WS1 Condition 1). Only the
  // cardinality flips to many-to-many — the "primary" contact now lives in
  // record_relationships.metadata.isPrimary, not in the slug.
  name: "opportunity_has_primary_contact",
  sourceEntitySlug: "opportunity",
  targetEntitySlug: "contact",
  cardinality: "many_to_many",
  cascadeDelete: false,
  description: "An opportunity may have several contacts (one marked primary)",
};

export const CRM_RELATIONSHIPS: CrmRelationshipSpec[] = [
  CONTACT_BELONGS_TO_ACCOUNT,
  CONTACT_RELATED_TO_ACCOUNT,
  OPPORTUNITY_BELONGS_TO_ACCOUNT,
  OPPORTUNITY_HAS_PRIMARY_CONTACT,
];
