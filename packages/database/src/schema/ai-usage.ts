import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  date,
  timestamp,
  jsonb,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { tenants, users } from "./tenants";

// ============================================================
// AI usage metering (Task 0.8)
// ============================================================
//
// Three RLS-protected tables (added to sql/001-enable-rls.sql). All
// tenant-scoped: tenant routes query via withTenant(), super-admin via
// withSuperAdminBypass(). Cost is stored in MICRODOLLARS (1 USD =
// 1,000,000 micros) — Anthropic bills in USD. GBP display is a deferred
// presentation concern (no live FX in Phase 1b).

/**
 * One row per AI call — success, error, rate-limit, or over-limit.
 * Written by `recordUsage` on every path so we have full visibility into
 * what tenants attempted, not just what succeeded.
 */
export const aiUsageLog = pgTable(
  "ai_usage_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id),
    module: text("module").notNull(),
    capability: text("capability").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    // bigint in micro-dollars. mode:"number" — a month of usage stays well
    // within Number.MAX_SAFE_INTEGER ($50/mo default cap ≈ 5e7 micros).
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    // 'success' | 'error' | 'rate_limited' | 'over_limit'
    status: text("status").notNull(),
    errorMessage: text("error_message"),
    requestMetadata: jsonb("request_metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Powers the tenant's rolling-window usage query and the per-tenant
    // super-admin drill-in.
    index("idx_ai_usage_log_tenant_created").on(
      table.tenantId,
      table.createdAt
    ),
  ]
);

/**
 * Per-tenant, per-period rollup. UPSERTed on each successful call. The
 * cap check reads `total_cost_micros` from the current period here rather
 * than scanning the log. One row per (tenant, period_start).
 */
export const aiUsageSummary = pgTable(
  "ai_usage_summary",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // Calendar-month period, UTC, stored as 'YYYY-MM-DD'.
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    totalTokens: bigint("total_tokens", { mode: "number" })
      .notNull()
      .default(0),
    totalCostMicros: bigint("total_cost_micros", { mode: "number" })
      .notNull()
      .default(0),
    requestCount: integer("request_count").notNull().default(0),
    // Per `module.capability` → { tokens, costMicros, count }.
    breakdown: jsonb("breakdown").notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("ai_usage_summary_tenant_period_key").on(
      table.tenantId,
      table.periodStart
    ),
  ]
);

/**
 * Per-tenant cost/token cap. Seeded on CRM activation with the default
 * cap. Super admin adjusts via `setUsageLimits`. One row per tenant.
 */
export const aiUsageLimits = pgTable(
  "ai_usage_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // null = no token cap (cost cap still applies).
    monthlyTokenLimit: bigint("monthly_token_limit", { mode: "number" }),
    monthlyCostLimitMicros: bigint("monthly_cost_limit_micros", {
      mode: "number",
    }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("ai_usage_limits_tenant_key").on(table.tenantId),
  ]
);
