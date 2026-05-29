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
| 0.4 | Dynamic form renderer | ✓ Complete | +15 (+1 expected-fail still) | 13 field components + UnsupportedField; client component takes data as props (server-component wrapper deferred to Task 0.6); explicit-locale Intl.* throughout; @testing-library/react + jsdom plumbed |
| 0.5 | Dynamic table renderer | ✓ Complete | +23 (7 operators, 16 component) | Controlled, props-driven `<DynamicTable>` in `apps/web/src/components/dynamic-table/`. Extracted shared `formatFieldValue` (dynamic-form) + refactored all 13 field components to consume it (single source of truth → consistency test). Sort/filter eligibility centralised in `operators.ts`. Filters draft→Apply (single emit path). Column visibility controlled-with-default. a11y: aria-sort + labelled controls |
| 0.6 | Entity registration & module activation | Not started | — | Will provide the server-component wrapper for `<DynamicForm>`; also the place to wire per-user column-preference persistence into `<DynamicTable>`'s `visibleColumns`/`onVisibleColumnsChange` |
| 1.1 | CRM schema + permission matrix | Not started | — | Constants exist in `packages/crm/`; this task wires the seed |
| 1.2 | CRM API routes | Not started | — | Skeleton test in `apps/web/__tests__/api/crm-accounts.test.ts` is still expected-fail |
| 1.3 | CRM list pages | Not started | — | |
| 1.4 | CRM detail pages | Not started | — | |
| 1.6a | Dashboard (3 widgets) | Not started | — | |
| 1.9a | Existing-tenant idempotent reprovision | Not started | — | Supersedes the Phase 2 placeholder CRM permissions (contacts/companies/deals/ai) |

**Cumulative test count: 123** across 5 task suites:

- `@adserve/database` — 3 (harness smoke)
- `@adserve/module-framework` — 60 (field engine) + 21 (layout engine) = 81
- `@adserve/ai-service` — 0 (stubs only; tests land with Task 0.7/0.8)
- `@adserve/crm` — 0 (constants only; tests land with Task 1.1)
- `@adserve/web` — 38 component tests (15 form + 23 table) + 1 expected-fail integration test = 39

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

## Next session opens with

**Task 0.6 — Entity type registration & module activation.** Per the
plan §0.6: on CRM activation, insert entity types / default field
definitions / default layouts / relationships / pipeline stages /
permissions / `ai_usage_limits`, idempotently. This task also builds the
server-component wrapper that fetches via the entity registry and feeds
`<DynamicForm>` and `<DynamicTable>` (both currently take data as props).

`<DynamicTable>` is presentation + callbacks only — the actual JSONB
sort/filter via `(data->>'field_slug')::<type>` casts and the
COUNT-over-filtered-set pagination land server-side in **Task 1.2**.
Sort/filter eligibility per field type lives in
`apps/web/src/components/dynamic-table/operators.ts` (the contract the
server query layer should honour).

**Verify during 0.6 (live render, carried over from 0.5):** confirm that
`long_text` cells truncate via CSS (currently `line-clamp-2` on the cell
wrapper; `truncate` + a `max-w-*` would also be acceptable) while the
full text remains in the DOM. The cell-formatting consistency with
`<DynamicForm>` view mode depends on `formatFieldValue` output staying
un-truncated — truncation must be CSS-only so `textContent` is preserved
for long values. Only assertable once a real list page renders multi-line
content (jsdom doesn't lay out CSS clamping).

## Reading order for a fresh Claude session

1. `CLAUDE.md` (root) — project orientation, AWS state, RLS notes
2. `docs/phase-3-plan.md` — full Phase 3 plan, scope, sequencing
3. `docs/phase-3-status.md` — this doc, pick up where work stopped
4. Relevant package README only when working in that package

No conversation history replay required. Pick the next-not-started
task from the table above and follow the existing protocol: plan →
approve → implement → tests → commit.
