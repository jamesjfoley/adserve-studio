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

## Iteration 10 — Account address + "Same as Site account address" inherit

- **Account address panel:** `DEFAULT_ACCOUNT_FIELDS` gains an **Address** panel (Address line 1/2,
  City, State / County, Postcode, Country).
- **Inherit:** the contact's Site address panel gains a **"Same as Site account address"** boolean.
  When ticked, the contact's site-address fields are copied from its PRIMARY account's address on
  save (create + PATCH), via `inheritAccountAddress` inside the one `withTenant` tx. Tested both
  paths. (Live grey-out of the site-address inputs while ticked is the field active/inactive slice,
  next.)

## Iteration 11 — Field active/inactive (read-only) for data entry

`DynamicForm` now renders a field read-only (inactive for data entry) when its definition's
`options` say so — generically, admin-extensible:
- `options.readOnly: true` — always inactive (admin-locked field).
- `options.disabledWhen: { field, equals }` — inactive when another field's current value matches
  (the **site-address fields carry `disabledWhen: sameAsAccountAddress === true`**, so they grey out
  to read-only the moment "Same as Site account address" is ticked).

Implemented by rendering the field in view mode within the editable form (reuses existing read-only
rendering — no change to the 13 field components). Tested (disabledWhen on/off + readOnly).
Deferred: an admin field-manager toggle to set `readOnly` per field (the mechanism is in place;
the UI control is a follow-up).

## Iteration 12 — Reactivation (inactive ↔ active)

Records are never deleted — "Mark inactive" sets `isArchived=true`; a **Reactivate** action on the
detail header (shown when the record is inactive) PATCHes `isArchived:false`. The PATCH route now
accepts an optional `isArchived` boolean (gated by the same permission/ownership rule). Tested.

**Vocabulary — deliberate scope:** "inactive" is used on the contact/account **detail** surfaces;
the shared list `FilterBar`/`DynamicTable` keep the generic "archived" wording, because a global
rename would mislabel leads/opportunities (their lifecycle is archived/converted, not "inactive").
An entity-aware list label is a future polish, not done.

## Iteration 13 — Data-driven RelationshipField

`RelationshipField` is no longer keyed on the field slug. It reads the field definition's
`options.relationship = { targetSlug, allowCreate }` and renders the searchable `RecordPicker` for
that target (`account` → account picker + create-new; `reportsTo` → contact picker, existing only)
via `recordSearchConfig`. Adding a new relationship field is now config-only — no renderer change.
(Relationship fields without that config fall back to the Phase-1 UUID input.) The slug-hardcoding
debt logged since iteration 2 is retired.

## Iteration 14 — Design-language re-skin (style_guides)

Re-grounded the in-product UI in `style_guides/` + codified it in `docs/design-language.md`:
- **Tokens** (globals.css + `adserve-design` skill, lock-synced, dark-mode): soft-grey `--page-bg`
  vs white `--panel-bg` vs filled `--field-bg` (three-level contrast), panel-header band, table
  header/zebra/hover, status-pill tokens.
- **Primitives:** `Panel` (header bands + `bodyClassName`), `PageHeader`, `StatusPill`, `StatCard`;
  filled-well form inputs.
- **Screens re-skinned:** list pages → `Home_Page` (PageHeader, header band, zebra, filled
  controls); detail/record header → `PageHeader` + `StatusPill`; dashboard → KPI stat-card row;
  app shell → white nav rail (contrasts the grey page); create/edit/log-activity modals → panel +
  field tokens.
- **Deferred (logged):** page-level sticky Cancel/Save bar on detail (DynamicForm submit retained);
  per-field status pill in form view (list status stays plain text per `Home_Page`); centred table
  search; a dark top-bar/brand chrome. Admin/super-admin screens inherit the token/Panel foundation
  automatically; a dedicated pass can follow if wanted.

## Iteration 15 — Full-bleed layout + full-height list tables + home-page search

Layout re-do per design feedback on Iteration 14 ("too much white space / use the screen
real-estate / tables full-height / search bar / sub-page table mismatch"):
- **Shells** (platform, tenant-admin, super-admin layouts): dropped `mx-auto max-w-7xl` centring.
  `<main>` is now a `flex flex-col overflow-hidden` column; its inner region is
  `min-h-0 flex-1 overflow-auto px-6 py-6` (full-width against the nav, ~24px gutter). This both
  reclaims the wasted horizontal space and gives pages a bounded height to fill.
- **DynamicTable:** new `fillHeight` mode — toolbar + pagination stay fixed, the rows region is
  `min-h-0 flex-1 overflow-auto` with a `sticky top-0` header band. New `searchField`/
  `searchPlaceholder` — a free-text box that drafts locally and commits a `contains` filter on
  that slug, composing with (not replacing) the advanced filter bar; seeded from / re-synced to the
  committed term.
- **CRM list pages:** root is a full-height flex column; the table `Panel` is `flex-1 min-h-0` with
  a `flex` body, so the table fills the viewport and scrolls internally. Per-entity search box on
  the Accounts/Contacts home pages (`findSearchField`: name → firstName → first text field).
- **ContactsTable** (Accounts→Contacts sub-page): re-styled to match DynamicTable — tinted
  `--table-header-bg` sticky header, sentence-case labels, `--row-alt`/`--row-hover` zebra,
  bordered rounded scroll region.
- All token-driven (no new palette values, lock test untouched). +4 search tests; 430 web green.

## Iteration 16 — Per-column filter icons (remove the global Add-filter bar)

Replaced the draft-then-Apply "Add filter" bar on the list pages with inline,
per-column filtering:
- **Removed** the `FilterBar` component (Add-filter select + draft list + Apply/Clear) — file deleted.
- **`ColumnFilter`** (new): a funnel icon in the header of each text-value column. Click → popover
  with operator (Contains / Equals / Starts with) + text value + Apply/Clear. The icon renders in
  accent when that column has an active filter; the popover seeds from the committed filter and a
  click-away backdrop closes it.
- **Scope:** only text-family columns get the icon — `isTextFilterable` = text/long_text/email/
  phone/url. Numeric, currency, date, select, boolean, multi_select and relationship columns
  deliberately get **no** filter icon (per the request: "text value, not numeric or currency").
  Trade-off logged: those column types are no longer filterable from the list UI; the server still
  supports their operators if a future UX wants them back.
- **DynamicTable:** one filter per column (apply replaces any existing filter on that slug, clear
  removes it); the global search box and a column filter targeting the same slug share a single slot
  (last action wins). The "Include archived" toggle moved from the old bar into the toolbar and now
  commits immediately (no Apply step).
- Server-side filter handling (`operatorsForType`, crm-query) is unchanged. Tests: rewrote the
  filtering suite to drive the header popovers + added `isTextFilterable` coverage; 436 web green.

## Iteration 17 — Intelligent column filters (value picklist on repeating text columns)

Made list filtering data-driven instead of present on every text column:
- **Eligibility (server, `loadCrmListData`):** for each text-value column, compute distinct
  non-empty values + counts over the BASE domain (tenant + entity, respecting archived/owner,
  ignoring the active filters). A column is filterable iff it has **≥2 distinct values AND at least
  one repeats** — one rule that excludes always-unique columns (email, phone, free-text) and
  single-value columns, and includes repeating categorical text. Returned as `facets`
  (`Record<slug, string[]>`, alphabetical). Grouped query groups on the output ordinal (`GROUP BY 1`)
  because the slug is a bound parameter — a re-stated `data->>$n` would carry a different placeholder
  and Postgres would not match it to the SELECT target.
- **UI (`ColumnFilter`):** now a searchable value picker. The funnel icon opens a popover listing the
  column's distinct values (alphabetical); a type-ahead box narrows the list (case-insensitive,
  Enter picks the first match); selecting a value commits an `equals` filter; "All …" clears it. The
  icon renders **only** for columns present in `facets`, so always-unique columns show no filter
  affordance at all.
- **Wiring:** `facets` flows loadCrmListData → page → CrmListClient → DynamicTable → TableHeader →
  ColumnFilter via a new `columnFacets` prop. Server-side filter handling (`operatorsForType`,
  crm-query) unchanged; the picker just emits an `equals` text filter the server already supports.
- **Tests:** rewrote the column-filter suite for the picklist model; added facet eligibility
  (repeating → facet; all-unique → none) + tenant-isolation coverage under the `adserve_app`
  NOBYPASSRLS harness. 441 web green.
- **Note / possible follow-up:** facets are computed from the live data, so a conceptually
  categorical column that *happens* to have all-distinct values in a small dataset won't get a
  filter until a value repeats. Per-column query (one GROUP BY per text column) is fine at prototype
  scale; a single lateral/aggregate query is the optimisation if column counts grow.

## Iteration 18 — Select columns are filterable too (Status / Industry / Source / Stage)

Bug from Iteration 17: the column filter only covered free-text field types, so `select` columns
(Status, Industry, Source, Stage) showed **no** filter icon. A select is categorical by definition
(never row-unique), so it must always be filterable — and a purely data-driven rule wouldn't help
here anyway (the dev accounts are all `prospect`, a single distinct value).

- **`TableHeader.resolveColumnFilter`**: select columns are filterable from their **declared
  choices** (operator `is`), independent of facets and data distribution; free-text columns stay
  facet-driven (operator `equals`). Columns that are neither get no icon.
- **`ColumnFilter`** now takes `{ value, label }[]` options + the operator to emit, so the picklist
  shows human-readable labels (e.g. "Active") while committing the stored value (`active`).
- Server free-text facet computation is unchanged; selects need no server facet.
- Tests: added select-column coverage (icon appears from choices with no facet; picking commits
  `{operator: "is", value}`). 443 web green.
- **Design note:** for selects the picklist lists ALL declared choices (not just values currently
  present), which guarantees the filter is always available and useful for a known enumeration. If
  present-only is preferred later, it's a small change (intersect choices with a server facet).

## Iteration 19 — Picklists list only values present in the data (incl. selects)

Correction to Iteration 18: select pickers listed every declared choice. The picker must show only
the distinct values that actually exist in the table (as free-text columns already did).
- **Server (`loadCrmListData`):** now facets `select` columns too, returning their PRESENT distinct
  values. Eligibility — select: ≥1 present value (categorical, stays filterable even with a single
  value); free-text: ≥2 distinct with a repeat (unchanged).
- **Client (`resolveColumnFilter`):** filterability is fully facet-driven (a column is filterable
  iff the server faceted it). Select columns map present stored values → display labels
  (operator `is`); free-text uses values verbatim (operator `equals`). Sorted alphabetically by
  label.
- Result: a Status where every row is `prospect` lists just **[Prospect]**; a contact Status with
  active + inactive lists **[Active, Inactive]** — never unused choices.
- Tests: select picker lists present values by label (not all choices) + no-facet → no icon; RLS
  harness covers single-value and multi-value select facets. 446 web green.

## Iteration 20 — Row banding fills the whole full-height table

On full-height list tables the zebra banding stopped at the last record, leaving blank space below.
Now it continues to the bottom even when records don't fill the panel.
- **`DynamicTable`**: in `fillHeight` mode the scroll container is a flex column; below the `<table>`
  a striped filler `div` (`flex-1`) fills the remaining height. A body-row height is measured via
  `ResizeObserver` (guarded with `typeof ResizeObserver` for jsdom/SSR) so the filler band size
  matches real rows.
- **`stripeFillStyle(renderedRowCount, rowHeight)`** (exported, pure): a repeating two-row
  `linear-gradient` whose first band continues the row parity from the row that would follow the
  last rendered one (Tailwind `even:` bands 0-based odd indices), so the empty area lines up with the
  real rows. Returns undefined until a row height is known; the filler collapses to zero height when
  records overflow (table scrolls as before).
- Tests: `stripeFillStyle` parity (odd count → starts `--row-alt`; even → transparent) + two-row
  period. 449 web green.

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
