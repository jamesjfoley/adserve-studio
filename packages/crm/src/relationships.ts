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
  // WS1: contact↔account is true many-to-many. The "primary" account lives in
  // record_relationships.metadata.isPrimary, not in the cardinality.
  cardinality: "many_to_many",
  cascadeDelete: false,
  description: "A contact may belong to several accounts",
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
  OPPORTUNITY_BELONGS_TO_ACCOUNT,
  OPPORTUNITY_HAS_PRIMARY_CONTACT,
];
