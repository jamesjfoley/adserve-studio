// ============================================================
// Types
// ============================================================
export type {
  // Row types
  EntityType,
  EntityTypeInsert,
  FieldDefinition,
  FieldDefinitionInsert,
  SchemaRelationship,
  SchemaRelationshipInsert,
  Layout,
  LayoutInsert,
  ValidationRule,
  ValidationRuleInsert,
  RecordRow,
  RecordRowInsert,
  RecordRelationship,
  RecordRelationshipInsert,
  Activity,
  ActivityInsert,
  // Augmented + structured
  FieldDefinitionWithLabels,
  LayoutSection,
  LayoutConfig,
  LayoutItem,
  ValidationCondition,
  ValidationAction,
  FieldType,
  CurrencyValue,
  LocalizedLabel,
} from "./types";

export { resolveLabel } from "./types";

// ============================================================
// Field engine
// ============================================================
export {
  createFieldDefinition,
  updateFieldDefinition,
  deleteFieldDefinition,
  listFieldDefinitions,
  coerceFieldValue,
  FieldDefinitionError,
  type CreateFieldDefinitionInput,
  type UpdateFieldDefinitionArgs,
  type DeleteFieldDefinitionArgs,
  type CoercionResult,
  type FieldCoercionSpec,
} from "./field-engine";

// ============================================================
// Layout engine
// ============================================================
export {
  createLayout,
  updateLayoutConfig,
  deleteLayout,
  getDefaultLayout,
  generateDefaultLayoutConfig,
  validateLayoutConfig,
  LayoutError,
  type CreateLayoutInput,
  type UpdateLayoutConfigArgs,
  type DeleteLayoutArgs,
  type GetDefaultLayoutArgs,
  type GenerateDefaultLayoutConfigArgs,
  type ValidateLayoutConfigArgs,
  type LayoutType,
  type LayoutValidationError,
  type LayoutValidationResult,
} from "./layout-engine";

// ============================================================
// Entity registry
// ============================================================
export {
  registerEntityType,
  getEntityTypeBySlug,
  listEntityTypesForModule,
  type RegisterEntityTypeInput,
} from "./entity-registry";

// ============================================================
// Provisioning (generic entity-type activation primitive)
// ============================================================
export {
  provisionEntityType,
  type ProvisionFieldSpec,
  type ProvisionEntityTypeInput,
  type ProvisionEntityTypeResult,
} from "./provisioning";

// ============================================================
// Validation
// ============================================================
export {
  createValidationRule,
  listValidationRules,
  deleteValidationRule,
  evaluateRules,
  type CreateValidationRuleInput,
} from "./validation";
