-- ===========================================================================
-- Create a non-superuser role for verifying RLS policies in dev.
-- Idempotent (uses DO blocks for conditional CREATE ROLE).
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'adserve_rls_test') THEN
    CREATE ROLE adserve_rls_test LOGIN PASSWORD 'rls_test_password' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

-- Grant CRUD on all RLS-protected tables. Use a loop to keep it tidy.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants',
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
    'validation_rules',
    -- Also grant access to non-RLS-but-joined tables so test queries work
    'role_permissions',
    'permissions',
    'modules',
    'users'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO adserve_rls_test', t);
  END LOOP;
END $$;

-- Sequences for any defaults
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO adserve_rls_test;
