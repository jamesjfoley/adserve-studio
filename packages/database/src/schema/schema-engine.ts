import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {
  fieldTypeEnum,
  relationshipTypeEnum,
  layoutTypeEnum,
  validationRuleTypeEnum,
} from "./enums";
import { tenants } from "./tenants";
import { modules } from "./modules";

// ============================================================
// Entity types
// ============================================================

export const entityTypes = pgTable(
  "entity_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    icon: text("icon"),
    nameFieldId: uuid("name_field_id"), // FK added below after fieldDefinitions
    isSystem: boolean("is_system").notNull().default(false),
    settings: jsonb("settings").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_entity_types_tenant_slug").on(
      table.tenantId,
      table.slug
    ),
    index("idx_entity_types_tenant").on(table.tenantId),
    index("idx_entity_types_module").on(table.tenantId, table.moduleId),
  ]
);

export const entityTypesRelations = relations(entityTypes, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [entityTypes.tenantId],
    references: [tenants.id],
  }),
  module: one(modules, {
    fields: [entityTypes.moduleId],
    references: [modules.id],
  }),
  fields: many(fieldDefinitions),
  layouts: many(layouts),
  validationRules: many(validationRules),
}));

// ============================================================
// Field definitions
// ============================================================

export const fieldDefinitions = pgTable(
  "field_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    entityTypeId: uuid("entity_type_id")
      .notNull()
      .references(() => entityTypes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    fieldType: fieldTypeEnum("field_type").notNull(),
    isRequired: boolean("is_required").notNull().default(false),
    isUnique: boolean("is_unique").notNull().default(false),
    isSystem: boolean("is_system").notNull().default(false),
    defaultValue: jsonb("default_value"),
    options: jsonb("options").notNull().default({}),
    displayOrder: integer("display_order").notNull().default(0),
    groupName: text("group_name"),
    description: text("description"),
    isSearchable: boolean("is_searchable").notNull().default(false),
    isFilterable: boolean("is_filterable").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_field_defs_entity_slug").on(
      table.entityTypeId,
      table.slug
    ),
    index("idx_field_defs_entity").on(table.entityTypeId),
    index("idx_field_defs_tenant").on(table.tenantId),
  ]
);

export const fieldDefinitionsRelations = relations(
  fieldDefinitions,
  ({ one }) => ({
    entityType: one(entityTypes, {
      fields: [fieldDefinitions.entityTypeId],
      references: [entityTypes.id],
    }),
    tenant: one(tenants, {
      fields: [fieldDefinitions.tenantId],
      references: [tenants.id],
    }),
  })
);

// ============================================================
// Relationships between entity types
// ============================================================

export const schemaRelationships = pgTable(
  "relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sourceEntityTypeId: uuid("source_entity_type_id")
      .notNull()
      .references(() => entityTypes.id, { onDelete: "cascade" }),
    targetEntityTypeId: uuid("target_entity_type_id")
      .notNull()
      .references(() => entityTypes.id, { onDelete: "cascade" }),
    relationshipType: relationshipTypeEnum("relationship_type").notNull(),
    sourceFieldId: uuid("source_field_id").references(
      () => fieldDefinitions.id,
      { onDelete: "set null" }
    ),
    targetFieldId: uuid("target_field_id").references(
      () => fieldDefinitions.id,
      { onDelete: "set null" }
    ),
    cascadeDelete: boolean("cascade_delete").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_relationships_tenant").on(table.tenantId),
    index("idx_relationships_source").on(table.sourceEntityTypeId),
    index("idx_relationships_target").on(table.targetEntityTypeId),
  ]
);

export const schemaRelationshipsRelations = relations(
  schemaRelationships,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [schemaRelationships.tenantId],
      references: [tenants.id],
    }),
    sourceEntityType: one(entityTypes, {
      fields: [schemaRelationships.sourceEntityTypeId],
      references: [entityTypes.id],
      relationName: "sourceRelationships",
    }),
    targetEntityType: one(entityTypes, {
      fields: [schemaRelationships.targetEntityTypeId],
      references: [entityTypes.id],
      relationName: "targetRelationships",
    }),
  })
);

// ============================================================
// Layouts
// ============================================================

export const layouts = pgTable(
  "layouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    entityTypeId: uuid("entity_type_id")
      .notNull()
      .references(() => entityTypes.id, { onDelete: "cascade" }),
    layoutType: layoutTypeEnum("layout_type").notNull(),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    config: jsonb("config").notNull().default({}),
    assignedRoles: uuid("assigned_roles").array().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_layouts_entity").on(table.entityTypeId),
    index("idx_layouts_tenant").on(table.tenantId),
  ]
);

export const layoutsRelations = relations(layouts, ({ one }) => ({
  entityType: one(entityTypes, {
    fields: [layouts.entityTypeId],
    references: [entityTypes.id],
  }),
  tenant: one(tenants, {
    fields: [layouts.tenantId],
    references: [tenants.id],
  }),
}));

// ============================================================
// Validation rules
// ============================================================

export const validationRules = pgTable(
  "validation_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    entityTypeId: uuid("entity_type_id")
      .notNull()
      .references(() => entityTypes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ruleType: validationRuleTypeEnum("rule_type").notNull(),
    condition: jsonb("condition").notNull(),
    action: jsonb("action").notNull(),
    errorMessage: text("error_message").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_validation_rules_entity").on(table.entityTypeId)]
);

export const validationRulesRelations = relations(
  validationRules,
  ({ one }) => ({
    entityType: one(entityTypes, {
      fields: [validationRules.entityTypeId],
      references: [entityTypes.id],
    }),
  })
);
