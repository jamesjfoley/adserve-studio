-- ===========================================================================
-- Phase 3 / Task 0.2: Add `labels` JSONB column to field_definitions
-- ===========================================================================
--
-- Locale-aware display labels for field definitions. The UI reads
-- labels[currentLocale] with fallback to labels.en, then to name.
-- Phase 1 populates "en" only; the schema is ready for more locales
-- without further migrations.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + backfill only-if-empty.
--
-- Apply locally:
--   pnpm db:push           (drizzle-kit will pick up the schema change)
-- Apply on RDS:
--   psql "$DATABASE_URL_MIGRATOR" -v ON_ERROR_STOP=1 -f packages/database/sql/003-add-field-labels.sql
-- ===========================================================================

BEGIN;

ALTER TABLE field_definitions
  ADD COLUMN IF NOT EXISTS labels jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Backfill: any existing row with empty labels gets { "en": <name> } so the
-- UI has something to render. New rows seeded after this point are
-- expected to populate labels explicitly via the field engine.
UPDATE field_definitions
SET labels = jsonb_build_object('en', name)
WHERE labels = '{}'::jsonb;

COMMIT;
