# Prototype SPEC — CRM Contact → Account picker

Prototype Mode / Stage 1. Branch `prototype/crm-contact-account-picker` (off main, local only,
never merges to main / never deploys to prod). See `docs/prototype-mode.md`.

## Goal

On the contact-create form, give the user a **single**, **searchable** account picker that scales
to thousands of accounts (server-side search), and lets them **create a new account inline** by
typing a name not in the list. On create-new, the account name is validated unique, the account is
created, and the contact is linked to it — atomically, in one tenant-scoped transaction.

"One account per contact" is a **prototype UX decision**, enforced in the picker (single-select)
and the endpoint (accepts at most one account). The underlying data model is unchanged (see
Production Considerations: DATA-MODEL DEFERRED).

## Current surface map (what existed before this prototype)

- `account-multi-select.tsx` — client-side checkbox **multi**-select, fetched `GET
  /api/crm/accounts?limit=200` (200-cap, no server search, no create-new). **Replaced** here.
- `POST /api/crm/contacts/with-accounts` — atomic contact-create + link to N existing accounts in
  one `withTenant` tx. **Extended** here with single-account + create-new branches.
- `POST /api/crm/leads/[id]/convert` — has the `lower(btrim())` unique account-name match (AC 21).
  Its match logic is **extracted** here into a shared helper and reused (convert behaviour
  unchanged).

## Planned extension (what this prototype builds — the audited gap, Option 2)

1. `account-picker.tsx` — single-select **searchable typeahead** (adserve-design tokens + `Panel`,
   light + dark), debounced **server-side** search. No new search endpoint: reuses the existing
   list endpoint's `filters` mechanism (`contains` ILIKE on the `name` text field).
2. Inline **"Create '<typed name>'"** affordance when search has no exact (case-insensitive) match.
3. `lib/crm/account-name.ts` — shared `lower(btrim())` normalisation extracted from convert and
   called by both convert and the new create-new branch.
4. `POST /api/crm/contacts/with-accounts` create-new branch: validate unique name via the shared
   helper → insert account → link contact, all in the existing single `withTenant` tx
   (all-or-nothing). On duplicate name → 409, nothing written.

## Iteration 2 — account is a first-class, admin-placeable field (no Panel)

Per product feedback, the account control must look like every other field and be positioned by
the admin, not sit in its own Panel above the form. Reworked so:

- **`account` is now a real `relationship` field definition** on the contact entity
  (`DEFAULT_CONTACT_FIELDS`, `displayOrder: 45`). It therefore flows through the normal field
  pipeline: rendered by `DynamicForm` → `FieldRenderer` → `RelationshipField`, wrapped in the
  shared `FieldShell` (label/description/error chrome) — identical chrome to every other field.
- **Admin placement** comes for free: the field appears in `generateDefaultLayoutConfig` and the
  admin layout editor already lists not-yet-placed fields as "unplaced" and lets the admin add
  them to any section/position. The admin moves/places `account` like any field.
- The searchable + inline-create picker (`components/crm/account-picker.tsx`) is now a **bare
  control** (no Panel); `RelationshipField` renders it for `field.slug === "account"` and falls
  back to the Phase-1 UUID input for any other relationship field.
- `DynamicForm` passes relationship-field values through without `records.data` coercion (the
  documented design: the caller routes relationship slugs into `record_relationships`). The
  contact-create client pulls `validated.account` (an `AccountSelection`) out of the submit and
  sends it as `accountId` / `newAccountName`; the endpoint skips relationship fields when building
  `records.data`.
- `loadEntityForm` appends any **unplaced** field to a trailing "More" section so a field added
  after a layout was persisted is never silently absent from the form (no-op once every field is
  placed). Existing tenants were reprovisioned (`pnpm --filter @adserve/crm reprovision-crm`) so
  the field exists; new tenants get it via activation.

## Iteration 3 — detail + edit parity for the account field

The account field was create-only (showed "—" on detail, not saved on edit). Now wired for
create/detail/edit parity, reusing the create-path machinery:

- **Load / hydrate** — `lib/crm/account-hydration.ts` (`accountSelectionFromRelationships`, a pure,
  client-safe, type-only-import helper) derives the field value from the contact's existing
  `contact_belongs_to_account` link. The detail client seeds `DynamicForm` `initialData.account`
  with it, so view shows the account name and edit pre-selects it.
- **Save on edit** — `lib/crm/contact-account.ts` (`applyContactAccount`) is the shared writer used
  by the contact PATCH route. It routes the same `accountId` / `newAccountName` selection as create
  and enforces one account via the link layer's **many_to_one REPLACE** branch: `createRecordLink`
  deletes the prior link and inserts the new one. Create-new validates uniqueness via the shared
  `findAccountByName`. Clearing the field removes the link. All in the existing single `withTenant`
  tx — a duplicate/invalid account returns before the data write, so nothing is persisted.
- **Contract** — the PATCH body carries an optional `account` directive
  (`{ accountId } | { newAccountName } | null`); its **presence** is the signal to apply (null =
  clear), its absence leaves links untouched (partial-update safe). Relationship fields are skipped
  in the PATCH `records.data` loop (same as create).
- The detail page's existing "Related" sidebar still lists the linked account; the field is the
  editable surface.

## Iteration 4 — Primary + Related accounts (two relationships)

Per the Rev-5 plan, contact↔account is split into TWO relationships sharing the junction:

- **`contact_belongs_to_account` → `many_to_one`** (PRIMARY, "Primary Account") — exactly one.
  The spec cardinality was flipped from M2M to M2O in `relationships.ts`; the local dev tenant's
  existing registry row was flipped with a one-off SQL `UPDATE` (activate skips-on-match by name).
  The forced `relationshipType: "many_to_one"` override in `applyContactAccount` was **dropped** —
  the real (M2O) relationship now drives the REPLACE branch.
- **`contact_related_to_account` → `many_to_many`** (NEW, "Related Accounts" / "Related Contacts")
  — zero or many; registered in `relationships.ts` + provisioned via `activate.ts`.
- **No self-overlap:** a contact may not be RELATED to its own PRIMARY account. Enforced at write
  (the WS2 link route rejects it 422; `applyRelatedAccounts` filters the desired set against the
  primary; setting a primary drops any related link to that account — primary wins).
- **Read path is edge-driven:** `loadRecordWithRelationships` now emits one `RelatedRecord` per
  relationship EDGE (group by `(otherId, relationshipName)`), so primary vs related to the same
  account stay distinct. Detail UI splits the lists in-memory by `relationshipName` (no extra
  queries).
- **API:** the create + PATCH contracts take a primary `account` directive
  (`{accountId}|{newAccountName}|null`) plus `relatedAccounts` (a full desired set keyed by
  presence; entries are `{accountId}` or `{newAccountName}`). Combined PATCH applies **primary
  first, then related** filtered against it. All in one `withTenant` tx; a duplicate/invalid/
  cross-tenant id throws `ContactAccountAbort` → the whole tx rolls back (atomic). The **legacy
  `accountIds[]` multi-primary path is REMOVED**.
- **UI:** account detail has a single **Contacts** tab containing two tables (`ContactsTable`):
  **Contacts** (primary/employees) and **Linked Contacts** (related) — one entity to the user; the
  primary-vs-related DB split stays under the hood. Each table shows Name · Title · Account · Email ·
  Telephone · LinkedIn with add/remove (WS2 route). The **Account** column is each contact's PRIMARY
  account, enriched by `loadPrimaryAccountsForContacts` (bounded, account-scoped, in
  `loadCrmDetailData`). Contact detail shows an editable **Related Accounts** panel
  (`RelatedRecordsPanel`). Primary stays the inline single-select field on the contact form.

### Deferred from this iteration (logged — rebuild scope)

- **Create-FORM related control:** the create endpoint accepts `relatedAccounts`, but the contact
  *create form* has no related multi-select control yet — related accounts are added on the contact
  detail page post-create. (Covered by endpoint tests.)
- **Inline create-new on the detail Related panels:** `RelatedRecordsPanel` / `LinkRecordPicker`
  link EXISTING records only (and still 200-cap, no typeahead). Create-new for related is supported
  by the `relatedAccounts` endpoint directive, not the detail panel. Rebuild should give the related
  panels the same searchable + create-new control as the primary picker.

## Iteration 5 — Account Contacts tab UX (layout + create-from-account)

- **Layout:** the Contacts tab is a full-height flex column; each `ContactsTable` panel stretches to
  fill (`fillHeight`), the table area scrolls within the panel, full-width, with **banded rows**
  (even-row tint).
- **Create a contact from the account page (creation context #2):** the top **Contacts** table has
  a **New contact** action. It opens a modal reusing `DynamicForm` with the contact fields (the
  `account` relationship field is omitted from the editable form) and shows the **Account read-only**
  = this account's name. On submit it POSTs `with-accounts` `{ data, accountId: <this account> }`, so
  the new contact's **primary account is inherited** from the page. The contact form bundle (fields +
  layout) is loaded for the account detail via `loadEntityForm(slug:"contact")` in `loadCrmDetailData`.
- **Two creation contexts (confirmed):** (1) from the contacts LIST page, the account is an editable
  picker (the inline `AccountPicker` picklist + create-new); (2) from the ACCOUNT page, the account is
  read-only and inherited. Both POST the same `with-accounts` endpoint.
- "Add contact" (link an EXISTING contact via the WS2 route) remains on both tables alongside "New
  contact" on the primary one.

## Iteration 6 — no deletion; inactive lifecycle

Contacts and accounts are **never hard-deleted** — only marked **inactive**. Decision:
**"inactive" = the existing `isArchived` soft-delete flag** (the requirement is about replacing
deletion, which is exactly what `isArchived` is), NOT the `status` field's "Inactive" choice (a
separate sales attribute — naming-collision flagged below).

- **No hard delete:** confirmed — nothing hard-deletes a `records` row anywhere; the "delete" action
  only sets `isArchived = true`.
- **Excluded from picklists:** the account picker (`AccountPicker`) and the link picker
  (`LinkRecordPicker`) both query the list endpoint, which excludes `isArchived` by default — so
  inactive contacts/accounts never appear when adding new records. (Already true; verified.)
- **Tables hide inactive by default + checkbox:** the account-detail `ContactsTable` panels now hide
  inactive rows by default and expose a **"Show inactive (n)"** checkbox to reveal them (struck
  through). The contacts/accounts LIST pages already had this via the shared `FilterBar`
  "Include archived" toggle.
- **Vocabulary:** the contact/account detail header relabels **Archive → "Mark inactive"** and the
  **"Archived" badge → "Inactive"**. Other entities (lead/opportunity) keep "Archive".

### Deferred / notes (rebuild)
- **Vocabulary not yet unified:** the shared `FilterBar`/`DynamicTable` still say "archived"
  (so contacts/accounts LIST pages show "Include archived", not "Show inactive"). A global rename
  touches all entities — left for a deliberate pass.
- **No UI reactivation:** marking inactive has no in-UI "Reactivate" (un-archive) yet — parity with
  the prior Archive (which also had none). Add a reversible toggle in the rebuild.
- **`status` "Inactive" collision:** both contacts and accounts have a `status` field whose choices
  include "Inactive". That's a distinct business attribute from the `isArchived` lifecycle; the
  rebuild should reconcile the naming so "Status: Active" + lifecycle "Inactive" can't co-occur
  confusingly.

## Iteration 7 — Contact details: panelled field set (configurable layout)

Reworks the contact form toward the supplied design, "achieved consistent with admin settings" —
i.e. expressed as **field definitions + layout sections (panels)**, not hardcoded, so the admin
layout editor can add/remove panels and move fields.

- **Default contact field set expanded** (`DEFAULT_CONTACT_FIELDS`) and grouped into panels via
  `groupName` → `generateDefaultLayoutConfig` renders one layout **section per panel**:
  - **General:** Salutation (select), First name*, Last name*, Known as name, Account name
    (relationship), Job title, Email - Work, Email - Other, Mobile, Landline, Status*, Department,
    Billing contact (boolean).
  - **Social:** LinkedIn, Facebook, Twitter, Other (urls).
  - **Site address:** Site address line 1/2, City, State / County, Postcode, Country.
  - **More:** Notes, External reference ID, Make favourite (boolean).
  (Relabels: Title→"Job title", Email→"Email - Work", Phone→"Landline".)
- **Panel shading:** `DynamicForm` now renders each section inside a `Panel` (shaded surface +
  border + elevation tokens), so panel ≠ field (`--background` inputs) ≠ page background — across
  ALL entity forms, view + edit.
- **Admin-configurable:** the panels/fields are the generated default layout; the admin layout
  editor remains the source of truth once a layout is persisted.

### Provisioning caveat (prototype handled locally; rebuild must address)
`provisionEntityType` only **inserts** new-slug fields on re-activation — it does NOT update an
existing field's `label`/`groupName`/`displayOrder`. So relabels/regroupings of pre-existing fields
(e.g. Email→"Email - Work") don't reach already-activated tenants via reprovision. Fresh tenants
(tests) get the full spec correctly. The local dev tenant was re-synced with a one-off metadata
`UPDATE` + a layout regen. **Production:** a migration/reconcile step is needed to apply field
metadata changes to existing tenants (or make `provisionEntityType` reconcile metadata).

### Deferred from this iteration (each its own slice — logged)
- **Reports-to (contact→contact hierarchy):** a `contact_reports_to_account`-style relationship +
  a contact lookup picker + create/PATCH directive + hydration. Needs the account picker
  generalised into a record picker (pays down the slug-hardcoding debt). Not built.
- **Notes & Attachments / Campaigns tabs** on the contact detail (you flagged these as separate
  activities). Contact detail is still the non-tabbed form + sidebar.
- **Address "same as account":** the Site address panel exists as fields, but the "Same as Site
  account address" inherit-from-account behaviour (needs account address fields + copy) is not wired.
- **Field active/inactive (read-only) for data entry:** field-level editable/locked state is a new
  per-field flag — not implemented (the layout editor's add/remove is the current configurability).
- **Bottom-bar specifics** (Make favourite / Contact Reference ID = record id / External reference
  ID styling), social icons, and the inline "Linked Accounts + Go" control (we have the Related
  Accounts panel) are presentational follow-ups.

## Iteration 8 — Reports-to hierarchy + generalised record picker

- **Generalised picker:** `AccountPicker` is now a thin wrapper over a reusable
  `components/crm/record-picker.tsx` (`RecordPicker` + `RecordSelection`) — searches any entity's
  list endpoint (`contains` on a configurable field), optional inline create-new. This unblocks
  reports-to and pays down the account-picker-only debt.
- **Reports-to (contact → contact hierarchy):** new `contact_reports_to_contact` relationship
  (many_to_one) + a `reportsTo` relationship field on the contact (General panel). `RelationshipField`
  renders a **contact lookup** (search by last name, existing-only) for it. Backend: a `reportsTo`
  directive on create + PATCH (`{ contactId } | null`, presence-keyed), applied via
  `applyContactReportsTo` (M2O replace, **self-reference rejected**, invalid manager rejected, clear
  on null) inside the one `withTenant` tx (atomic via `ContactAccountAbort`). Detail/edit hydrate the
  current manager via `loadReportsTo`.
- Tests: create-with-manager, PATCH replace (one link), self-reference 422, invalid manager 422,
  clear. 388 web + 19 crm pass.
- Still slug-keyed in `RelationshipField` (account → account picker; reportsTo → contact picker) —
  the data-driven-from-field-settings version remains deferred (needs `ProvisionFieldSpec` settings).
- Deferred sub-item: a "Direct reports" (subordinates) display panel on the contact (the reverse
  edge) — the field captures the upward link; the downward roll-up is a later slice.

## Iteration 9 — Contact detail tabs

The contact detail now uses the tabbed layout (like account/opportunity): **Details** (the panelled
form + the Related Accounts panel + any other related records + Activity), **Notes & Attachments**,
and **Campaigns**. The latter two are placeholders ("coming soon — separate activity") per the
design note. Lead remains the non-tabbed form+sidebar layout.

## Data model touched

Prototype-local only: the spec cardinality change + a **local** SQL flip of the dev tenant's
`contact_belongs_to_account` registry row, and `activate.ts` registering the new
`contact_related_to_account` row per tenant (idempotent). No prod migration. Row writes go to
`records` (accounts) and `record_relationships` (links) inside `withTenant`. The PRODUCTION registry
flip + reconciliation are gated migrations 009/010 (below) — NOT done here.

## Auth & permissions

`POST /api/crm/contacts/with-accounts` runs under `contact.create` (server-enforced). The picker's
search calls `GET /api/crm/accounts`, gated by `account.read` (server-enforced). Client
`<PermissionGate>` is cosmetic only.

## Tenant-isolation notes

All reads/writes go through `withTenant(tenant.id, …)`. The create-new uniqueness check, the
account insert, and the link insert all run inside that one tx, so RLS scopes them to the caller's
tenant. A cross-tenant existing `accountId` resolves to zero rows under RLS → rejected (whole tx
aborts). Smoke test runs under the `adserve_app` NOBYPASSRLS harness.

## Production Considerations log (DO NOT build in prototype — handoff to the rebuild)

- **GATED MIGRATIONS 009 + 010 (prod registry + reconciliation):** the prototype flipped the model
  locally; prod still has `contact_belongs_to_account = many_to_many` (WS1 / `sql/007`) and no
  related row. The rebuild must run, on prod via the `adserve_migrator` bastion (human-gated):
  - **009** — add the `contact_related_to_account` (M2M) registry row. Self-idempotent
    (SELECT-then-INSERT on `(tenant_id, name)`); does NOT depend on 008's index.
  - **010** — flip `contact_belongs_to_account` M2M→M2O **+ reconcile**: for any contact with
    multiple primary links, keep the **oldest** (`record_relationships.createdAt`; `isPrimary` is
    never written, so it won't apply) and **convert the rest to `contact_related_to_account`** —
    no data deleted. Idempotent: convert-inserts use `ON CONFLICT DO NOTHING`; "keep oldest" is a
    no-op once one primary remains. Filenames sort 009 before 010 (apply order). The enum flip is
    advisory only (see M2O hardening below) — the reconciliation is what makes data single-primary.
- **008 PROD-APPLY PENDING / UNVERIFIED:** `sql/008` (`UNIQUE(tenant_id, name)` on the relationships
  registry) is merged to `main` (PR #20) and applied to LOCAL dev, but the **prod RDS apply is
  pending/unverified** per `aws-deployment-status.md:31`. Do NOT assume the index exists on prod.
  The 009/010 bastion session must run a read-only `pg_indexes` check first and apply 008
  (idempotent `IF NOT EXISTS`) if absent. Leave the `aws-deployment-status.md:31` "pending" line as
  is — it flips ONLY when an actual bastion query confirms/applies it on prod.
- **M2O IS NOT DB-ENFORCED:** flipping the registry `relationship_type` to `many_to_one` is a label
  only — Postgres won't stop a buggy writer creating two primary links. Single-primary is enforced
  by `createRecordLink`'s replace branch + the reconciliation. Rebuild hardening: a partial unique
  index on `(tenant_id, relationship_id, source_record_id)` scoped to the primary relationship makes
  it a true DB invariant.
- **ACCOUNT NAME UNIQUENESS IS RACY:** there is no DB unique constraint on accounts'
  `records.data->>'name'` (the `sql/008` UNIQUE is on the `relationships` registry — a different
  table). The create-new uniqueness check is read-then-insert and can race under concurrent
  creates. Production should add a DB-level unique constraint (e.g. a unique expression index on
  `lower(btrim(data->>'name'))` scoped to tenant + account entity type, partial on
  `is_archived = false`) and handle the conflict at insert time.
- **SHARED HELPER EXTRACTION:** `lib/crm/account-name.ts` was extracted from `convert/route.ts`
  (the inline AC 21 match). Convert now calls it. A regression test asserts the helper matches
  case/whitespace-insensitively exactly as convert relied on. The rebuild should keep this single
  source of truth rather than re-inlining.
- **SEARCH RANKING:** the typeahead orders results by `name asc` and caps at 20. No relevance
  ranking / prefix-priority / pagination of search results. Acceptable for the prototype; the
  rebuild may want ranked search and "load more".
- **RENDERER HARDCODES THE SLUG:** `RelationshipField` selects the rich account picker on
  `field.slug === "account"`. Production should drive this from the field definition's `settings`
  (e.g. `{ relationshipName, targetEntitySlug, allowCreate }`) so ANY relationship field gets an
  appropriate picker. That needs `ProvisionFieldSpec` / `createFieldDefinition` to carry `settings`
  (they currently do not) — a small `@adserve/module-framework` change deliberately skipped here.
- **EDIT / DETAIL PARITY — DONE (iteration 3):** detail/edit now hydrate the `account` field from
  the existing link and persist add/replace/clear on edit. See "Iteration 3" below. (Remaining
  production gap: only the single contact→account link is handled — the many_to_many model could
  in principle hold several; the prototype intentionally collapses to one.)
- **RELATIONSHIP COERCION BYPASS:** `DynamicForm` skips `coerceFieldValue` for relationship fields
  (pass-through). Production needs real validation for relationship fields (required handling, valid
  selection shape) rather than trusting the caller.
- **UNPLACED-FIELDS SAFETY NET:** `loadEntityForm` now appends unplaced fields to a trailing "More"
  section so new fields never vanish from the form. This changes shared form behaviour for all
  entities (currently a no-op since every field is placed except `account`). The rebuild should
  decide whether unplaced = "show in More" or "intentionally hidden" and likely regenerate/patch
  persisted layouts on field add instead.

## Open questions (for the rebuild)

- Should the model become `many_to_one` (the DATA-MODEL DEFERRED decision), or stay M2M with a
  `isPrimary` flag and a multi-account UI elsewhere?
- Should create-new on a duplicate name *offer to link the existing account* instead of erroring?
  (Prototype errors with 409 + the existing account in the payload so a future UI could.)
