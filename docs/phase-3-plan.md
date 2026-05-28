# Phase 3 — Module Framework + CRM Module

Source of truth for the work that builds AdServe Studio's first business module
(CRM) on a reusable module framework, plus the AI service layer that all
future modules will share. Supersedes any earlier Phase 3 drafts.

This plan reflects:
- The actual Phase 2 schema (single `records` table with JSONB `data`, no
  per-entity-type tables, `activities` as a first-class table, etc.).
- The Phase 2 query patterns (`withTenant()` / `withSuperAdminBypass()`,
  RLS active on RDS).
- Phase 1a / 1b split — a shippable basic CRM ahead of AI features.

---

## Executive summary

We build two interlocked things together so the framework is designed by
having a real consumer:

- **Module framework** — application code on top of the existing schema
  primitives (`entity_types`, `field_definitions`, `layouts`,
  `validation_rules`, `records`, `record_relationships`, `relationships`,
  `activities`). Provides field engine, layout engine, dynamic form +
  table renderers, entity type registration, module activation.
- **CRM module** — first consumer. Accounts, Contacts, Leads,
  Opportunities, plus activities. Built on the framework — when something
  doesn't fit, we fix the framework, not the module.

**The schema is already in place.** Phase 3 is mostly application code, not
schema design. Additions needed: one column (`field_definitions.labels`),
three new tables for AI metering, three RLS policies.

### Phase 1a / Phase 1b split

| Phase | End state | Tasks |
|---|---|---|
| **1a** — Framework + basic CRM | Tenant can create/list/edit Accounts, Contacts, Leads, Opportunities through dynamic forms and tables. Default field definitions and layouts apply. Dashboard shows 3 widgets. No AI yet. Pipeline kanban not yet. Tenant admin can't customize fields yet. | 0.0–0.6, 1.1–1.4, 1.6a, 1.9a |
| **1b** — AI + advanced UI | AI service layer live with usage metering. 4 AI capabilities (NL record creation, field suggestion, activity summary, smart search). Pipeline kanban. Dashboard has funnel + forecast widgets. Tenant admin can manage custom fields and layouts. | 0.1b, 0.7, 0.8, 1.5, 1.6b, 1.7, 1.8 |

Phase 1a is a shippable usable CRM on its own. Phase 1b layers AI and
advanced UX on top.

---

## Architecture

### Records data model

There is **one** `records` table for every entity type in every module.
Per `packages/database/src/schema/records.ts`:

```ts
records: {
  id, tenantId, entityTypeId,
  data: jsonb,             // all field values live here
  createdBy, updatedBy, ownedBy,
  isArchived: boolean,
  createdAt, updatedAt,
}
```

`field_definitions` declares the schema for `data` per entity type. The
app layer enforces field types and validation rules; PostgreSQL only sees
JSONB. This is closer to "JSONB with schema metadata" than the hybrid
EAV/relational model — the GIN index on `records.data` keeps tenant-scoped
queries fast.

**Activities are not records.** The `activities` table is dedicated and
stores polymorphic activity log entries linked to any record via
`recordId` + `entityTypeId`. CRM has only 4 record-typed entities
(account, contact, lead, opportunity); activities have their own table,
schema, and API patterns.

### Relationships between records

Two records linking to each other (e.g. an opportunity belonging to an
account) goes through `record_relationships`, typed by a row in
`relationships`:

- `relationships` row defines that "Opportunity → Account" is a valid
  relationship type in this tenant (source entity type, target entity
  type, kind).
- `record_relationships` row stores the actual link: source record id,
  target record id, metadata.

Querying "all opportunities for account X" is `records JOIN
record_relationships ON record_relationships.source_record_id = records.id
WHERE record_relationships.target_record_id = ?` — not a JSONB scan. Well
indexed via `idx_record_rels_source` / `idx_record_rels_target`.

### Soft delete

`records.isArchived` boolean is the soft-delete flag.

- Archived records **stay in the relationship graph.** If an account is
  archived, its contacts still resolve the relationship — UI shows the
  account with a visual indicator (e.g. greyed out, "(archived)"
  suffix).
- Dynamic list views filter `isArchived = false` by default, with a toggle
  in the filter UI to include archived rows.
- No auto-purge. Archived records are retained indefinitely.
- Audit log retention: indefinite for now.

### AI service architecture

All AI calls in the platform flow through a single service. Modules
declare a *capability*; the service maps that to a model, a prompt
template, and a metered call.

```
packages/
  ai-service/
    src/
      client.ts          Anthropic SDK wrapper, retry, timeout, error classification
      metering.ts        Usage recording, limit enforcement
      cost.ts            Model pricing constants; cost calculation
      models.ts          Model selection by capability (config-driven, not hardcoded)
      types.ts           Shared types
      prompts/
        record-creation.ts
        field-suggestion.ts
        activity-summary.ts
        smart-search.ts
```

Modules don't choose models. They call
`aiService.complete({ tenantId, userId, module, capability, messages })`
and the service routes to the right model with the right prompt template.

**Model selection by capability** (initial mapping; values read from env
or config table, not hardcoded constants):

| Capability | Model class | Why |
|---|---|---|
| `field_suggestion` | Haiku-tier | Sub-second response for inline UI |
| `record_creation` | Sonnet-tier | Parsing NL into structured fields |
| `activity_summary` | Sonnet-tier | Quality matters for summaries users read |
| `smart_search` | Sonnet-tier | Field-type-aware filter generation |
| (future) `complex_analysis` | Opus-tier | Reserved |

Actual model name strings (e.g. `claude-sonnet-4-…`) come from
configuration so changing them later does not require code changes.

**Streaming is not implemented in Phase 1b.** CloudFront in front of the
ALB buffers responses; the fragility outweighs the UX gain at this scale.
All four AI capabilities use non-streaming responses.

**Rate limiting is not implemented in Phase 1b.** Per-tenant rate limits
across multiple ECS tasks require a shared counter store (Redis), which
we do not have. Usage metering captures every call, so a runaway tenant
is detectable before it gets expensive. We add rate limiting if real
usage reveals a need.

### AI usage metering

Three new tables, all **RLS-protected** (added to the 14 in
`001-enable-rls.sql`, bringing the total to 17). Same access patterns as
every other tenant-scoped table: tenant routes use `withTenant()`,
super-admin routes use `withSuperAdminBypass()`.

```sql
ai_usage_log {
  id uuid pk, tenant_id uuid (RLS), user_id uuid,
  module text, capability text, model text,
  input_tokens int, output_tokens int, total_tokens int,
  cost_micros bigint,          -- microdollars; 1 USD = 1,000,000 micros
  duration_ms int,
  status text,                  -- 'success' | 'error' | 'rate_limited' | 'over_limit'
  error_message text nullable,
  request_metadata jsonb,
  created_at timestamptz
}

ai_usage_summary {
  id uuid pk, tenant_id uuid (RLS),
  period_start date, period_end date,
  total_tokens bigint, total_cost_micros bigint, request_count int,
  breakdown jsonb,              -- per-module, per-capability
  updated_at timestamptz,
  UNIQUE (tenant_id, period_start)
}

ai_usage_limits {
  id uuid pk, tenant_id uuid (RLS, UNIQUE),
  monthly_token_limit bigint nullable,
  monthly_cost_limit_micros bigint NOT NULL,  -- seeded to £50/mo equivalent
  updated_at timestamptz
}
```

Cost is recorded per-call in microdollars (Anthropic bills in USD).
GBP-display conversion is presentation-layer and deferred (no live FX in
Phase 1b).

**Default cost limit: £50/month equivalent per tenant**, seeded on
module activation. Super admin can raise/lower per tenant via the
existing super-admin UI.

### Multi-language & multi-currency — baked in, not active

- `field_definitions` gets a new column `labels jsonb` (migration in Task
  0.2): `{ "en": "Annual Revenue", "fr": "Revenu Annuel" }`. UI reads
  `labels[currentLocale]` with `en` fallback. Phase 1 only populates
  `en`. Locale source-of-truth is `Accept-Language` header for now;
  user-preference column TBD when activation is needed.
- Currency fields store `{ amount: 50000, currency: "GBP" }`. Display
  formatting respects the currency code. Default is GBP; any ISO-4217
  code is valid from day one. No FX rates stored yet — when summing
  across currencies, sum stays in the source currency until conversion
  is required.

### Contracts file (cross-module API)

**Not in Phase 1.** The pattern of declaring each module's public API for
other modules to consume only makes sense when there are two modules.
When the second module arrives, we'll define CRM's contract by what that
module actually needs. YAGNI applies.

---

## Permissions matrix

**Naming convention** (from existing Phase 2 seed): permissions are
stored as `(module_id, resource, action)` tuples and checked at runtime
as a 2-part dotted string `${resource}.${action}` (e.g.
`ctx.permissions.has("account.read")`). The module is the FK on
`permissions.module_id`, not encoded in the check string. Action
granularity follows the existing pattern (`read/create/update/delete`)
rather than collapsing create+update into `write`.

CRM permissions are added to the `permissions` table during activation
(Task 1.1's seed). The platform-level `ai_usage.read` is added to the
existing platform-permissions block in `packages/database/src/seed/index.ts`.

### CRM-scoped permissions (21, `module_id = crm`)

| Resource | Actions |
|---|---|
| `account` | `read`, `create`, `update`, `delete` |
| `contact` | `read`, `create`, `update`, `delete` |
| `lead` | `read`, `create`, `update`, `delete`, `convert` |
| `opportunity` | `read`, `create`, `update`, `delete` |
| `pipeline` | `read`, `update` (update = move opportunities between stages) |
| `activity` | `read`, `create` (no edit/delete on logged activities in Phase 1) |

### Platform-level permissions added by Phase 3 (1)

| Resource | Action | Description |
|---|---|---|
| `ai_usage` | `read` | View the tenant's own AI usage stats (`/admin/ai-usage`) |

**Total Phase 3 permission additions: 22** (21 CRM-scoped + 1 platform).

### Existing Phase 2 CRM permissions — superseded

Phase 2's seed (`packages/database/src/seed/index.ts`) created placeholder
CRM permissions for an earlier entity design: `contacts/companies/deals`
with actions `read/create/update/delete/export` plus `ai/use`. These are
already in the live database and granted to the existing test tenant's
Owner role.

Task 1.9a's idempotent reprovisioning **deletes the Phase 2 placeholder
permissions and reseeds with the Phase 3 matrix above**, then migrates
any role grants on the old permission rows.

### Default role assignments (Task 1.1's seed)

- **Owner** — all 22 permissions, plus `tenant.admin` from Phase 2.
- **Admin** — all 22 Phase 3 permissions; same Phase 2 admin perms
  except `tenant.admin`.
- **Member** — read-only on CRM entities + create activities:
  `account.read`, `contact.read`, `lead.read`, `opportunity.read`,
  `pipeline.read`, `activity.read`, `activity.create` (7 perms).
  Row-level "edit records you own" is enforced at the route layer, not
  the permission matrix.

---

## Phase 1a — Framework + basic CRM

### Task 0.0 — Test harness

Cheap insurance before the framework lands.

- vitest installed at workspace root, runnable as `pnpm test`
- Test pattern for the database package: spin a local Postgres via
  docker-compose or `pg-mem`, run migrations, run tests against it
- Test pattern for Next.js route handlers: import the handler, call with
  a mock NextRequest, assert response
- A `tests/fixtures/tenant.ts` helper that creates a fresh tenant + user
  with admin role for use in integration tests
- One smoke test per pattern so future tasks can copy-paste

### Task 0.1 — Package structure

Create the two new workspace packages.

```
packages/
  module-framework/        Shared framework engine
    src/
      field-engine.ts
      layout-engine.ts
      entity-registry.ts
      validation.ts        Adapter to the existing validation_rules table
      types.ts
    package.json           @adserve/module-framework
  ai-service/              Created as part of Phase 1b — skeleton only here
    package.json           @adserve/ai-service (stub)
```

Both depend on `@adserve/database`. `apps/web` adds both as workspace
deps. No code in `ai-service` yet — just the package.json shell so the
workspace layout is settled.

### Task 0.2 — Field definition engine

Application code on the existing `field_definitions` table. Migration:

```sql
ALTER TABLE field_definitions
  ADD COLUMN labels jsonb NOT NULL DEFAULT '{}';
```

(Backfill existing rows with `{"en": <name>}` so the UI has something
to render.)

Engine responsibilities:

- CRUD for field definitions per (tenant, entity type)
- Type catalog from the existing `fieldTypeEnum` (text, number, currency,
  date, datetime, boolean, select, multiselect, email, phone, url,
  textarea, relationship)
- Type coercion on write: ensure `records.data[field.slug]` matches the
  declared `fieldType`
- Locale-aware label resolution: `field.labels[locale] ?? field.labels.en ?? field.name`
- System field protection: `isSystem = true` fields cannot be deleted,
  only renamed (display label change via `labels`)
- Field deletion guard: if any records have data for this field's slug,
  refuse delete and return count. Tenant admin must confirm "delete
  field and orphan N records' data" via an explicit flag.
- Integration with `validation_rules`: write helper that creates a
  default required-rule when `isRequired = true` on the field; the rule
  engine reads from `validation_rules`, not `field_definitions`

### Task 0.3 — Layout engine

Application code on the existing `layouts` table.

- CRUD for layouts per (tenant, entity type, layout type)
- Layout config shape:
  ```ts
  {
    sections: [
      { title: string, columns: 1 | 2 | 3, fieldIds: string[] }
    ]
  }
  ```
- Validation on write: every referenced fieldId must exist for this
  entity type
- Default-layout generation: when a new entity type is created with N
  fields, build a default 2-column layout
- API for reordering sections, moving fields between sections, adding/
  removing sections — all atomic updates to the `config` JSONB

### Task 0.4 — Dynamic form renderer

React component that renders a record form from a layout config + field
definitions.

- `<DynamicForm entityTypeId={...} recordId={...} mode="view"|"edit"|"create" />`
- Section rendering: title, column grid, field components in declared
  order
- Per-field-type input components: text, number, currency, date,
  datetime, boolean, select, multiselect, email, phone, url, textarea,
  relationship picker
- Validation: client-side from field definitions for immediate feedback;
  server-side enforcement on save via the `validation_rules` engine
- Relationship picker: searches `records` filtered by target entity type
- Archived records shown with visual indicator when surfaced via
  relationships

### Task 0.5 — Dynamic table renderer

React component that lists records with configurable columns.

- `<DynamicTable entityTypeId={...} />`
- Column selection: user picks from available fields for that entity
  type
- Sorting on JSONB fields via `(data->>'field_slug')::<type>`
- Filtering: field-type-aware operators (text contains/equals, number
  gt/lt/between, date before/after/range, select is/isNot, boolean is)
- **Offset pagination** for Phase 1; cursor pagination deferred
- Default filter `isArchived = false` with toggle in the filter UI
- Archived rows have visual indicator (greyed out, badge)
- Per-user column preferences saved (new column on `users` or a
  dedicated `user_preferences` table — decide in task)

### Task 0.6 — Entity type registration & module activation

When CRM is activated for a tenant (via the existing
`tenant_modules.enabled = true` flow):

- Insert entity type rows for: account, contact, lead, opportunity
- Insert default field definitions per entity type (see Task 1.1)
- Insert default layouts (one per entity type, layoutType=`detail`)
- Insert default relationships (Contact→Account, Opportunity→Account,
  Opportunity→Contact)
- Insert default pipeline stages as a custom-typed configuration row
  (location TBD: could be entity_types.settings JSONB)
- Insert default CRM permissions into the tenant's role grants
- Seed a row in `ai_usage_limits` with the default £50/mo cost limit

Idempotent: re-running activation for a tenant that already has CRM
must not duplicate rows. Uses `ON CONFLICT DO NOTHING` on natural keys
((tenant_id, slug) for entity_types, etc.).

### Task 1.1 — CRM schema definitions

This is a code task, not a database migration — the schema is generic
and lives in `records`/`field_definitions`. What we define:

`packages/crm/src/schema-definitions.ts`:

- Entity type slugs and metadata for account, contact, lead, opportunity
- Default field definitions per entity type (system fields + starter
  custom fields)
- Default layouts per entity type
- Default relationships
- Default pipeline stages
- Permission matrix (see above) — written as data, seeded into
  `permissions` table

**Field definitions per entity type:**

- **Account** — `name` (text, required, isSystem), `website` (url),
  `industry` (select), `status` (select: active/inactive/prospect),
  `phone` (phone), `email` (email), `address` (JSONB structured),
  `annualRevenue` (currency), `employeeCount` (number),
  `description` (textarea)
- **Contact** — `firstName` (text, required, isSystem), `lastName`
  (text, required, isSystem), `email` (email), `phone` (phone),
  `title` (text), `status` (select), `department` (text),
  `linkedinUrl` (url), `notes` (textarea). `accountId` lives in
  `record_relationships`, not as a field.
- **Lead** — `firstName`, `lastName`, `email`, `company` (text),
  `source` (select), `status` (select: new/contacted/qualified/
  converted/lost), `estimatedValue` (currency), `notes` (textarea)
- **Opportunity** — `name` (text, required, isSystem), `stage` (select
  from pipeline stages), `amount` (currency), `closeDate` (date),
  `probability` (number 0-100), `description` (textarea),
  `nextStep` (text), `lostReason` (select). `accountId` and
  `contactId` via `record_relationships`.

`ownedBy` and timestamps come from `records` columns directly, not
field definitions.

### Task 1.2 — CRM API routes

RESTful API per entity type:

- `GET /api/crm/[entityType]` — list with filtering, sorting,
  pagination (offset)
- `GET /api/crm/[entityType]/[id]` — single record with relationships
  expanded
- `POST /api/crm/[entityType]` — create; validates against field
  definitions and validation_rules
- `PATCH /api/crm/[entityType]/[id]` — update
- `DELETE /api/crm/[entityType]/[id]` — sets `isArchived = true`

Plus CRM-specific endpoints:

- `POST /api/crm/leads/[id]/convert` — single transaction: create
  account record, create contact record, create opportunity record,
  link them via `record_relationships`, set lead.status = "converted"
- `GET /api/crm/accounts/[id]/activities` — activities timeline scoped
  to one account (and via relationships, to its contacts and
  opportunities)
- `POST /api/crm/activities` — log activity against any record

All routes:
- Use `withTenant()` for RLS
- Require the appropriate permission via `apiRequirePermission()`
- Write audit log entries on every mutation (existing `audit_log` table)
- Return 200/201/204 with consistent error shapes

### Task 1.3 — CRM list pages

For each entity type (accounts, contacts, leads, opportunities):

- `/crm/[entityType]` route, server component
- `<DynamicTable>` with CRM-specific default columns
- Sidebar filters: status, owner, date range
- Bulk actions: assign owner, change status, archive
- "New" button → modal or full-page form using `<DynamicForm>` in
  create mode

Phase 1a covers the **default** experience — no per-user column
customization (deferred to Phase 1b along with the field/layout admin
UI).

### Task 1.4 — CRM detail pages

For each entity type:

- `/crm/[entityType]/[id]` route, server component
- `<DynamicForm>` in view mode by default, edit mode behind permission
- Related records sidebar:
  - Account: list of contacts, opportunities
  - Contact: parent account, related opportunities
  - Lead: convert button
  - Opportunity: parent account, contact, activities
- Activity timeline component (reads `activities` filtered by recordId)
- Quick actions: log activity (call, email, meeting, task, note)

### Task 1.6a — CRM dashboard (3 widgets)

`/crm` index route with three widgets:

1. **Pipeline value by stage** — bar chart, sums opportunity amounts
   grouped by stage
2. **Upcoming activities (next 7 days)** — list of activities with
   `dueDate` in the next week, sorted ascending
3. **Recently modified records** — last 10 records (any entity type)
   updated by anyone in the tenant

Funnel chart and revenue forecast are Phase 1b.

### Task 1.9a — Existing tenant idempotent provisioning

Phase 2 already activated CRM for "Katherine's Organization." The
activation flow in Task 0.6 must work idempotently for them:

- Re-running activation does not duplicate entity types, fields,
  layouts, relationships, permissions, or `ai_usage_limits`
- A new schema-version field on `entity_types.settings` records which
  Phase shipped that type. When Phase 3 lands, all existing tenants
  with CRM enabled get re-provisioned via a one-off CLI script that
  calls the activation function for each.

### Phase 1a milestone

- pnpm lint, pnpm test, pnpm build all green
- A tenant with CRM enabled can:
  - Navigate to `/crm/accounts`, see a table (empty initially)
  - Create an account, contact, lead, opportunity via the dynamic form
  - View/edit any record
  - See activities timeline on a record
  - Archive a record; archived rows hidden by default, visible with
    toggle
  - Convert a lead end-to-end
  - See the dashboard with the 3 widgets populated
- Existing tenant ("Katherine's Organization") works with the new CRM
  with no manual DB intervention

---

## Phase 1b — AI + advanced UI

### Task 0.1b — ai-service package skeleton fills out

The package created as a stub in Task 0.1 now gets real code.

### Task 0.7 — AI service layer

`packages/ai-service/src/`:

- `client.ts` — Anthropic SDK wrapper:
  - Reads API key from `process.env.ANTHROPIC_API_KEY`
  - Retry on retryable errors (5xx, overloaded), respects `retry-after`
  - 30-second timeout on individual requests
  - Returns structured `{ ok: true, response } | { ok: false, error: {...} }` — never throws past the service boundary
- `models.ts` — capability → model mapping, read from env (e.g.
  `AI_MODEL_FIELD_SUGGESTION=claude-haiku-…`). Defaults baked but
  overridable per environment.
- `prompts/` — one file per capability, exports `systemPrompt` and
  `buildUserPrompt(input)`. Versioned via a string constant; future
  changes increment.
- `cost.ts` — pricing constants per model, function to compute
  microdollars from `input_tokens` + `output_tokens`. Constants
  reviewed quarterly against Anthropic's pricing page.

**Infra prerequisites (one-time):**

1. Create secret `adserve/anthropic-api-key` in Secrets Manager
   (eu-west-2)
2. Add to ECS task definition `secrets:` block
3. Add the secret ARN to the task IAM role's
   `secretsmanager:GetSecretValue` resource list
4. **Don't enable rotation** on this secret — Anthropic has no rotation
   API equivalent. Manual rotation only.
5. Update GitHub Actions deploy workflow if the task def is templated
   there

### Task 0.8 — AI usage metering & limits

Three new tables, all added to the RLS-protected set in
`packages/database/sql/001-enable-rls.sql`:

- `ai_usage_log` (RLS by tenant_id)
- `ai_usage_summary` (RLS by tenant_id)
- `ai_usage_limits` (RLS by tenant_id)

Application code in `packages/ai-service/src/metering.ts`:

- Before every API call: check `ai_usage_summary` for current period vs
  `ai_usage_limits.monthly_cost_limit_micros`. If over, return
  `{ ok: false, error: { code: 'over_limit' } }` without making the
  call. Record the attempt in `ai_usage_log` with `status =
  'over_limit'`.
- After a successful response: write to `ai_usage_log` (one row per
  call). Update `ai_usage_summary` for the current period
  (UPSERT-style).
- After an error response: still write to `ai_usage_log` with `status =
  'error'` and `error_message` populated. Don't update the summary.

API endpoints:

- `GET /api/admin/ai-usage` — current tenant's usage (last N days,
  rolling). Requires `ai_usage.read`.
- `GET /api/super-admin/ai-usage` — platform-wide list of tenants by
  usage
- `GET /api/super-admin/ai-usage/[tenantId]` — drill-in for one tenant
- `PATCH /api/super-admin/ai-usage/[tenantId]/limits` — adjust limits

Super-admin UI page `/super-admin/ai-usage` and tenant page
`/admin/ai-usage` follow the existing super-admin / tenant-admin layout
patterns.

### Task 1.5 — Pipeline kanban

`/crm/pipeline` route:

- Columns = pipeline stages (from per-tenant config)
- Cards show: opportunity name, account (via relationship), amount,
  close date, probability
- Drag and drop to change `data.stage`
- Per-column summary header: count and total amount
- Filter bar: date range, owner, account

### Task 1.6b — Dashboard funnel + forecast widgets

Add two widgets to the existing dashboard from Task 1.6a:

4. **Lead conversion funnel** — counts of leads at each stage
   (new → contacted → qualified → converted), as a funnel chart
5. **Revenue forecast** — sum of (opportunity.amount × probability/100)
   for opportunities with close date in the next 30/60/90 days

### Task 1.7 — AI features (4 capabilities)

All four use the AI service layer. All are metered. All return
non-streaming JSON responses.

#### 1.7a — Natural language record creation

- User clicks "+ Create with AI" on any list page, types a free-form
  description
- AI parses to structured fields; UI shows pre-populated form for user
  to confirm
- Endpoint: `POST /api/crm/[entityType]/from-nl` body `{ prompt: string }`
- Metered as `module=crm, capability=record_creation`
- Model: configured Sonnet-tier

#### 1.7b — AI field suggestions

- On a create/edit form, blank field surfaces an "AI suggest" button
- Calls AI with context (other field values, entity type) → suggestion
  inline
- Endpoint: `POST /api/crm/[entityType]/suggest-field` body
  `{ recordContext: {...}, fieldSlug: string }`
- Metered as `module=crm, capability=field_suggestion`
- Model: configured Haiku-tier
- Phase 1b does NOT use web search to enrich (deferred)

#### 1.7c — Activity summarisation

- On account detail page: "Summarize recent activity" button
- AI reads last N activities for the account (and related records),
  returns a 2-3 paragraph summary
- Endpoint: `POST /api/crm/accounts/[id]/summarize`
- Metered as `module=crm, capability=activity_summary`
- Model: configured Sonnet-tier

#### 1.7d — Smart search

- Natural language query input on list pages
- AI translates query to dynamic table filter state
- Endpoint: `POST /api/crm/[entityType]/smart-search` body
  `{ query: string }`
- Returns structured filter state the table consumes (no separate
  search execution)
- Metered as `module=crm, capability=smart_search`
- Model: configured Sonnet-tier

### Task 1.8 — Tenant admin field/layout configuration UI

Three new tenant-admin pages:

- `/admin/crm/fields` — per-entity-type list of fields, with add/edit/
  reorder/delete. Uses field engine from Task 0.2.
- `/admin/crm/layouts` — per-entity-type layout editor with drag-and-
  drop sections and fields. Uses layout engine from Task 0.3.
- `/admin/crm/pipeline` — manage pipeline stages (add, rename, reorder,
  set default probability)

Each page requires `crm.admin` permission (added to the matrix in this
task).

### Phase 1b milestone

- All four AI capabilities working end-to-end with metering recorded
- Pipeline kanban functional with drag-and-drop stage changes
- Dashboard shows all 5 widgets
- Tenant admin can add a custom field to an entity type and see it
  appear in the dynamic form and table without code changes
- `/super-admin/ai-usage` shows platform-wide and per-tenant usage
- `/admin/ai-usage` shows the tenant's own usage
- All routes wrapped in `withTenant()` or `withSuperAdminBypass()`
- pnpm lint, pnpm test, pnpm build all green

---

## Development protocol

Same as Phase 2:

1. Read the task spec in this doc
2. Survey the relevant existing code
3. Confirm understanding back to the user: scope, files, dependencies,
   risks
4. Suggest improvements if any
5. Wait for explicit approval
6. After implementing, summarize and provide verification steps
7. User tests/confirms before the next task

### Context-loading strategy

For a future Claude Code session picking up Phase 3:

- `CLAUDE.md` — project orientation
- `docs/phase-3-plan.md` — this doc (source of truth)
- `docs/phase-3-status.md` — progress tracker (updated after each task)
- Relevant package README — when working in a specific package

No conversation-history replay needed.

---

## Task execution order

```
Phase 1a:
  0.0  Test harness
  0.1  Package structure (module-framework, ai-service stub)
  0.2  Field engine + labels migration
  0.3  Layout engine
  0.4  Dynamic form renderer
  0.5  Dynamic table renderer
  0.6  Entity type registration + module activation
  1.1  CRM schema definitions + permission matrix
  1.2  CRM API routes
  1.3  CRM list pages
  1.4  CRM detail pages
  1.6a Dashboard (3 widgets)
  1.9a Existing-tenant idempotent reprovision
       — Phase 1a milestone — ship —

Phase 1b:
  0.1b ai-service package skeleton fills out
  0.7  AI service layer
  0.8  AI usage metering + limits (RLS-protected tables + endpoints)
  1.5  Pipeline kanban
  1.6b Dashboard funnel + forecast widgets
  1.7  AI features:
       1.7a NL record creation
       1.7b Field suggestions
       1.7c Activity summarisation
       1.7d Smart search
  1.8  Tenant admin field/layout config UI
       — Phase 1b milestone —
```

Estimated effort:

- Phase 1a: ~3–4 weeks of focused work
- Phase 1b: ~3–4 weeks of focused work

---

## What this plan does NOT cover

- Bring Your Own Key for AI (architecture compatible, deferred)
- Email send/receive integration
- Calendar sync
- Import/export (CSV/Excel)
- Cross-entity reporting module
- Workflow automation (triggers, scheduled actions)
- Tenant API rate limiting (deferred to when real traffic justifies)
- Mobile-responsive polish (desktop-first for Phase 1)
- Multi-language UI activation (architecture ready, locale switching
  deferred)
- Multi-currency conversion rates (currency codes stored, no FX rates)
- Predictive AI (scoring, churn, auto-enrichment from external data)
- AI usage billing integration (metering captures data, billing system
  separate)
- Prompt caching / response caching (optimization for later)
- Streaming AI responses (deferred per CloudFront buffering concerns)
- Cursor pagination (deferred — offset is sufficient at current scale)
- Cross-module contracts file (defined when second module arrives)

---

## RLS-protected tables after Phase 3

Phase 2 had 14 tenant-scoped RLS-protected tables. Phase 3 adds 3:

- `ai_usage_log`
- `ai_usage_summary`
- `ai_usage_limits`

Total after Phase 3: **17 RLS-protected tables**. Update
`packages/database/sql/001-enable-rls.sql` in Task 0.8.
