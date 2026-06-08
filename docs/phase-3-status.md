# Phase 3 — progress status

Per-task tracker for `docs/phase-3-plan.md`. Updated at the end of each
working session. Reading this + `docs/phase-3-plan.md` + `CLAUDE.md` is
enough context to pick up Phase 3 work in a fresh session — no
conversation-history replay needed.

## End-of-session snapshot — 2026-06-08

**`main` is `aa567a7` (#19), local synced to origin, deployed to ECS.** All of the
Phase 3 master plan (WS0–WS6) is now **merged**, the convert enhancements have landed,
and one hardening PR remains open (below).

**Merged since 2026-06-02:**
- **WS5 — collapsible / pinnable CRM primary nav (PR #16, `500e75a`).** Builds on
  `adserve-design`; localStorage persistence, no-flash hydration, keyboard shortcut,
  Playwright e2e via `@clerk/testing`.
- **WS6 — admin-selectable per-org palette (PR #17, `6da8dae`)** + **accent re-skin /
  admin theming (PR #18, `4d63f2f`)**. Palette resolved server-side via `data-palette`;
  static CSS catalogue in `globals.css` (not inline); catalogue of 4 (grey-blue default,
  slate, emerald, violet); tenant-admin sidebar stays fixed navy, only accent surfaces
  follow palette; WCAG-AA verified.
- **Convert enhancements — AC 20–24 (PR #19, `aa567a7`).** Two-phase duplicate warning
  (409 `account_exists`/`contact_exists` → confirm → link-to-existing); duplicate match
  on `lower(btrim())` (case + outer whitespace only, deliberately not fuzzy); AC 24 PATCH
  guard fires **before** `canMutate` so converted leads are read-only for everyone; atomic
  convert in one `withTenant` transaction.

The WS-delivery tracker below is updated: **WS0–WS6 all ✓ Merged.**

**`UNIQUE(tenant_id, name)` hardening — PR #20 (OPEN, not merged).** The optional
hardening from the 2026-06-02 open-items list is now done at the DB level. Migration
`packages/database/sql/008-unique-relationship-name.sql` (self-contained txn, `SET LOCAL
app.bypass_rls` for the cross-tenant pre-check, RAISE-and-rollback on duplicates,
idempotent `CREATE UNIQUE INDEX IF NOT EXISTS`) was **applied and verified on prod RDS on
2026-06-08** — `idx_relationships_tenant_name` unique on `(tenant_id, name)`; pre-check
passed (prod duplicate-free). **PR #20 merge is still pending** (human gate); the index it
depends on is already live, so merge → deploy is safe ordering.

**Prod `008` apply — operational record (2026-06-08):**
- Bastion brought up per `docs/aws-deployment-status.md` §(b): SSM Session Manager host
  (`t3.micro`, AL2023) in **private** subnet `subnet-08907b065b8d35b83`, no public IP,
  SSM egress via NAT; IAM role/profile `adserve-bastion-ssm` (`AmazonSSMManagedInstanceCore`);
  bastion SG `adserve-bastion-sg` (no inbound) with one temporary tcp/5432 ingress to RDS SG
  `sg-012023b2c91d23bde`.
- Applied over an `ssm start-session` port-forward (local `5433` → RDS `5432`) as
  `adserve_migrator` (secret `adserve/database-url-migrator`, RDS-managed JSON,
  `sslmode=require` over the tunnel). Verified the index, then **full teardown**: instance
  terminated, ingress rule revoked, bastion SG deleted, RDS SG re-baselined to its original
  two-source-SG rule. **IAM role/profile retained** for the next bring-up (grants nothing
  without an instance).

**Still outstanding:**
- **Merge PR #20** (human gate) → ECS deploy.
- **Phase 1b gated actions:** Secrets Manager `adserve/anthropic-api-key` + ECS secrets block
  + IAM `GetSecretValue`; prod `006` then re-run `001` RLS (confirm idempotent + covers
  ai-usage tables); deferred 1.7-UI affordances; `cost.ts` price + cap-currency review;
  flatten/rebase the Phase 1b branch stack onto `origin/main`.
- **Node 20 deploy-action deprecation** — bump pending; **confirm the actual deadline** (the
  2026-06-02 note says 16 Sep 2026).
- **CI wiring (4 items):** all `sql/` migrations incl. `008` into the CI test DB; serial
  workspace tests or per-workspace DBs (shared-DB parallel race seen on `@adserve/crm`); swap
  e2e Clerk user off the owner account to a dedicated `crm.admin` user; Clerk testing keys +
  creds as GitHub secrets.

## End-of-session snapshot — 2026-06-02

**`main` is `d880d84`, deployed to ECS and healthy.** Two things shipped this session,
both merged and deployed via the standard agent flow (plan → architect-reviewer →
builder → qa → architect-reviewer → PR → human merge gate):

**1. WS4 — design-system tokens + server-safe `Panel` primitive (PR #14, merged → `e770a8a`).**
Expanded `apps/web/src/app/globals.css` with elevation/border/radius/padding/spacing/
surface tokens (value-for-value with the old inline styles + dark-mode overrides); added
the `Panel` primitive (`apps/web/src/components/ui/panel.tsx`, `react`-types-only import,
server-safe); refactored the CRM dashboard, list, and detail sections onto `<Panel>`.
Locked acceptance criteria #16 (Panel used by detail/list/dashboard) and #17 (no
server-only import — boundary gate green) both PASS. `detail-tabs.tsx` deliberately not
wrapped (tablist, not a card). See the WS-delivery tracker further down for the WS1–WS4
landing table.

**2. `adserve-design` skill + token value-lock guard (PR #15, merged → `d880d84`).**
- **Skill:** `.claude/skills/adserve-design/SKILL.md` — the in-product design system. It
  **governs in-app product surfaces** (apps/web authenticated / app-shell UI: CRM,
  `/admin`, `/super-admin`); `frontend-design` is for marketing / throwaway prototypes
  only, and **`adserve-design` wins on conflict**. Encodes: the token catalogue copied
  **verbatim** from `globals.css` (kept honest by the guard below), the `Panel` contract
  (use for cards/sections, not tablists; `className` is layout-only; default elevation 1;
  `adserve-panel` class hook), the **#16/#17 server/client boundary rules**, a **light AND
  dark** mandate (drive everything from tokens; never hardcode a colour that bypasses the
  dark-mode overrides), and `--accent`/`--accent-foreground` documented as
  **reserved-for-WS6** (factual seam, no WS5/WS6 guidance authored).
- **Precedence pinned** by one line in `CLAUDE.md` (the Styling bullet).
- **Value-lock guard:** `apps/web/__tests__/components/adserve-design-tokens-lock.test.ts`
  — asserts every `--token: value;` in the skill catalogue appears (names **+** values) in
  `globals.css`, **one-directional (skill ⊆ globals.css)**, scoped to `globals.css` CSS
  custom properties only (does NOT resolve Tailwind tokens like `brand-500`).
  Whitespace-normalised so it locks values, not the formatter's line-wraps. Proven
  **non-tautological** by injecting a value drift during review (it failed on exactly that
  declaration, then restored).
- `.gitignore` gained `!.claude/skills/` so the skill is tracked (mirrors the existing
  `!.claude/agents/` negation; `frontend-design` had been force-added).

### Decisions captured this session

- **DECISION (done-bar):** `pnpm dev` runs as the local **superuser**, which **BYPASSES
  RLS** — so the browser can never prove tenant isolation. `pnpm test` runs as
  **`adserve_app` (NOBYPASSRLS)** where RLS actually enforces. **A feature is NOT done
  until `pnpm test` is green** — "looks right in the browser" is necessary but not
  sufficient.
- **DECISION (workflow):** develop in a **local inner loop** (`pnpm dev` / `pnpm test` /
  `pnpm build`), batch changes, and only **merge → deploy when shipping to others**.
  Runbook: `docs/local-dev-loop.md` (currently untracked).
- **Guard scope:** locking **names + values** now (option ii); **defer bidirectional**
  (option iii — fail if `globals.css` gains an undocumented token) **to WS6**, when the
  palette work will churn the token set.

### Next

- **WS5** — collapsible / hover-expand / pinnable nav with active-state. Builds on
  `adserve-design` (consume the tokens + `Panel` conventions). Frontend-only, low risk.
- **WS6** — admin-selectable per-org palette. Depends on WS4 tokens (it overrides them);
  this is where the `--accent` seam gets wired and where bidirectional guard hardening
  lands.

### Open side items

- **Delete stale remote branch `chore/enable-frontend-design-skill`** — James's one-liner;
  still present on origin (its payload already landed via PR #13). NOT to be deleted by an
  agent.
- **Convert enhancements (acceptance criteria 20–24)** — dated opportunity name, two-phase
  duplicate-warning convert (409 → confirm → link-to-existing), server-side converted-lead
  read-only + JSONB back-links. Still outstanding from the master plan.
- **Optional `UNIQUE(tenant_id, name)` hardening migration** — safe; prod is currently
  duplicate-free. Protected path → human-gated when done.
- **Node 20 deploy-action deprecation** — `aws-actions/amazon-ecs-deploy-express-service@v1`
  runs on Node 20; bump before **16 Sep 2026**.

### Local env verified (2026-06-02)

- `pnpm dev` (Ready ~2s, `/api/health` 200), `pnpm build` (success, 36.9s), `pnpm test`
  (**483 tests green** across 5 packages under the `adserve_app` harness) — all confirmed
  on this machine.
- Homebrew `postgresql@16` + `redis` both **started**; `adserve_app` role present
  (NOBYPASSRLS). **Redis is currently unused** (declared in env, no code references it).
- `docs/01-setup-guide.md` is **stale** (documents Docker Compose Postgres/Redis);
  **superseded by `docs/local-dev-loop.md`** for the local Homebrew setup.

## End-of-session snapshot — 2026-05-31

Clean shutdown after Phase 1b completed. Working tree **clean**, stash
**empty**, nothing dangling. Nothing pushed; nothing merged to `main`.

**Branch stack (linear, each built on the previous, all rooted at local `main`):**

| Branch | Head | Sits on |
|---|---|---|
| `main` (local) | `90f9445` | — |
| `task/1.4-crm-detail-pages` (Phase 1a tail) | `e198ac0` | main +11 |
| `task/0.7-ai-service-layer` | `6296eb4` | task/1.4 |
| `task/0.8-ai-usage-metering` | `9af7868` | 0.7 |
| `task/1.5-pipeline-kanban` | `55888a3` | 0.8 |
| `task/1.6b-dashboard-funnel-forecast` | `2ea37b6` | 1.5 |
| `task/1.7-ai-features` | `073efbd` | 1.6b |
| `task/1.8-crm-config` | `89dc635` | 1.7 (current tip) |

**main vs origin/main:** local `main` (`90f9445`) is **0 behind / 4 ahead** of
`origin/main` (`8d04d30`) — origin has nothing local lacks; the 4 ahead are
locally-merged Phase 1a work never pushed.

**Rebase scope for tomorrow:** 17 commits sit between local `main` and the
`task/1.8` tip — **11 pre-Phase-1b** (Phase 1a 1.3/1.4/1.3b/1.6a/1.9a + the
protocol/chore commits, tail = `task/1.4-crm-detail-pages`) + **6 Phase 1b**
task heads. The whole thing is one linear chain, so a flatten/rebase onto
`main` is straightforward (no diverging branches, no merge commits).

**GATED — still outstanding (need James):**
- Prod `reprovision-crm` run (`adserve_migrator` role) — destructive.
- RDS migration backlog: `003`/`004`/`005` **+ `006-add-ai-usage-tables.sql`
  then re-run `001-enable-rls.sql`** (migrator role).
- Create Secrets Manager `adserve/anthropic-api-key` + ECS task-def `secrets:`
  + IAM `GetSecretValue` (no rotation) — required before AI features run in prod.
- Eyeball model list prices in `packages/ai-service/src/cost.ts` (feed the cap).
- **Scope change to ratify:** `1.7-UI` follow-up — 3 deferred AI front-end
  affordances (from-nl pre-fill, inline field-suggest, smart-search→table).

**Open review flags (non-blocking, recorded per-task below):**
- 1.5 drag-to-stage resets a manually-set probability to the stage default.
- 1.6b forecast SQL assumes well-formed `closeDate`/`probability` (revisit if
  AI writes unvalidated values).
- 1.8 pipeline stage-delete orphan-check ignores *archived* opportunities
  (accepted); DnD→up/down buttons in the config editors (approach choice).
- Deep branch stack off local `main` — flatten/merge before the next phase.
- `resolveCtx`/`resolveTenantCtx` duplication (fold into `1.7-UI`).

## Status as of 2026-05-29

`origin/main` HEAD: `8d04d30` (unchanged — nothing pushed since).
Local `main` HEAD: `90f94454196ba91a5e1afb1d7e981917e4e82d03` (Task 1.2,
merged locally via earlier flatten). Currently on branch
`task/1.4-crm-detail-pages` (Tasks 1.3 + 1.4 + 1.3b + 1.6a + 1.9a committed
here; ahead of local `main`). Cumulative tests: **236, zero expected-fail**;
lint clean; web tsc clean. **Phase 1a is feature-complete.** Next: Phase 1b
(0.7 AI service → 0.8 metering → 1.5 kanban → 1.6b → 1.7 AI features).
**GATED — awaiting James:** run `pnpm --filter @adserve/crm reprovision-crm`
against **production** with the **`adserve_migrator` role**
(`database-url-migrator` — it deletes permission rows; the app role can't).
Destructive — retires the 16 Phase-2 placeholder perms + reprovisions
CRM-enabled tenants. Verified on local dev (1 tenant reprovisioned, 16
placeholders retired, idempotent on re-run).

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
| 1.6a | Dashboard (3 widgets) | ✓ Complete | +11 web (5 dashboard-format, 6 dashboard queries DB) | `/crm` index server page (new). Three read-only widgets, **per-widget permission-gated**; page redirects to `/dashboard` only if the user has none of `{account,contact,lead,opportunity}.read ∪ activity.read`. (1) Pipeline value by stage — SQL `sum` of opportunity `amount` grouped by `stage`, labelled/ordered from `settings.pipelineStages`, **CSS bars (no charting dep)**; zero-opportunity stages render at £0, unknown stages bucket to "Other", null amounts coalesce to 0. (2) Upcoming tasks (next 7 days) — `task` activities with `metadata.dueDate` in `[today,+7d]` ascending. (3) Recently modified — last 10 records across **readable** entity types only (permission boundary), newest-first. Query seam `lib/crm/dashboard.ts` (testable; explicit `tenantId` predicate, not added to 44-site debt). **Bundled (per decision #37):** the 1.4 log-activity modal gained an optional task due-date → `metadata.dueDate` (no API change — route already accepts `metadata`). **Deferred (unchanged):** funnel + revenue forecast → Phase 1b. |
| 1.9a | Existing-tenant idempotent reprovision | ✓ Complete | +2 crm (reprovision: migrate/drop/delete + idempotent no-op) | `reprovisionCrm(tx)` in `@adserve/crm` (NOT `@adserve/database` — would create a `database→crm` cycle): reprovisions every CRM-enabled tenant via the idempotent `activateCrmForTenant`, then retires the 16 Phase-2 placeholder perms (`contacts/companies/deals × r/c/u/d/export` + `ai.use`). **Migrate-then-delete in one transaction** (runner wraps `db.transaction`): grants on placeholders are migrated to the Phase-3 perms (`contacts→contact`, `companies→account`, `deals→opportunity` for r/c/u/d) **before** deletion. `*.export` + `ai.use` dropped (no Phase-3 equivalent), counted distinctly (`ai.use` flagged for a future 0.8 `ai_usage.read` follow-up). **Migration scoped to CRM-enabled tenants** — a CRM-disabled tenant's placeholder grants are dropped, not migrated. Throws if a mapped target perm is missing (botched-reprovision guard). Thin runner `reprovision.run.ts` + `pnpm --filter @adserve/crm reprovision-crm`. **Verified on local dev** (1 tenant, 16 placeholders retired, 6 export + 2 ai.use drops, idempotent). **Production run is GATED** (destructive — see header). |

**Cumulative test count: 236** across 5 task suites (zero expected-fail):

- `@adserve/database` — 3 (harness smoke) + 1 (seed permission regression guard) = 4
- `@adserve/module-framework` — 60 (field engine) + 21 (layout engine) + 9 (5 entity-registry + 4 provisioning) = 90
- `@adserve/ai-service` — 0 (stubs only; tests land with Task 0.7/0.8)
- `@adserve/crm` — 8 (CRM activation) + 3 (permission seeding + role grants) + 2 (1.9a reprovision: migrate/drop/delete + idempotent no-op) = 13
- `@adserve/web` — 129: 16 table + 15 form (39 component, incl. 1.3 long_text truncation verify) + 1 provision-activation smoke + 25 CRM API + 7 list-pages (4 stateToQuery round-trip, 3 crm-list-client) + 21 detail-pages (5 record-title, 6 detail-capabilities, 10 crm-detail-client) + 26 bulk/owner (5 table-selection, 12 owner-filter, 9 bulk route) + 11 dashboard (5 format/heuristic, 6 query DB incl. permission boundary). **No expected-fail remaining.**

> **Test-suite note:** the full `pnpm test` (turbo, parallel) can still
> hit the documented flaky DB gate (`crm-records.test.ts` `beforeAll`
> contends on the shared single-connection local DB → `users_email_unique`).
> Deterministically green under serial execution
> (`vitest run --no-file-parallelism`) and in isolated per-file runs. This
> is the deferred flaky-gate item below, **not** a 1.4 regression (1.4 adds
> only pure + jsdom tests, no DB).

### Phase 1b — AI + advanced UI

| # | Task | Status | Tests added | Notes |
|---|---|---|---|---|
| 0.7 | AI service layer | ✓ Complete | +15 (`ai-service`) | Anthropic-backed `aiComplete` chokepoint on branch `task/0.7-ai-service-layer`. Per-tenant usage emitted on every path via an injectable `recordUsage` seam. See decisions below. |
| 0.8 | AI usage metering + limits | ✓ Complete | +13 (ai-service metering, incl. 2 RLS-enforcement) +1 (crm activation) | 3 RLS tables + real metering behind the 0.7 seam + cap enforcement + 4 endpoints + 2 UI pages. See decisions below. |
| 1.5 | Pipeline kanban | ✓ Complete | +5 (pipeline loader) +5 (move endpoint) | `/crm/pipeline` board; native HTML5 DnD (no new dep); dedicated `pipeline.update` move endpoint. See decisions below. |
| 1.6b | Dashboard funnel + forecast | ✓ Complete | +4 (funnel + forecast queries) | Two widgets added to the 1.6a CRM dashboard. Lead funnel (new→contacted→qualified→converted, `lost` off-funnel); weighted revenue forecast (Σ amount×probability/100) in 30/60/90-day close-date windows. Pure CSS bars (no chart lib). Funnel gated on `lead.read`, forecast on `opportunity.read`. Queries run inside `withTenant` (scoped connection) AND carry explicit `tenantId` predicates. **Known assumption:** the forecast SQL casts `closeDate::date` / `probability::numeric`, so it assumes well-formed values — revisit when AI record creation (1.7a) can write unvalidated fields (a malformed value would error the tenant's forecast query). |
| 1.7 | AI feature endpoints | ◐ Endpoints done; 3 UIs deferred | +13 (ai-features) | 4 metered AI endpoints (from-nl, suggest-field, summarize, smart-search) all via `aiComplete` (auto-metered/capped) + summarize UI. **3 UIs deferred (SCOPE CHANGE — gated, see below).** See decisions. |
| 1.8 | Tenant-admin CRM config UIs | ✓ Complete | +11 (crm-config) | `crm.admin` perm + 3 admin pages (fields CRUD, layout editor, pipeline stages) + backfill. Up/down reorder (not DnD). See decisions below. |

#### Task 0.7 — decisions (2026-05-30)

1. **Provider abstraction:** tight coupling to the Anthropic SDK inside
   `client.ts`; `aiComplete(request): AICompletionResponse` is the single
   provider-agnostic chokepoint. No `Provider` interface (YAGNI — provider
   decision is locked; the seam to add one later is localised to
   `aiComplete`'s body).
2. **API-key resolution:** read `process.env.ANTHROPIC_API_KEY` in BOTH dev
   and prod. Traced the codebase — every secret (DATABASE_URL, Clerk keys)
   flows Secrets Manager → ECS task-def `secrets:` block → env var →
   `process.env`; there is **no runtime Secrets Manager SDK call anywhere**.
   **Declined to add `@aws-sdk/client-secrets-manager`** — a runtime resolver
   would diverge from the established convention. Matches the plan's Task 0.7
   row ("Reads API key from `process.env.ANTHROPIC_API_KEY`").
3. **`ai_usage` table ownership:** stays with **Task 0.8** (per plan
   §616–636). 0.7 delivers the *emission seam* only — `aiComplete` builds a
   fully-populated usage record on every path (success / error / rate-limit /
   over-limit / invalid-request) and hands it to an injectable `recordUsage`.
   Defaults (`checkLimits → {ok:true}`, `recordUsage → no-op`) live locally in
   `client.ts` (NOT the throwing `metering.ts` stubs). **Not a scope change.**
4. **Model IDs + pricing (verify):** `cost.ts`/`models.ts` now use real IDs
   `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `claude-opus-4-8` with
   published list prices ($1/$5, $3/$15, $15/$75 per Mtok input/output) dated
   2026-05-30. **James: eyeball these against the current pricing page** — they
   feed 0.8's £50 cap, so a wrong number is a real-money error. Re-verify
   quarterly. Placeholder keys retained for back-compat.
5. **Errors:** never throws past the boundary. SDK-native retry (maxRetries=2,
   honours `retry-after`); 30s default timeout (overridable). Mapping:
   RateLimit→`rate_limited`+retryAfterMs, timeout/abort→`timeout`,
   400→`invalid_request`, 401→`api_error`/401, connection→`api_error`/0, other
   APIError→`api_error`/status, missing-key/unknown→`internal`. `UsageStatus`
   has only 4 values, so timeout/internal/invalid_request all log `status:error`.
6. **Deferred (NOT in 0.7):** cap enforcement + DB persistence → 0.8;
   `ai_usage_*` tables + RLS → 0.8; usage endpoints/UI → 0.8; feature endpoints
   → 1.7; BYOK → out of scope; streaming → deferred (capabilities are
   single-shot).

**Handoff to 0.8:** implement `metering.checkLimits`/`recordUsage` against the
new tables, then swap `client.ts`'s `defaultCheckLimits`/`defaultRecordUsage`
(or inject via `AIServiceDeps` from the 1.7 endpoints). The `recordUsage` arg
shape is already exported as `RecordUsageInput`. — **DONE in 0.8.**

#### Task 0.8 — decisions (2026-05-30)

1. **Tables:** `ai_usage_log`, `ai_usage_summary`, `ai_usage_limits` in
   `packages/database/src/schema/ai-usage.ts`. Migration `sql/006-add-ai-usage-tables.sql`
   (hand-written, idempotent; matches the Drizzle defs — the 003–005
   convention, not `drizzle-kit generate`). All three added to the RLS array
   in `001-enable-rls.sql` (14→17 tables) and to the test-role grants in `002`.
   Applied to LOCAL dev; **prod RDS application is gated (see below).**
2. **Cap behaviour:** hard block when `total_cost_micros >= cap` (at-or-over).
   Optional `monthly_token_limit` enforced the same way. **Period:**
   calendar-month, **UTC**, `period_start`/`period_end` as `YYYY-MM-DD`. A
   single `currentPeriod()` helper feeds both read and write paths.
3. **Fail-safe:** missing summary → used=0; **missing limits row → default
   $50 cap applies (never unlimited).**
4. **Currency:** the cap is **$50 USD** (50_000_000 microdollars), NOT £50 —
   `DEFAULT_MONTHLY_COST_LIMIT_MICROS` comment corrected. GBP is display-only
   and deferred (no live FX). UI shows `$`.
5. **Metering ↔ seam:** `metering.ts` functions take an optional `tx` (tests
   pass the rollback handle; prod opens its own `withTenant`/
   `withSuperAdminBypass`). `aiComplete`'s defaults now wire the real
   DB-backed metering — **safe-by-default, metering can't be skipped.**
   `recordUsage` writes the log row on every status; only `success` moves the
   summary (atomic `ON CONFLICT` increments + `jsonb_set` breakdown merge that
   handles first-touch of a new `module.capability` key).
6. **Permission:** `ai_usage.read` added to `seed/index.ts` platformPerms
   (inlined, NOT imported from ai-service — `@adserve/database` must not
   depend on ai-service or it cycles). New tenants auto-grant it (provisioning
   wildcard); existing tenants via new `seed:backfill-ai-usage-read` (run
   locally — granted Owner+Admin across 4 tenants). **Decision: `ai_usage.read`
   → Owner + Admin only** (it's an admin-panel view).
7. **Endpoints:** `GET /api/admin/ai-usage`, `GET /api/super-admin/ai-usage`,
   `GET /api/super-admin/ai-usage/[tenantId]`, `PATCH …/[tenantId]/limits`.
   **Pages:** `/admin/ai-usage`, `/super-admin/ai-usage` (+ `[tenantId]`
   drill-in with a client limit editor). Nav items added to both layouts.
8. **SDK skew RESOLVED:** `apps/web` had a stale direct `@anthropic-ai/sdk@^0.39.0`
   (no direct import). Web now depends on `@adserve/ai-service` (for the
   metering reads in routes/pages) and gets the SDK transitively at `0.100.1`;
   web's direct dep removed. One SDK version in the deployable now.
9. **Test-helper fix:** `uniqueSuffix()` (test-helpers/tenant.ts) now includes
   `process.pid` + a random component. The old `Date.now()+per-process counter`
   collided across turbo's parallel vitest workers once ai-service added a 3rd
   concurrent DB-testing process (`users_email_unique`). Pre-existing latent
   flaw, surfaced and fixed here.

**Deferred (NOT in 0.8):** GBP/FX conversion (presentation); AI feature
endpoints (1.7); streaming; cap-breach alerting/email (the cap blocks silently,
no notifications).

#### Task 1.5 — decisions (2026-05-30)

1. **Drag-drop: native HTML5 DnD API — no new dependency.** Avoids the gated
   `@dnd-kit` add; adequate for a desktop kanban. Touch/keyboard fallback: every
   card links to the opportunity detail page where `stage` is an editable
   select (the same path read-only users use). Swappable to a lib later.
2. **Dedicated move endpoint** `PATCH /api/crm/pipeline/[id]` — pure
   `pipeline.update` gate (NOT the generic record PATCH's permission-OR-ownership
   rule). Validates target stage ∈ tenant's `pipelineStages`; sets BOTH
   `data.stage` AND `data.probability` (= stage `defaultProbability`, per the
   `pipeline.ts` contract — moving resets probability; users re-override on the
   detail page). RLS-safe: existence SELECT + UPDATE both carry tenant_id +
   entity_type_id, so a forged cross-tenant id → 404 (tested).
3. **Board loader** `lib/crm/pipeline.ts` `loadPipelineBoard`: account names
   resolved by joining `record_relationships` (opp always source) to records of
   the ACCOUNT entity type specifically — never "any related record" (would
   conflate the primary-contact relationship). Unknown/missing-stage opps →
   trailing `__other__`/"Other" column (dashboard convention). Currency totals
   summed numerically (no FX, mirrors dashboard).
4. **Closed stages:** free movement allowed in v1 (re-opening a deal is
   legitimate); `pipeline.ts` `isClosed` comment updated to reflect this. NOT
   done (deferred, conscious gaps): close-date auto-stamp on entering
   closed_won/closed_lost; WIP/flow constraints; per-tenant stage-config UI;
   keyboard reorder. No new dependency, no migration.

**GATED — awaiting James (joins the 003/004/005 deferred RDS queue):** apply
`sql/006-add-ai-usage-tables.sql` then re-run `sql/001-enable-rls.sql` against
**production RDS** with the **`adserve_migrator`** role. Until then, the AI
metering tables don't exist in prod (fine — no AI feature endpoints ship until
1.7).

#### Task 1.7 — decisions (2026-05-30)

1. **4 metered AI endpoints**, each: resolve ctx → permission gate → `withTenant`
   to build the prompt inputs → `aiComplete` (auto-meters via the 0.8 default;
   cap enforced inside) → shape JSON. Endpoints call `aiComplete` exactly once
   and never touch metering directly (no double-count).
   - `POST /api/crm/[entityType]/from-nl` {prompt} → `${slug}.create`; returns
     `{fields}` draft (does NOT create — the normal create path does, validated).
   - `POST /api/crm/[entityType]/suggest-field` {recordContext,fieldSlug} →
     `${slug}.create` **OR** `${slug}.update` (button lives on create+edit forms).
   - `POST /api/crm/accounts/[id]/summarize` → `account.read` **AND**
     `activity.read` (the summary surfaces activity content — both required to
     avoid an exfiltration bypass; mirrors the activity-timeline route).
   - `POST /api/crm/[entityType]/smart-search` {query} → `${slug}.read`; returns
     `{filters}` only (no search execution).
2. **Shared `lib/crm/ai-response.ts`:** AIError→HTTP (over_limit/rate_limited→429,
   timeout→504, others→502); `parseAiJson` strips a single ```json fence before
   parsing (defensive — prompts forbid fences) then falls through to 502; a
   `resolveTenantCtx` for the OR/AND gates.
3. **Summarize UI** (1.7c) shipped: self-contained `AiActivitySummary` panel in
   the account detail Activity section (one optional `showAiSummary` prop on
   `CrmDetailClient`, accounts only) — full UI→endpoint→AI→metering path.
4. **Tests** mock only `aiComplete` (real prompt builders + real DB input
   loading via `setupCrmTenant`); cover success/shape, permission gates (incl.
   the update-only suggest case and the activity.read-denied summarize case),
   over_limit→429, fence-strip success, malformed→502, 404.

**GATED — SCOPE CHANGE vs `docs/phase-3-plan.md` §671-715 (awaiting James):**
Task 1.7 delivers all 4 endpoints + the summarize UI, but **defers the UI
integration for 1.7a (Create-with-AI form pre-fill), 1.7b (inline field-suggest
button), and 1.7d (smart-search → dynamic-table filter state)**. Reason: these
couple deeply into the existing CRM create-form and dynamic-table filter
contracts — higher regression risk to do unattended. The metered capabilities
all work end-to-end at the API level; only the front-end affordances are
outstanding. Recommend a follow-up task `1.7-UI`.

#### Task 1.8 — decisions (2026-05-30)

1. **`crm.admin` permission** added to `CRM_PERMISSIONS` (22 now) →
   owner+admin auto-inherit via the `[...CRM_PERMISSION_KEYS]` spread; member
   excluded (schema/layout/pipeline mutation is destructive, beyond read-only
   scope). New tenants get it via activation + provisioning wildcard.
   `seed:backfill-crm-admin` grants it to existing owner/admin roles — and,
   unlike the platform `ai_usage.read` backfill, **ensures the `crm.admin`
   permission row exists first** (module-scoped perms are created at
   activation, so the row is absent for pre-1.8 tenants). Ran locally: 6 roles
   across 5 tenants. The 3 pages gate `requirePermission("crm.admin")`; routes
   `apiRequirePermission("crm.admin")`.
2. **Reorder via up/down buttons, NOT drag-and-drop** (all 3 editors). The
   plan row says "drag-and-drop" for layouts; buttons deliver the same
   capability (reorder + cross-section reassign via a dropdown) without
   nested-DnD regression risk or a new dep. Approach choice, not a capability
   cut — the Phase 1b *kanban* (1.5) remains true drag-and-drop.
3. **Routes are thin wrappers over the 0.2 field engine / 0.3 layout engine**;
   error codes mapped to HTTP in `lib/crm/config-errors.ts` (dup_slug→409,
   system_field→403, type_change_blocked→422, has_data→409, invalid_config→422,
   etc.). System fields: editable label/flags, type-locked + delete-blocked
   (engine-enforced; UI hides delete). Field delete defaults to block-on-data
   (409); `?force=true` available behind explicit intent.
4. **Pipeline editor safety:** slug immutable on rename (UI edits name only);
   deleting a stage that opportunities still reference is **blocked with 409**
   (else those records vanish from the kanban/dashboard and get stuck in an
   unselectable stage); ≥1 open (non-closed) stage enforced (lead-convert uses
   the first open stage as the default). `displayOrder` recomputed from array
   order; writes merge into `entity_types.settings` with a tenant predicate.
   **Known/accepted edge:** the orphan-check counts only non-archived
   opportunities, so an *archived* opportunity in a removed stage keeps an
   orphaned `data.stage` slug (archived records are hidden from kanban/dashboard
   anyway; consistent with "archived persists as-is").
6. **Permission count correction:** Phase 3 now adds **22 CRM-scoped** perms
   (`crm.admin` added in 1.8) + **1 platform** (`ai_usage.read`) = **23** total.
   The plan's matrix headers (§236/§253) still say 21/22 — stale, code is the
   source of truth.
5. **Layout editor:** edits the default `detail` layout's config only (never
   creates/deletes layouts, so the single-default invariant can't be violated);
   null-default → bootstrap via `generateDefaultLayoutConfig` + `createLayout`.
   All config writes validated by the engine (fieldIds exist tenant-scoped).

**SDK version skew — RESOLVED (Task 0.8).** `apps/web`'s stale direct
`@anthropic-ai/sdk@^0.39.0` dep was removed; web now depends on
`@adserve/ai-service` and gets the single SDK at `0.100.1` transitively. One
SDK major in the deployable.

**GATED — awaiting James (one-time infra, for prod/0.8):** create Secrets
Manager secret `adserve/anthropic-api-key` (eu-west-2), add to ECS task-def
`secrets:` block, add its ARN to the task-role IAM `GetSecretValue` list,
**no rotation** (Anthropic has no rotation API). Confirmed NOT yet done —
deploy step 22 was RDS rotation, unrelated.

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

### Task 1.6a decisions

45. **Widget 2 "upcoming" sourced from `activities.metadata.dueDate`
    (`YYYY-MM-DD`, task-type only), and the capture UI was bundled here**
    per decision #37 (which pre-located `dueDate` to 1.6a/metadata). The
    1.4 log-activity modal gained an optional due-date input → stored in
    `metadata.dueDate`; no API/schema change (the route already accepts
    `metadata`). Day-granular `YYYY-MM-DD` stored + compared as `::date`
    (timezone-stable); the window is `[today, +7d]` inclusive. Re-scoping
    to "recent by createdAt" or shipping an always-empty widget were both
    rejected as unfaithful to the plan.
46. **No charting dependency — CSS bars.** Adding a chart lib is a gated
    action; the bar widget is trivial in CSS. Avoided.
47. **Per-widget permission gating; page redirects only on zero CRM read.**
    The redirect predicate is the union
    `account.read ∪ contact.read ∪ lead.read ∪ opportunity.read ∪
    activity.read`. A user with only `activity.read` lands on the page.
    **Both record-surfacing widgets (upcoming tasks AND recently modified)
    are filtered to the entity types the user can read** — `activity.read`
    alone is necessary but not sufficient to see a task, because a task
    surfaces its record's title + deep-link; seeing it requires read on
    that record's entity type. So `activity.read` without any entity read
    shows an empty upcoming widget. (Permission boundary, tested for both
    widgets.)
48. **Pipeline aggregation is SQL `sum`/`group by`** inside `withTenant`
    with the explicit `tenantId` predicate (correct-by-construction; not
    added to the 44-site RLS debt). Null/malformed amounts coalesce to 0;
    configured stages with no opportunities still render; opportunities
    with an unrecognised stage bucket into "Other" (never silently
    dropped). **Mixed-currency assumption (recorded):** amounts are summed
    raw and formatted GBP — correct only if a tenant's opportunities share
    one currency. Multi-currency aggregation is a Phase-1b concern; flagged
    here so the number isn't mistaken for currency-aware.

### Task 1.9a decisions

49. **`reprovisionCrm` lives in `@adserve/crm`, not `@adserve/database`.**
    It calls `activateCrmForTenant` (a crm export), so housing it in
    `@adserve/database` would create a `database → crm` import cycle
    (decision #22). crm already depends on database, so it imports the
    tables (`modules`/`permissions`/`rolePermissions`/`roles`/
    `tenantModules`) + `db` directly.
50. **Migrate-then-delete in a single transaction; runner wraps
    `db.transaction`.** Grants on placeholders are migrated to the Phase-3
    perms before the placeholders are deleted — no orphan window, full
    rollback on error. The `role_permissions` FK cascades on perm delete;
    the explicit grant-delete is kept for clarity.
51. **Placeholder → Phase-3 mapping:** `contacts→contact`,
    `companies→account`, `deals→opportunity` for `read/create/update/
    delete`. `*.export` and `ai.use` have no Phase-3 equivalent and are
    **dropped, counted distinctly** (`grantsDroppedExport` /
    `grantsDroppedAi`) so a future 0.8 `ai_usage.read` follow-up can target
    the tenants that had AI grants. **Identity caveat:** placeholders are
    matched by resource-prefix (`resource ∈ {contacts,companies,deals,ai}`
    under the crm module), not an explicit 16-id allowlist — do not
    reintroduce a crm-module perm under those plural resources or this
    script would retire it.
52. **Grant migration is scoped to CRM-enabled tenants' roles.** A tenant
    that has since *disabled* CRM does not gain Phase-3 grants; its
    placeholder grants are dropped (`grantsDroppedDisabledTenant`). Avoids
    granting CRM perms to a tenant that no longer has the module.
53. **Production run is GATED.** Local-dev run is reversible (re-seed) and
    was executed to verify (16 placeholders retired, idempotent). The
    production run deletes live permission rows → queued for James, not run
    unattended. Runner reads `DATABASE_URL` from the environment (the local
    verify required passing it explicitly, since the crm package has no
    `.env`; production sets it in the deploy environment). **Run with the
    `adserve_migrator` role (`database-url-migrator`), NOT the runtime
    `adserve_app` role** — the script deletes `permissions` /
    `role_permissions` rows, which the non-superuser app role cannot do.

### Protocol decisions

54. **Autonomous execution policy was modified mid-run** by commit
    `036b89c` ("chore: autonomous execution policy"), which superseded the
    earlier "wait for explicit approval" workflow with the overnight /
    unattended default (decide-and-proceed on reversible work;
    queue-and-continue on a short irreversible/external list). James
    reviewed and **approved this after the fact**, with **one carve-out
    added here**: *scope changes versus the originally-defined task in
    `docs/phase-3-plan.md` (architectural pivots that redefine what a task
    is supposed to deliver) are now on the gated-actions list* — queued for
    James, not auto-proceeded. Applied in: `CLAUDE.md` (gated-actions list)
    + `.claude/agents/architect-reviewer.md` (scope changes reframed from a
    stop-the-run gate to a queue-and-surface item, consistent with the
    policy).
55. **Task 1.4a — `ownedBy` create-route gap (logged in #43) closed.** The
    create route (`POST /api/crm/[entityType]`) now validates a
    caller-supplied `body.ownedBy` is an active member of the tenant
    (reusing `isActiveMember` from `lib/crm/members.ts`) → **400** with the
    same message as bulk assignOwner, giving create + bulk parity on legal
    owners. Audit of all `ownedBy` write paths: create (fixed), bulk
    (already validated), PATCH/DELETE (don't accept `ownedBy`), and
    `lead.convert` — which **derives** `ownedBy` from the existing lead
    record, not request input, so it's out of scope. **Surfaced note:**
    `convert` propagates a stored `ownedBy`; pre-existing rows with an
    invalid `ownedBy` (created before this fix) are a data-migration
    concern, not an input gap — not actioned here. **Follow-up (queued, not
    in 1.4a's reviewed scope):** an explicit `ownedBy: ""` (empty string) is
    falsy, so it skips the `&&` guard and `"" ?? user.id` keeps `""` — a
    pre-existing theoretical hole. Tighten later to `if (body.ownedBy !=
    null)` + default `body.ownedBy || user.id` if airtight rejection of
    empty-string owners is wanted.

## Next session opens with

**Phase 1b is COMPLETE (2026-05-30).** All milestone tasks done end-to-end,
each on its own stacked branch (off local `main`), reviewer-approved, committed,
NOT pushed: **0.7** `task/0.7-ai-service-layer` (6296eb4) → **0.8**
`task/0.8-ai-usage-metering` (9af7868) → **1.5** `task/1.5-pipeline-kanban`
(55888a3) → **1.6b** `task/1.6b-dashboard-funnel-forecast` (2ea37b6) → **1.7**
`task/1.7-ai-features` (073efbd) → **1.8** `task/1.8-crm-config` (this commit).
Full suite green; lint + web tsc clean.

**Phase 1b milestone met:** 4 metered AI capabilities; pipeline kanban (DnD);
all 5 dashboard widgets; tenant-admin can add custom fields + manage
layouts/pipeline; `/admin/ai-usage` + `/super-admin/ai-usage`; all routes
`withTenant`/`withSuperAdminBypass`.

**Open follow-ups (not blocking):** `1.7-UI` (3 deferred AI UIs — gated scope
change); the deep branch stack should be flattened/merged before more work.

**GATED actions still awaiting James** (see header + per-task notes): prod
`reprovision-crm`; RDS migration deferrals (003/004/005 **+ 006 ai-usage +
RLS re-run**); create the `adserve/anthropic-api-key` Secrets Manager secret +
ECS/IAM wiring (required before AI features run in prod); eyeball model prices
in `cost.ts`.

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

## CRM Relationships / Conversion / Design System — locked decisions (WS0)

New feature, planned in `docs/plans/crm-relationships-conversion-design-system.md`
(architect-reviewer-approved, REVISED round 2 — folds in all 9 reviewer
conditions; the 7 prior open decisions are now LOCKED). The plan is committed
alongside this WS0 entry. Work is sequenced WS0 → WS1 → … → WS6; **WS0 is
documentation only (this section) — no code, no schema, no protected-path
touch.** WS1 is the next workstream and is a PROTECTED PATH (see end).

Read this section + the plan doc to pick up the feature in a fresh session. The
7 locked answers + the member link/unlink rule + the scope reconciliation:

1. **Convert with an existing account/contact → LINK to existing on user
   confirm** (no duplicate create). The confirmed POST links to the matched
   account/contact and creates only what is missing; matched entities emit
   `link` audit rows. (Open Decision 1, option a.)
2. **Converted lead → server-side read-only**, enforced in the generic record
   PATCH path (reviewer Condition 8). Back-links are stored as
   `records.data.convertedTo = { accountId, contactId, opportunityId }` — an
   **ordinary JSONB `records.data` write inside the convert `withTenant` tx.
   NO new relationship type, NO schema/seed change, NO protected-path touch.**
   (Must not be confused with the rejected "new relationship type" option.)
3. **contact↔account = TRUE many-to-many; opportunity↔contact = many-to-many.**
   BOTH carry a "primary" concept via `record_relationships.metadata.isPrimary`
   (the junction already has a `metadata jsonb` column — no schema change to add
   it). **Single-primary-per-source is enforced app-level** in the same
   transaction (Condition 5).
4. **Admin-selectable palette stored per-org in `tenants.settings.theme`**,
   applied whole-app, **resolved per-request server-side with NO cross-request
   caching** (Condition 6).
5. **Nav pinned-state → `localStorage` for v1.** Hydration flash accepted.
6. **Convert stays a single bundled `lead.convert` permission** (it creates all
   3 records — account + contact + opportunity). The three-creates coupling is
   documented in the convert route; a test pins `lead.convert` to exactly
   `{owner, admin}` (Condition 3).
7. **Scope reconciliation accepted: extend, not greenfield.** Relationships +
   conversion already exist. The **in-place cardinality-flip migration** and the
   **two-phase convert flow (409 warn → confirm → proceed)** are approved in
   principle. The CRM permission matrix is **22** — the brief's "23rd"
   (`ai_usage.read`) is platform-level, outside the CRM matrix.

**Member link/unlink rule (Condition 4):** the link/unlink path honours the
same permission-OR-ownership escape-hatch (`canMutate`) as the generic record
PATCH/DELETE — a member can relate records they own; a member lacking BOTH the
`.update` permission AND ownership gets `403`. Chosen over the `.update`-only
option, which would silently strip members of edit rights that
`packages/crm/src/role-assignments.ts` grants.

**Next workstream is PROTECTED.** WS1 (relationship cardinality flip + the
idempotent reconciliation migration `packages/database/sql/NNN-reconcile-crm-cardinality.sql`,
landing as `007-…`, plus edits to `packages/crm/src/relationships.ts`) is a
PROTECTED PATH. Its production-RDS apply is human-gated — do not apply to prod
RDS unattended; queue it for James.

## Workstream delivery tracker (CRM Relationships / Conversion / Design System)

| WS | Title | Status | Landed via |
|---|---|---|---|
| WS0 | Decision capture | ✓ Complete | recorded above |
| WS1 | Cardinality flip + reconcile migration | ✓ Merged | [#9](https://github.com/jamesjfoley/adserve-studio/pull/9) (prod-RDS apply queued — `007` recorded #10) |
| WS2 | Relationship link/unlink write API | ✓ Merged | [#11](https://github.com/jamesjfoley/adserve-studio/pull/11) |
| WS3 | Contact-create account picker + account/opportunity detail tabs | ✓ Merged | [#12](https://github.com/jamesjfoley/adserve-studio/pull/12) |
| WS4 | Design-system tokens + server-safe `Panel` primitive | ✓ Merged | [#14](https://github.com/jamesjfoley/adserve-studio/pull/14) (+ adserve-design skill & token-lock guard [#15](https://github.com/jamesjfoley/adserve-studio/pull/15)) |
| WS5 | Collapsible / pinnable nav | ✓ Merged | [#16](https://github.com/jamesjfoley/adserve-studio/pull/16) |
| WS6 | Admin-selectable per-org palette | ✓ Merged | [#17](https://github.com/jamesjfoley/adserve-studio/pull/17) (+ accent re-skin / admin theming [#18](https://github.com/jamesjfoley/adserve-studio/pull/18)) |

### WS4 — Design-system tokens + Panel primitive (2026-06-02)

Frontend-only, low risk. No DB/RLS/protected-path/infra changes; no new
dependency. Branch `ws4-design-tokens-panel` off `main` (`c8f07cc`, includes
WS2/WS3 from PRs #11–#13).

**Delivered:**
- **Tokens** (`apps/web/src/app/globals.css`): added spacing (`--space-1..8`),
  radius (`--radius-sm/md/panel/full`), border (`--border-width`/`--border-color`),
  elevation (`--elevation-0..3` box-shadows + dark-mode overrides), panel surface
  (`--panel-padding`/`-sm`, `--panel-bg`/`--panel-border`/`--page-bg`), and the
  WS6 seam (`--accent`/`--accent-foreground` = `brand.500` `#185FA5`). Values are
  **value-for-value** with the prior inline styles (`--radius-panel: 0.75rem` =
  `rounded-xl`, `--panel-padding: 1.5rem` = `p-6`) so the refactor is a wrapper
  swap, not a redesign. The 5 existing palette vars + `prefers-color-scheme: dark`
  block are preserved.
- **`Panel` primitive** (`apps/web/src/components/ui/panel.tsx`, NEW): pure
  presentational wrapper applying the elevation/border/radius/padding tokens, with
  optional `title`/`actions` slots, `elevation` (0–3, default 1), `compact`,
  polymorphic `as`, and `className`/`aria-label` passthrough. Imports only `react`
  types — no `postgres`/`@adserve/database` value import — so it is server-safe and
  usable from both server and client components (**criterion #17**, boundary lint
  gate green).
- **CRM section refactors** (**criterion #16**): dashboard `crm/page.tsx` (5
  widgets), list `crm-list-client.tsx` (table region), detail
  `related-records-panel.tsx` (preserving its aria-label, heading classes, Add
  button, empty-state copy). `detail-tabs.tsx` deliberately left unwrapped (it is
  a tablist, not a card surface) — documented deviation, reviewer-approved.

**Acceptance criteria #16 + #17 (LOCKED): both PASS.** Verified by automated
assertions: `panel.test.tsx` (9 tests, incl. a real file-read source guard for
#17), `panel-adoption.test.ts` (proves all three sections import + render
`<Panel>`, legacy literal gone), `design-tokens.test.ts` (tokens defined, palette
preserved, elevation resolves light + dark).

**Gates:** lint (`boundary/no-server-in-client`) green, production `next build`
green, full monorepo test suite green under the RLS-enforced `adserve_app`
(NOBYPASSRLS) harness; Docker build deferred to CI per repo policy. WS4 adds no
tenant-scoped query or `withSuperAdminBypass` path, so the cross-tenant isolation
obligation is **N/A by design**; existing RLS page tests remain the regression
guard and stay green.

**Commits:** `d365d49` (builder — tokens + Panel + refactor), `1f5b51e`
(qa — adoption + token tests). **GATED:** merge to `main` is the standing human
gate — PR opened, not merged.
