# AdServe Studio — Platform foundation specification

## Overview

This document defines the data model and architectural patterns for the AdServe Studio platform foundation. Everything described here must be built and validated before any business module (CRM, Campaigns, etc.) is started.

The foundation comprises three interconnected systems:

1. **Tenant and identity layer** — multi-tenancy, authentication, users, roles, permissions
2. **Schema engine** — dynamic entity types, fields, layouts, validation, and record storage
3. **Module registry** — how business modules plug into the platform

## Design principles

### Tenant isolation is non-negotiable
Every row in every business table carries a `tenant_id`. PostgreSQL Row-Level Security (RLS) policies enforce isolation at the database level. Application code cannot bypass this — even a bug in a query cannot leak data across tenants.

### Schema-driven, not code-driven
Business entities (Contact, Company, Deal) are not hardcoded database tables. They are metadata records in the schema engine. A "Contact" is an `entity_type` row with associated `field_definition` rows. Contact records are stored in a generic `records` table with a JSONB `data` column. This means tenants can add fields, remove fields, rename entities, and create entirely new entity types without any code changes.

### JSONB for flexibility, indexes for performance
PostgreSQL JSONB provides the flexibility of a document database with the transactional guarantees of a relational database. GIN indexes on the JSONB `data` column allow efficient querying. For fields that need high-performance filtering or sorting (e.g., email, company name), we create expression indexes on specific JSONB paths.

### Permissions are additive
A user has no access by default. Permissions are granted through roles. Roles are scoped to a tenant. Module access is a permission like any other.

---

## Part 1: Tenant and identity layer

### Core tables

#### `tenants`
The top-level organisational unit. Every customer is a tenant.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| name | text | Display name |
| slug | text | URL-safe unique identifier |
| status | enum | `active`, `suspended`, `cancelled` |
| settings | jsonb | Tenant-level configuration (timezone, locale, branding) |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### `users`
Global user records. A user can belong to multiple tenants (e.g., a consultant working with several media groups).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| email | text | Unique, used for authentication |
| full_name | text | |
| avatar_url | text | Nullable |
| auth_provider_id | text | External ID from Clerk/Auth.js |
| status | enum | `active`, `invited`, `disabled` |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### `tenant_memberships`
Links users to tenants with a role. This is where tenant-scoped access is defined.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| tenant_id | uuid | FK → tenants |
| user_id | uuid | FK → users |
| role_id | uuid | FK → roles |
| status | enum | `active`, `invited`, `suspended` |
| invited_by | uuid | FK → users, nullable |
| invited_at | timestamptz | |
| joined_at | timestamptz | Nullable until accepted |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Unique constraint on `(tenant_id, user_id)` — a user has exactly one membership per tenant.

#### `roles`
Roles are tenant-scoped. Each tenant gets default roles on creation, and admins can create custom roles.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| tenant_id | uuid | FK → tenants |
| name | text | e.g., "Owner", "Admin", "Sales Rep" |
| slug | text | URL-safe, unique within tenant |
| description | text | |
| is_system | boolean | True for default roles that cannot be deleted |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Unique constraint on `(tenant_id, slug)`.

Default system roles created for every new tenant:
- `owner` — full access to everything, cannot be removed
- `admin` — full access except tenant deletion and billing
- `member` — access to assigned modules only

#### `permissions`
Granular permission definitions. These are global (not tenant-scoped) — they define what permissions exist in the system.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| module_id | uuid | FK → modules, nullable (null = platform-level) |
| resource | text | e.g., "contacts", "deals", "users", "settings" |
| action | text | e.g., "read", "create", "update", "delete", "export", "admin" |
| description | text | Human-readable description |

Unique constraint on `(module_id, resource, action)`.

Examples:
- `(crm, contacts, read)` — can view contacts
- `(crm, contacts, create)` — can create contacts
- `(null, users, admin)` — can manage users (platform-level)
- `(null, settings, admin)` — can manage tenant settings

#### `role_permissions`
Many-to-many link between roles and permissions.

| Column | Type | Notes |
|--------|------|-------|
| role_id | uuid | FK → roles |
| permission_id | uuid | FK → permissions |

Primary key on `(role_id, permission_id)`.

#### `modules`
Registry of available business modules.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| slug | text | Unique. e.g., "crm", "campaigns", "trafficking" |
| name | text | Display name |
| description | text | |
| version | text | Semantic version |
| status | enum | `active`, `coming_soon`, `deprecated` |
| icon | text | Icon identifier for the UI |
| display_order | integer | Ordering in navigation |

#### `tenant_modules`
Which modules a tenant has access to. Controls both licensing and navigation visibility.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| tenant_id | uuid | FK → tenants |
| module_id | uuid | FK → modules |
| enabled | boolean | Can be toggled without removing |
| settings | jsonb | Module-specific tenant configuration |
| enabled_at | timestamptz | |
| created_at | timestamptz | |

Unique constraint on `(tenant_id, module_id)`.

---

## Part 2: Schema engine

The schema engine is the heart of the platform. It allows tenants to define their own data structures without writing code.

### Entity system tables

#### `entity_types`
Defines the types of records a tenant can create. Pre-configured by modules, customisable by tenants.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| tenant_id | uuid | FK → tenants |
| module_id | uuid | FK → modules |
| name | text | Display name, e.g., "Contact" |
| slug | text | System name, e.g., "contact" |
| description | text | |
| icon | text | Icon identifier |
| name_field_id | uuid | FK → field_definitions. Which field is the "name" of a record |
| is_system | boolean | True if part of the default module schema |
| settings | jsonb | Entity-level config (default sort, enable activities, etc.) |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Unique constraint on `(tenant_id, slug)`.

#### `field_definitions`
Defines fields on an entity type. Each field has a type, validation rules, and display configuration.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| tenant_id | uuid | FK → tenants |
| entity_type_id | uuid | FK → entity_types |
| name | text | Display label, e.g., "Email address" |
| slug | text | System name used as JSONB key, e.g., "email" |
| field_type | enum | See field types below |
| is_required | boolean | |
| is_unique | boolean | Within tenant + entity type |
| is_system | boolean | True if part of default schema, cannot be deleted |
| default_value | jsonb | Default value for new records |
| options | jsonb | Type-specific config (see below) |
| display_order | integer | Ordering on forms and detail views |
| group_name | text | For grouping fields into sections |
| description | text | Help text shown to users |
| is_searchable | boolean | Include in full-text search |
| is_filterable | boolean | Show in filter UI |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Unique constraint on `(entity_type_id, slug)`.

**Field types:**

| Type | Description | Options example |
|------|-------------|-----------------|
| `text` | Single line text | `{ "max_length": 255 }` |
| `long_text` | Multi-line text / rich text | `{ "rich_text": true }` |
| `number` | Integer or decimal | `{ "precision": 2, "min": 0 }` |
| `currency` | Monetary value | `{ "currency_code": "GBP" }` |
| `date` | Date only | `{ "format": "DD/MM/YYYY" }` |
| `datetime` | Date and time | `{ "timezone_aware": true }` |
| `boolean` | True/false toggle | `{}` |
| `select` | Single select from options | `{ "choices": ["Hot","Warm","Cold"] }` |
| `multi_select` | Multiple selections | `{ "choices": ["Print","Digital","Events"] }` |
| `email` | Email with validation | `{}` |
| `phone` | Phone with formatting | `{ "default_country": "GB" }` |
| `url` | URL with validation | `{}` |
| `relationship` | Link to another entity type | `{ "related_entity_type_id": "uuid", "relationship_type": "many_to_one" }` |
| `user` | Reference to a platform user | `{ "allow_multiple": false }` |
| `file` | File attachment | `{ "allowed_types": ["pdf","docx"], "max_size_mb": 10 }` |
| `image` | Image attachment | `{ "max_size_mb": 5 }` |
| `json` | Arbitrary JSON data | `{}` |
| `computed` | Calculated from other fields | `{ "formula": "fields.quantity * fields.unit_price" }` |
| `ai_generated` | AI-populated field | `{ "prompt_template": "Summarise this contact's recent activity", "source_fields": ["notes","activities"] }` |

#### `relationships`
Explicit relationship definitions between entity types. Complements the `relationship` field type with metadata about the relationship itself.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| tenant_id | uuid | FK → tenants |
| name | text | e.g., "Company contacts" |
| source_entity_type_id | uuid | FK → entity_types |
| target_entity_type_id | uuid | FK → entity_types |
| relationship_type | enum | `one_to_one`, `one_to_many`, `many_to_many` |
| source_field_id | uuid | FK → field_definitions (the relationship field on source) |
| target_field_id | uuid | FK → field_definitions (optional reverse field on target) |
| cascade_delete | boolean | Delete related records when source is deleted |
| created_at | timestamptz | |

#### `layouts`
Page layout definitions. Controls how entity records are displayed and edited.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| tenant_id | uuid | FK → tenants |
| entity_type_id | uuid | FK → entity_types |
| layout_type | enum | `detail`, `list`, `create`, `edit`, `card` |
| name | text | e.g., "Default detail view" |
| is_default | boolean | Used when no specific layout is assigned |
| config | jsonb | Layout structure (see below) |
| assigned_roles | uuid[] | Which roles see this layout. Empty = all roles |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Layout config structure (detail view example):**
```json
{
  "sections": [
    {
      "title": "Basic information",
      "columns": 2,
      "fields": ["first_name", "last_name", "email", "phone"]
    },
    {
      "title": "Company details",
      "columns": 1,
      "fields": ["company", "job_title", "department"]
    }
  ],
  "sidebar": {
    "sections": [
      { "type": "activity_timeline" },
      { "type": "related_records", "entity_type": "deal" }
    ]
  }
}
```

**Layout config structure (list view example):**
```json
{
  "columns": [
    { "field": "full_name", "width": 200, "sortable": true },
    { "field": "company", "width": 180, "sortable": true },
    { "field": "email", "width": 220 },
    { "field": "status", "width": 100, "sortable": true, "filterable": true }
  ],
  "default_sort": { "field": "full_name", "direction": "asc" },
  "row_actions": ["edit", "delete"],
  "bulk_actions": ["delete", "export", "assign"]
}
```

#### `validation_rules`
Custom validation rules beyond simple field-level required/unique.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| tenant_id | uuid | FK → tenants |
| entity_type_id | uuid | FK → entity_types |
| name | text | e.g., "Close date required for won deals" |
| rule_type | enum | `field_level`, `record_level`, `cross_entity` |
| condition | jsonb | When this rule applies |
| action | jsonb | What happens when condition is met |
| error_message | text | Shown to users on validation failure |
| is_active | boolean | |
| created_at | timestamptz | |

**Condition/action examples:**
```json
// If deal stage is "Won", close_date must be set
{
  "condition": { "field": "stage", "operator": "equals", "value": "Won" },
  "action": { "type": "require_field", "field": "close_date" }
}

// If deal value > 100000, must have an approver assigned
{
  "condition": { "field": "value", "operator": "greater_than", "value": 100000 },
  "action": { "type": "require_field", "field": "approver" }
}
```

### Record storage

#### `records`
The main data table. All business records across all entity types are stored here.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| tenant_id | uuid | FK → tenants |
| entity_type_id | uuid | FK → entity_types |
| data | jsonb | The actual field values |
| created_by | uuid | FK → users |
| updated_by | uuid | FK → users |
| owned_by | uuid | FK → users (record owner for assignment) |
| is_archived | boolean | Soft delete |
| created_at | timestamptz | |
| updated_at | timestamptz | |

The `data` column stores field values keyed by field slug:
```json
{
  "first_name": "Sarah",
  "last_name": "Chen",
  "email": "sarah@example.com",
  "company": "rec_uuid_of_company_record",
  "status": "active",
  "tags": ["enterprise", "q4-target"],
  "annual_revenue": 5000000
}
```

**Indexes on `records`:**
- `(tenant_id, entity_type_id)` — base query for listing records of a type
- GIN index on `data` — enables JSONB containment queries
- Expression indexes on frequently queried paths, created dynamically when fields are marked `is_filterable`

#### `record_relationships`
Stores many-to-many relationships between records.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| tenant_id | uuid | FK → tenants |
| relationship_id | uuid | FK → relationships |
| source_record_id | uuid | FK → records |
| target_record_id | uuid | FK → records |
| metadata | jsonb | Relationship-specific data (e.g., role in deal) |
| created_at | timestamptz | |

Unique constraint on `(relationship_id, source_record_id, target_record_id)`.

#### `activities`
Activity log for records. Tracks changes, notes, emails, calls, and AI interactions.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| tenant_id | uuid | FK → tenants |
| record_id | uuid | FK → records |
| entity_type_id | uuid | FK → entity_types |
| activity_type | enum | `note`, `email`, `call`, `meeting`, `change`, `ai_action`, `system` |
| subject | text | |
| body | jsonb | Activity content, structure varies by type |
| performed_by | uuid | FK → users, nullable (null for system/AI activities) |
| metadata | jsonb | Additional data (e.g., field changes for `change` type) |
| created_at | timestamptz | |

---

## Part 3: Row-Level Security

Every table with a `tenant_id` column gets an RLS policy. Here is the pattern:

```sql
-- Enable RLS on the table
ALTER TABLE records ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (important!)
ALTER TABLE records FORCE ROW LEVEL SECURITY;

-- Policy: users can only see records in their tenant
CREATE POLICY tenant_isolation ON records
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- Policy: users can only insert records in their tenant
CREATE POLICY tenant_insert ON records
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
```

The application middleware sets the tenant context on every request:

```typescript
// Middleware pseudocode
async function tenantMiddleware(req, res, next) {
  const tenantId = req.auth.tenantId; // from JWT
  await db.execute(`SET LOCAL app.current_tenant = '${tenantId}'`);
  next();
}
```

`SET LOCAL` scopes the setting to the current transaction, so it automatically resets when the transaction completes. This prevents any tenant leakage between requests.

---

## Part 4: Default CRM schema package

When the CRM module is enabled for a tenant, the following entity types, fields, and layouts are automatically created. The tenant can modify all of these.

### Entity types

1. **Contact** — individual people
2. **Company** — organisations
3. **Deal** — sales opportunities
4. **Activity** — notes, calls, emails, meetings (uses the activities table)

### Contact fields (default)

| Field | Type | Required | System |
|-------|------|----------|--------|
| first_name | text | yes | yes |
| last_name | text | yes | yes |
| email | email | no | yes |
| phone | phone | no | no |
| mobile | phone | no | no |
| job_title | text | no | no |
| department | text | no | no |
| company | relationship (→ Company) | no | yes |
| status | select [Active, Inactive, Lead, Prospect] | no | yes |
| source | select [Web, Referral, Event, Cold Call, Inbound, Partner] | no | no |
| owner | user | no | yes |
| tags | multi_select | no | no |
| notes | long_text | no | no |
| last_contacted | datetime | no | no |
| ai_summary | ai_generated | no | no |

### Company fields (default)

| Field | Type | Required | System |
|-------|------|----------|--------|
| name | text | yes | yes |
| website | url | no | no |
| industry | select [Media, Publishing, Broadcasting, Digital, Advertising, Technology, Other] | no | no |
| size | select [1-10, 11-50, 51-200, 201-1000, 1000+] | no | no |
| annual_revenue | currency | no | no |
| phone | phone | no | no |
| address | long_text | no | no |
| status | select [Active, Prospect, Churned, Partner] | no | yes |
| owner | user | no | yes |
| tags | multi_select | no | no |
| notes | long_text | no | no |

### Deal fields (default)

| Field | Type | Required | System |
|-------|------|----------|--------|
| name | text | yes | yes |
| company | relationship (→ Company) | no | yes |
| contact | relationship (→ Contact) | no | yes |
| value | currency | no | yes |
| stage | select [Prospecting, Qualification, Proposal, Negotiation, Closed Won, Closed Lost] | yes | yes |
| probability | number (0-100) | no | no |
| expected_close | date | no | no |
| actual_close | date | no | no |
| owner | user | no | yes |
| source | select [Inbound, Outbound, Referral, Upsell, Partner] | no | no |
| competitor | text | no | no |
| notes | long_text | no | no |
| ai_score | ai_generated | no | no |
| ai_next_action | ai_generated | no | no |

### Default relationships

| Relationship | Type | Cascade |
|-------------|------|---------|
| Company → Contacts | one_to_many | no |
| Company → Deals | one_to_many | no |
| Contact → Deals | many_to_many | no |

---

## Part 5: AI integration points

The schema engine has built-in support for AI through two mechanisms:

### 1. AI-generated fields
Fields of type `ai_generated` are populated by Claude when a record is created or updated. The field definition includes a prompt template and source fields. Example:

```json
{
  "field_type": "ai_generated",
  "options": {
    "prompt_template": "Based on this contact's activity history and deal involvement, provide a 2-sentence summary of their relationship status and engagement level.",
    "source_fields": ["activities", "deals"],
    "refresh_trigger": "on_activity_added",
    "model": "claude-sonnet-4-20250514"
  }
}
```

### 2. AI actions (invoked by users)
Module-specific AI actions that users can trigger from the UI:

- **Summarise** — summarise a record's history and relationships
- **Draft email** — generate an email based on context
- **Score deal** — analyse a deal's likelihood of closing
- **Suggest next action** — recommend what to do next with a contact or deal
- **Enrich** — fill in missing fields from available data
- **Analyse** — answer ad-hoc questions about the data

These are registered per module and configured per tenant.

---

## Part 6: API structure

All APIs follow this pattern:

```
POST   /api/v1/:entityType              → create record
GET    /api/v1/:entityType              → list records (with filtering, sorting, pagination)
GET    /api/v1/:entityType/:id          → get single record
PATCH  /api/v1/:entityType/:id          → update record
DELETE /api/v1/:entityType/:id          → archive record

GET    /api/v1/schema/entity-types      → list entity types for current tenant
POST   /api/v1/schema/entity-types      → create new entity type (admin only)
GET    /api/v1/schema/entity-types/:id  → get entity type with fields
PATCH  /api/v1/schema/entity-types/:id  → update entity type

POST   /api/v1/admin/users              → invite user to tenant
GET    /api/v1/admin/users              → list tenant users
PATCH  /api/v1/admin/users/:id          → update user role/status
DELETE /api/v1/admin/users/:id          → remove user from tenant

POST   /api/v1/admin/roles              → create custom role
GET    /api/v1/admin/roles              → list roles
PATCH  /api/v1/admin/roles/:id          → update role permissions

POST   /api/v1/ai/action                → trigger an AI action on a record
GET    /api/v1/ai/actions               → list available AI actions
```

Tenant context is always derived from the authenticated user's JWT — never from URL parameters.

---

## Implementation order

1. Database schema creation (all tables, indexes, RLS policies)
2. Tenant CRUD + first tenant seeding
3. Auth integration (Clerk) + JWT tenant claims
4. User invitation and role assignment APIs
5. Schema engine APIs (entity types, fields, layouts)
6. Record CRUD APIs (generic, schema-driven)
7. Admin UI (tenant settings, user management, schema builder)
8. CRM default schema package installer
9. CRM-specific views (pipeline board, activity timeline)
10. AI integration layer
