-- ===========================================================================
-- Dev/test RLS parity — mirror prod's two-identity model locally
-- ===========================================================================
--
-- Local dev historically connected as a Postgres SUPERUSER (jamesfoley), which
-- bypasses RLS silently — so the RLS layer was never actually enforced in dev
-- or in the test suite. This script creates a local `adserve_app` role that
-- mirrors PRODUCTION's runtime identity (NOSUPERUSER, NOBYPASSRLS, NOT the
-- table owner), so the application's own queries are subject to RLS exactly as
-- they are in prod.
--
-- Two identities, mirroring prod:
--   * Privileged (schema migrations + fixture seeding): the table owner /
--     superuser (locally `jamesfoley`; in prod `adserve_migrator`). Runs the
--     migrations INCLUDING the patched 001-enable-rls.sql (NULLIF guard).
--   * App (runtime queries): `adserve_app` below — RLS enforces on every query.
--
-- Run as the privileged owner (so it can CREATE ROLE + GRANT):
--   psql "postgresql://jamesfoley@localhost:5432/adserve" -v ON_ERROR_STOP=1 \
--     -f packages/database/sql/dev-rls-roles.sql
--
-- Prereq: schema already pushed (drizzle-kit push) and migrations 001-006
-- applied, with 001 being the PATCHED (NULLIF) version. This script re-applies
-- 001 implicitly is NOT done here — apply 001 separately; this only sets up the
-- app role + grants.
--
-- Idempotent: CREATE ROLE guarded; GRANTs are no-ops if already present.
-- Local-only password (dev convenience); never used outside local dev.
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'adserve_app') THEN
    CREATE ROLE adserve_app LOGIN PASSWORD 'adserve_app_dev'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- Connect + read/write the app tables, exactly like prod's adserve_app grants.
GRANT CONNECT ON DATABASE adserve TO adserve_app;
GRANT USAGE ON SCHEMA public TO adserve_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO adserve_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO adserve_app;

-- Future tables created by the current (privileged) role inherit the grants,
-- so a later `drizzle-kit push` doesn't lock the app role out.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO adserve_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO adserve_app;
