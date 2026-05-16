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
import { moduleStatusEnum } from "./enums";
import { tenants } from "./tenants";

// ============================================================
// Modules (global registry)
// ============================================================

export const modules = pgTable("modules", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  version: text("version").notNull().default("0.1.0"),
  status: moduleStatusEnum("status").notNull().default("active"),
  icon: text("icon"),
  displayOrder: integer("display_order").notNull().default(0),
});

export const modulesRelations = relations(modules, ({ many }) => ({
  tenantModules: many(tenantModules),
}));

// ============================================================
// Tenant ↔ Module access
// ============================================================

export const tenantModules = pgTable(
  "tenant_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    settings: jsonb("settings").notNull().default({}),
    enabledAt: timestamp("enabled_at", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_tenant_modules_unique").on(
      table.tenantId,
      table.moduleId
    ),
    index("idx_tenant_modules_tenant").on(table.tenantId),
  ]
);

export const tenantModulesRelations = relations(tenantModules, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantModules.tenantId],
    references: [tenants.id],
  }),
  module: one(modules, {
    fields: [tenantModules.moduleId],
    references: [modules.id],
  }),
}));
