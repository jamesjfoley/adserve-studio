import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  inet,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { activityTypeEnum } from "./enums";
import { tenants, users } from "./tenants";
import { entityTypes } from "./schema-engine";
import { schemaRelationships } from "./schema-engine";

// ============================================================
// Records (main business data table)
// ============================================================

export const records = pgTable(
  "records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    entityTypeId: uuid("entity_type_id")
      .notNull()
      .references(() => entityTypes.id, { onDelete: "cascade" }),
    data: jsonb("data").notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    ownedBy: uuid("owned_by").references(() => users.id),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Primary query: list records of a type within a tenant
    index("idx_records_tenant_entity").on(
      table.tenantId,
      table.entityTypeId
    ).where(sql`is_archived = false`),
    // GIN index for JSONB queries
    index("idx_records_data").using("gin", table.data),
    // Owner lookup
    index("idx_records_owner").on(
      table.ownedBy,
      table.entityTypeId
    ).where(sql`is_archived = false`),
    // Timeline sorting
    index("idx_records_created").on(
      table.tenantId,
      table.entityTypeId,
      table.createdAt
    ).where(sql`is_archived = false`),
  ]
);

export const recordsRelations = relations(records, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [records.tenantId],
    references: [tenants.id],
  }),
  entityType: one(entityTypes, {
    fields: [records.entityTypeId],
    references: [entityTypes.id],
  }),
  creator: one(users, {
    fields: [records.createdBy],
    references: [users.id],
    relationName: "createdRecords",
  }),
  updater: one(users, {
    fields: [records.updatedBy],
    references: [users.id],
    relationName: "updatedRecords",
  }),
  owner: one(users, {
    fields: [records.ownedBy],
    references: [users.id],
    relationName: "ownedRecords",
  }),
  activities: many(activities),
  sourceRelationships: many(recordRelationships, {
    relationName: "sourceRecord",
  }),
  targetRelationships: many(recordRelationships, {
    relationName: "targetRecord",
  }),
}));

// ============================================================
// Record relationships (many-to-many links between records)
// ============================================================

export const recordRelationships = pgTable(
  "record_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    relationshipId: uuid("relationship_id")
      .notNull()
      .references(() => schemaRelationships.id, { onDelete: "cascade" }),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    targetRecordId: uuid("target_record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_record_rels_unique").on(
      table.relationshipId,
      table.sourceRecordId,
      table.targetRecordId
    ),
    index("idx_record_rels_source").on(table.sourceRecordId),
    index("idx_record_rels_target").on(table.targetRecordId),
  ]
);

export const recordRelationshipsRelations = relations(
  recordRelationships,
  ({ one }) => ({
    sourceRecord: one(records, {
      fields: [recordRelationships.sourceRecordId],
      references: [records.id],
      relationName: "sourceRecord",
    }),
    targetRecord: one(records, {
      fields: [recordRelationships.targetRecordId],
      references: [records.id],
      relationName: "targetRecord",
    }),
    relationship: one(schemaRelationships, {
      fields: [recordRelationships.relationshipId],
      references: [schemaRelationships.id],
    }),
  })
);

// ============================================================
// Activities (log of actions on records)
// ============================================================

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    recordId: uuid("record_id")
      .notNull()
      .references(() => records.id, { onDelete: "cascade" }),
    entityTypeId: uuid("entity_type_id")
      .notNull()
      .references(() => entityTypes.id, { onDelete: "cascade" }),
    activityType: activityTypeEnum("activity_type").notNull(),
    subject: text("subject"),
    body: jsonb("body").notNull().default({}),
    performedBy: uuid("performed_by").references(() => users.id),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_activities_record").on(table.recordId, table.createdAt),
    index("idx_activities_tenant").on(
      table.tenantId,
      table.entityTypeId,
      table.createdAt
    ),
  ]
);

export const activitiesRelations = relations(activities, ({ one }) => ({
  record: one(records, {
    fields: [activities.recordId],
    references: [records.id],
  }),
  entityType: one(entityTypes, {
    fields: [activities.entityTypeId],
    references: [entityTypes.id],
  }),
  performer: one(users, {
    fields: [activities.performedBy],
    references: [users.id],
  }),
}));

// ============================================================
// Audit log
// ============================================================

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    userId: uuid("user_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    changes: jsonb("changes"),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_audit_tenant_time").on(table.tenantId, table.createdAt),
    index("idx_audit_resource").on(
      table.tenantId,
      table.resourceType,
      table.resourceId
    ),
  ]
);
