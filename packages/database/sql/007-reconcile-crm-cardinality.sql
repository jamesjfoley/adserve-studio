-- ===========================================================================
-- Phase 3 / WS1: Reconcile CRM relationship cardinality to many-to-many
-- ===========================================================================
--
-- WHAT THIS DOES
-- Flips the `relationship_type` of two registry rows from 'many_to_one' to
-- 'many_to_many', IN PLACE, for every tenant that already has them:
--   - contact_belongs_to_account     (contact↔account is now true M2M)
--   - opportunity_has_primary_contact (opportunity↔contacts is now M2M;
--                                      "primary" lives in
--                                      record_relationships.metadata.isPrimary)
-- `opportunity_belongs_to_account` deliberately stays 'many_to_one'.
--
-- The spec (packages/crm/src/relationships.ts) now declares these two as
-- 'many_to_many'. Activation keys its existing-row check on relationshipType
-- (packages/crm/src/activate.ts lines ~148-159), so a tenant that already has
-- the old 'many_to_one' rows would get a SECOND 'many_to_many' row inserted on
-- re-activation (duplicate, orphaned cardinality). This migration reconciles
-- existing tenants up-front so re-activation finds the flipped row and skips.
--
-- WHY IN-PLACE (not a junction rewrite)
-- We UPDATE the existing `relationships` rows rather than delete+recreate, so
-- every `record_relationships.relationship_id` foreign key keeps pointing at the
-- SAME row. No junction rows are rewritten, none are orphaned, and the per-tenant
-- count of record_relationships is unchanged.
--
-- IDEMPOTENT
-- The `AND relationship_type = 'many_to_one'` predicate means a second run
-- matches zero rows. Safe to re-run.
--
-- TRANSACTION-SAFE
-- Wrapped in an explicit transaction. The 'many_to_many' enum value already
-- exists (it predates 'many_to_one', which sql/004 added), so — unlike sql/004's
-- ALTER TYPE ... ADD VALUE — this UPDATE can run inside a BEGIN/COMMIT block.
--
-- RLS / FORCE ROW LEVEL SECURITY CORRECTNESS — DO NOT REMOVE THE BYPASS GUC
-- `relationships` has FORCE ROW LEVEL SECURITY with the tenant_isolation policy
-- from sql/001-enable-rls.sql, whose USING/WITH CHECK clause is:
--     current_setting('app.bypass_rls', true) = 'on'
--     OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
-- This migration is a CROSS-TENANT data op: it must flip rows for ALL tenants,
-- and it runs with NO `app.current_tenant_id` set. Under FORCE RLS the applying
-- role does NOT bypass RLS implicitly (in production this is the non-superuser
-- migrator/app role). With no tenant GUC, the NULLIF(...) guard evaluates to
-- NULL, `tenant_id = NULL` is never true, and the UPDATE would match ZERO rows
-- and SILENTLY no-op — while locally the superuser DATABASE_URL bypasses RLS and
-- it would APPEAR to work. To be correct in BOTH environments we set the
-- existing bypass GUC INSIDE the transaction before the UPDATE (the same
-- mechanism withSuperAdminBypass uses; the policy honours
-- current_setting('app.bypass_rls', true) = 'on'). SET LOCAL scopes it to this
-- transaction only — it auto-resets on COMMIT. No bare ''::uuid cast is used,
-- and the RLS policy shape is NOT changed.
--
-- PROTECTED PATH / HUMAN GATE
-- This file lives under packages/database/sql/** and mutates existing-tenant
-- data. Applying it to the production RDS database is a human-gated, queued
-- action — it is NOT run unattended. Local-dev apply is reversible (see below)
-- and runs in-run.
--
-- Apply locally:
--   pnpm --filter @adserve/database sql:reconcile-cardinality
--   (or: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--          -f packages/database/sql/007-reconcile-crm-cardinality.sql)
--
-- Revert (local dev only — repo has no down-migration convention):
--   UPDATE relationships
--      SET relationship_type = 'many_to_one'
--    WHERE name IN ('contact_belongs_to_account','opportunity_has_primary_contact')
--      AND relationship_type = 'many_to_many';
--   (run with SET LOCAL app.bypass_rls = 'on' under enforced RLS)
-- ===========================================================================

BEGIN;

-- Cross-tenant UPDATE under FORCE RLS with no tenant GUC → must bypass the
-- NULLIF tenant guard, or it silently matches zero rows (see header).
SET LOCAL app.bypass_rls = 'on';

UPDATE relationships
   SET relationship_type = 'many_to_many'
 WHERE name IN ('contact_belongs_to_account', 'opportunity_has_primary_contact')
   AND relationship_type = 'many_to_one';

COMMIT;
