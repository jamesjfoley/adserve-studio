-- AdServe Studio — Platform Foundation Schema
-- This file creates all tables, indexes, RLS policies, and seed data
-- for the tenant/identity layer and schema engine.
--
-- Run against a fresh PostgreSQL 15+ database.

-- ============================================================
-- Extensions
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- Custom types
-- ============================================================

CREATE TYPE tenant_status AS ENUM ('active', 'suspended', 'cancelled');
CREATE TYPE user_status AS ENUM ('active', 'invited', 'disabled');
CREATE TYPE membership_status AS ENUM ('active', 'invited', 'suspended');
CREATE TYPE module_status AS ENUM ('active', 'coming_soon', 'deprecated');

CREATE TYPE field_type AS ENUM (
  'text', 'long_text', 'number', 'currency', 'date', 'datetime',
  'boolean', 'select', 'multi_select', 'email', 'phone', 'url',
  'relationship', 'user', 'file', 'image', 'json',
  'computed', 'ai_generated'
);

CREATE TYPE relationship_type AS ENUM ('one_to_one', 'one_to_many', 'many_to_many');
CREATE TYPE layout_type AS ENUM ('detail', 'list', 'create', 'edit', 'card');

CREATE TYPE validation_rule_type AS ENUM ('field_level', 'record_level', 'cross_entity');

CREATE TYPE activity_type AS ENUM (
  'note', 'email', 'call', 'meeting', 'change', 'ai_action', 'system'
);

-- ============================================================
-- Part 1: Tenant and identity layer
-- ============================================================

-- Tenants (top-level organisations)
CREATE TABLE tenants (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  status        tenant_status NOT NULL DEFAULT 'active',
  settings      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenants_slug ON tenants (slug);
CREATE INDEX idx_tenants_status ON tenants (status);

-- Users (global, not tenant-scoped)
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email             text NOT NULL UNIQUE,
  full_name         text NOT NULL,
  avatar_url        text,
  auth_provider_id  text UNIQUE,
  status            user_status NOT NULL DEFAULT 'invited',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_auth_provider ON users (auth_provider_id);

-- Modules (global registry of available modules)
CREATE TABLE modules (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug            text NOT NULL UNIQUE,
  name            text NOT NULL,
  description     text,
  version         text NOT NULL DEFAULT '0.1.0',
  status          module_status NOT NULL DEFAULT 'active',
  icon            text,
  display_order   integer NOT NULL DEFAULT 0
);

-- Roles (tenant-scoped)
CREATE TABLE roles (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  slug          text NOT NULL,
  description   text,
  is_system     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX idx_roles_tenant ON roles (tenant_id);

-- Permissions (global definitions)
CREATE TABLE permissions (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  module_id     uuid REFERENCES modules(id) ON DELETE CASCADE,
  resource      text NOT NULL,
  action        text NOT NULL,
  description   text,
  UNIQUE (module_id, resource, action)
);

-- Role-permission assignments
CREATE TABLE role_permissions (
  role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX idx_role_perms_role ON role_permissions (role_id);

-- Tenant memberships (user ↔ tenant with role)
CREATE TABLE tenant_memberships (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  status        membership_status NOT NULL DEFAULT 'invited',
  invited_by    uuid REFERENCES users(id),
  invited_at    timestamptz DEFAULT now(),
  joined_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX idx_memberships_tenant ON tenant_memberships (tenant_id);
CREATE INDEX idx_memberships_user ON tenant_memberships (user_id);

-- Tenant module access
CREATE TABLE tenant_modules (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_id     uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  enabled       boolean NOT NULL DEFAULT true,
  settings      jsonb NOT NULL DEFAULT '{}',
  enabled_at    timestamptz DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, module_id)
);

CREATE INDEX idx_tenant_modules_tenant ON tenant_modules (tenant_id);

-- ============================================================
-- Part 2: Schema engine
-- ============================================================

-- Entity types (tenant-scoped, module-associated)
CREATE TABLE entity_types (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_id       uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  name            text NOT NULL,
  slug            text NOT NULL,
  description     text,
  icon            text,
  name_field_id   uuid,  -- FK added after field_definitions exists
  is_system       boolean NOT NULL DEFAULT false,
  settings        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX idx_entity_types_tenant ON entity_types (tenant_id);
CREATE INDEX idx_entity_types_module ON entity_types (tenant_id, module_id);

-- Field definitions
CREATE TABLE field_definitions (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type_id    uuid NOT NULL REFERENCES entity_types(id) ON DELETE CASCADE,
  name              text NOT NULL,
  slug              text NOT NULL,
  field_type        field_type NOT NULL,
  is_required       boolean NOT NULL DEFAULT false,
  is_unique         boolean NOT NULL DEFAULT false,
  is_system         boolean NOT NULL DEFAULT false,
  default_value     jsonb,
  options           jsonb NOT NULL DEFAULT '{}',
  display_order     integer NOT NULL DEFAULT 0,
  group_name        text,
  description       text,
  is_searchable     boolean NOT NULL DEFAULT false,
  is_filterable     boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type_id, slug)
);

CREATE INDEX idx_field_defs_entity ON field_definitions (entity_type_id);
CREATE INDEX idx_field_defs_tenant ON field_definitions (tenant_id);

-- Now add the FK from entity_types.name_field_id → field_definitions
ALTER TABLE entity_types
  ADD CONSTRAINT fk_entity_name_field
  FOREIGN KEY (name_field_id) REFERENCES field_definitions(id)
  ON DELETE SET NULL;

-- Relationships between entity types
CREATE TABLE relationships (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                    text NOT NULL,
  source_entity_type_id   uuid NOT NULL REFERENCES entity_types(id) ON DELETE CASCADE,
  target_entity_type_id   uuid NOT NULL REFERENCES entity_types(id) ON DELETE CASCADE,
  relationship_type       relationship_type NOT NULL,
  source_field_id         uuid REFERENCES field_definitions(id) ON DELETE SET NULL,
  target_field_id         uuid REFERENCES field_definitions(id) ON DELETE SET NULL,
  cascade_delete          boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_relationships_tenant ON relationships (tenant_id);
CREATE INDEX idx_relationships_source ON relationships (source_entity_type_id);
CREATE INDEX idx_relationships_target ON relationships (target_entity_type_id);

-- Layouts (page layout definitions)
CREATE TABLE layouts (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type_id  uuid NOT NULL REFERENCES entity_types(id) ON DELETE CASCADE,
  layout_type     layout_type NOT NULL,
  name            text NOT NULL,
  is_default      boolean NOT NULL DEFAULT false,
  config          jsonb NOT NULL DEFAULT '{}',
  assigned_roles  uuid[] DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_layouts_entity ON layouts (entity_type_id);
CREATE INDEX idx_layouts_tenant ON layouts (tenant_id);

-- Validation rules
CREATE TABLE validation_rules (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type_id  uuid NOT NULL REFERENCES entity_types(id) ON DELETE CASCADE,
  name            text NOT NULL,
  rule_type       validation_rule_type NOT NULL,
  condition       jsonb NOT NULL,
  action          jsonb NOT NULL,
  error_message   text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_validation_rules_entity ON validation_rules (entity_type_id);

-- ============================================================
-- Part 3: Record storage
-- ============================================================

-- Records (the main data table for all business records)
CREATE TABLE records (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type_id  uuid NOT NULL REFERENCES entity_types(id) ON DELETE CASCADE,
  data            jsonb NOT NULL DEFAULT '{}',
  created_by      uuid REFERENCES users(id),
  updated_by      uuid REFERENCES users(id),
  owned_by        uuid REFERENCES users(id),
  is_archived     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Primary query pattern: list records of a type within a tenant
CREATE INDEX idx_records_tenant_entity ON records (tenant_id, entity_type_id)
  WHERE is_archived = false;

-- GIN index for JSONB containment queries (e.g., WHERE data @> '{"status": "active"}')
CREATE INDEX idx_records_data ON records USING GIN (data);

-- Owned-by index for "my records" queries
CREATE INDEX idx_records_owner ON records (owned_by, entity_type_id)
  WHERE is_archived = false;

-- Created/updated timestamps for sorting
CREATE INDEX idx_records_created ON records (tenant_id, entity_type_id, created_at DESC)
  WHERE is_archived = false;

-- Many-to-many record relationships
CREATE TABLE record_relationships (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  relationship_id   uuid NOT NULL REFERENCES relationships(id) ON DELETE CASCADE,
  source_record_id  uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  target_record_id  uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  metadata          jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (relationship_id, source_record_id, target_record_id)
);

CREATE INDEX idx_record_rels_source ON record_relationships (source_record_id);
CREATE INDEX idx_record_rels_target ON record_relationships (target_record_id);

-- Activity log
CREATE TABLE activities (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  record_id       uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  entity_type_id  uuid NOT NULL REFERENCES entity_types(id) ON DELETE CASCADE,
  activity_type   activity_type NOT NULL,
  subject         text,
  body            jsonb NOT NULL DEFAULT '{}',
  performed_by    uuid REFERENCES users(id),
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_activities_record ON activities (record_id, created_at DESC);
CREATE INDEX idx_activities_tenant ON activities (tenant_id, entity_type_id, created_at DESC);

-- ============================================================
-- Part 4: Audit log
-- ============================================================

CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     uuid NOT NULL,
  user_id       uuid,
  action        text NOT NULL,  -- e.g., 'record.create', 'user.invite', 'schema.update'
  resource_type text NOT NULL,  -- e.g., 'record', 'user', 'entity_type'
  resource_id   uuid,
  changes       jsonb,          -- { "before": {...}, "after": {...} }
  ip_address    inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_tenant_time ON audit_log (tenant_id, created_at DESC);
CREATE INDEX idx_audit_resource ON audit_log (tenant_id, resource_type, resource_id);

-- ============================================================
-- Part 5: Row-Level Security policies
-- ============================================================

-- Helper: all tenant-scoped tables get the same RLS pattern.
-- The application sets `app.current_tenant` at the start of every request.

-- Tenants table: users can only see their own tenant
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = current_setting('app.current_tenant', true)::uuid);

-- Roles
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON roles
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
CREATE POLICY tenant_insert ON roles FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Tenant memberships
ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_memberships
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
CREATE POLICY tenant_insert ON tenant_memberships FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Tenant modules
ALTER TABLE tenant_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_modules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_modules
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
CREATE POLICY tenant_insert ON tenant_modules FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Entity types
ALTER TABLE entity_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_types FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON entity_types
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
CREATE POLICY tenant_insert ON entity_types FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Field definitions
ALTER TABLE field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_definitions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON field_definitions
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
CREATE POLICY tenant_insert ON field_definitions FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Relationships
ALTER TABLE relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON relationships
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
CREATE POLICY tenant_insert ON relationships FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Layouts
ALTER TABLE layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE layouts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON layouts
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
CREATE POLICY tenant_insert ON layouts FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Validation rules
ALTER TABLE validation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON validation_rules
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
CREATE POLICY tenant_insert ON validation_rules FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Records
ALTER TABLE records ENABLE ROW LEVEL SECURITY;
ALTER TABLE records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON records
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
CREATE POLICY tenant_insert ON records FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Record relationships
ALTER TABLE record_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE record_relationships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON record_relationships
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
CREATE POLICY tenant_insert ON record_relationships FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Activities
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON activities
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
CREATE POLICY tenant_insert ON activities FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Audit log
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
CREATE POLICY tenant_insert ON audit_log FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ============================================================
-- Part 6: Updated-at triggers
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenants_updated BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_roles_updated BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_memberships_updated BEFORE UPDATE ON tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_entity_types_updated BEFORE UPDATE ON entity_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_field_defs_updated BEFORE UPDATE ON field_definitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_layouts_updated BEFORE UPDATE ON layouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_records_updated BEFORE UPDATE ON records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Part 7: Seed data — modules
-- ============================================================

INSERT INTO modules (slug, name, description, status, icon, display_order) VALUES
  ('crm',               'CRM',                  'Contact and deal management',                'active',      'users',          1),
  ('campaigns',         'Campaign planning',     'Plan and schedule advertising campaigns',    'coming_soon', 'calendar',       2),
  ('trafficking',       'Trafficking',           'Ad trafficking and delivery management',     'coming_soon', 'truck',          3),
  ('audience',          'Audience measurement',  'Audience data and analytics',                'coming_soon', 'chart-bar',      4),
  ('reporting',         'Reporting',             'Cross-module reporting and dashboards',      'coming_soon', 'file',           5),
  ('revenue',           'Revenue management',    'Revenue tracking and forecasting',           'coming_soon', 'currency-pound', 6),
  ('pricebooks',        'Price books',           'Rate cards and pricing management',          'coming_soon', 'book',           7);

-- ============================================================
-- Part 8: Seed data — platform-level permissions
-- ============================================================

-- Platform-level permissions (module_id is NULL)
INSERT INTO permissions (module_id, resource, action, description) VALUES
  (NULL, 'tenant',     'admin',   'Full tenant administration'),
  (NULL, 'users',      'read',    'View tenant users'),
  (NULL, 'users',      'admin',   'Invite, edit, remove users'),
  (NULL, 'roles',      'read',    'View roles'),
  (NULL, 'roles',      'admin',   'Create and edit roles'),
  (NULL, 'schema',     'read',    'View entity type definitions'),
  (NULL, 'schema',     'admin',   'Create and modify entity types and fields'),
  (NULL, 'settings',   'read',    'View tenant settings'),
  (NULL, 'settings',   'admin',   'Modify tenant settings'),
  (NULL, 'audit',      'read',    'View audit log');

-- CRM module permissions
INSERT INTO permissions (module_id, resource, action, description)
SELECT m.id, p.resource, p.action, p.description
FROM modules m,
(VALUES
  ('contacts',  'read',   'View contacts'),
  ('contacts',  'create', 'Create contacts'),
  ('contacts',  'update', 'Edit contacts'),
  ('contacts',  'delete', 'Archive contacts'),
  ('contacts',  'export', 'Export contacts'),
  ('companies', 'read',   'View companies'),
  ('companies', 'create', 'Create companies'),
  ('companies', 'update', 'Edit companies'),
  ('companies', 'delete', 'Archive companies'),
  ('companies', 'export', 'Export companies'),
  ('deals',     'read',   'View deals'),
  ('deals',     'create', 'Create deals'),
  ('deals',     'update', 'Edit deals'),
  ('deals',     'delete', 'Archive deals'),
  ('deals',     'export', 'Export deals'),
  ('ai',        'use',    'Use AI features in CRM')
) AS p(resource, action, description)
WHERE m.slug = 'crm';
