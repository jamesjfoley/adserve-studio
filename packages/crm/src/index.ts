// ============================================================
// Data shapes — what lives in records.data per entity type
// ============================================================
export type {
  AccountData,
  AccountStatus,
  AccountAddress,
  ContactData,
  ContactStatus,
  LeadData,
  LeadStatus,
  LeadSource,
  OpportunityData,
  CrmActivityType,
  CrmActivityBody,
} from "./types";

// ============================================================
// Entity types
// ============================================================
export {
  ACCOUNT_ENTITY_TYPE,
  CONTACT_ENTITY_TYPE,
  LEAD_ENTITY_TYPE,
  OPPORTUNITY_ENTITY_TYPE,
  CRM_ENTITY_TYPES,
  type CrmEntityTypeSpec,
} from "./entity-types";

// ============================================================
// Field definitions
// ============================================================
export {
  DEFAULT_ACCOUNT_FIELDS,
  DEFAULT_CONTACT_FIELDS,
  DEFAULT_LEAD_FIELDS,
  DEFAULT_OPPORTUNITY_FIELDS,
  DEFAULT_FIELDS_BY_ENTITY,
  type CrmFieldDefinitionSpec,
} from "./field-definitions";

// ============================================================
// Relationships
// ============================================================
export {
  CONTACT_BELONGS_TO_ACCOUNT,
  OPPORTUNITY_BELONGS_TO_ACCOUNT,
  OPPORTUNITY_HAS_PRIMARY_CONTACT,
  CRM_RELATIONSHIPS,
  type CrmRelationshipSpec,
  type RelationshipCardinality,
} from "./relationships";

// ============================================================
// Pipeline
// ============================================================
export {
  DEFAULT_PIPELINE_STAGES,
  type PipelineStageSpec,
} from "./pipeline";

// ============================================================
// Permissions
// ============================================================
export {
  CRM_PERMISSIONS,
  CRM_PERMISSION_KEYS,
  type CrmPermissionSpec,
} from "./permissions";

// ============================================================
// Role assignments
// ============================================================
export {
  DEFAULT_CRM_ROLE_PERMISSIONS,
  type SystemRoleSlug,
} from "./role-assignments";
