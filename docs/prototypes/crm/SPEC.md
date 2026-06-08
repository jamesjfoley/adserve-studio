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
- **UI:** account detail now shows **Employees** (primary) + **Related Contacts** (related) tabs;
  contact detail shows an editable **Related Accounts** panel. All reuse `RelatedRecordsPanel` +
  the WS2 link route (add/remove existing). Primary stays the inline single-select field.

### Deferred from this iteration (logged — rebuild scope)

- **Create-FORM related control:** the create endpoint accepts `relatedAccounts`, but the contact
  *create form* has no related multi-select control yet — related accounts are added on the contact
  detail page post-create. (Covered by endpoint tests.)
- **Inline create-new on the detail Related panels:** `RelatedRecordsPanel` / `LinkRecordPicker`
  link EXISTING records only (and still 200-cap, no typeahead). Create-new for related is supported
  by the `relatedAccounts` endpoint directive, not the detail panel. Rebuild should give the related
  panels the same searchable + create-new control as the primary picker.

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
