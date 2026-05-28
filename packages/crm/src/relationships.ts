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
  cardinality: "many_to_one",
  cascadeDelete: false,
  description: "A contact belongs to one account",
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
  name: "opportunity_has_primary_contact",
  sourceEntitySlug: "opportunity",
  targetEntitySlug: "contact",
  cardinality: "many_to_one",
  cascadeDelete: false,
  description: "An opportunity may have a primary contact",
};

export const CRM_RELATIONSHIPS: CrmRelationshipSpec[] = [
  CONTACT_BELONGS_TO_ACCOUNT,
  OPPORTUNITY_BELONGS_TO_ACCOUNT,
  OPPORTUNITY_HAS_PRIMARY_CONTACT,
];
