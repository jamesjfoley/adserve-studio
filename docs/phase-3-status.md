# Phase 3 — progress status

Per-task tracker for `docs/phase-3-plan.md`. Updated at the end of each
working session. Reading this + `docs/phase-3-plan.md` + `CLAUDE.md` is
enough context to pick up Phase 3 work in a fresh session — no
conversation-history replay needed.

## Status as of 2026-05-29

`origin/main` HEAD: `8d04d30` (Phase 3 progress snapshot).
Task 0.5 implemented in the working tree (uncommitted at time of writing).

### Phase 1a — Framework + basic CRM

| # | Task | Status | Tests added | Notes |
|---|---|---|---|---|
| 0.0 | Test harness | ✓ Complete | 3 (DB smoke) | vitest 4 + RTL/jsdom for components; per-package configs orchestrated by turbo; `withTestTransaction` rolls back; `test.fails()` for not-yet-implemented contracts |
| 0.1 | Package structure | ✓ Complete | — | `module-framework`, `ai-service`, `crm` packages stood up with full types + constants; engine fns stub `not implemented`; AI cost calc is real |
| 0.2 | Field engine | ✓ Complete | +60 | Migration `003-add-field-labels.sql` (applied locally, deferred on RDS); CRUD + `coerceFieldValue` (13 types + 6 Phase 2+ pass-through); validation boundary documented at top of `field-engine.ts` |
| 0.3 | Layout engine | ✓ Complete | +21 | CRUD + default-config generation + structural+reference validation; system-field-style protections (last-layout refusal, layoutType-scoped, default demotion) |
| 0.4 | Dynamic form renderer | ✓ Complete | +15 (+1 expected-fail still) | 13 field components + UnsupportedField; client component takes data as props (server-component wrapper now owned by 1.3/1.4); explicit-locale Intl.* throughout; @testing-library/react + jsdom plumbed |
| 0.5 | Dynamic table renderer | ✓ Complete | +23 (7 operators, 16 component) | Controlled, props-driven `<DynamicTable>` in `apps/web/src/components/dynamic-table/`. Extracted shared `formatFieldValue` (dynamic-form) + refactored all 13 field components to consume it (single source of truth → consistency test). Sort/filter eligibility centralised in `operators.ts`. Filters draft→Apply (single emit path). Column visibility controlled-with-default. a11y: aria-sort + labelled controls |
| 0.6 | Entity type registration & CRM module activation | ✓ Complete | +18 (9 framework, 8 crm, 1 web smoke) | Framework primitive `provisionEntityType` (entity + missing fields + default `detail` layout + `nameFieldId`) + entity-registry stubs implemented + CRM orchestrator `activateCrmForTenant` (entity types, fields, default layouts, relationships, pipeline stages + `schemaVersion` into every CRM entity's `settings`). Idempotent (registry `ON CONFLICT DO NOTHING`; fields top-up by slug; relationships SELECT-then-INSERT). Wired into `/api/dev/provision-tenant`. Added `many_to_one` to `relationship_type` enum (migration `004`, applied locally, deferred on RDS). **NOT** in 0.6: server-component wrappers (→1.3/1.4), `ai_usage_limits` seeding (→0.8), CRM permission rows + role grants (→1.1/1.9a), `validation_rules` seeding (→until `createValidationRule` adapter is implemented) |
| 1.1 | CRM schema + permission matrix | Not started | — | Constants exist in `packages/crm/`; this task wires the seed. **Owns** the global CRM `permissions` rows + per-tenant role grants (`activateCrmForTenant` from 0.6 does NOT seed permissions) |
| 1.2 | CRM API routes | Not started | — | Skeleton test in `apps/web/__tests__/api/crm-accounts.test.ts` is still expected-fail |
| 1.3 | CRM list pages | Not started | — | **Now also owns:** the `<DynamicTable>` server-component wrapper (fetch via entity registry → feed the client component); per-user column-preference persistence into `visibleColumns`/`onVisibleColumnsChange`; and the **live-render verify of `long_text` cell truncation** (CSS `line-clamp`/`truncate`, full text preserved in DOM) — moved here from 0.6 as 0.6 renders no table |
| 1.4 | CRM detail pages | Not started | — | **Now also owns:** the `<DynamicForm>` server-component wrapper (fetch via entity registry → feed the client component) |
| 1.6a | Dashboard (3 widgets) | Not started | — | |
| 1.9a | Existing-tenant idempotent reprovision | Not started | — | Supersedes the Phase 2 placeholder CRM permissions (contacts/companies/deals/ai). Calls `activateCrmForTenant` (0.6) per existing CRM-enabled tenant + reseeds the permission matrix |

**Cumulative test count: 141** across 5 task suites:

- `@adserve/database` — 3 (harness smoke)
- `@adserve/module-framework` — 60 (field engine) + 21 (layout engine) + 9 (5 entity-registry + 4 provisioning) = 90
- `@adserve/ai-service` — 0 (stubs only; tests land with Task 0.7/0.8)
- `@adserve/crm` — 8 (CRM activation)
- `@adserve/web` — 39 passing (15 form + 23 table + 1 provision-activation smoke) + 1 expected-fail integration test = 40

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
- **Skeleton API-route test for `GET /api/crm/accounts`** still in
  expected-fail state. Will flip when Task 1.2 lands.

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
    Phase 1b (0.6 / 1.3).
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

## Next session opens with

**Task 0.6 — Entity type registration & CRM module activation.** Scope
(per the approved 0.6 plan):

- **module-framework**: implement the entity-registry stubs
  (`registerEntityType` idempotent on `(tenantId, slug)`,
  `getEntityTypeBySlug` tenant-scoped, `listEntityTypesForModule`) +
  a new generic `provisionEntityType(tx, spec)` (entity + missing field
  defs + default `detail` layout + `nameFieldId`).
- **@adserve/crm**: `activateCrmForTenant(tx, { tenantId })` mapping the
  CRM constants through `provisionEntityType`, creating the 3
  `relationships` rows, and writing pipeline stages + a `schemaVersion`
  stamp into **every** CRM entity's `entity_types.settings`. Idempotent.
- **wiring**: call `activateCrmForTenant` from `/api/dev/provision-tenant`
  after the module-enable step.

Explicitly out of 0.6 (see deferred items): server-component wrappers
(→1.3/1.4), `ai_usage_limits` (→0.8), CRM permission rows + role grants
(→1.1/1.9a), `validation_rules` seeding (→adapter impl).

`<DynamicTable>`/`<DynamicForm>` remain presentation + callbacks only —
the JSONB sort/filter via `(data->>'field_slug')::<type>` casts and
COUNT-over-filtered-set pagination land server-side in **Task 1.2**;
sort/filter eligibility per field type lives in
`apps/web/src/components/dynamic-table/operators.ts`.

## Reading order for a fresh Claude session

1. `CLAUDE.md` (root) — project orientation, AWS state, RLS notes
2. `docs/phase-3-plan.md` — full Phase 3 plan, scope, sequencing
3. `docs/phase-3-status.md` — this doc, pick up where work stopped
4. Relevant package README only when working in that package

No conversation history replay required. Pick the next-not-started
task from the table above and follow the existing protocol: plan →
approve → implement → tests → commit.
