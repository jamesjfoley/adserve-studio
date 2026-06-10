# CRM Media-First Prototype — Campaigns + Module Visibility (SPEC / handoff)

> **Status:** LOCAL PROTOTYPE, complete on branch `prototype/crm-campaigns`. Never merged, pushed,
> or deployed; no prod RDS / AWS touched. This document is the handoff artifact for the future
> production rebuild. Built per brief v3.2.

## What this delivers

A media-first CRM where **Campaigns** is the default primary pipeline object, **Leads** is on by
default, and **Opportunities** is optional (off by default). A `crm.admin` toggles Leads / Campaigns
/ Opportunities and — when both pipeline entities are on — chooses which one Lead Convert creates.
Accounts + Contacts (with Notes & Activities) are always on. Pipeline + the CRM dashboard appear
when either pipeline entity is enabled.

## Build summary (by task)

### Task 1 — Campaign entity
- **`@adserve/crm` package** (`packages/crm/src`): `CAMPAIGN_ENTITY_TYPE` (icon `megaphone`),
  `DEFAULT_CAMPAIGN_FIELDS`, `CAMPAIGN_STAGES`, `campaign_belongs_to_account` (M2O) +
  `campaign_has_primary_contact` (M2M, `isPrimary`), `campaign.{read,create,update,delete}`
  permissions (member grant gains `campaign.read`), `CampaignData`/`CampaignStage` types, columns,
  url segment, and exports. `activate.ts` resolves the **fixed** `campaign_stages` enum (NOT the
  opportunity `pipeline_stages`) and stamps `settings.pipelineStages` + `nameFieldId` for campaign.
  Activation stays idempotent; new tenants and the harness get the full spec automatically.
- **Fields:** name; account (relationship→account, **required**); primaryContact
  (relationship→contact, optional); value (`currency` — `{amount,currency}`, like `opportunity.amount`);
  stage (fixed enum `brief→planning→booking→live→pca` + `lost`); flightStart/flightEnd (date);
  products (long_text); pcaOutcome (long_text); opsCampaignId (text **stub**, no FK, not wired to
  Planning/Trafficking).
- **`POST /api/crm/campaigns/with-account`** — creates the campaign and its **required** account
  link (+ optional primary contact) in one `withTenant` tx, reusing `findAccountByName` (dedup),
  `createRecordLink`, `resolveRelationshipByName`. The list "New campaign" form routes through it
  (`enableCampaignCreate`), extracting the inline `account`/`primaryContact` relationship fields.
- **Detail page:** Campaign gets Details / Notes & Activities / Account / Contacts tabs (mirrors
  Opportunity); link/unlink authorizes source-side on `campaign.update`.

### Task 2 — Module config
- **`apps/web/src/lib/crm/module-config.ts`**: stored at **`tenants.settings.modules.crm`** (JSONB
  key — mirrors the WS6 palette precedent; **no migration / seed / backfill**). `readCrmModuleConfig(settings)`
  (pure, per-request, no caching) + `getCrmModuleConfig(tenantId)` (reads inside `withTenant` because
  `tenants` has FORCE RLS). Absent key → default `{ leads:true, campaigns:true, opportunities:false,
  convertTarget:'campaign' }`. Exposes `showPipeline = showDashboard = (campaigns || opportunities)`,
  raw `convertTarget`, and derived `effectiveConvertTarget` (both-on → convertTarget; one-on → that
  entity; neither → null). `isCrmEntityEnabled(config, slug)` for guards/nav.

### Task 3 — Pipeline + CRM dashboard (generalized, campaign-first)
- `load-pipeline-data` / `pipeline.ts` parameterised by entity (`campaign`|`opportunity`): stages
  from the entity's `settings.pipelineStages`, value field `value` (campaign) / `amount`
  (opportunity). `/crm/pipeline` shows an **entity switcher** when both are enabled (`?entity=`,
  default campaign) — never a merged kanban; a single board when one is enabled. Campaign stage
  moves authorize on **`campaign.update`** (the generic record PATCH); opportunity moves keep the
  legacy `pipeline.update`. The CRM dashboard (`crm/page.tsx` + `load-dashboard-data`) renders one
  pipeline section per **enabled** entity (campaign-first); forecast stays opportunity-only
  (campaigns carry no probability).

### Task 4 — Nav filtering + route guards
- Platform layout builds the CRM nav per request from `readCrmModuleConfig` (server component → no
  flash): Accounts + Contacts always; Leads / Campaigns / Opportunities per toggle; Pipeline + CRM
  Dashboard when `showPipeline`. New `campaigns` nav icon (Megaphone).
- **Module-enabled check runs BEFORE the permission check.** The generic CRM list page 404s a
  disabled entity; the Pipeline page and CRM dashboard 404 when `showPipeline` is false. A disabled
  module looks **absent (404)**, not forbidden (403), even to a fully-permitted user.

### Task 5 — Lead Convert (config-driven)
- The convert route reads `effectiveConvertTarget` and deterministically creates the matching deal:
  `campaign` → Campaign (stage `brief`, value from `estimatedValue`); `opportunity` → Opportunity
  (first pipeline stage, amount); `null` → Account + Contact only. **No per-convert picker.**
- `convertedTo` evolved to `{ accountId, contactId, opportunityId?, campaignId? }` — exactly one deal
  id set (or none); `opportunityId` stays optional so historical converted leads remain intact.
- AC 20–24 preserved (atomic `withTenant`, 409 warn-before-insert on `account_exists`/`contact_exists`,
  read-only after convert). **AC 24 extended** beyond PATCH to archive (DELETE) and relationship
  link/unlink via the shared `isConvertedLead` guard (fires before the permission gate).

### Task 6 — Admin toggle UI + config write
- **`PATCH /api/admin/crm/modules`** — gated + authorized on `crm.admin` server-side (401/403),
  validates toggles (booleans) + `convertTarget ∈ {campaign,opportunity}` (400), merges into
  `tenants.settings.modules.crm` preserving other keys, inside `withTenant` (mirrors the palette
  write). **`/admin/crm/modules`** page (gated `crm.admin`): Accounts + Contacts shown always-on
  (non-interactive); Leads/Campaigns/Opportunities toggles; a Lead-conversion control showing the
  Campaign/Opportunity selector **only when both are on** (else read-only text); notes that
  disabling hides without deleting. Token-driven (`Panel` + CSS vars), admin sidebar nav entry added.

### Task 7 — Mandatory smoke tests (adserve_app NOBYPASSRLS harness)
- Campaign tenant isolation + authz (`crm-campaigns`): cross-tenant 422/404, member create 403 /
  read 200, required-account 422, create+link.
- Config authz + isolation (`crm-modules-config`): crm.admin write persists, non-admin 403, A↛B.
- Derived flags + `effectiveConvertTarget` across all combos (`crm-module-config`, 11 cases).
- Convert targets (`crm-convert-targets`): campaign / null / extended-read-only DELETE+link 409.
- Guards (`crm-module-guards`): `getCrmModuleConfig` isolation, data-retention disable→enable,
  **404-precedes-permission** for a fully-permitted user.
- Legacy AC 20–24 suites pinned to the opportunity convert target (green). Full web suite green.

## Authz model (as built)
- `campaign.{read,create,update,delete}` granted like Opportunity; `member` has `campaign.read`.
- Campaign↔Account / Campaign↔Contact link/unlink + stage moves authorize **source-side** on
  `campaign.update`. `pipeline.*` remains opportunity-legacy.
- Config write gated on the existing `crm.admin` (owner/admin).
- Module-enabled check ALWAYS precedes the permission check on guarded routes.

## Tenant isolation / RLS notes
- All record reads/writes go through `withTenant(tenantId, …)`. The campaign create-with-account tx,
  the convert tx, and the config read/write are all tenant-scoped; cross-tenant ids resolve to zero
  rows under RLS. `getCrmModuleConfig` reads `tenants` inside `withTenant` (FORCE RLS on `tenants`).
- Tests run under the `adserve_app` (`NOBYPASSRLS`) harness.

## Local enablement
- Reprovision local tenants to pick up the Campaign entity/relationships/permissions:
  `DATABASE_URL="postgresql://jamesfoley@localhost:5432/adserve" pnpm --filter @adserve/crm reprovision-crm`
  (new `campaign` slug → `provisionEntityType` skip-on-match is a non-issue; campaign relationships
  are new names, so the `(tenantId,name)` flip caveat does not apply).
- No config seed needed — absent `settings.modules.crm` resolves to the media-first default.

---

## Iteration — Rich Account detail (panels, Brand child entity, accordions, history)

- **Account field set** regrouped (via `groupName`) into the design's panels: **Account Details**
  (first panel, always open), **Credit Approvals**, **Financial Controls**, **Addresses** — ~35
  fields (account type/rating, parent account [text], station exclusions [multi_select], default
  category, the three boolean flags, credit status/type, required credit limit, read-only credit
  limit/balance, payment terms, commission %, VAT code, billing currency, company reg / VAT / IBAN,
  suppress invoice, Site + Billing addresses with a "Billing same as site" toggle via `disabledWhen`).
  `generateDefaultLayoutConfig` turns the groups into the default panels; the admin reorders/adds/
  removes panels + fields via the EXISTING `/admin/crm/fields` + `/admin/crm/layouts` editors.
- **Accordion panels:** new `CollapsiblePanel` client wrapper (Panel stays server-safe); `DynamicForm`
  renders section 0 static and the rest collapsible (open by default). Brands + Account History
  panels are collapsible too.
- **Brand CHILD ENTITY:** `brand` entity + `brand.{read,create,update,delete}` (member read) +
  `brand_belongs_to_account` (M2O). No standalone nav/list — created/listed/deleted via the Account
  **Brands** panel (`BrandsPanel`, inline add + delete) backed by `POST /api/crm/brands/with-account`.
- **Account History panel:** `GET /api/crm/[entityType]/[id]/history` (RLS-scoped audit read) +
  `RecordHistoryPanel`, in the account Details tab.
- **Local dev demo:** fresh tenants/tests get the full design automatically. Existing local tenants
  were reprovisioned (adds Brand + new Account fields); a one-off local SQL re-synced the
  pre-existing Account fields' `group_name`/`display_order`/label and cleared the stored Account
  `detail` layout so it regenerates into the new panels (this clobber is acceptable locally — the
  skip-on-match activation never updates existing fields/layouts in prod).

### Layout editor + widget panels (all Account panels manageable)
- `LayoutSection` extended: `columns: 1|2|3|4`, `hidden?` (configured but not rendered), `widget?`
  (a non-field panel placed in layout order). `generateDefaultLayoutConfig(widgets)` appends widget
  sections; `validateLayoutConfig` accepts 1–4 + hidden/widget.
- The Account default detail layout carries **Brands** + **Account History** as widget sections, so
  they appear in `/admin/crm/layouts` next to the field panels (Account Details, Credit Approvals,
  Financial Controls, Addresses). `DynamicForm` renders widget sections via a `widgetRenderers` map,
  skips hidden sections, supports 4-column grids, and keeps the first VISIBLE panel always-open.
- Layout editor UI gained: **columns 1–4**, **show/hide** per panel, **reorder** panels (move
  up/down), and read-only handling of widget panels. So the admin can reorder/hide/columns every
  Account panel — field panels and the Brands/History widget panels alike.

### Admin editor enhancements
- **Layout editor is WYSIWYG drag-and-drop:** each field panel renders its fields in a grid matching
  its column count (1–4), filled row-major to mirror the detail page; native HTML5 DnD lets the admin
  drag fields to any row/column, between panels, and from the unplaced pool (move-up/down + Add-field
  kept as fallbacks). Widget panels (Brands / Account History) stay read-only + reorderable/hideable.
- **Fields page:** existing fields listed alphabetically by Name; Select / multi_select create + edit
  has an options editor (Label + Value rows, value auto-slugified, ≥1 required) persisted as
  `options.choices`. The fields admin page passes `options` through so editing a select pre-fills its
  choices.
- **Note:** the "blank Brands/Account History panels" report was a stale stored layout viewed before
  the widget sections were reprovisioned — the 47 Account fields + 6-panel layout are present in the
  DB and the widget rendering is test-locked. DnD itself needs a real-browser pass (jsdom can't
  dispatch drag events).

### Layout grid model (field spans + rows + widget previews)
- `LayoutSection.items?: LayoutItem[]` — field cells `{ fieldId, span }` + spacer cells
  `{ spacer, span }`. The detail renders `items` in a CSS grid (`repeat(columns,1fr)`, each cell
  spanning `min(span,columns)`); spacers leave gaps / push fields to a new row. Absent → render
  `fieldIds` at span 1 (backward compatible; old stored layouts unaffected). `validateLayoutConfig`
  validates item field refs + positive-integer spans.
- Layout editor: per-field width selector (1..columns, WYSIWYG grid), "Add empty cell" + "Add row
  break" spacers, DnD/keyboard reorder over items; saves both `items` and derived `fieldIds`.
- Widget panels (Brands / Account History) show a read-only content preview in the editor (Brand /
  Brand Category / Brand Values; Field Name / New / Old / Changed By / Date) — their actual fields
  live on the Brand entity / the audit log, so they're previews, not editable cells.

### Full-page create (replaces the New-record modal)
- `New {entity}` navigates to `/crm/[entityType]/new` (static route, precedence over `[id]`) instead
  of opening a modal. The page loads the entity's detail layout + fields and renders them in
  `DynamicForm` create mode — the same panelled surface (accordions, field spans) the record is
  viewed on. Mandatory fields are enforced by DynamicForm before submit; on success it lands on the
  new record's detail page. Widget panels (Brands/Account History) are skipped on create (no record
  yet). Inline relationship fields route to the atomic create-with-link endpoints as before. The
  list modal + create-routing props were removed.

### Account-detail production considerations
- **Required fields kept optional.** Account type / Required credit limit / Company registration are
  starred in the design but seeded OPTIONAL — Lead-convert and Campaign create-with-account
  auto-create accounts with minimal data, so enforcing them would break those flows. Production
  needs a create-vs-quick-create distinction before enforcing.
- **Parent account is a text field**, not a true account→account relationship picker (a relationship
  would need its own registry entry + inline create/edit persistence). Follow-up.
- **Brand edit** is add + delete only in the panel; inline edit of an existing brand is a follow-up.
- **Read-only credit limit/balance** use the form `readOnly` option (no computed-field engine yet).
- **Account History** reads the audit log directly; richer field-name humanisation + paging is a
  follow-up.

## Platform shell — Title Bar (endures across all modules)

A module-agnostic top Title Bar mounted once in the `(platform)` layout, above every module
surface (CRM is the first module). New modules plug in with no shell changes.
- **`lib/shell.ts`:** `getTenantModules(tenantId)` builds the candy-box catalogue from
  `modules` × `tenant_modules` under RLS (enabled + active + routable → clickable; others "coming
  soon"); `readShellConfig(settings)` resolves the branding logo + title-bar mode (mirrors
  `readTenantPalette`); `userInitials()`; `MODULE_HOME` (slug → landing route); `APP_VERSION`.
- **`components/shell/title-bar.tsx`:** candy box (module switcher) · company logo
  (`settings.branding.logoUrl`) or the "as" wordmark · centred active module name · user roundel →
  menu (Ask support, Workflows [soon], Version, Log out via Clerk `signOut` → `/sign-in`). Two
  modes: **always-on** (in flow) and **auto-hide** (overlay revealed on top-edge hover).
- **Admin:** "Branding & shell" page + `PATCH /api/admin/shell` (gated `crm.admin`/`tenant.admin`)
  to upload a logo (data URL, ≤500 KB) + pick the title-bar mode, persisted to
  `settings.branding` / `settings.shell` (mirrors the theme write).
- **Production considerations:** logo stored as a data URL in tenant settings (move to object
  storage/CDN for production); `MODULE_HOME` + the active-module name are static (CRM) — derive the
  active module from the route once a 2nd module ships; logout/identity still also available via the
  sidebar Clerk `UserButton` (can be retired now the roundel owns it); the shell currently mounts on
  `(platform)` only — `(tenant-admin)` can adopt the same `<TitleBar/>` if a unified chrome is wanted
  (super-admin stays a separate track). `APP_VERSION` is a constant kept in sync with package.json.

## Contacts tab table + Notes & Attachments

- **Contacts tab → home-page table:** the Account "Contacts" / "Linked Contacts" tables now render
  via the shared `DynamicTable` driven CLIENT-SIDE (the related contacts are in memory) — column
  sorting, per-column value-picker filtering + facets, full-panel zebra banding (`fillHeight`), table
  fills the panel. Client filter/sort/facet evaluators mirror the server (`query.ts`). Panel chrome
  (Show-inactive, Add-contact picker, New-contact modal) preserved; the detail page passes the
  contact `fields`.
- **Notes & Attachments** (Account + Contact): notes, web-links (http(s)-validated) and file
  attachments. **Storage: `records.data.notesAttachments`** — deliberately NOT a new table (a new
  RLS policy/table is a standing human gate); items inherit the record's tenant isolation.
  `/api/crm/[entityType]/[id]/notes` (GET/POST/PATCH/DELETE): read = `${slug}.read`, mutate =
  `${slug}.update` (or ownership), cross-tenant 404. `NotesAttachmentsPanel` is a layout widget
  (reorderable/hideable) on both entities. **Production considerations:** attachments are capped
  (~500KB) data URLs in JSONB — production should use object storage + a dedicated `record_notes`
  table (with RLS) and signed URLs; large/many attachments bloat the record JSONB; no virus scan /
  content-type allow-list yet.

## Contacts tab — density & full-surface refinement

Follow-up tightening of the Account "Contacts" tab for high-volume use (hundreds/thousands of
contacts):

- **Slimmer panel headers** — `Panel` gained an opt-in `denseHeader` (reduces header vertical
  padding to `--space-2`); the contacts panels use it.
- **Chrome in the header** — `DynamicTable` gained `hideToolbar`; the contacts panels render
  **Include archived** + **Columns** inline in the panel header (via the now-exported `ColumnToggle`
  with controlled `visibleColumns`), eliminating the standalone toolbar row and its whitespace.
- **No pagination** — `DynamicTable` gained `hidePagination`; the contacts tables show **every**
  related contact (page-level scroll), since the related set is already in memory. No Previous/Next.
- **Full surface, always ≥10 rows** — `DynamicTable` gained `minRows`; the contacts tables pass
  `minRows={10}`. The zebra banding fills down to at least 10 rows even when sparse/empty (uses a
  measured-or-estimated row height, so banding renders even with zero records). Reusable primitive
  for the system-wide "tables are full-size even when empty" preference.
- **Per-panel actions** — primary **Contacts** panel: only **New contact** (create; account
  inherited) — the old "Add contact" link-existing picker and the "Show inactive" checkbox were
  removed. **Linked Contacts** panel: **Link existing contact** (renamed from "Add contact"); no
  "Show inactive".
- **Demoted lifecycle action** — "Mark inactive" / "Reactivate" moved off the prominent page header
  into a low-key bottom-left page footer (subtle muted text button), since it's rarely used.
- **Compact rows** — `DynamicTable` gained `dense` (trims header/body cell padding, `px-3 py-1.5`);
  the contacts tables use it. The estimated row height tracks the density so empty/sparse banding
  still lines up.
- **User-adjustable row count** — the panel header has a `Rows` stepper (−/+, default **8**, bounds
  3–50) that drives the table's `minRows`. The user resizes the Contacts / Linked Contacts panels by
  the number of rows shown; more contacts than the count still all render (page scroll).
- **Persistent per user, across logins** — the chosen row count for each panel persists via
  `localStorage`, keyed `adserve:crm:rowCount:<userId>:<panel>` (`account-contacts` /
  `account-linked-contacts`). `userId` is threaded from the server-resolved `user.id`, so two users
  on the same browser don't share settings; the choice survives logout/login and reloads. New
  reusable hook: `lib/use-persistent-state.ts` (SSR-safe, validated read, write-after-load guard).
  **Production consideration:** localStorage is per-device — a per-user preference that follows the
  account across devices belongs in a server-side user-settings store (deferred; a new table / RLS
  policy is a standing human gate).

## Production Considerations log (deferred — handoff to the production rebuild)

1. **Real `opsCampaignId` wiring.** Currently a nullable stub string in `records.data` (no FK, not
   populated). Production must wire it to the operational Planning/Trafficking campaign at the
   Booking stage (FK + integrity + UI link).
2. **Per-tenant configurable campaign stages.** `CAMPAIGN_STAGES` is a fixed enum for the prototype.
   Production should make stages per-tenant configurable (like opportunity `pipeline_stages`),
   including the `Lost` terminal semantics and `pca_outcome` capture rules.
3. **Multi-account campaigns.** A campaign belongs to exactly one Account (M2O). Production may need
   multi-advertiser / agency-of-record structures (M2M with roles).
4. **Reporting for disabled entities.** Disabling a module hides nav/routes/dashboard but never
   deletes data. Reporting/exports over disabled-entity data (and how converted-lead history that
   references a now-hidden Campaign/Opportunity is surfaced) needs a defined behaviour.
5. **Campaign edit-form account field on PATCH.** The detail form renders `account`/`primaryContact`
   relationship fields; create writes them atomically, but the generic PATCH route does not persist
   relationship-field changes from the form — re-linking is done via the Account/Contacts tabs
   (RelatedRecordsPanel). Production should unify create/edit relationship persistence.
6. **Account-name uniqueness is racy.** `findAccountByName` is a read-then-insert with no DB unique
   constraint (shared with the contact/convert flows). Production needs a unique expression index.
7. **`pipeline.*` legacy consolidation.** `pipeline.read`/`pipeline.update` remain opportunity-only
   legacy; the generalized board uses `campaign.update` for campaign moves. Consolidate the pipeline
   permission model in production (e.g. per-entity move permissions).
8. **Convert UI for the 409 warn path.** The convert button does a single POST and surfaces a 409
   (`account_exists`/`contact_exists`) as an error; it does not yet offer an in-UI "link to existing
   + confirm" step. The API semantics (AC 21–23) are complete and tested; the confirm UX is deferred.
9. **Monetary-unit consistency.** Campaign `value` + Opportunity `amount` both use the `currency`
   `{amount,currency}` shape; confirm a single canonical minor-unit/seralization story platform-wide.
10. **Full e2e / CI.** Dedicated `crm.admin` test user; Playwright no-flash assertion on nav
    filtering; end-to-end convert→pipeline→dashboard flows. Prototype keeps coverage thin except the
    mandatory isolation + authz harness checks (and the updated convert suite).
