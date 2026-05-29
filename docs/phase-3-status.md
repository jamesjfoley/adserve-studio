# Phase 3 — progress status

Per-task tracker for `docs/phase-3-plan.md`. Updated at the end of each
working session. Reading this + `docs/phase-3-plan.md` + `CLAUDE.md` is
enough context to pick up Phase 3 work in a fresh session — no
conversation-history replay needed.

## Status as of 2026-05-29

`origin/main` HEAD: `8d04d30` (unchanged — nothing pushed since).
Local `main` HEAD: `90f94454196ba91a5e1afb1d7e981917e4e82d03` (Task 1.2,
merged locally via earlier flatten). Currently on branch
`task/1.4-crm-detail-pages` (Tasks 1.3 + 1.4 + 1.3b committed here; ahead
of local `main`). Cumulative tests: **223, zero expected-fail**; lint
clean; tsc clean. **Next task to begin: Task 1.6a — CRM dashboard
(3 widgets).**

### Phase 1a — Framework + basic CRM

| # | Task | Status | Tests added | Notes |
|---|---|---|---|---|
| 0.0 | Test harness | ✓ Complete | 3 (DB smoke) | vitest 4 + RTL/jsdom for components; per-package configs orchestrated by turbo; `withTestTransaction` rolls back; `test.fails()` for not-yet-implemented contracts |
| 0.1 | Package structure | ✓ Complete | — | `module-framework`, `ai-service`, `crm` packages stood up with full types + constants; engine fns stub `not implemented`; AI cost calc is real |
| 0.2 | Field engine | ✓ Complete | +60 | Migration `003-add-field-labels.sql` (applied locally, deferred on RDS); CRUD + `coerceFieldValue` (13 types + 6 Phase 2+ pass-through); validation boundary documented at top of `field-engine.ts` |
| 0.3 | Layout engine | ✓ Complete | +21 | CRUD + default-config generation + structural+reference validation; system-field-style protections (last-layout refusal, layoutType-scoped, default demotion) |
| 0.4 | Dynamic form renderer | ✓ Complete | +15 (+1 expected-fail still) | 13 field components + UnsupportedField; client component takes data as props (server-component wrapper now owned by 1.3/1.4); explicit-locale Intl.* throughout; @testing-library/react + jsdom plumbed |
| 0.5 | Dynamic table renderer | ✓ Complete | +23 (7 operators, 16 component) | Controlled, props-driven `<DynamicTable>` in `apps/web/src/components/dynamic-table/`. Extracted shared `formatFieldValue` (dynamic-form) + refactored all 13 field components to consume it (single source of truth → consistency test). Sort/filter eligibility centralised in `operators.ts`. Filters draft→Apply (single emit path). Column visibility controlled-with-default. a11y: aria-sort + labelled controls |
| 0.6 | Entity type registration & CRM module activation | ✓ Complete | +18 (9 framework, 8 crm, 1 web smoke) | Framework primitive `provisionEntityType` (entity + missing fields + default `detail` layout + `nameFieldId`) + entity-registry stubs implemented + CRM orchestrator `activateCrmForTenant` (entity types, fields, default layouts, relationships, pipeline stages + `schemaVersion` into every CRM entity's `settings`). Idempotent (registry `ON CONFLICT DO NOTHING`; fields top-up by slug; relationships SELECT-then-INSERT). Wired into `/api/dev/provision-tenant`. Added `many_to_one` to `relationship_type` enum (migration `004`, applied locally, deferred on RDS). **NOT** in 0.6: server-component wrappers (→1.3/1.4), `ai_usage_limits` seeding (→0.8), CRM permission rows + role grants (→**1.1** seeds rows + grants; **1.9a** migrates the live DB), `validation_rules` seeding (→until `createValidationRule` adapter is implemented) |
| 1.1 | CRM permission matrix wiring (constants already exist) | ✓ Complete | +4 (1 seed guard, 3 crm perm/grant) | Constants already shipped in `packages/crm/` (Task 0.1) — this task wrote **no new constants**, it wired the seed/grants. Scope: extend `activateCrmForTenant` to (a) upsert the **21** global CRM `permissions` rows (`module_id=crm`) from `CRM_PERMISSIONS` and (b) grant them per `DEFAULT_CRM_ROLE_PERMISSIONS` (owner 21 / admin 21 / member 7); remove the Phase-2 placeholder CRM block from `db:seed`. `ai_usage.read` (22nd perm) is **owned by 0.8**, not 1.1. **Behavioral change:** `pnpm db:seed` no longer pre-creates CRM perms — they appear at tenant activation. Live-DB placeholder deletion + grant migration remains **1.9a** |
| 1.2 | CRM API routes | ✓ Complete | +23 web (25 CRM-API total; crm-accounts skeleton → real) | RESTful `/api/crm/[entityType]` (+`[id]`): list (JSONB filter/sort/offset+total), detail (relationships expanded), create, patch, archive; plus `leads/[id]/convert`, `accounts/[id]/activities`, generic `activities` POST. Plural collection URLs via `resolveCrmEntitySlug` (`@adserve/crm/url`). `withTenant()` + explicit `tenantId` predicate (correct-by-construction RLS — **not** added to the legacy 44-site `task_rls_production_switchover` debt). Member edit-own override on PATCH/DELETE (null `ownedBy` → strict perm). Audit-log writes (first writer). `crm-accounts.test.ts` rewritten as a **real passing** integration test (skeleton flipped, dodgy cast removed → tsc clean). **NOT** in 1.2: `validation_rules` enforcement (engine stubbed — `coerceFieldValue` only), generic relationship linking on create/patch (→1.4), pages/wrappers (→1.3/1.4) |
| 1.3 | CRM list pages | ✓ Complete | +8 web (4 round-trip, 3 client wrapper, 1 long_text truncation) | Scope (James-approved 2026-05-29): dynamic `/crm/[entityType]` server pages + `<DynamicTable>` server-component wrapper (query DB directly via `lib/crm/query.ts`; default columns) + state↔URL client wrapper + "New" record `<DynamicForm>` modal + nav cleanup to the 4 Phase-3 entities. Also owns the **live-render verify of `long_text` cell truncation** (CSS clamp, full text in DOM). **Deferred out of 1.3 (James-approved):** bulk actions → **Task 1.3b**; owner filter → **Task 1.3b**; per-user column persistence → **Phase 1b** (plan §499–501; the `<DynamicTable>` controllable-with-default seam from decision #15 makes it free later) |
| 1.4 | CRM detail pages | ✓ Complete | +21 web (5 record-title, 6 detail-capabilities, 10 detail-client) | Dynamic `/crm/[entityType]/[id]` server page: `loadEntityForm` (shared server-component form wrapper, also retro-fitted into the 1.3 list page — mechanical lift, no behaviour change) → `<DynamicForm>` view default / edit behind `canEdit`; related-records sidebar (generic off the relationships map, links via `crmCollectionSegment`); activity timeline (per-record direct query, gated on `activity.read`); quick actions: log activity (modal → `POST /api/crm/activities`), convert (leads, routes to the new account), archive. **No new API routes, no schema/migration** — reads server-side, writes via the 1.2 routes → zero new RLS debt, zero RDS-deferred. Capability derivation extracted to pure `computeRecordCapabilities` (mirrors 1.2 `canMutate`: perm OR owner; null `ownedBy` never grants). **NOT** in 1.4: generic relationship editing from the form (1.2 deferred generic rel writes), bulk/owner filter (→1.3b), per-user layout (→Phase 1b), AI summarise (→Phase 1b) |
| 1.3b | CRM list bulk actions + owner filter (follow-up) | ✓ Complete | +26 web (5 table-selection, 12 owner-filter, 9 bulk route) | Row selection in `<DynamicTable>` (`selectable`/`selectedIds`/`defaultSelectedIds`/`onSelectionChange` + checkbox column with select-all + indeterminate; checkbox clicks `stopPropagation` so `onRowClick` never fires — the controllable-with-default seam from decision #15). Bulk endpoint `POST /api/crm/[entityType]/bulk` (`assignOwner`/`changeStatus`/`archive`): **strict permission gate, no owner override** (update for assign/status, delete for archive); all-or-nothing (count-checked recordIds, zero writes on a bad/cross-tenant id); idempotent (skips rows already in target state); audit one row per real change. Owner filter on the `records.ownedBy` **column** (token `me`/`unassigned`/`<userId>`, `me` resolved server-side) via `resolveOwnerFilter` + `buildWhere` extension; threaded through `parseListParams`/`stateToQuery`. List page loads active members (`lib/crm/members.ts`) for the owner dropdown + bulk assign picker. `changeStatus` takes a validated `field` param (default `status`, must be single-select) — generic, not hardcoded (account/contact/lead use `status`, opportunity `stage`). **Deferred (unchanged):** per-user saved filters → Phase 1b; bulk hard-delete → never. |
| 1.6a | Dashboard (3 widgets) | Not started | — | |
| 1.9a | Existing-tenant idempotent reprovision | Not started | — | Calls `activateCrmForTenant` (0.6/1.1) per existing CRM-enabled tenant (idempotent — seeds perms + grants). 1.9a's **unique** job: **delete** the live Phase-2 placeholder CRM permission rows (contacts/companies/deals/ai) + **migrate** any role grants on them. (1.1 already stopped seeding placeholders going forward.) |

**Cumulative test count: 223** across 5 task suites (zero expected-fail):

- `@adserve/database` — 3 (harness smoke) + 1 (seed permission regression guard) = 4
- `@adserve/module-framework` — 60 (field engine) + 21 (layout engine) + 9 (5 entity-registry + 4 provisioning) = 90
- `@adserve/ai-service` — 0 (stubs only; tests land with Task 0.7/0.8)
- `@adserve/crm` — 8 (CRM activation) + 3 (permission seeding + role grants) = 11
- `@adserve/web` — 118: 16 table + 15 form (39 component, incl. 1.3 long_text truncation verify) + 1 provision-activation smoke + 25 CRM API + 7 list-pages (4 stateToQuery round-trip, 3 crm-list-client) + 21 detail-pages (5 record-title, 6 detail-capabilities, 10 crm-detail-client) + 26 bulk/owner (5 table-selection, 12 owner-filter, 9 bulk route). **No expected-fail remaining.**

> **Test-suite note:** the full `pnpm test` (turbo, parallel) can still
> hit the documented flaky DB gate (`crm-records.test.ts` `beforeAll`
> contends on the shared single-connection local DB → `users_email_unique`).
> Deterministically green under serial execution
> (`vitest run --no-file-parallelism`) and in isolated per-file runs. This
> is the deferred flaky-gate item below, **not** a 1.4 regression (1.4 adds
> only pure + jsdom tests, no DB).

### Phase 1b — AI + advanced UI

Untouched. Tasks 0.7, 0.8, 1.5, 1.6b, 1.7, 1.8 all not started.

## Deferred items

- **Production migration of `003-add-field-labels.sql` on RDS.** Local
  dev has the `labels jsonb` column applied; production does not. Needs
  a fresh bastion + the migrator role, same pattern as the Phase 2 RLS
  application. Blocking before Phase 1a final ship — not blocking any
  in-progress task.
- **Server-component `<DynamicForm>` / `<DynamicTable>` wrappers** that
  fetch via the entity-registry. **Reassigned from 0.6 → 1.3 (table) /
  1.4 (form)** — 0.6 builds the registry/activation but renders no UI, so
  the wrappers belong with the pages that consume them.
- **`long_text` cell-truncation live-render verify** (CSS-only clamp,
  full text preserved in DOM). **Reassigned from 0.6 → 1.3** — only
  exercisable once a real list page renders multi-line content.
- **`ai_usage_limits` seeding on CRM activation** — owned by **0.8**
  (the table is created there, Phase 1b). `activateCrmForTenant` does not
  touch it.
- **CRM permission rows + per-tenant role grants** — owned by **1.1**
  (global rows) and **1.9a** (reprovision/placeholder cleanup), not by
  0.6's activation.
- **`validation_rules` seeding on activation** — deferred until the
  `createValidationRule` adapter is implemented (still stubbed from 0.2).
  Required-ness is carried by `field_definitions.isRequired` +
  `coerceFieldValue` in the meantime.
- **Migration `004-add-many-to-one-relationship-type.sql` on RDS.**
  Adds `many_to_one` to the `relationship_type` enum. Applied locally in
  Task 0.6; **not yet applied on RDS.** Blocking before any
  relationship-creating CRM activation runs against production — same
  bastion + migrator-role pattern as `003`.
- **Migration `005-add-task-activity-type.sql` on RDS.** Adds `task` to
  the `activity_type` enum (CRM logs call/email/meeting/**task**/note).
  Applied locally in Task 1.2; **not yet applied on RDS.** Blocking
  before the activities API runs against production — same pattern as
  `003`/`004`.
- **Flaky DB-test gate under parallel turbo** (found in Task 1.3, latent
  since 1.2). `pnpm test` runs each package's suite in parallel; the
  web + crm DB-integration suites share a single-connection local DB, so
  `crm-records.test.ts`'s `beforeAll` can intermittently contend and skip
  its tests (recovers on re-run; isolated per-package runs are
  deterministically green). Fix before relying on `pnpm test` as a CI
  gate: isolate per-suite test DBs, or serialise DB-bound test tasks
  (turbo concurrency / vitest `fileParallelism: false` for DB projects).
  Not caused by 1.3 (1.3 added only pure + jsdom tests).
- **Skeleton API-route test for `GET /api/crm/accounts`** — **resolved in
  Task 1.2**: rewritten from an expected-fail skeleton into a real
  passing integration test against the live route; the dodgy type cast is
  gone and `pnpm --filter @adserve/web exec tsc --noEmit` is now fully
  clean for the first time since Task 0.0.

## Key decisions made this session

1. **AI Option A** (JSON-format secret + AWS-managed rotation Lambda +
   ECS auto-redeploy) executed in step 22 with full chain verified.
   Per-tenant cost limit defaults to £50/mo equivalent in microdollars.
2. **CRM permissions: Option C** — 21 CRM permissions + 1 platform
   (`ai_usage.read`) = 22 total. Action granularity matches Phase 2
   convention (`read/create/update/delete` + capability-specific
   `lead.convert`, `pipeline.update`). 2-part `resource.action` naming.
3. **Single `records` table with JSONB `data` is canonical.** Phase 3
   plan revised to match — no hybrid system-fields-as-columns. The plan
   doc reflects this from commit `1686f0d` onward.
4. **Activities are first-class** — separate `activities` table linked
   to records via `recordId` + `entityTypeId`, not a 5th CRM record
   type. CRM has 4 record types (account, contact, lead, opportunity).
5. **Phase 1a / Phase 1b split** — basic CRM CRUD shippable as 1a
   without AI, pipeline kanban, or admin field/layout UI. 1b layers
   those on.
6. **Offset pagination for Phase 1.** Cursor pagination deferred until
   real scale appears.
7. **Streaming AI responses deferred entirely.** CloudFront buffering
   risk outweighs UX gain at current scale.
8. **Rate limiting deferred entirely.** Metering captures everything;
   adding Redis for one feature is overkill.
9. **CRM "contracts" file skipped for Phase 1.** Will define when the
   second module arrives and drives the API.
10. **Soft-delete semantics fixed**: archived records stay in the
    relationship graph with a visual indicator; list views filter by
    default with a toggle; no auto-purge.
11. **Schema-truthful field type names** — `long_text` (not
    `textarea`), `multi_select` (not `multiselect`). Surfaced during
    Task 0.2 implementation when Drizzle inferred type vs hand-written
    union diverged.

### Task 0.5 decisions

12. **`formatFieldValue` is the single source of truth for read-only
    value rendering.** Extracted to
    `components/dynamic-form/format-field-value.tsx`; all 13 field
    components' view branches now call it, and `<DynamicTable>` cells
    call it too. The consistency test renders the same field/value/locale
    through `<DynamicForm>` view mode and a table cell and asserts
    identical text. Output is un-truncated; table cells clamp via CSS
    (`line-clamp`) so textContent — and thus the guarantee — is stable.
13. **Sort + filter eligibility centralised in `operators.ts`.**
    `operatorsForType` / `isFilterable` / `isSortable`. multi_select and
    relationship are neither sortable (no scalar `::type` cast) nor
    freely filterable — multi_select gets has/has-not only; relationship
    filtering deferred.
14. **Filter emit = explicit Apply/Clear, single emit path.** The filter
    bar drafts locally; `onFiltersChange` fires only on Apply (or Clear),
    never per keystroke — one server COUNT+query per committed change.
    Debounce rejected. `between` validates `from ≤ to` inline and blocks
    Apply. "Include archived" is committed through the same Apply.
15. **Column visibility is controllable-with-default** (the
    `value`/`defaultValue` pattern): internal state by default, opt into
    control via `visibleColumns` + `onVisibleColumnsChange`. Avoids an
    internal→controlled rewrite when per-user column persistence lands in
    Phase 1b (per plan §499–501; **not** a 1.3 deliverable).
16. **`<DynamicTable>` is controlled + presentation-only.** Sort, filter,
    pagination state are owned by the parent and emitted via callbacks;
    the component never queries. Actual JSONB sort/filter + COUNT
    pagination are Task 1.2's server responsibility.

### Task 0.6 decisions

17. **Activation split**: generic `provisionEntityType` in
    module-framework (entity + missing fields + default layout +
    `nameFieldId`); CRM-specific orchestration in
    `@adserve/crm/activate.ts` (`activateCrmForTenant`). CRM gained
    `drizzle-orm` as a runtime dep for the relationship inserts.
18. **`relationship_type` enum gained `many_to_one`** (migration `004`).
    The CRM relationships store source = the "many" side / target = the
    "one" side (the orientation the plan's query examples use), which had
    no faithful enum value before. "Fix the framework, not the module."
    Applied locally; RDS apply deferred (see deferred items).
19. **Relationship idempotency = SELECT-then-INSERT** on
    `(tenantId, sourceEntityTypeId, targetEntityTypeId, relationshipType)`
    — no DB unique constraint added (keeps 0.6 to one enum migration).
    Entity types use `ON CONFLICT DO NOTHING` (existing unique index);
    fields top up by slug; settings merge is only-if-absent (never
    clobbers tenant customisation). Re-running activation is a no-op.
20. **`schemaVersion` stamped on every CRM entity's `settings`** (not
    just opportunity) so future migrations can target individual
    entities. `CRM_SCHEMA_VERSION = 1`.
21. **Route tests get a `DATABASE_URL` default** in the web vitest
    config (local dev DB when unset) so handlers that use the app client
    (`withSuperAdminBypass`) connect to the same DB as the test-helpers'
    `testDb`. Real/CI `DATABASE_URL` is respected.

### Task 1.1 decisions

22. **CRM permission rows + role grants live in `activateCrmForTenant`**
    (Option A), sourced from the canonical `CRM_PERMISSIONS` /
    `DEFAULT_CRM_ROLE_PERMISSIONS` in `@adserve/crm` — no duplication, no
    `database → crm` circular dep. Global perm rows upserted on
    `(module_id, resource, action)`; grants idempotent on the
    `role_permissions` PK; grants only to roles that exist for the tenant.
23. **`db:seed` no longer creates module permissions.** The Phase-2
    placeholder CRM block (contacts/companies/deals/ai) was removed; CRM
    perms now appear at tenant activation. The seed was refactored into an
    importable `seed(database)` (in `seed/index.ts`) + a `seed/run.ts`
    runner (so it's testable without `process.exit`). A regression-guard
    test asserts `seed()` creates zero CRM permission rows. Grep confirmed
    the placeholder resource names were referenced **only** in the seed
    block — nothing else depended on them.
24. **`ai_usage.read` deferred to 0.8.** 1.1 ships exactly the 21 CRM
    perms; the platform `ai_usage.read` (the 22nd) is owned by 0.8, per
    `ai-service/src/permissions.ts`'s own annotation.
25. **Live-DB placeholder cleanup stays 1.9a.** 1.1 only stops *seeding*
    placeholders going forward; deleting the rows that already exist in
    live DBs + migrating their grants is 1.9a's unique job.

### Task 1.2 decisions

26. **Plural collection URLs** (`/api/crm/accounts`) mapped to singular
    entity slugs via `resolveCrmEntitySlug` in `@adserve/crm/url` (shared
    with 1.3/1.4). The `[entityType]` param accepts plural or singular.
27. **JSONB query builder** (`apps/web/src/lib/crm/query.ts`): sort/filter
    honour the `operators.ts` eligibility vocabulary server-side; slugs
    validated against field defs; values are bound params; casts from a
    fixed allowlist. Verified storage shapes: currency `{amount,currency}`
    → sort/filter on `data->slug->>'amount'`; multi_select top-level
    string array → `data->slug ? value`.
28. **Permission at the route layer**; tenant isolation via `withTenant()`
    **+ explicit `tenantId` predicate** (dev superuser bypasses RLS, so the
    predicate is load-bearing today). CRM routes are correct-by-construction
    — **not** part of the legacy 44-site `task_rls_production_switchover`.
29. **Member edit-own override** on PATCH/DELETE: allowed if the user has
    the perm OR `record.ownedBy === userId`. **Null `ownedBy` never grants
    via the override** — falls back to the strict permission check (tested).
30. **`activity_type` enum gained `task`** (migration `005`, applied local,
    deferred RDS). Audit-log shape defined in `lib/crm/audit.ts`: create →
    `{after}`, update → `{before,after}`, archive → `{before,after}`,
    convert → one row per created entity + one for the lead status change;
    activities write **no** audit rows.
31. **Relationship reads are query-bounded** — `loadRecordWithRelationships`
    fans out in ≤4 queries regardless of N related records (asserted).
    Generic relationship *writes* on create/patch deferred to 1.4; 1.2
    writes links only in `lead.convert`.

### Task 1.4 decisions

32. **No new API routes; reads server-side, writes via 1.2 routes.** The
    detail page is a server component that loads the record + relationships
    + activities directly inside `withTenant` (same pattern as the 1.3 list
    page). All mutations reuse the 1.2 routes (PATCH/DELETE
    `/api/crm/[entityType]/[id]`, `POST /api/crm/activities`, `POST
    /api/crm/leads/[id]/convert`). Consequence: **zero new RLS debt, zero
    new RDS-deferred migrations** — 1.4 adds no schema.
33. **`<DynamicForm>` server wrapper = `loadEntityForm`** (`lib/crm/`):
    resolves entity + field defs + `detail` layout (generated fallback).
    Consumed by both the detail page (view/edit) and — retro-fitted — the
    1.3 list page (the "New" form). The list-page refactor was a
    behaviour-preserving mechanical lift (entity/fields/layout resolution
    only); list query, param parsing, and column intersection untouched.
34. **Timeline is a per-record direct query**, ordered `desc(createdAt)`,
    **gated on its own `activity.read` permission** (a user may read the
    record without seeing activity). Deliberately NOT the account-aggregate
    endpoint `GET /api/crm/accounts/[id]/activities` — that answers a
    different question (activity across an account's related records) and
    stays available for a future roll-up view.
35. **Capability derivation extracted to pure `computeRecordCapabilities`**
    (`lib/crm/detail-capabilities.ts`) so the UI gate and the API
    `canMutate` agree and the rules are unit-tested. Edit/archive = perm OR
    record ownership; **null `ownedBy` never grants via ownership**. Convert
    is lead-only + strictly `lead.convert`-gated (no owner override) and
    hidden once `status === "converted"`.
36. **Convert routes to the new account** (uses the 201 response's
    `account.id`) rather than bare-refreshing the now-converted lead;
    surfaces the 409 `already_converted` distinctly.
37. **Activity `body` is JSONB `{ text? }`** (confirmed against the schema +
    the 1.2 route). The log-activity modal sends `body: { text }`; the
    timeline renders `body.text` and tolerates an empty `{}`. There is **no
    `dueDate` column** on `activities` (that concept is 1.6a, and would live
    in `metadata` if anywhere).
38. **Related-record sidebar labels are presentation-only heuristics**
    (`data.name` → `firstName lastName` → id), not driven by each related
    type's `nameFieldId` — avoids extra per-type field queries for 1.4.
    Relationship-type fields still render raw ids in `<DynamicForm>` view
    (known 0.4 gap); the sidebar provides the human-readable view.

### Task 1.3b decisions

39. **Bulk is strict-permission-gated — NO per-record owner override.**
    Single-record PATCH/DELETE allow edit-own (`canMutate`); bulk does not.
    Bulk is a cross-record admin action (reassigning/archiving a page of
    records) where partial-success on ownership is ambiguous — so it
    requires the real `${slug}.update` / `${slug}.delete` and is
    all-or-nothing. **This asymmetry with the single-record routes is
    deliberate** (don't "fix" it).
40. **One `/bulk` endpoint with an `action` discriminator**
    (`assignOwner`/`changeStatus`/`archive`) — shares recordId resolution,
    the tenant/entity isolation check, and the audit loop. Plural→singular
    via `resolveCrmEntitySlug` like every CRM route (decision #26).
41. **All-or-nothing + count check is the isolation guard.** The fetch is
    `WHERE tenantId AND entityTypeId AND id IN (...)`; if the returned count
    ≠ unique recordIds, the batch fails with `{missing}` and **zero writes**
    (dev superuser bypasses RLS, so this explicit predicate + count is
    load-bearing — same posture as decision #28; **not** added to the
    44-site RLS debt). Idempotent: rows already in the target state are
    skipped, so `updated` counts real changes and no redundant audit rows
    are written.
42. **`changeStatus` takes a validated `field` param (default `status`),
    required to be single-select** (`select`). Generic, not hardcoded —
    account/contact/lead carry `status`, opportunity `stage`; both are
    `select` fields. Value validated via `coerceFieldValue`. Keeps CRM
    field knowledge out of the generic route ("fix the framework, not the
    module").
43. **`assignOwner` validates the target is an active tenant member**
    (`lib/crm/members.ts`), and **`ownedBy: null` unassigns** (the inverse
    of the `unassigned` owner filter). **Known gap (logged, not fixed
    here):** the create route (`POST /api/crm/[entityType]`) accepts
    `body.ownedBy` **without** this membership validation — create and
    bulk-assign therefore disagree on legal owners. Candidate cleanup for a
    later task; intentionally out of 1.3b scope.
44. **Owner filter is on the `records.ownedBy` column, not a JSONB field**
    — so it lives outside the field-driven filter bar as a dedicated
    dropdown. Tokens `me`/`unassigned`/`<userId>`; `me` is resolved
    server-side from the session (keeps the URL shareable). `buildWhere`
    gained an optional resolved `ownerFilter` arg (back-compatible).

## Next session opens with

**Task 1.6a — CRM dashboard (3 widgets).** (1.3 + 1.4 + 1.3b complete —
see their rows.) `/crm` index route with: (1) pipeline value by stage
(bar chart summing opportunity amounts grouped by stage), (2) upcoming
activities next 7 days (list, ascending), (3) recently modified records
(last 10, any entity, tenant-wide). Funnel + forecast are Phase 1b.
Then 1.9a (existing-tenant idempotent reprovision) closes Phase 1a.

(Historical note: Task 1.3's scope was finalised with James on
2026-05-29 — bulk actions + owner filter split to **Task 1.3b**;
per-user column persistence stays **Phase 1b** per plan §499–501, *not*
1.3, correcting an earlier reassignment note. 1.3 translates
`<DynamicTable>` state → the 1.2 query-param contract
`offset`/`limit`/`includeArchived`/JSON `sort`/JSON `filters`, and uses
plural URLs from `@adserve/crm/url`.)

## Reading order for a fresh Claude session

1. `CLAUDE.md` (root) — project orientation, AWS state, RLS notes
2. `docs/phase-3-plan.md` — full Phase 3 plan, scope, sequencing
3. `docs/phase-3-status.md` — this doc, pick up where work stopped
4. Relevant package README only when working in that package

No conversation history replay required. Pick the next-not-started
task from the table above and follow the existing protocol: plan →
approve → implement → tests → commit.
