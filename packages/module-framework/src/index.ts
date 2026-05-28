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
  type CreateFieldDefinitionInput,
  type DeleteFieldDefinitionArgs,
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
  type CreateLayoutInput,
  type LayoutType,
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
// Validation
// ============================================================
export {
  createValidationRule,
  listValidationRules,
  deleteValidationRule,
  evaluateRules,
  type CreateValidationRuleInput,
} from "./validation";
