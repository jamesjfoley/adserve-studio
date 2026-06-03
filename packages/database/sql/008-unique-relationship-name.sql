-- ===========================================================================
-- Phase 3 / hardening: UNIQUE(tenant_id, name) on the relationships registry
-- ===========================================================================
--
-- WHAT THIS DOES
-- Adds a DB-level UNIQUE index enforcing one registry row per (tenant_id, name)
-- on the `relationships` table. This is the enforcement that AC 3 (WS1) relied
-- on but never had at the DB level — it was held only by WS1's migration
-- predicate (`AND relationship_type = 'many_to_one'`) and the activation
-- existing-row check (packages/crm/src/activate.ts). Defence in depth: even a
-- buggy future writer or a manual insert cannot create a duplicate registry row.
--
-- DUPLICATE-SAFE (does NOT assume a clean table)
-- Production is duplicate-free, but this migration must not silently corrupt or
-- partially apply if duplicates exist. The pre-check RAISEs a clear exception
-- listing how many (tenant_id, name) groups are duplicated; the transaction then
-- rolls back and nothing is changed. Resolve the duplicates, then re-run.
--
-- IDEMPOTENT
-- CREATE UNIQUE INDEX IF NOT EXISTS — a second run is a no-op. Safe to re-run.
--
-- TRANSACTION-SAFE
-- Wrapped in an explicit transaction. The index is created non-concurrently
-- (the registry is tiny — a handful of rows per tenant), so it is valid inside
-- BEGIN/COMMIT (CONCURRENTLY would not be).
--
-- RLS / FORCE ROW LEVEL SECURITY — the PRE-CHECK needs the bypass GUC
-- `relationships` has FORCE ROW LEVEL SECURITY (sql/001-enable-rls.sql) with the
-- policy clause:
--     current_setting('app.bypass_rls', true) = 'on'
--     OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
-- The duplicate pre-check is a CROSS-TENANT read with NO app.current_tenant_id
-- set. Under FORCE RLS a non-superuser applier (the prod migrator role) would
-- otherwise see ZERO rows (the NULLIF guard → NULL → never matches) and the
-- pre-check would falsely report "no duplicates". We SET LOCAL app.bypass_rls
-- = 'on' (the same mechanism withSuperAdminBypass / sql/007 use) so the
-- pre-check sees ALL tenants' rows in BOTH environments. SET LOCAL auto-resets
-- on COMMIT. (CREATE INDEX itself is DDL and is not subject to RLS; the GUC is
-- only load-bearing for the SELECT.) No bare ''::uuid cast; RLS policy shape is
-- NOT changed.
--
-- PROTECTED PATH / HUMAN GATE
-- This file lives under packages/database/sql/** and alters table structure.
-- Applying it to the production RDS database is a human-gated, queued action —
-- NOT run unattended. Local-dev apply is reversible (see below) and runs in-run.
--
-- Apply locally:
--   pnpm --filter @adserve/database sql:unique-relationship-name
--   (or: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--          -f packages/database/sql/008-unique-relationship-name.sql)
--
-- Revert (local dev only — repo has no down-migration convention):
--   DROP INDEX IF EXISTS idx_relationships_tenant_name;
-- ===========================================================================

BEGIN;

-- Cross-tenant pre-check must bypass the NULLIF tenant guard (see header).
SET LOCAL app.bypass_rls = 'on';

DO $$
DECLARE
  dup_groups int;
BEGIN
  SELECT count(*) INTO dup_groups
  FROM (
    SELECT tenant_id, name
    FROM relationships
    GROUP BY tenant_id, name
    HAVING count(*) > 1
  ) d;

  IF dup_groups > 0 THEN
    RAISE EXCEPTION
      'Cannot add UNIQUE(tenant_id, name) on relationships: % duplicate (tenant_id, name) group(s) exist. Resolve them before applying this migration.',
      dup_groups;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_relationships_tenant_name
  ON relationships (tenant_id, name);

COMMIT;
