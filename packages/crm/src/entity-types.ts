/**
 * Entity type metadata for the CRM module.
 *
 * Each entity type is registered (per tenant) in the `entity_types`
 * table by Task 0.6 / 1.9a activation. The slug is used in URLs,
 * record relationships, and permission resource names.
 */

export interface CrmEntityTypeSpec {
  slug: string;
  name: string;
  description: string;
  icon: string;
  /**
   * System entity types cannot be deleted by tenant admins, only
   * extended with custom fields.
   */
  isSystem: true;
}

export const ACCOUNT_ENTITY_TYPE: CrmEntityTypeSpec = {
  slug: "account",
  name: "Account",
  description: "Companies and organisations",
  icon: "building",
  isSystem: true,
};

export const CONTACT_ENTITY_TYPE: CrmEntityTypeSpec = {
  slug: "contact",
  name: "Contact",
  description: "People at companies",
  icon: "user",
  isSystem: true,
};

export const LEAD_ENTITY_TYPE: CrmEntityTypeSpec = {
  slug: "lead",
  name: "Lead",
  description: "Unqualified prospects",
  icon: "sparkles",
  isSystem: true,
};

export const OPPORTUNITY_ENTITY_TYPE: CrmEntityTypeSpec = {
  slug: "opportunity",
  name: "Opportunity",
  description: "Deals and sales pipeline",
  icon: "trending-up",
  isSystem: true,
};

export const CAMPAIGN_ENTITY_TYPE: CrmEntityTypeSpec = {
  slug: "campaign",
  name: "Campaign",
  description: "Media campaigns and delivery pipeline",
  icon: "megaphone",
  isSystem: true,
};

export const BRAND_ENTITY_TYPE: CrmEntityTypeSpec = {
  slug: "brand",
  name: "Brand",
  // A child of Account (no standalone nav/list) — surfaced + managed via the
  // Account detail "Brands" panel. Linked by brand_belongs_to_account (M2O).
  description: "Advertiser brands belonging to an account",
  icon: "tag",
  isSystem: true,
};

/**
 * All CRM entity types in registration order. Task 0.6's activation
 * iterates this list.
 */
export const CRM_ENTITY_TYPES: CrmEntityTypeSpec[] = [
  ACCOUNT_ENTITY_TYPE,
  CONTACT_ENTITY_TYPE,
  LEAD_ENTITY_TYPE,
  OPPORTUNITY_ENTITY_TYPE,
  CAMPAIGN_ENTITY_TYPE,
  BRAND_ENTITY_TYPE,
];
