-- AdServe Studio — Tenant provisioning
-- This function creates a new tenant with default roles, permissions,
-- and optionally installs module schema packages.
--
-- Called by the application when a new customer signs up.
-- Runs as a superuser/service role (bypasses RLS) since the tenant
-- doesn't exist yet when this starts.

-- ============================================================
-- Function: provision_tenant
-- Creates tenant, default roles, assigns permissions, creates
-- the first owner membership.
-- ============================================================

CREATE OR REPLACE FUNCTION provision_tenant(
  p_tenant_name   text,
  p_tenant_slug   text,
  p_owner_user_id uuid,
  p_modules       text[] DEFAULT ARRAY['crm']  -- module slugs to enable
)
RETURNS uuid AS $$
DECLARE
  v_tenant_id   uuid;
  v_owner_role  uuid;
  v_admin_role  uuid;
  v_member_role uuid;
  v_module_id   uuid;
  v_module_slug text;
  v_perm        RECORD;
BEGIN
  -- Create the tenant
  INSERT INTO tenants (name, slug, status, settings)
  VALUES (
    p_tenant_name,
    p_tenant_slug,
    'active',
    jsonb_build_object(
      'timezone', 'Europe/London',
      'locale', 'en-GB',
      'currency', 'GBP',
      'date_format', 'DD/MM/YYYY'
    )
  )
  RETURNING id INTO v_tenant_id;

  -- Create default system roles
  INSERT INTO roles (tenant_id, name, slug, description, is_system)
  VALUES (v_tenant_id, 'Owner', 'owner', 'Full access. Can manage billing and delete tenant.', true)
  RETURNING id INTO v_owner_role;

  INSERT INTO roles (tenant_id, name, slug, description, is_system)
  VALUES (v_tenant_id, 'Admin', 'admin', 'Full access except tenant deletion and billing.', true)
  RETURNING id INTO v_admin_role;

  INSERT INTO roles (tenant_id, name, slug, description, is_system)
  VALUES (v_tenant_id, 'Member', 'member', 'Access to assigned modules. Cannot manage users or schema.', true)
  RETURNING id INTO v_member_role;

  -- Assign ALL permissions to the owner role
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_owner_role, p.id
  FROM permissions p;

  -- Assign all permissions EXCEPT tenant.admin to admin role
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_admin_role, p.id
  FROM permissions p
  WHERE NOT (p.resource = 'tenant' AND p.action = 'admin');

  -- Assign read + create + update permissions to member role
  -- (no delete, no export, no admin, no schema management)
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_member_role, p.id
  FROM permissions p
  WHERE p.action IN ('read', 'create', 'update', 'use');

  -- Create the owner's membership
  INSERT INTO tenant_memberships (tenant_id, user_id, role_id, status, joined_at)
  VALUES (v_tenant_id, p_owner_user_id, v_owner_role, 'active', now());

  -- Enable requested modules
  FOREACH v_module_slug IN ARRAY p_modules LOOP
    SELECT id INTO v_module_id FROM modules WHERE slug = v_module_slug;
    IF v_module_id IS NOT NULL THEN
      INSERT INTO tenant_modules (tenant_id, module_id, enabled)
      VALUES (v_tenant_id, v_module_id, true);
    END IF;
  END LOOP;

  RETURN v_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- Function: install_crm_schema
-- Installs the default CRM entity types, fields, relationships,
-- and layouts for a tenant.
-- ============================================================

CREATE OR REPLACE FUNCTION install_crm_schema(p_tenant_id uuid)
RETURNS void AS $$
DECLARE
  v_crm_module_id   uuid;
  v_contact_type_id uuid;
  v_company_type_id uuid;
  v_deal_type_id    uuid;
  v_field_id        uuid;
  v_name_field_id   uuid;
BEGIN
  SELECT id INTO v_crm_module_id FROM modules WHERE slug = 'crm';

  -- ========================================
  -- Entity type: Contact
  -- ========================================
  INSERT INTO entity_types (tenant_id, module_id, name, slug, description, icon, is_system)
  VALUES (p_tenant_id, v_crm_module_id, 'Contact', 'contact', 'Individual people and leads', 'user', true)
  RETURNING id INTO v_contact_type_id;

  -- Contact fields
  INSERT INTO field_definitions (tenant_id, entity_type_id, name, slug, field_type, is_required, is_system, is_searchable, is_filterable, display_order, group_name)
  VALUES
    (p_tenant_id, v_contact_type_id, 'First name',      'first_name',     'text',         true,  true,  true,  false, 1,  'Basic info'),
    (p_tenant_id, v_contact_type_id, 'Last name',       'last_name',      'text',         true,  true,  true,  false, 2,  'Basic info'),
    (p_tenant_id, v_contact_type_id, 'Email',           'email',          'email',        false, true,  true,  true,  3,  'Basic info'),
    (p_tenant_id, v_contact_type_id, 'Phone',           'phone',          'phone',        false, false, false, false, 4,  'Basic info'),
    (p_tenant_id, v_contact_type_id, 'Mobile',          'mobile',         'phone',        false, false, false, false, 5,  'Basic info'),
    (p_tenant_id, v_contact_type_id, 'Job title',       'job_title',      'text',         false, false, true,  true,  6,  'Work'),
    (p_tenant_id, v_contact_type_id, 'Department',      'department',     'text',         false, false, false, true,  7,  'Work'),
    (p_tenant_id, v_contact_type_id, 'Status',          'status',         'select',       false, true,  false, true,  9,  'Classification'),
    (p_tenant_id, v_contact_type_id, 'Source',          'source',         'select',       false, false, false, true,  10, 'Classification'),
    (p_tenant_id, v_contact_type_id, 'Tags',            'tags',           'multi_select', false, false, false, true,  11, 'Classification'),
    (p_tenant_id, v_contact_type_id, 'Notes',           'notes',          'long_text',    false, false, false, false, 12, 'Additional'),
    (p_tenant_id, v_contact_type_id, 'Last contacted',  'last_contacted', 'datetime',     false, false, false, true,  13, 'Activity'),
    (p_tenant_id, v_contact_type_id, 'AI summary',      'ai_summary',     'ai_generated', false, false, false, false, 14, 'AI');

  -- Set select options
  UPDATE field_definitions SET options = '{"choices": ["Active", "Inactive", "Lead", "Prospect"]}'
  WHERE entity_type_id = v_contact_type_id AND slug = 'status';

  UPDATE field_definitions SET options = '{"choices": ["Web", "Referral", "Event", "Cold call", "Inbound", "Partner"]}'
  WHERE entity_type_id = v_contact_type_id AND slug = 'source';

  UPDATE field_definitions SET options = '{"prompt_template": "Summarise this contacts recent activity and relationship status in 2 sentences.", "source_fields": ["notes", "activities"], "refresh_trigger": "on_activity_added"}'
  WHERE entity_type_id = v_contact_type_id AND slug = 'ai_summary';

  -- Set the name field for Contact
  SELECT id INTO v_name_field_id FROM field_definitions
  WHERE entity_type_id = v_contact_type_id AND slug = 'first_name';
  UPDATE entity_types SET name_field_id = v_name_field_id WHERE id = v_contact_type_id;

  -- ========================================
  -- Entity type: Company
  -- ========================================
  INSERT INTO entity_types (tenant_id, module_id, name, slug, description, icon, is_system)
  VALUES (p_tenant_id, v_crm_module_id, 'Company', 'company', 'Organisations and accounts', 'building', true)
  RETURNING id INTO v_company_type_id;

  INSERT INTO field_definitions (tenant_id, entity_type_id, name, slug, field_type, is_required, is_system, is_searchable, is_filterable, display_order, group_name)
  VALUES
    (p_tenant_id, v_company_type_id, 'Name',            'name',            'text',         true,  true,  true,  true,  1,  'Basic info'),
    (p_tenant_id, v_company_type_id, 'Website',         'website',         'url',          false, false, false, false, 2,  'Basic info'),
    (p_tenant_id, v_company_type_id, 'Industry',        'industry',        'select',       false, false, false, true,  3,  'Classification'),
    (p_tenant_id, v_company_type_id, 'Size',            'size',            'select',       false, false, false, true,  4,  'Classification'),
    (p_tenant_id, v_company_type_id, 'Annual revenue',  'annual_revenue',  'currency',     false, false, false, true,  5,  'Financial'),
    (p_tenant_id, v_company_type_id, 'Phone',           'phone',           'phone',        false, false, false, false, 6,  'Basic info'),
    (p_tenant_id, v_company_type_id, 'Address',         'address',         'long_text',    false, false, false, false, 7,  'Basic info'),
    (p_tenant_id, v_company_type_id, 'Status',          'status',          'select',       false, true,  false, true,  8,  'Classification'),
    (p_tenant_id, v_company_type_id, 'Tags',            'tags',            'multi_select', false, false, false, true,  9,  'Classification'),
    (p_tenant_id, v_company_type_id, 'Notes',           'notes',           'long_text',    false, false, false, false, 10, 'Additional');

  UPDATE field_definitions SET options = '{"choices": ["Media", "Publishing", "Broadcasting", "Digital", "Advertising", "Technology", "Other"]}'
  WHERE entity_type_id = v_company_type_id AND slug = 'industry';

  UPDATE field_definitions SET options = '{"choices": ["1-10", "11-50", "51-200", "201-1000", "1000+"]}'
  WHERE entity_type_id = v_company_type_id AND slug = 'size';

  UPDATE field_definitions SET options = '{"choices": ["Active", "Prospect", "Churned", "Partner"]}'
  WHERE entity_type_id = v_company_type_id AND slug = 'status';

  UPDATE field_definitions SET options = '{"currency_code": "GBP"}'
  WHERE entity_type_id = v_company_type_id AND slug = 'annual_revenue';

  SELECT id INTO v_name_field_id FROM field_definitions
  WHERE entity_type_id = v_company_type_id AND slug = 'name';
  UPDATE entity_types SET name_field_id = v_name_field_id WHERE id = v_company_type_id;

  -- ========================================
  -- Entity type: Deal
  -- ========================================
  INSERT INTO entity_types (tenant_id, module_id, name, slug, description, icon, is_system)
  VALUES (p_tenant_id, v_crm_module_id, 'Deal', 'deal', 'Sales opportunities and pipeline', 'currency-pound', true)
  RETURNING id INTO v_deal_type_id;

  INSERT INTO field_definitions (tenant_id, entity_type_id, name, slug, field_type, is_required, is_system, is_searchable, is_filterable, display_order, group_name)
  VALUES
    (p_tenant_id, v_deal_type_id, 'Name',            'name',            'text',         true,  true,  true,  false, 1,  'Basic info'),
    (p_tenant_id, v_deal_type_id, 'Value',           'value',           'currency',     false, true,  false, true,  2,  'Financial'),
    (p_tenant_id, v_deal_type_id, 'Stage',           'stage',           'select',       true,  true,  false, true,  3,  'Pipeline'),
    (p_tenant_id, v_deal_type_id, 'Probability',     'probability',     'number',       false, false, false, true,  4,  'Pipeline'),
    (p_tenant_id, v_deal_type_id, 'Expected close',  'expected_close',  'date',         false, false, false, true,  5,  'Dates'),
    (p_tenant_id, v_deal_type_id, 'Actual close',    'actual_close',    'date',         false, false, false, false, 6,  'Dates'),
    (p_tenant_id, v_deal_type_id, 'Source',          'source',          'select',       false, false, false, true,  7,  'Classification'),
    (p_tenant_id, v_deal_type_id, 'Competitor',      'competitor',      'text',         false, false, true,  false, 8,  'Classification'),
    (p_tenant_id, v_deal_type_id, 'Notes',           'notes',           'long_text',    false, false, false, false, 9,  'Additional'),
    (p_tenant_id, v_deal_type_id, 'AI score',        'ai_score',        'ai_generated', false, false, false, false, 10, 'AI'),
    (p_tenant_id, v_deal_type_id, 'AI next action',  'ai_next_action',  'ai_generated', false, false, false, false, 11, 'AI');

  UPDATE field_definitions SET options = '{"choices": ["Prospecting", "Qualification", "Proposal", "Negotiation", "Closed won", "Closed lost"]}'
  WHERE entity_type_id = v_deal_type_id AND slug = 'stage';

  UPDATE field_definitions SET options = '{"precision": 0, "min": 0, "max": 100}'
  WHERE entity_type_id = v_deal_type_id AND slug = 'probability';

  UPDATE field_definitions SET options = '{"currency_code": "GBP"}'
  WHERE entity_type_id = v_deal_type_id AND slug = 'value';

  UPDATE field_definitions SET options = '{"choices": ["Inbound", "Outbound", "Referral", "Upsell", "Partner"]}'
  WHERE entity_type_id = v_deal_type_id AND slug = 'source';

  UPDATE field_definitions SET options = '{"prompt_template": "Score this deal from 1-100 based on stage, value, and activity recency. Return only the number.", "source_fields": ["stage", "value", "activities"]}'
  WHERE entity_type_id = v_deal_type_id AND slug = 'ai_score';

  UPDATE field_definitions SET options = '{"prompt_template": "Based on this deals current stage and recent activity, suggest the single most impactful next action in one sentence.", "source_fields": ["stage", "notes", "activities"]}'
  WHERE entity_type_id = v_deal_type_id AND slug = 'ai_next_action';

  SELECT id INTO v_name_field_id FROM field_definitions
  WHERE entity_type_id = v_deal_type_id AND slug = 'name';
  UPDATE entity_types SET name_field_id = v_name_field_id WHERE id = v_deal_type_id;

  -- ========================================
  -- Relationship fields (Contact → Company, Deal → Company, Deal → Contact)
  -- ========================================

  -- Contact.company → Company (many contacts belong to one company)
  INSERT INTO field_definitions (tenant_id, entity_type_id, name, slug, field_type, is_required, is_system, is_filterable, display_order, group_name, options)
  VALUES (p_tenant_id, v_contact_type_id, 'Company', 'company', 'relationship', false, true, true, 8, 'Work',
    jsonb_build_object('related_entity_type_id', v_company_type_id, 'relationship_type', 'many_to_one'));

  INSERT INTO relationships (tenant_id, name, source_entity_type_id, target_entity_type_id, relationship_type, cascade_delete)
  VALUES (p_tenant_id, 'Company contacts', v_company_type_id, v_contact_type_id, 'one_to_many', false);

  -- Deal.company → Company
  INSERT INTO field_definitions (tenant_id, entity_type_id, name, slug, field_type, is_required, is_system, is_filterable, display_order, group_name, options)
  VALUES (p_tenant_id, v_deal_type_id, 'Company', 'company', 'relationship', false, true, true, 12, 'Linked records',
    jsonb_build_object('related_entity_type_id', v_company_type_id, 'relationship_type', 'many_to_one'));

  INSERT INTO relationships (tenant_id, name, source_entity_type_id, target_entity_type_id, relationship_type, cascade_delete)
  VALUES (p_tenant_id, 'Company deals', v_company_type_id, v_deal_type_id, 'one_to_many', false);

  -- Deal ↔ Contact (many-to-many)
  INSERT INTO field_definitions (tenant_id, entity_type_id, name, slug, field_type, is_required, is_system, is_filterable, display_order, group_name, options)
  VALUES (p_tenant_id, v_deal_type_id, 'Contacts', 'contacts', 'relationship', false, true, false, 13, 'Linked records',
    jsonb_build_object('related_entity_type_id', v_contact_type_id, 'relationship_type', 'many_to_many'));

  INSERT INTO relationships (tenant_id, name, source_entity_type_id, target_entity_type_id, relationship_type, cascade_delete)
  VALUES (p_tenant_id, 'Deal contacts', v_deal_type_id, v_contact_type_id, 'many_to_many', false);

  -- Owner fields (user type)
  INSERT INTO field_definitions (tenant_id, entity_type_id, name, slug, field_type, is_required, is_system, is_filterable, display_order, group_name)
  VALUES
    (p_tenant_id, v_contact_type_id, 'Owner', 'owner', 'user', false, true, true, 15, 'Assignment'),
    (p_tenant_id, v_company_type_id, 'Owner', 'owner', 'user', false, true, true, 15, 'Assignment'),
    (p_tenant_id, v_deal_type_id,    'Owner', 'owner', 'user', false, true, true, 15, 'Assignment');

  -- ========================================
  -- Default layouts
  -- ========================================

  -- Contact list view
  INSERT INTO layouts (tenant_id, entity_type_id, layout_type, name, is_default, config)
  VALUES (p_tenant_id, v_contact_type_id, 'list', 'Default contact list', true, '{
    "columns": [
      {"field": "first_name", "width": 140, "sortable": true},
      {"field": "last_name", "width": 140, "sortable": true},
      {"field": "email", "width": 200},
      {"field": "company", "width": 180, "sortable": true},
      {"field": "status", "width": 100, "filterable": true},
      {"field": "owner", "width": 140, "filterable": true}
    ],
    "default_sort": {"field": "last_name", "direction": "asc"},
    "row_actions": ["edit", "delete"],
    "bulk_actions": ["delete", "export", "assign"]
  }');

  -- Contact detail view
  INSERT INTO layouts (tenant_id, entity_type_id, layout_type, name, is_default, config)
  VALUES (p_tenant_id, v_contact_type_id, 'detail', 'Default contact detail', true, '{
    "sections": [
      {"title": "Basic info", "columns": 2, "fields": ["first_name", "last_name", "email", "phone", "mobile"]},
      {"title": "Work", "columns": 2, "fields": ["company", "job_title", "department"]},
      {"title": "Classification", "columns": 2, "fields": ["status", "source", "tags", "owner"]},
      {"title": "Notes", "columns": 1, "fields": ["notes"]},
      {"title": "AI insights", "columns": 1, "fields": ["ai_summary"]}
    ],
    "sidebar": {
      "sections": [
        {"type": "activity_timeline"},
        {"type": "related_records", "entity_type": "deal"}
      ]
    }
  }');

  -- Company list view
  INSERT INTO layouts (tenant_id, entity_type_id, layout_type, name, is_default, config)
  VALUES (p_tenant_id, v_company_type_id, 'list', 'Default company list', true, '{
    "columns": [
      {"field": "name", "width": 200, "sortable": true},
      {"field": "industry", "width": 140, "filterable": true},
      {"field": "size", "width": 100, "filterable": true},
      {"field": "annual_revenue", "width": 140, "sortable": true},
      {"field": "status", "width": 100, "filterable": true},
      {"field": "owner", "width": 140, "filterable": true}
    ],
    "default_sort": {"field": "name", "direction": "asc"},
    "row_actions": ["edit", "delete"],
    "bulk_actions": ["delete", "export"]
  }');

  -- Deal list view (pipeline)
  INSERT INTO layouts (tenant_id, entity_type_id, layout_type, name, is_default, config)
  VALUES (p_tenant_id, v_deal_type_id, 'list', 'Default deal list', true, '{
    "columns": [
      {"field": "name", "width": 200, "sortable": true},
      {"field": "company", "width": 180, "sortable": true},
      {"field": "value", "width": 120, "sortable": true},
      {"field": "stage", "width": 130, "filterable": true},
      {"field": "expected_close", "width": 130, "sortable": true},
      {"field": "owner", "width": 140, "filterable": true}
    ],
    "default_sort": {"field": "expected_close", "direction": "asc"},
    "row_actions": ["edit", "delete"],
    "bulk_actions": ["delete", "export"]
  }');

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
