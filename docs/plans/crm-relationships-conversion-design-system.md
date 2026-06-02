# Plan: CRM Relationships, Lead Conversion, and Design System

Status: REVISED (round 2) — folds in all 9 architect-reviewer required conditions; the 7 prior
open decisions are now LOCKED. Awaiting second-pass review.
Author: planner
Date: 2026-06-02

---

## Goal

Bring contact↔account and opportunity↔contact relationships up to true many-to-many with
in-product editing (preserving a "primary" concept via junction metadata), enhance the existing
lead-conversion flow with duplicate warnings, link-to-existing-on-confirm, a dated opportunity
name, and a server-enforced read-only converted-lead state, and establish a cohesive design system
(panel/elevation primitive, collapsible/pinnable nav, admin-selectable per-org palette) — building
on the relationship and conversion infrastructure that **already exists** rather than greenfield.

## Grounding reconciliation (verified against the repo, 2026-06-02)

The brief reads as greenfield. Most of the data layer already exists. Verified facts and
corrections to the brief:

- **Relationships infra exists.** `record_relationships` is a physical M2M junction
  (`packages/database/src/schema/records.ts` lines 103–133; unique index `idx_record_rels_unique`
  on `relationship_id + source_record_id + target_record_id`, indexed both directions). It already
  carries a `metadata jsonb NOT NULL DEFAULT '{}'` column (line 119) — **this is where the
  "primary" concept lives; no schema change is needed to add it.** The schema registry
  `relationships` table (`schema-engine.ts` lines 139–172) carries a `relationship_type` enum
  (`one_to_one / one_to_many / many_to_one / many_to_many` — confirmed in `enums.ts`, with
  `many_to_one` added by `sql/004`). Reads go through the bounded 4-query
  `loadRecordWithRelationships` (`apps/web/src/lib/crm/relationships.ts`).
- **Seeded CRM relationships** (`packages/crm/src/relationships.ts`): `contact_belongs_to_account`
  = `many_to_one`, `opportunity_belongs_to_account` = `many_to_one`,
  `opportunity_has_primary_contact` = `many_to_one`. Activation seeds the `relationships` rows
  (`packages/crm/src/activate.ts` lines 137–172), and the existing-row check is keyed on
  `(tenantId, sourceEntityTypeId, targetEntityTypeId, relationshipType)` (lines 152–157).
  **Because `relationshipType` is part of that key, flipping the enum value at the spec level
  causes re-activation to INSERT a NEW row rather than update the existing one** — this is the
  core WS1 migration hazard (addressed below). Cardinality is **stored but not enforced on any
  write path**.
- **CARDINALITY IS COSMETIC TODAY.** The junction is physically M2M regardless of the enum value.
  There is no validator that reads `relationship_type` and rejects an over-cardinality insert.
  So "make contact↔account M2M" is a *seed/label* change plus *new UI + new write path*, not a
  table change. The "many-to-one" enum value today is purely descriptive metadata.
- **The convert route imports relationship constants and looks rows up BY `.name`.**
  `apps/web/src/app/api/crm/leads/[id]/convert/route.ts` imports
  `CONTACT_BELONGS_TO_ACCOUNT`, `OPPORTUNITY_BELONGS_TO_ACCOUNT`,
  `OPPORTUNITY_HAS_PRIMARY_CONTACT` (lines 10–13) and resolves their ids via
  `inArray(schemaRelationships.name, relNames)` then `relIdByName.get(l.name)` (lines 125–166).
  Critically, `linkValues` is `.filter((l) => l.relationshipId)`-ed (line 160): **if a relationship
  name does not resolve, the link is silently dropped with no error.** Renaming the
  `opportunity_has_primary_contact` slug without lockstep-updating the constant + this route would
  silently break the opp↔contact link. **Therefore the slug is NOT renamed (see WS1 + Locked
  Decision 3).**
- **Lead conversion exists** (`convert/route.ts`): one `withTenant()` transaction guarded on
  `lead.convert`, creates account+contact+opportunity, inserts the three relationship links, sets
  lead `data.status = "converted"` (line 172), writes 4 audit rows. Opportunity is currently named
  `` `${accountName} opportunity` `` (line 107) — **not** dated. Account name =
  `company || personName || "Untitled account"` (lines 69–70). Conversion is **atomic and
  unconditional** — no duplicate checks today. Note `status` lives in `records.data` (JSONB), not a
  column.
- **There is NO general relationship link/unlink API.** The only writer of `record_relationships`
  is the convert route. The generic record-create POST (`api/crm/[entityType]/route.ts`) does
  **not** create relationships. The detail UI reads related records but has **no add/remove
  affordance**. So "pick accounts on contact create" and "edit related contacts/opps" are
  **net-new write paths and net-new UI**.
- **Generic record edit path = PATCH** in `api/crm/[entityType]/[id]/route.ts`. It uses a
  permission-OR-ownership gate (`canMutate`, lines 52–59; `ctx.permissions.has(key) || ownedBy ===
  ctx.user.id`). It does **not** currently reject edits to a converted lead (relevant to Condition
  8). DELETE uses the same `canMutate` pattern with `.delete`.
- **Member is read-only + `activity.create` ONLY.** `packages/crm/src/role-assignments.ts`
  (lines 28–36): member holds `account.read`, `contact.read`, `lead.read`, `opportunity.read`,
  `pipeline.read`, `activity.read`, `activity.create` — and **no `.update`/`.create` grants**.
  Members edit records THEY OWN via the route-layer ownership escape-hatch (`canMutate`), documented
  at lines 3–13 and 25–27, NOT via an `.update` grant. owner/admin hold `[...CRM_PERMISSION_KEYS]`
  (all 22), so they hold `lead.convert` and member does not (Conditions 3 + 4).
- **Permission count is 22, not 23.** `packages/crm/src/permissions.ts` defines exactly 22 CRM
  permissions (account/contact/lead/opportunity × CRUD = 16, plus `lead.convert`, `pipeline.read`,
  `pipeline.update`, `activity.read`, `activity.create`, `crm.admin`). Asserted by
  `packages/crm/__tests__/activate-crm.test.ts`. The brief's "23" is almost certainly the
  platform-level `ai_usage.read` in `@adserve/ai-service`, outside the CRM matrix. Treat as 22.
- **Frontend is bare.** Nav is a static server component (`apps/web/src/app/(platform)/layout.tsx`)
  with a fixed `w-64` sidebar, no collapse/pin/active-state. **The platform layout loads ONLY
  `getSuperAdminOrNull()` and `getTenantAdminContextOrNull()` (lines 32–35) — it does NOT load the
  request-scoped tenant context (`getTenantContextOrNull`), so it has no `tenant.settings`
  today** (relevant to Condition 6). Theming = 5 CSS vars in `globals.css` plus brand blues in
  `tailwind.config.ts`; an OS `prefers-color-scheme: dark` block exists. No Panel/Card component
  (sections are inline `rounded-xl border`). Per-org config lives in `tenants.settings` JSONB and
  `tenant_modules.settings`; `users.settings` column exists but is unused — **no per-user prefs
  store**.
- **`record_relationships` and `relationships` are RLS-protected** (`sql/001-enable-rls.sql`)
  with `FORCE ROW LEVEL SECURITY` and the `NULLIF(...)::uuid` guard. Any new read/write of these
  tables is inside RLS scope and needs cross-tenant tests under the `adserve_app` harness.

### Net-new vs modification (scope reconciliation — accepted, Locked Decision 7)

| Brief item | Status | Why |
|---|---|---|
| contact↔account M2M | MODIFICATION (in-place enum flip) + NET-NEW (UI + write path) | junction already M2M; only the enum value flip + missing editor are the work |
| opportunity↔one account | ALREADY CORRECT | `opportunity_belongs_to_account` stays `many_to_one` |
| opportunity↔many contacts | MODIFICATION (in-place enum flip, slug UNCHANGED) + NET-NEW (UI + write path) | `opportunity_has_primary_contact` flips to `many_to_many`; **slug + constant unchanged** (Condition 1); "primary" moves to junction `metadata.isPrimary` |
| Lead convert button + flow | ALREADY EXISTS | enhance only |
| convert: warn account-exists | NET-NEW | no duplicate check today |
| convert: warn contact-exists-in-account | NET-NEW | no duplicate check today |
| convert: opp name `<Account> <date>` | MODIFICATION | currently `<Account> opportunity` |
| convert: read-only + back-links | NET-NEW (records.data JSONB write only) | no read-only enforcement / no back-links today |
| Collapsible/pinnable nav | NET-NEW | static nav today |
| Panel/elevation design system | NET-NEW | inline styles today |
| Admin-selectable per-org palette | NET-NEW | no palette mechanism today |
| Account detail tabs for contacts/opps | MODIFICATION | generic detail page renders a flat sidebar list today |

## Scope / non-scope

**In scope:**
1. Relationship cardinality reconciliation via **in-place enum flip** for `contact_belongs_to_account`
   (→ M2M) and `opportunity_has_primary_contact` (→ M2M; **slug retained**), plus an idempotent
   data-migration for existing tenants. `opportunity_belongs_to_account` stays `many_to_one`.
2. A net-new, permission-gated relationship link/unlink API and editing UI (contact-create account
   picker; account-detail add/remove contacts & opportunities; opportunity-detail manage contacts),
   including `metadata.isPrimary` management with the single-primary invariant enforced
   app-level in the same transaction.
3. Lead-convert enhancements: two-phase duplicate-warning contract (409 warn → confirm → proceed),
   link-to-existing-on-confirm (no duplicate accounts/contacts), dated opportunity name,
   server-enforced read-only converted leads, and JSONB back-links (`records.data.convertedTo`).
4. Design-system foundation: CSS-var token set (spacing/type/elevation/palette), a reusable
   server-safe `Panel` primitive, applied to CRM page sections.
5. Collapsible + hover-expand + pinnable left nav with active-state (localStorage pin state).
6. Admin-selectable per-org palette stored in `tenants.settings.theme`, applied whole-app via a
   per-request server-resolved inline style.
7. Account-detail "associated Contacts and Opportunities" tabbed view, ordering primary links first.

**Non-scope (explicit):**
- **No rename of the `opportunity_has_primary_contact` relationship slug** and no change to the
  `OPPORTUNITY_HAS_PRIMARY_CONTACT` constant (Condition 1). A rename is explicitly out of scope.
- **No new relationship TYPE / no new seed-registry row for converted-lead back-links** — back-links
  are an ordinary `records.data` JSONB write on the lead (Locked Decision 2 / Condition 8). This is
  the reviewer-confirmed viable path and must not be confused with the rejected "new relationship
  type" option.
- No sharding of the JSONB `records` model (ARCHITECTURE.md §1 — deliberate single-table model).
- No new entity types or new modules.
- No change to the RLS policy *shape* (the `NULLIF` guard, `FORCE RLS`, `withTenant`/bypass
  contract) — only additive, RLS-respecting reads/writes. No new `withSuperAdminBypass` call site.
- No Clerk config changes; no production DB migration applied (queued as gated).
- No global component library adoption (one `Panel` primitive + tokens, not a framework).
- No per-user preferences *table* (nav pin uses localStorage — Locked Decision 5).
- No new CRM permission (matrix stays at 22).

## Design approach & ARCHITECTURE.md invariants touched

- **§1 Multi-tenancy/RLS.** All relationship reads/writes go through `withTenant(tenantId, …)`.
  The new link/unlink path inserts/deletes `record_relationships` rows under tenant context; the
  `WITH CHECK` policy already forces `tenant_id` match. No `withSuperAdminBypass` is introduced.
  **No bare `''::uuid` cast**; we reuse the existing `NULLIF` policy untouched. Cardinality
  enforcement and the single-primary invariant are application-layer inside the same transaction,
  never a substitute for RLS.
- **§2 Permissions & cosmetic-vs-enforced.** Every new write path declares and server-enforces a
  permission via `apiRequirePermission` (or the `canMutate` permission-OR-ownership gate for
  member-owned records). Client `<PermissionGate>` and any UI read-only treatment remain
  **cosmetic**; the converted-lead read-only rule is enforced **server-side** in the PATCH path
  (Condition 8).
- **§3 Server/client boundary.** The `Panel` primitive is a pure presentational component with no
  server-only imports. Nav collapse/pin state is client-only; palette tokens are injected
  server-side as inline CSS-var style on a layout wrapper so no DB client leaks into client code.
- **§5 The four gates.** Lint (boundary rule), production build, Docker build, and the
  RLS-enforced `adserve_app` test harness must stay green. New tests run under that harness.
- **§6 Protected paths / human gate.** Any change under `packages/database/sql/**`, RLS-table
  schema, or the relationship seed that needs a backfill/migration is a PROTECTED PATH and a
  standing human gate. Flagged per workstream below.

---

## Workstreams (sequenced, with effort / risk / order)

Recommended order: WS0 → WS1 → WS2 → WS3 → WS4 → WS5 → WS6. WS4 (design tokens/Panel) and WS5
(nav) are frontend-only and can run in parallel with WS1–WS3 if staffed separately, but the
account-detail UI (WS3) should consume the Panel primitive, so land WS4 before WS3's UI polish.

### WS0 — Decision capture (S, low) — order 1
All decisions are now LOCKED (see "Resolved decisions (locked)" below). WS0 is documentation only:
record the locked answers in `docs/phase-3-status.md` before touching code. No code.

### WS1 — Relationship cardinality flip + data migration (M, **HIGH**, PROTECTED PATH) — order 2
- Edit `packages/crm/src/relationships.ts`: flip **only** `relationship_type`/`cardinality`:
  - `CONTACT_BELONGS_TO_ACCOUNT.cardinality` → `"many_to_many"`.
  - `OPPORTUNITY_HAS_PRIMARY_CONTACT.cardinality` → `"many_to_many"`. **Keep the `name`
    (`"opportunity_has_primary_contact"`) and the exported constant identifier unchanged**
    (Condition 1). The "primary" concept now lives in `record_relationships.metadata.isPrimary`,
    not in the slug.
  - `OPPORTUNITY_BELONGS_TO_ACCOUNT` stays `"many_to_one"`.
  - The descriptions may be reworded (cosmetic), but the `name` slugs MUST NOT change.
- **Migration hazard (verified, lines 152–157 of `activate.ts`):** the activation existing-row
  check keys on `relationshipType`. With the enum flipped at the spec level, re-activation of a
  tenant that already has the `many_to_one` rows would INSERT new `many_to_many` rows (duplicates),
  orphaning the in-flight cardinality. Therefore WS1 ships a one-off, idempotent reconciliation
  script (`packages/database/sql/NNN-reconcile-crm-cardinality.sql` → PROTECTED PATH, human gate)
  that, per tenant, **flips `relationship_type` IN PLACE** on the existing rows, keyed on `name`:
  ```
  UPDATE relationships
     SET relationship_type = 'many_to_many'
   WHERE name IN ('contact_belongs_to_account','opportunity_has_primary_contact')
     AND relationship_type = 'many_to_one';
  ```
  In-place UPDATE keeps every `record_relationships.relationship_id` FK pointing at the same row —
  **no junction rewrite, no orphaning.** Wrap in a transaction (the `many_to_many` enum value
  already exists, unlike sql/004, so this is transaction-safe). No GUC touched; no bare `''::uuid`.
  Include a post-condition count assertion (junction row count unchanged) in the migration test.
- **Activation idempotency follow-up:** after the in-place flip, a subsequent `activate` call will
  no longer find a `many_to_one` row for these two and (because the spec now declares
  `many_to_many`) will find the flipped row and skip — so re-activation does not re-duplicate.
  A test asserts: flip migration, then re-run activation, then assert exactly one row per name
  per tenant.
- **No `record_relationships` data changes** for contact↔account or opp↔contact — existing rows are
  already valid M2M links; we only widen the declared cardinality.
- **Cardinality enforcement decision (locked, Decision 3):** enforce only
  `opportunity_belongs_to_account` as a true singleton (one account per opportunity) in the WS2
  write path; leave the two M2M relationships unconstrained on count. Enforcement is
  application-layer in the link transaction, not RLS.
- **Gate:** the migration SQL touches `packages/database/sql/**` and existing-tenant data →
  human gate (apply to prod RDS is queued, never run unattended). Local dev apply is reversible
  and runs in-run.

### WS2 — Relationship link/unlink API + cardinality guard + primary invariant (M, med) — order 3
- New endpoint family (net-new): `POST` and `DELETE` for a record-to-record link, e.g.
  `apps/web/src/app/api/crm/[entityType]/[id]/relationships/route.ts` accepting
  `{ relationshipName, targetRecordId, isPrimary? }`. One `withTenant` transaction per call.
- **Permission gating — member ownership escape-hatch (locked, Condition 4).** Decision: **link/
  unlink honours the SAME permission-OR-ownership escape-hatch as the generic record PATCH/DELETE
  path** (option (b)). Rationale: relating records you own is an edit to records you own; gating
  purely on `.update` would silently strip members of the ability to relate their own records,
  contradicting the documented `role-assignments.ts` contract (lines 3–13, 25–27). Implementation:
  reuse the existing `canMutate(ctx, '<owningSlug>.update', owningRecord.ownedBy)` gate from
  `[id]/route.ts`. The "owning" record is the one whose `[entityType]/[id]` the route is scoped to
  (e.g. linking contacts on an account requires `account.update` OR account ownership). **Both the
  owning record AND the target record must resolve under the caller's `withTenant` context** (a
  cross-tenant target id returns zero rows under RLS → `404`, never a cross-tenant link).
- **Cardinality guard:** before insert, if the relationship is `many_to_one` on the source side
  (only `opportunity_belongs_to_account`), delete any existing link of that relationship for that
  source inside the same transaction (replace semantics). The unique index already prevents
  duplicate identical links. The two M2M relationships are unconstrained on count.
- **`isPrimary` single-primary invariant (locked, Condition 5).** The unique index is only
  `(relationshipId, sourceRecordId, targetRecordId)` — `metadata.isPrimary` is unconstrained JSONB,
  so nothing at the DB level prevents two primaries for one source. Enforce app-level inside the
  WS2 transaction: when a link is created/updated with `metadata.isPrimary = true`, first clear
  `isPrimary` on ALL sibling links for the same `(relationshipId, sourceRecordId)` (a same-tx
  `UPDATE ... SET metadata = metadata - 'isPrimary'` or `jsonb_set(... false)`), then set it on the
  target link. **The read-modify-write is acknowledged as racy under concurrent writers; this is
  accepted for v1** (two simultaneous primary-sets could briefly both win; the unique index does
  not cover it). Stated explicitly, not left silent. Unsetting/deleting the current primary leaves
  the source with zero primaries (allowed).
- **Unlink-last-link semantics (locked, Condition 9).** Unlinking the SOLE account from a contact
  (or the SOLE contact from an opportunity) is ALLOWED and leaves an orphaned record (no confirm
  required at the API layer; the UI may show a soft confirm but the server does not block). An
  opportunity may legitimately have zero contacts and a contact zero accounts. Removing the
  `opportunity_belongs_to_account` link likewise leaves the opportunity account-less (allowed).
- **Audit:** write an `audit_log` row (`action: "link"` / `"unlink"`, `resourceType:
  "relationship"`) inside the transaction, mirroring existing audit conventions in
  `@/lib/crm/audit`.

### WS3 — Contact-create account picker + account/opportunity detail editing UI (M, med) — order 4
- **Contact create:** extend the create flow so the user picks one or more accounts; wrap
  create+link in a single new server endpoint/action inside ONE `withTenant` transaction (avoids a
  half-created contact with no account). Runs under `contact.create` (with the create-time owner
  being the acting user, so ownership escape-hatch is moot at create).
- **Account detail:** add the "associated Contacts and Opportunities" tabbed view (recommendation
  below), each tab listing linked records with add/remove, **ordering primary links first** (reads
  `metadata.isPrimary` exposed by the extended loader — WS3/Condition 7).
- **Opportunity detail:** manage associated contacts (add/remove, set-primary) and show the single
  account.
- **Empty-state / backfill handling (locked, Condition 9):**
  - Tenants whose records have zero links render an explicit empty state per tab ("No contacts
    linked yet"), not a broken/blank panel.
  - Pre-existing converted leads that lack `data.convertedTo` (converted before this feature
    shipped) render gracefully: the back-link section is simply absent (no "undefined" link, no
    error). The read-only enforcement (Condition 8) keys on `data.status === "converted"`, which
    pre-existing converted leads already have, so they too become read-only.
- All editing UI gated client-side by `<PermissionGate>` (cosmetic) and server-side by WS2.

### WS4 — Design-system tokens + Panel primitive (M, low) — order 5 (land before WS3 UI polish)
- Expand `globals.css` token set; add `Panel` primitive; refactor CRM page sections to use it.
- Server/client safe (§3). No DB imports.

### WS5 — Collapsible / hover-expand / pinnable nav + active-state (M, low) — order 6
- Convert the static sidebar into a client `NavShell`: collapses to icons-only, expands on hover,
  can be pinned, highlights the active route via `usePathname`. Server layout still resolves
  super-admin/tenant-admin context and passes nav data + initial state as props.
- **Pin persistence:** localStorage-only for v1 (Locked Decision 5). Server renders a sensible
  default (expanded); client hydrates from localStorage. **A brief nav-pin hydration flash is an
  accepted, separate surface** from the palette (the palette is flash-free per Condition 6).

### WS6 — Admin-selectable per-org palette (M, med) — order 7
- Storage: `tenants.settings.theme = { palette: "<id>" }` (JSONB, no migration), set via the
  tenant-admin settings surface, gated `tenant.admin` / `crm.admin`.
- Apply whole-app. See "Admin-selectable per-org palette" in Frontend for the per-request read
  site and no-cross-request-caching requirement (Condition 6).
- Depends on WS4 (tokens are what the palette overrides).

---

## Schema changes (detail)

- **No new tables, no new columns** on `records` / `record_relationships`. The JSONB records model,
  the M2M junction, and the existing `record_relationships.metadata` JSONB column are reused as-is
  (ARCHITECTURE.md §1). `metadata.isPrimary` is stored in that existing column.
- **Enum:** `relationship_type` already has `many_to_many` and `many_to_one`. No enum change.
- **Seed/registry (`packages/crm/src/relationships.ts`):** flip the `cardinality` value in place for
  the two relationships moving to M2M; **slugs/`name`s and exported constants unchanged**
  (Condition 1).
- **Migration script** (PROTECTED PATH, `packages/database/sql/NNN-reconcile-crm-cardinality.sql`):
  idempotent, keyed on `name`, in-place `UPDATE relationships SET relationship_type = 'many_to_many'
  WHERE name IN ('contact_belongs_to_account','opportunity_has_primary_contact') AND
  relationship_type = 'many_to_one'`. Transaction-wrapped (enum value exists). No GUC, no bare
  `''::uuid`. Post-condition: junction row count unchanged; exactly one registry row per name per
  tenant.
- **Convert enhancements need no schema change.** The converted-lead back-links are stored as a
  `records.data.convertedTo = { accountId, contactId, opportunityId }` JSONB write on the lead's own
  record inside the existing `withTenant` convert transaction (Locked Decision 2 / Condition 8).
  **This is an ordinary `records.data` write — NOT a new relationship type, NOT a new
  seed/registry row, NOT a schema change — and does not touch the protected seed/registry path.**
- **Palette storage:** `tenants.settings.theme` (JSONB) — no migration.

All reads/writes of `records`, `record_relationships`, `relationships` stay inside `withTenant`
with the existing `NULLIF` policy. FORCE RLS remains. No bare `''::uuid`.

---

## Backend (detail)

### Permission gating (which of the 22)
- **Convert:** stays the single `lead.convert` permission, authorizing creation across 3 entities
  (Locked Decision 6). The three-creates coupling is documented in the route (see below) — the
  user need not individually hold `account.create` / `contact.create` / `opportunity.create`.
- **Link/unlink contact↔account / opportunity↔contacts / set opportunity→account:** the
  permission-OR-ownership gate (`canMutate`, Condition 4) on the owning entity's `.update`:
  - Account-side contact/opportunity management → `account.update` OR account ownership.
  - Contact-side account management → `contact.update` OR contact ownership (or `contact.create`
    during the initial create+link wrapper).
  - Opportunity-side contact management / account set → `opportunity.update` OR opportunity
    ownership.
- We do **not** introduce a new permission for relationships (keeps the matrix at 22, avoids
  re-seeding existing tenants).

### Convert transaction shape (enhanced) — atomicity pinned (Condition 2)
Preserve the single atomic `withTenant` transaction. Enhancements, in this exact order:
1. **All duplicate-check SELECTs run BEFORE the first `tx.insert`.** Inside the transaction, before
   creating anything: query for an existing non-archived account whose `data->>'name'` equals the
   computed account name; if found (or proceeding with a matched account), query for an existing
   contact of the same name linked to that account.
2. **Warn path returns a discriminated outcome (or throws) BEFORE any insert.** On an unconfirmed
   POST with a match, return a discriminated result (`kind: "account_exists" | "contact_exists" |
   "both"`) from the `withTenant` callback so the route maps it to `409 { warning, existing: {...} }`.
   **Because the dup checks are read-only and sit at the top of the tx, an early return commits
   nothing** (no inserts have happened). This is explicitly safer than a plain early-return placed
   *after* inserts, which WOULD commit — that ordering is the load-bearing detail. (Equivalently,
   a thrown error rolls the tx back; either mechanism leaves zero writes.)
3. **Confirmed POST (`?confirm=1` / `{ confirm: true }`) — link-to-existing in ONE `withTenant` tx
   (Locked Decision 1).** On confirm: for any matched account/contact, **link to the existing
   record** (no duplicate create); create only what is missing (e.g. always the opportunity).
   The entire confirmed path stays inside a single `withTenant` transaction. **Matched entities
   emit `link` audit rows, newly-created entities emit `create` audit rows** (Condition 2).
4. **Opportunity name** → `` `${accountName} ${conversionDate}` `` where `conversionDate` is the
   transaction date formatted `YYYY-MM-DD` (locale-stable). Replaces the line-107 literal.
5. **Converted-lead back-links** → set `lead.data.convertedTo = { accountId, contactId,
   opportunityId }` in the same `records.data` update that sets `status: "converted"` (the existing
   line-172 write, extended). Ordinary JSONB write; no protected-path touch.
6. **Audit rows:** one `create` per newly-created entity, one `link` per matched-existing entity,
   one `update` for the lead — all inside the tx.

### Server-side converted-lead read-only (Condition 8)
- UI read-only is cosmetic per ARCHITECTURE.md §2 and is NOT sufficient. The generic record PATCH
  path (`api/crm/[entityType]/[id]/route.ts`) MUST reject edits to a lead whose
  `data.status === "converted"`, server-side, returning a clear status (recommend `409
  { error: "Lead is converted and read-only" }`). This sits inside the existing `withTenant` PATCH
  transaction, after the record is loaded, before the update. A test asserts a PATCH against a
  converted lead is rejected and writes nothing.
- The back-links (`data.convertedTo`) are stored as `records.data` JSONB on the lead — restating:
  no protected-path touch, no new relationship type.

### RLS / permission notes in convert
- The single `lead.convert` grant authorizes cross-entity creation. member lacks `lead.convert`
  (member's grants per `role-assignments.ts` are read-only + `activity.create`), so no current
  escalation. The route documents the three-creates coupling (Condition 3). A test pins exactly
  which roles hold `lead.convert` (see Test obligations).
- Duplicate-check reads are tenant-scoped via `withTenant`; tenant A cannot see tenant B's
  accounts during the check (RLS). Confirmed by the cross-tenant convert test below.
- The link/unlink endpoint validates that BOTH the owning and target records resolve under the
  caller's tenant context; a target id from another tenant returns zero rows under RLS → `404`.

---

## Frontend (detail)

### `loadRecordWithRelationships` extension (Condition 7)
Today `loadRecordWithRelationships` (`apps/web/src/lib/crm/relationships.ts` lines 44–58) selects
ONLY `sourceRecordId` and `targetRecordId` from `record_relationships`, then groups related records
by entity-type slug. It **drops the relationship `name` and the `metadata`** — so the account/
opportunity detail tabs cannot order by `metadata.isPrimary` or distinguish relationship types.
**Fix: add `name`/`relationshipId` resolution and `metadata` as ADDITIONAL COLUMNS on the EXISTING
rels SELECT** (lines 44–58), and carry them through into the grouped output (e.g. attach
`{ relationshipName, metadata, isPrimary }` to each related record entry). **This keeps the bounded
4-query count — it is additive columns on the existing query, NOT a new query.** (Note: the prior
draft's "no new query" wording was imprecise; the correct statement is "additional columns on the
existing query.") If resolving the relationship `name` requires the `relationships` registry, fold
it into the existing entity-type lookup query rather than adding a 5th round-trip; the bound stays
at 4. The grouped shape gains per-entry relationship metadata so tabs can sort primary-first.

### Design-system tokens (CSS vars) and Panel primitive
Add to `globals.css` `:root` (names illustrative; final names confirmed in WS4):
- **Spacing scale:** `--space-1: 0.25rem` … `--space-8: 2rem` (4px base, geometric).
- **Type scale:** `--text-xs … --text-2xl` with `--leading-*` companions.
- **Elevation:** `--elevation-0..3` as box-shadow tokens; `--radius-panel: 0.75rem`.
- **Surface tokens:** `--panel-bg`, `--panel-border`, `--page-bg`.
- **Palette tokens:** the existing 5 vars plus a small swap set (`--accent`, `--accent-foreground`,
  brand ramp mapped to vars).

`Panel` primitive (`apps/web/src/components/ui/panel.tsx`): a presentational wrapper applying the
panel/elevation/radius/spacing tokens with optional `title`/`actions` slots. Pure props, **no
server-only imports** (§3), usable from server and client. CRM page sections refactor inline
`rounded-xl border` blocks to `<Panel>`.

### Collapsible / hover-expand / pinnable nav
- Split `(platform)/layout.tsx`: keep the server layout (resolves super-admin/tenant-admin context,
  builds nav items) and pass items + initial state into a new client `NavShell`.
- Collapsed = icons only (`w-16`); hover expands (transient); a pin toggle persists "expanded"
  state in localStorage (Locked Decision 5). Active route highlighted via `usePathname`. A brief
  pin-state hydration flash is accepted (separate from the flash-free palette).

### Admin-selectable per-org palette — read site + no cross-request caching (Condition 6)
- **The platform layout does NOT currently load `getTenantContextOrNull`** (it loads only
  super-admin and tenant-admin contexts, lines 32–35). To apply the palette, add a request-scoped
  load of the tenant context (or a narrower `tenants.settings.theme` read) in the server
  `(platform)/layout.tsx`, resolving the palette **per request**.
- **No cross-request caching of the palette.** Do NOT memoise the resolved palette at module scope,
  and do NOT wrap the read in an unkeyed `cache()` that could serve tenant A's palette to tenant B
  on a later request. The read must be keyed to the request's tenant and recomputed per request.
- **Flow to CSS vars:** the layout emits an inline `style={{ ...paletteVars }}` (or a
  `data-palette` attribute mapped to a static CSS catalog) on the layout root wrapper — server-side,
  so no DB client crosses the client boundary (§3). Inline server style means **no palette
  hydration flash**. A fixed catalog of admin-selectable palettes keyed by id (e.g. `grey-blue`
  default, `slate`, `emerald`, `violet`); admins pick from the catalog, not arbitrary hex.
- **Acceptance:** selecting a palette for tenant A changes A's render and **no other org is
  affected** (test below).

### Account-detail "associated Contacts and Opportunities" — recommended pattern
**Tabbed panels** ("Contacts" / "Opportunities", with "Details" and "Activity" also as tabs) over
the current flat sidebar list. Implement as a client tab strip inside `crm-detail-client.tsx`
(account variant), sourced from the loader's grouped relationships map (now carrying
`metadata.isPrimary` per Condition 7) — **primary-linked records sort first**. Add/remove/set-primary
controls call WS2.

---

## Acceptance criteria (QA-derivable without reading implementation)

### WS1 — Cardinality reconciliation
1. After migration, the registry row `contact_belongs_to_account` has `relationship_type =
   'many_to_many'`; `opportunity_has_primary_contact` has `relationship_type = 'many_to_many'`
   **and its `name`/slug is unchanged**; `opportunity_belongs_to_account` remains `many_to_one`.
2. The `OPPORTUNITY_HAS_PRIMARY_CONTACT` constant and its `.name` are unchanged; the convert route
   still imports them and still creates the opp↔contact link (regression guard — Condition 1).
3. The migration is idempotent: running it twice, and running activation after it, leaves exactly
   one registry row per relationship name per tenant with identical `relationship_type`.
4. The count of `record_relationships` rows per tenant is identical before and after the migration
   (no junction rewrite, no orphans); every `record_relationships.relationship_id` still references
   a live `relationships.id`.

### WS2 — Link/unlink API
5. `POST .../relationships` with valid `{ relationshipName, targetRecordId }` and the required
   permission-or-ownership returns `201` and creates exactly one `record_relationships` row.
6. A duplicate identical link does not create a second row (unique index holds); the response is a
   defined idempotent/`409` outcome (asserted).
7. `DELETE` removes only the targeted link row and returns `200`/`204`; unlinking the SOLE link of
   a relationship is allowed and leaves the record orphaned (no server block).
8. Linking `opportunity_belongs_to_account` when one already exists REPLACES it (single row
   remains for that source/relationship).
9. Setting `metadata.isPrimary = true` on one link **unsets it on all sibling links for the same
   source**; at no point do two links for the same `(relationshipId, sourceRecordId)` both carry
   `isPrimary = true`. Unsetting/deleting the primary leaves zero primaries (allowed).
10. A `link`/`unlink` `audit_log` row (`resourceType: "relationship"`) is written inside the same
    transaction.

### WS3 — Editing UI / contact-create picker
11. On contact create with N selected accounts, the contact is created and exactly N
    contact↔account links exist, atomically (a forced link failure leaves no half-created contact).
12. The account detail page shows tabs listing all linked Contacts and Opportunities with
    add/remove; primary-linked records sort first; the list reflects changes after refresh.
13. The opportunity detail shows its single account and associated contacts with add/remove and
    set-primary.
14. A tenant with zero links renders an explicit per-tab empty state (no blank/broken panel).
15. A pre-existing converted lead lacking `data.convertedTo` renders gracefully (back-link section
    simply absent; no error).

### WS4 — Design system
16. A `Panel` primitive renders with the elevation/border/radius/padding tokens and is used by at
    least the CRM detail, list, and dashboard sections.
17. `Panel` imports no server-only module (lint boundary gate stays green).

### WS5 — Nav
18. Collapsed nav shows icons only; hovering expands it; the pin toggle keeps it expanded across
    navigations within a session (localStorage); the active route is visually highlighted.

### WS6 — Palette
19. A tenant admin can select a palette from the catalog; after save, the app renders with the
    selected palette's CSS-var values for that org and **no other org is affected**; the palette is
    resolved per request (no cross-request leak), with no hydration flash.

### Convert enhancements
20. Converting a lead produces an opportunity whose name is exactly `<Account name> <YYYY-MM-DD>`.
21. When the computed account name matches an existing non-archived account, the default
    (unconfirmed) convert returns `409 { warning: "account_exists", ... }` and **writes nothing**
    (row counts unchanged) — because the dup checks run before the first insert.
22. When a contact of the same name already exists within that account, the default convert returns
    `409 { warning: "contact_exists", ... }` and writes nothing.
23. A confirmed convert **links to the existing** matched account/contact (no duplicate create),
    creates only what is missing, stays atomic, emits `link` audit rows for matched entities and
    `create` rows for new ones, and stores `lead.data.convertedTo = { accountId, contactId,
    opportunityId }`.
24. A PATCH to a lead whose `data.status === "converted"` is rejected server-side and writes
    nothing (read-only enforced server-side, not just in the UI).

---

## Test obligations (QA must prove; run under the RLS-enforced `adserve_app` harness)

**Relationship reads/writes (WS1–WS3) — RLS cross-tenant isolation (MANDATORY, every new write path):**
- No-predicate isolation: a `withTenant(A)` SELECT of `record_relationships` returns **only** A's
  links; a missing/empty context returns **zero** rows (NULLIF guard), never another tenant's.
- `withSuperAdminBypass` (test harness only) sees **both** tenants' links — the control proving the
  policy gates the data, not app filtering. (This feature introduces no new bypass call site; this
  is the control for the isolation assertion.)
- Link endpoint cross-tenant: a caller in tenant A linking to a `targetRecordId` in tenant B gets
  `404` (RLS returns zero rows for the target lookup) and creates no cross-tenant row.

**Convert (WS-convert):**
- **Atomicity (Condition 2):** a forced mid-transaction failure leaves **zero** new records, zero
  new links, **zero new audit rows**, and the lead `data.status` unchanged.
- Warn path A (account exists): default convert returns `409 account_exists`, writes nothing;
  control: a confirmed convert links to the existing account (no duplicate) and proceeds.
- Warn path B (contact exists in account): default convert returns `409 contact_exists`, writes
  nothing.
- Confirmed link-to-existing: matched account/contact get `link` audit rows (not `create`); newly
  created entities get `create` rows; everything in one `withTenant` tx.
- Cross-tenant: a same-name account in tenant B does NOT trigger a warning when converting in
  tenant A (RLS scoping).

**Converted-lead read-only (Condition 8):**
- A PATCH to a converted lead is rejected server-side and writes nothing.
- A pre-existing converted lead (status converted, no `data.convertedTo`) is also read-only.

**Permission / role-pin paths:**
- **Role-pin (Condition 3):** assert `lead.convert` is held by EXACTLY `{owner, admin}` and no
  other role — verified against `packages/crm/src/role-assignments.ts` (member's grants are
  read-only + `activity.create`; owner/admin hold all `CRM_PERMISSION_KEYS`).
- `lead.convert` missing → `403` from the convert endpoint.
- **Member ownership escape-hatch (Condition 4):** a member who OWNS an account/contact/opportunity
  CAN link/unlink its relationships (permission-OR-ownership), while a member who does NOT own the
  owning record and lacks the `.update` permission gets `403`. Both cases tested.
- Missing `account.update` / `contact.update` / `opportunity.update` AND no ownership → `403` from
  the respective link/unlink edits.

**M2M link/unlink + primary behavior:**
- Adding a second account to a contact yields two links (M2M proven); removing one leaves the other.
- `opportunity_belongs_to_account` replace semantics asserted (single row after re-link).
- Duplicate identical link does not create a second row.
- **Single-primary invariant (Condition 5):** setting a new primary unsets the old one; never two
  primaries for one source.
- **Unlink-last-link (Condition 9):** unlinking the sole account from a contact succeeds and leaves
  the contact orphaned.

**Empty-state / backfill (Condition 9):**
- Account/opportunity detail with zero links renders the empty state, not an error.

**Frontend gates:**
- Lint (server/client boundary) stays green with `Panel`, `NavShell`, and palette wiring.
- Production build + Docker build gates remain green (workspace-dependency copy intact).

---

## Gate notes (protected paths / standing human gates)

- **WS1 migration SQL** (`packages/database/sql/NNN-reconcile-crm-cardinality.sql`) and the
  relationship-seed cardinality flip are **PROTECTED PATHS** (ARCHITECTURE.md §6). Local-dev apply
  is reversible and runs in-run; **applying to production RDS is a queued, human-gated action** and
  is NOT run unattended.
- No RLS *policy* shape change is proposed — but because WS1 edits files under
  `packages/database/sql/**` and mutates existing-tenant data, the architect review + human gate
  apply.
- No new `withSuperAdminBypass` call site is introduced.
- The four CI gates (lint/boundary, production build, Docker build, `adserve_app` RLS test harness)
  must stay green.
- Merging/pushing to `main`, applying the migration to prod RDS, and any palette/secret/infra
  change remain on the standing GATED-ACTIONS list — feature branches and local-dev migrations
  proceed unattended.

---

## Resolved decisions (locked)

1. **Convert with existing account/contact → link to existing on confirm.** The confirmed POST
   links to the matched account/contact (no duplicate create), creates only what is missing;
   matched entities emit `link` audit rows. (Was Open Decision 1, option (a).)
2. **Converted lead → server-side read-only + JSONB back-links.** The lead becomes read-only
   (enforced server-side in PATCH, Condition 8), and back-links are stored as
   `records.data.convertedTo = { accountId, contactId, opportunityId }` — an **ordinary
   `records.data` write inside the convert `withTenant` tx. No new relationship type, no
   schema/seed change, no protected-path touch.** (Reviewer-confirmed viable.)
3. **contact↔account is TRUE M2M and opportunity↔contact is M2M, both with a "primary" concept via
   `record_relationships.metadata.isPrimary`.** Single-primary-per-source enforced app-level
   (Condition 5). (Was Open Decision 3.)
4. **Admin palette stored per-org in `tenants.settings.theme`, applied whole-app**, resolved
   per-request server-side with no cross-request caching (Condition 6). (Was Open Decision 4.)
5. **Nav pinned-state → localStorage for v1.** Hydration flash accepted. (Was Open Decision 5.)
6. **Convert stays a single bundled `lead.convert` permission** (creates all 3 records). The
   three-creates coupling is documented in the route; a test pins `lead.convert` to exactly
   `{owner, admin}` (Condition 3). (Was Open Decision 6, option (a).)
7. **Scope reconciliation accepted:** the already-built-vs-new breakdown stands; the in-place
   cardinality-flip migration and the two-phase (409 warn → confirm → proceed) convert flow are
   approved in principle. (Was Open Decision 7.) The brief's "23 permissions" is treated as 22
   (the 23rd is the platform `ai_usage.read`, outside the CRM matrix).

### Member link/unlink rule (resolved per Condition 4)
Link/unlink **honours the same permission-OR-ownership escape-hatch** as the generic record
PATCH/DELETE path (`canMutate`). A member can relate records they own; a member who lacks both the
`.update` permission and ownership gets `403`. Chosen over the `.update`-only option because the
latter would silently strip members of editing rights the `role-assignments.ts` contract grants.

---

### Relevant file paths (absolute)
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/packages/crm/src/relationships.ts`
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/packages/crm/src/activate.ts`
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/packages/crm/src/permissions.ts`
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/packages/crm/src/role-assignments.ts`
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/packages/database/src/schema/records.ts`
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/packages/database/src/schema/schema-engine.ts`
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/packages/database/sql/001-enable-rls.sql`
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/packages/database/sql/004-add-many-to-one-relationship-type.sql`
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/apps/web/src/lib/crm/relationships.ts`
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/apps/web/src/lib/permissions.ts`
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/apps/web/src/app/api/crm/leads/[id]/convert/route.ts`
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/apps/web/src/app/api/crm/[entityType]/route.ts`
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/apps/web/src/app/api/crm/[entityType]/[id]/route.ts`
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/apps/web/src/app/(platform)/layout.tsx`
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/apps/web/src/app/(platform)/crm/[entityType]/[id]/page.tsx`
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/apps/web/src/app/(platform)/crm/[entityType]/[id]/_components/crm-detail-client.tsx`
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/apps/web/src/app/globals.css`
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/apps/web/tailwind.config.ts`
