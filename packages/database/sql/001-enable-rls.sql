-- ===========================================================================
-- Task 8: Row-Level Security on tenant-scoped tables
-- ===========================================================================
--
-- Adds tenant_isolation policies to every table that holds tenant data.
-- The policy lets a connection see only rows whose tenant_id matches the
-- transaction-scoped session variable `app.current_tenant_id`, or anything
-- when `app.bypass_rls = 'on'` (super admin code paths).
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY for each table.
--
-- IMPORTANT: as of this migration, the application DATABASE_URL still
-- connects as a Postgres superuser in dev. Postgres superusers bypass RLS
-- unconditionally, so these policies will NOT enforce against the app
-- today. They DO enforce against any non-superuser role — see
-- docs/02-rls.md for the production switchover and how to verify locally.
-- ===========================================================================

BEGIN;

-- ---------- tenants (the table IS the tenant, so use id, not tenant_id) ----
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenants;
CREATE POLICY tenant_isolation ON tenants
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- ---------- tenant-scoped tables (use tenant_id) --------------------------
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'activities',
    'audit_log',
    'ai_usage_limits',
    'ai_usage_log',
    'ai_usage_summary',
    'entity_types',
    'field_definitions',
    'layouts',
    'record_relationships',
    'records',
    'relationships',
    'roles',
    'tenant_invitations',
    'tenant_memberships',
    'tenant_modules',
    'validation_rules'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (
          current_setting('app.bypass_rls', true) = 'on'
          OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        )
        WITH CHECK (
          current_setting('app.bypass_rls', true) = 'on'
          OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        )
    $f$, t);
  END LOOP;
END $$;

-- role_permissions has no tenant_id column (it joins to roles.tenant_id).
-- Access to permission grants is gated indirectly through the roles table's
-- RLS policy: a tenant user can only read roles for their tenant, so they
-- can only meaningfully join through to relevant role_permissions rows.
-- Leaving role_permissions unprotected — the data is meaningless without
-- the role context.

COMMIT;
