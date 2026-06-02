# Plan: WS4 — Design-system tokens + a server-safe Panel primitive

Status: DRAFT — awaiting architect-reviewer.
Author: planner
Date: 2026-06-02
Parent plan: `docs/plans/crm-relationships-conversion-design-system.md` (WS4 = lines ~279–280,
~407–419; LOCKED acceptance criteria #16 and #17 = lines ~493–496).

---

## Goal

Establish the design-system foundation for the CRM: expand `globals.css` with elevation / border /
radius / padding / spacing / surface tokens (preserving the existing 5 vars and the dark-mode
block), introduce a single **server-safe** `Panel` presentational primitive, and refactor the CRM
**dashboard, list, and detail** section blocks to use it — replacing the repeated inline
`rounded-xl border border-[var(--border)] p-6` pattern with one tokenised component.

## Scope / non-scope

**In scope (frontend-only, low risk):**
1. Expand `apps/web/src/app/globals.css` `:root` with the WS4 token set (elevation box-shadows,
   border, radius, padding, plus the spacing/surface tokens the parent plan lists at ~407–415).
   Keep the existing 5 palette vars (`--background`, `--foreground`, `--muted`,
   `--muted-foreground`, `--border`) and the `@media (prefers-color-scheme: dark)` block working;
   add dark-mode values for any new token whose light value would not read correctly in dark.
2. Create `apps/web/src/components/ui/panel.tsx` — a pure presentational `<Panel>` wrapper applying
   the panel surface / elevation / border / radius / padding tokens, with optional `title` and
   `actions` slots. Pure props; **no server-only imports** so it renders from both server and client
   components.
3. Refactor the CRM **dashboard, list, and detail** sections to use `<Panel>`:
   - Dashboard widgets (`crm/page.tsx`) — 5 inline `<section className="rounded-xl border …">`.
   - Detail panels (`related-records-panel.tsx`) — the self-contained `<section className="rounded-xl
     border …">` wrapper (already commented "so WS4 can swap the wrapper for a `<Panel>`").
   - List surface (`crm-list-client.tsx`) — the bulk-action bar block (currently `rounded-lg border …
     bg-[var(--muted)]`) and/or wrap the table region in a `<Panel>` so the list section visibly uses
     the primitive. (See "Refactor approach" for the exact target.)
4. Add `Panel` component test coverage under the existing jsdom + RTL harness.

**Non-scope (explicit — OUT):**
- **No** DB, schema, migration, RLS, or `packages/database/sql/**` change.
- **No** IAM / secrets / infra change.
- **No** edit to any protected path (`packages/database/sql/**`, RLS-table Drizzle schema,
  `.github/workflows/**`, secrets/infra config).
- **No** WS1 (cardinality flip), WS2 (link/unlink API), WS3 (relationship UI logic), WS5 (nav), or
  WS6 (palette) work. WS4 only. The palette token *names* WS6 will later override may be introduced
  here as vars, but **no palette selection / per-org theme mechanism** is built in WS4.
- **No** charting/component-library dependency; one `Panel` primitive + CSS-var tokens only (parent
  plan non-scope: "No global component library adoption").
- **No** behavioural change to any CRM page — refactors are visual-structure-preserving wrappers
  only (same headings, same children, same data flow, same permission gates).
- **No** change to `tailwind.config.ts` `brand` ramp (existing `bg-brand-*` classes stay as-is);
  WS4 adds CSS vars to `globals.css`, it does not rewire Tailwind's theme.

## ARCHITECTURE.md invariants touched

- **§3 Server/client boundary.** `Panel` is a pure presentational component: it takes
  `ReactNode`/`string`/`className` props and emits markup with token-based classes. It imports
  **no** server-only module — specifically not `postgres` and not `@adserve/database` (the two names
  the ESLint `boundary/no-server-in-client` rule forbids in `"use client"` files), and no DB client,
  secret, or server action. Because it has no server-only import, it is intentionally **not** marked
  `"use client"` either — a server component (dashboard `crm/page.tsx`) and a client component
  (`crm-list-client.tsx`, `related-records-panel.tsx`) can both import it. This is the literal intent
  of locked criterion **#17**. The boundary lint gate stays green.
- **§5 The four gates.** All four must stay green: lint (incl. the boundary rule), production
  `next build`, Docker image build, and the RLS-enforced `adserve_app` test harness. WS4 adds only a
  CSS file change, one new pure component, three presentational refactors, and one jsdom component
  test — none of which touch RLS, the workspace dependency graph, or the build's standalone tracing.
  The existing ~307 tests must remain green (the refactors preserve DOM structure / accessible
  labels the existing `crm-detail-client.test.tsx` and `crm-list-client.test.tsx` assert against).

§1 (multi-tenancy/RLS), §2 (permissions), and §4 (cost metering) are **not** touched by WS4 — no
data access, no permission declaration, no metering. §6 protected paths are **not** touched.

---

## Token set to add to `globals.css`

Current `:root` (lines 5–11) keeps all five existing vars unchanged. The dark-mode block
(lines 13–21) keeps its five overrides unchanged. WS4 **adds** the following tokens to `:root`, and
adds dark-mode overrides only for the surface/elevation tokens that need them. Values below are the
proposed defaults (final exact values may be nudged by the builder within these ranges; names are
fixed because the tests and WS6 depend on them).

**Spacing scale (4px base, geometric):**
```
--space-1: 0.25rem;   /* 4px  */
--space-2: 0.5rem;    /* 8px  */
--space-3: 0.75rem;   /* 12px */
--space-4: 1rem;      /* 16px */
--space-5: 1.25rem;   /* 20px */
--space-6: 1.5rem;    /* 24px — current section padding (p-6) */
--space-8: 2rem;      /* 32px */
```

**Radius:**
```
--radius-sm: 0.375rem;   /* matches rounded-md controls */
--radius-md: 0.5rem;     /* matches rounded-lg */
--radius-panel: 0.75rem; /* matches the current rounded-xl section */
--radius-full: 9999px;   /* badges/pills */
```

**Border:**
```
--border-width: 1px;
--border-color: var(--border);  /* alias onto the existing token, single source of truth */
```

**Elevation (box-shadow tokens):**
```
--elevation-0: none;
--elevation-1: 0 1px 2px 0 rgb(0 0 0 / 0.05);
--elevation-2: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
--elevation-3: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
```

**Padding (panel-scoped, layered on the spacing scale):**
```
--panel-padding: var(--space-6);     /* default panel inset, = current p-6 */
--panel-padding-sm: var(--space-4);  /* compact panel inset */
```

**Surface tokens:**
```
--panel-bg: var(--background);       /* panels sit on the page background today */
--panel-border: var(--border);
--page-bg: var(--background);
```

**Palette token seam for WS6 (names introduced, NOT wired to any selection mechanism in WS4):**
```
--accent: var(--brand-500, #185FA5);            /* mirrors tailwind brand-500 */
--accent-foreground: #ffffff;
```
(WS6 later overrides `--accent` / the surface vars per-org; WS4 only declares them so the seam
exists. No DB read, no per-request resolution in WS4.)

**Dark-mode additions** (inside the existing `@media (prefers-color-scheme: dark)` block) — only
where the light value reads wrong on a dark surface:
```
--elevation-1: 0 1px 2px 0 rgb(0 0 0 / 0.4);
--elevation-2: 0 1px 3px 0 rgb(0 0 0 / 0.5), 0 1px 2px -1px rgb(0 0 0 / 0.5);
--elevation-3: 0 10px 15px -3px rgb(0 0 0 / 0.6), 0 4px 6px -4px rgb(0 0 0 / 0.6);
```
`--panel-bg`, `--panel-border`, `--accent` resolve via the already-dark `--background` / `--border`
/ brand vars, so they need no explicit dark override. The five existing dark overrides are untouched.

---

## `Panel` API

`apps/web/src/components/ui/panel.tsx` — a single named export. Minimal, presentational, pure props.

```ts
type Elevation = 0 | 1 | 2 | 3;

interface PanelProps {
  children: React.ReactNode;
  /** Optional heading rendered in the panel header row. String or node. */
  title?: React.ReactNode;
  /** Optional right-aligned header slot (e.g. an "Add" button). */
  actions?: React.ReactNode;
  /** Elevation token to apply; default 1. */
  elevation?: Elevation;
  /** Compact padding (uses --panel-padding-sm). Default false. */
  compact?: boolean;
  /** Polymorphic root element. Defaults to "section". */
  as?: "section" | "div" | "aside";
  /** Escape hatch for layout classes (grid spans, margins) on the root. */
  className?: string;
  /** Forwarded to the root (e.g. aria-label) — typed as a narrow allowlist. */
  "aria-label"?: string;
}
```

Behaviour:
- Renders `<As className="<token classes> {className}">`. The token classes apply
  `--radius-panel`, `--border-width`/`--panel-border`, `--panel-bg`, `--panel-padding` (or
  `-sm` when `compact`), and the selected `--elevation-N` via inline `style={{ boxShadow:
  "var(--elevation-N)" }}` or a small static class map (builder's choice; tests assert observable
  output, see below).
- When `title` or `actions` is present, renders a header row (flex, space-between) above
  `children`; the title uses the existing `text-sm font-semibold tracking-tight` heading style so
  the refactored panels match today's headings exactly.
- When neither `title` nor `actions` is given, renders `children` directly (no empty header row).

**Why it is server-safe (criterion #17):** the file imports only `react` (and `clsx`/string concat
if used) — **no `postgres`, no `@adserve/database`, no DB client, no server action, no secret**. It
is therefore not `"use client"`-restricted and not server-restricted; it is shared. The boundary
ESLint rule only fires on `"use client"` files importing the forbidden modules, and `Panel` imports
none, so the gate stays green regardless of where it is imported. A dedicated test asserts no
server-only import (see Test obligations).

---

## Files to change + refactor approach

| File | Change |
|---|---|
| `apps/web/src/app/globals.css` | Add the token set above to `:root`; add the listed dark-mode elevation overrides. Existing 5 vars + dark block preserved. |
| `apps/web/src/components/ui/panel.tsx` | **NEW.** The `Panel` primitive above. |
| `apps/web/src/app/(platform)/crm/page.tsx` | Replace each of the 5 `<section className="rounded-xl border border-[var(--border)] p-6 …">` widgets with `<Panel title="…">…</Panel>`, lifting the existing `<h2>` text into `title`. Preserve the `lg:col-span-2` on the pipeline widget via `className`. Server component — imports `Panel` directly. |
| `apps/web/src/app/(platform)/crm/[entityType]/[id]/_components/related-records-panel.tsx` | Replace the outer `<section aria-label={…} className="rounded-xl border …">` with `<Panel as="section" aria-label={…} title={<plural label>} actions={<Add button>}>`. Keep the existing `aria-label` (tests/assistive tech rely on it). Move the current header row's title + Add button into `title`/`actions`. Body (error, picker, list/empty-state) becomes `children`. Client component — `Panel` is server-safe so importing it is fine. |
| `apps/web/src/app/(platform)/crm/[entityType]/_components/crm-list-client.tsx` | Wrap the list/table region (the `<div className="mt-6"><DynamicTable …/></div>`) in a `<Panel>` (no title, so the table reads as a single elevated surface), satisfying "used by … the list section". Optionally also convert the bulk-action bar's `rounded-lg border … bg-[var(--muted)]` block to `<Panel compact>` — but keep its `bg-[var(--muted)]` via `className` so the visual distinction from the table panel is preserved. Builder picks the cleaner of the two; the table-region wrap is the required one. Client component — import is server-safe. |
| `apps/web/__tests__/components/panel.test.tsx` | **NEW.** Panel component tests (see below). |

**Refactor invariants (avoid visual/behavioural regression):**
- Headings keep `text-sm font-semibold tracking-tight`; the `Panel` title slot uses the same.
- `aria-label`s and `role`s on the refactored `<section>`s are preserved (the
  `crm-detail-client.test.tsx` and any RLS page tests render these; changing labels would break
  assertions and a11y).
- The dashboard widgets keep their conditional rendering, grid placement (`lg:col-span-2`), and the
  empty-state copy verbatim.
- `crm-detail-client.tsx` itself is **not** edited (it composes `RelatedRecordsPanel`; the swap is
  internal to that child). The legacy related sidebar `<section>`s and the modal cards are left as-is
  for WS4 (out of the "detail/list/dashboard sections" minimum and not worth regression risk;
  noted, not done).
- Modals (`bg-[var(--background)] … shadow-xl` cards in the list/detail clients) are **not**
  converted in WS4 — they are overlays, not page section panels. Noted as a deliberate non-target.

---

## Acceptance criteria (QA-derivable)

**LOCKED (from the parent plan, verbatim — non-negotiable):**

16. A `Panel` primitive renders with the elevation/border/radius/padding tokens and is used by at
    least the CRM **detail, list, and dashboard** sections.
17. `Panel` imports no server-only module (the lint import-boundary gate stays green).

**WS4-specific (additive, testable):**

18. The new `globals.css` tokens (`--space-*`, `--radius-*`, `--border-*`, `--elevation-0..3`,
    `--panel-padding[-sm]`, `--panel-bg`, `--panel-border`, `--page-bg`, `--accent`,
    `--accent-foreground`) are defined in `:root`; the five pre-existing vars and the
    `prefers-color-scheme: dark` block remain present and unchanged in value.
19. Each new elevation token has a defined value in BOTH the light `:root` and the dark-mode block
    (or resolves through an already-overridden base var), so panels render correctly in dark mode —
    no token resolves to an empty string in either scheme.
20. `Panel` renders its `children`; when `title`/`actions` are passed it renders them in a header
    row; when neither is passed it renders no empty header. Default `elevation` is `1`; passing
    `elevation={n}` and `compact` changes the applied token (observable in the rendered class/style).
21. The CRM dashboard (`crm/page.tsx`), the detail relationship panels
    (`related-records-panel.tsx`), and the CRM list surface (`crm-list-client.tsx`) all render via
    `<Panel>` (grep: no remaining `rounded-xl border border-[var(--border)] p-6` literal in these
    three files for the converted sections).
22. No behavioural regression: the existing `crm-detail-client.test.tsx`, `crm-list-client.test.tsx`,
    `dynamic-table*.test.tsx`, and `dynamic-form.test.tsx` suites still pass unchanged (preserved
    DOM structure / labels). The CRM list, detail, and dashboard pages render with the same headings,
    empty states, and controls as before.
23. `next build` (production) completes with no new errors or warnings attributable to WS4; the
    Docker image build gate stays green.

---

## Test obligations (QA must prove; run under the RLS-enforced `adserve_app` harness)

WS4 is frontend-only and introduces **no tenant-scoped surface, no new DB read/write, and no
`withSuperAdminBypass` path** — therefore **no no-predicate tenant-isolation assertion and no
cross-tenant control are applicable to WS4 itself** (there is no new query to isolate). This is
stated explicitly so the reviewer can confirm the isolation obligation is N/A here, not omitted.
The existing RLS page tests (`crm-detail-page-rls.test.ts`, `crm-list-page-rls.test.ts`,
`crm-dashboard-pipeline-rls.test.ts`) continue to run under the `adserve_app` harness and act as the
regression guard that the panel refactor did not break the tenant-scoped page renders.

**Panel component test** (`apps/web/__tests__/components/panel.test.tsx`, jsdom + RTL, mirroring the
existing `// @vitest-environment jsdom` + `@testing-library/react` pattern):
- Renders `children` (text appears in the DOM).
- Renders `title` and `actions` in a header row when provided; renders no empty header when both are
  omitted (asserts the title text is absent and children still render).
- Applies token-based output: the root carries the panel border/radius classes (or CSS-var-backed
  classes) and the elevation reflects `elevation` prop (default 1 vs an explicit value differ in the
  rendered class/`style.boxShadow`). Asserts the observable difference, not implementation detail.
- `as="div"` renders a `<div>`; default renders a `<section>`; `className` is forwarded onto the
  root; `aria-label` is forwarded.
- **No server-only import (criterion #17):** a static assertion that `panel.tsx`'s source contains
  no import of `postgres` or `@adserve/database` (read the file and assert the import list is
  client-safe), complementing the lint gate. (The authoritative proof is the lint boundary gate
  itself in CI; this is a fast in-suite guard.)

**Gate obligations (the four gates — qa runs and reports each):**
- **Lint** green, including `boundary/no-server-in-client` — proves #17 at CI level. Importing
  `Panel` into the client `crm-list-client.tsx` / `related-records-panel.tsx` must not trip the rule.
- **Production build** (`next build`) green — proves the CSS + component changes compile and the
  refactored pages build (criterion #23).
- **Docker image build** green — proves no workspace-dependency / tracing regression (no new package
  dep was added, so this is expected clean; still verified).
- **Test harness** (`adserve_app`, non-superuser) green — the new `panel.test.tsx` plus the full
  existing ~307-test suite, with the documented serial-execution caveat for the DB-bound suites
  (`vitest run --no-file-parallelism`). No expected-fail introduced.

---

## Risks & how the refactor avoids visual regressions

- **Risk: a token swap subtly changes spacing/borders.** Mitigation: the panel tokens are chosen to
  equal today's values (`--radius-panel` = `rounded-xl`'s `0.75rem`; `--panel-padding` = `p-6`'s
  `1.5rem`; `--panel-border` aliases the existing `--border`). The refactor is value-for-value, plus
  an additive elevation shadow that the inline sections lacked (a deliberate, mild visual lift, not a
  structural change).
- **Risk: breaking a test that asserts DOM structure / labels.** Mitigation: preserve every
  `aria-label`, `role`, heading text, and empty-state string; `crm-detail-client.test.tsx` and
  `crm-list-client.test.tsx` are run as the regression guard before and after.
- **Risk: accidentally marking `Panel` `"use client"` (or importing a server module) and tripping
  the boundary rule.** Mitigation: `Panel` imports only `react`; it is neither client- nor
  server-restricted; the dedicated no-server-import test plus the lint gate both guard this.
- **Risk: dark-mode panels look wrong (shadow invisible on dark).** Mitigation: explicit dark
  elevation overrides (criterion #19); surface vars resolve through already-dark base vars.
- **Risk: scope creep into WS5/WS6.** Mitigation: WS6's palette var *names* are declared but no
  selection/per-request mechanism is built; nav is untouched. Flagged in non-scope.

---

## Gate notes (protected paths / standing human gates)

- **No protected path is touched.** WS4 edits `globals.css`, adds `panel.tsx`, refactors three CRM
  client/server components, and adds one test. It does **not** touch `packages/database/sql/**`,
  RLS-table Drizzle schema, `.github/workflows/**`, or secrets/infra config.
- **No standing human gate is hit.** No prod deploy, no DB op, no RLS/policy change, no IAM/secrets
  change, no infra change. Autonomous through to opening the PR; merge to `main` remains the usual
  human gate (architect-reviewer opens the PR, never merges).
- **No new dependency.** No charting/component library added — so no "new external dependency" gate.

---

## Deviations from the prompt / master plan

- None material. The prompt's listed detail-section target — `crm-detail-client.tsx` and "its
  `_components/*` panels (related-records-panel, detail-tabs, etc.)" — is honoured by converting the
  panel wrapper inside `related-records-panel.tsx` (which `crm-detail-client.tsx` composes, and which
  carries the in-code note that it was "Structured as a self-contained `<section>` so WS4 can swap
  the wrapper for a `<Panel>`"). `detail-tabs.tsx` is a tab strip, not a card/section, so it is
  deliberately **not** wrapped in `Panel` (wrapping a tablist in a card would be a visual
  regression); noted here rather than silently skipped. This satisfies criterion #16's "detail …
  section" via the relationship panels, which is the actual section surface on the detail page.
- The prompt notes WS3 files "verify against the repo." Verified: WS3 already shipped (PRs #12/#13),
  so the detail page already uses tabs + `RelatedRecordsPanel`; WS4 swaps that panel's wrapper rather
  than the older flat sidebar. This is the correct current-state target.

---

## Relevant file paths (absolute)

- `/Users/jamesfoley/Claude Code Projects/adserve-studio/apps/web/src/app/globals.css`
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/apps/web/src/components/ui/panel.tsx` (NEW)
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/apps/web/src/app/(platform)/crm/page.tsx`
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/apps/web/src/app/(platform)/crm/[entityType]/[id]/_components/related-records-panel.tsx`
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/apps/web/src/app/(platform)/crm/[entityType]/_components/crm-list-client.tsx`
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/apps/web/src/app/(platform)/crm/[entityType]/[id]/_components/crm-detail-client.tsx` (composes the panel; not edited)
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/apps/web/src/app/(platform)/crm/[entityType]/[id]/_components/detail-tabs.tsx` (deliberately not wrapped)
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/apps/web/__tests__/components/panel.test.tsx` (NEW)
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/apps/web/eslint.config.mjs` (the boundary rule that gates #17; not edited)
- `/Users/jamesfoley/Claude Code Projects/adserve-studio/apps/web/tailwind.config.ts` (brand ramp reference; not edited)
