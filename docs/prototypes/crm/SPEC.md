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

## Data model touched

No schema change. No migration. The `relationships` registry is **not** touched. Only `records`
(insert one account) and `record_relationships` (insert one link) rows are written, via the
existing `createRecordLink` writer, inside the caller's `withTenant` tx.

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

- **DATA-MODEL DEFERRED:** contact↔account is `many_to_many` in the shipped model (WS1 / `sql/007`).
  This prototype enforces single-account in the UX + endpoint only. Whether it should be
  `many_to_one` at the data level is a rebuild decision — if yes, it is a **gated migration (009)**
  on the `relationships` registry **plus destructive reconciliation** of any existing contacts
  linked to >1 account (pick `isPrimary`, else first; deletes the rest).
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

## Open questions (for the rebuild)

- Should the model become `many_to_one` (the DATA-MODEL DEFERRED decision), or stay M2M with a
  `isPrimary` flag and a multi-account UI elsewhere?
- Should create-new on a duplicate name *offer to link the existing account* instead of erroring?
  (Prototype errors with 409 + the existing account in the payload so a future UI could.)
