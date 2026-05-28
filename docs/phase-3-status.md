# Phase 3 — progress status

Per-task tracker for `docs/phase-3-plan.md`. Updated at the end of each
working session. Reading this + `docs/phase-3-plan.md` + `CLAUDE.md` is
enough context to pick up Phase 3 work in a fresh session — no
conversation-history replay needed.

## Status as of 2026-05-28

`origin/main` HEAD: `7b8ddc4` (Task 0.4 commit).
Working tree clean. CI green.

### Phase 1a — Framework + basic CRM

| # | Task | Status | Tests added | Notes |
|---|---|---|---|---|
| 0.0 | Test harness | ✓ Complete | 3 (DB smoke) | vitest 4 + RTL/jsdom for components; per-package configs orchestrated by turbo; `withTestTransaction` rolls back; `test.fails()` for not-yet-implemented contracts |
| 0.1 | Package structure | ✓ Complete | — | `module-framework`, `ai-service`, `crm` packages stood up with full types + constants; engine fns stub `not implemented`; AI cost calc is real |
| 0.2 | Field engine | ✓ Complete | +60 | Migration `003-add-field-labels.sql` (applied locally, deferred on RDS); CRUD + `coerceFieldValue` (13 types + 6 Phase 2+ pass-through); validation boundary documented at top of `field-engine.ts` |
| 0.3 | Layout engine | ✓ Complete | +21 | CRUD + default-config generation + structural+reference validation; system-field-style protections (last-layout refusal, layoutType-scoped, default demotion) |
| 0.4 | Dynamic form renderer | ✓ Complete | +15 (+1 expected-fail still) | 13 field components + UnsupportedField; client component takes data as props (server-component wrapper deferred to Task 0.6); explicit-locale Intl.* throughout; @testing-library/react + jsdom plumbed |
| 0.5 | Dynamic table renderer | **Not started** | — | Plan was requested at task spec time; not yet submitted. Next session opens here. |
| 0.6 | Entity registration & module activation | Not started | — | Will provide the server-component wrapper for `<DynamicForm>` |
| 1.1 | CRM schema + permission matrix | Not started | — | Constants exist in `packages/crm/`; this task wires the seed |
| 1.2 | CRM API routes | Not started | — | Skeleton test in `apps/web/__tests__/api/crm-accounts.test.ts` is still expected-fail |
| 1.3 | CRM list pages | Not started | — | |
| 1.4 | CRM detail pages | Not started | — | |
| 1.6a | Dashboard (3 widgets) | Not started | — | |
| 1.9a | Existing-tenant idempotent reprovision | Not started | — | Supersedes the Phase 2 placeholder CRM permissions (contacts/companies/deals/ai) |

**Cumulative test count: 100** across 5 task suites:

- `@adserve/database` — 3 (harness smoke)
- `@adserve/module-framework` — 60 (field engine) + 21 (layout engine) = 81
- `@adserve/ai-service` — 0 (stubs only; tests land with Task 0.7/0.8)
- `@adserve/crm` — 0 (constants only; tests land with Task 1.1)
- `@adserve/web` — 15 component tests + 1 expected-fail integration test = 16

### Phase 1b — AI + advanced UI

Untouched. Tasks 0.7, 0.8, 1.5, 1.6b, 1.7, 1.8 all not started.

## Deferred items

- **Production migration of `003-add-field-labels.sql` on RDS.** Local
  dev has the `labels jsonb` column applied; production does not. Needs
  a fresh bastion + the migrator role, same pattern as the Phase 2 RLS
  application. Blocking before Phase 1a final ship — not blocking any
  in-progress task.
- **Server-component `<DynamicForm>` wrapper** that fetches via the
  entity-registry. Deferred to Task 0.6 (which builds the registry).
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

## Next session opens with

**Task 0.5 — Dynamic table renderer.** Per the plan §0.5: build the
`<DynamicTable entityTypeId={...} />` component that lists records with
configurable columns, field-type-aware filtering, JSONB sorting via
`(data->>'field_slug')::<type>` casts, offset pagination, archived-row
toggle, per-user column preferences saved.

Same approach as Task 0.4: plan first, then implement, with the
existing test harness + DB helpers ready to use.

## Reading order for a fresh Claude session

1. `CLAUDE.md` (root) — project orientation, AWS state, RLS notes
2. `docs/phase-3-plan.md` — full Phase 3 plan, scope, sequencing
3. `docs/phase-3-status.md` — this doc, pick up where work stopped
4. Relevant package README only when working in that package

No conversation history replay required. Pick the next-not-started
task from the table above and follow the existing protocol: plan →
approve → implement → tests → commit.
