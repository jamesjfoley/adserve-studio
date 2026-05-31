-- ===========================================================================
-- Phase 3 / Task 0.8: AI usage metering tables
-- ===========================================================================
--
-- Three tenant-scoped tables behind the @adserve/ai-service metering layer.
-- Cost is stored in MICRODOLLARS (1 USD = 1,000,000 micros) — Anthropic bills
-- in USD; GBP display is a deferred presentation concern (no live FX in 1b).
--
-- RLS is enabled separately by re-running sql/001-enable-rls.sql (these three
-- tables are added to its table array). The Drizzle definitions in
-- src/schema/ai-usage.ts are the ORM source of truth and match this DDL.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + named constraints.
--
-- Apply locally:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/006-add-ai-usage-tables.sql
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/001-enable-rls.sql   # RLS
--
-- Production (gated — adserve_migrator role): same two files, in order.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS ai_usage_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES users(id),
  module          text NOT NULL,
  capability      text NOT NULL,
  model           text NOT NULL,
  input_tokens    integer NOT NULL DEFAULT 0,
  output_tokens   integer NOT NULL DEFAULT 0,
  total_tokens    integer NOT NULL DEFAULT 0,
  cost_micros     bigint NOT NULL DEFAULT 0,
  duration_ms     integer NOT NULL DEFAULT 0,
  status          text NOT NULL,
  error_message   text,
  request_metadata jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_tenant_created
  ON ai_usage_log (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS ai_usage_summary (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_start      date NOT NULL,
  period_end        date NOT NULL,
  total_tokens      bigint NOT NULL DEFAULT 0,
  total_cost_micros bigint NOT NULL DEFAULT 0,
  request_count     integer NOT NULL DEFAULT 0,
  breakdown         jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_usage_summary_tenant_period_key UNIQUE (tenant_id, period_start)
);

CREATE TABLE IF NOT EXISTS ai_usage_limits (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  monthly_token_limit       bigint,
  monthly_cost_limit_micros bigint NOT NULL,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_usage_limits_tenant_key UNIQUE (tenant_id)
);

-- Runtime grants for the non-superuser app role. Schema ownership (these
-- tables are created by adserve_migrator) does NOT imply privileges, so the
-- app role must be granted access explicitly. This is idempotent and
-- harmless if the migrator's ALTER DEFAULT PRIVILEGES already covers new
-- tables — re-granting an existing privilege is a no-op. Makes 006
-- self-contained rather than relying on that default-ACL being in place.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ai_usage_log, ai_usage_summary, ai_usage_limits
  TO adserve_app;

COMMIT;
