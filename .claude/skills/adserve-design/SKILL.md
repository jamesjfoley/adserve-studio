---
name: adserve-design
description: AdServe Studio's in-product design system. Use when building or refactoring ANY in-app product surface (apps/web authenticated / app-shell UI — CRM, /admin, /super-admin). Encodes the locked design tokens, the Panel primitive contract, and the server/client boundary rule. For in-app surfaces this GOVERNS over generative aesthetics (frontend-design). Do not free-style fonts, colours, shadows, or radii on product surfaces — use the tokens and Panel.
---

This skill is the house design system for **AdServe Studio's in-product UI**. It is a
*constraint* skill: it tells you what to reuse, not how to invent. Match the existing
surfaces; do not introduce a new visual language inside the product.

## When to use this skill — and precedence

**Use `adserve-design` (this skill) for in-app product surfaces** — anything rendered
inside the authenticated app shell under `apps/web`: the CRM (`/crm`), tenant admin
(`/admin`), and super admin (`/super-admin`) screens, plus any shared app-shell chrome.
On these surfaces this skill **GOVERNS**: use the locked tokens and the `Panel` primitive;
do **not** free-style fonts, colours, shadows, radii, or spacing.

**Use `frontend-design` only for marketing pages and throwaway prototypes** — greenfield,
non-product, disposable work where a bold, distinctive aesthetic is the point.

When the two skills conflict on a product surface, **`adserve-design` wins.** (This
precedence is also pinned in `CLAUDE.md`.) Do not edit the vendored `frontend-design`
skill; the two coexist with this stated precedence.

## Source of truth

The tokens live in **`apps/web/src/app/globals.css`** (the `:root` block and the
`@media (prefers-color-scheme: dark)` override block). That file is the single source of
truth. The catalogue below is a **verbatim copy** of those declarations and is held in
sync by a guard test (`apps/web/__tests__/components/adserve-design-tokens-lock.test.ts`):
every `--token: value;` line below must appear verbatim in `globals.css`, or the test
fails. If you change a token, change `globals.css` first, then update the block below to
match — never let them drift.

## Token catalogue (verbatim from globals.css)

Use these CSS variables. Never hardcode a hex/px value that one of these tokens already
expresses.

<!-- TOKENS:BEGIN — verbatim copy of apps/web/src/app/globals.css declarations; guarded by adserve-design-tokens-lock.test.ts. Keep in sync with globals.css. -->
```css
:root {
  /* Base palette (pre-existing) */
  --background: #ffffff;
  --foreground: #171717;
  --muted: #f5f5f5;
  --muted-foreground: #737373;
  --border: #e5e5e5;

  /* Spacing scale (4px base, geometric — note: no --space-7) */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;

  /* Radius */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-panel: 0.75rem;
  --radius-full: 9999px;

  /* Border */
  --border-width: 1px;
  --border-color: var(--border);

  /* Elevation (box-shadow tokens) */
  --elevation-0: none;
  --elevation-1: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --elevation-2: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
  --elevation-3: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);

  /* Panel-scoped padding */
  --panel-padding: var(--space-6);
  --panel-padding-sm: var(--space-4);

  /* Surface tokens */
  --panel-bg: var(--background);
  --panel-border: var(--border);
  --page-bg: var(--background);

  /* Palette seam — reserved for WS6 (see note below) */
  --accent: var(--brand-500, #185fa5);
  --accent-foreground: #ffffff;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0a;
    --foreground: #ededed;
    --muted: #1a1a1a;
    --muted-foreground: #a3a3a3;
    --border: #262626;

    /* Stronger elevation so shadows read on a dark surface */
    --elevation-1: 0 1px 2px 0 rgb(0 0 0 / 0.4);
    --elevation-2: 0 1px 3px 0 rgb(0 0 0 / 0.5), 0 1px 2px -1px rgb(0 0 0 / 0.5);
    --elevation-3: 0 10px 15px -3px rgb(0 0 0 / 0.6), 0 4px 6px -4px rgb(0 0 0 / 0.6);
  }
}
```
<!-- TOKENS:END -->

### `--accent` is reserved for WS6 (factual note, not guidance)

`--accent` / `--accent-foreground` exist in `globals.css` as a seam for a future
admin-selectable per-org palette (WS6). They are **not wired to any selection mechanism
today** and WS4 does not use them for anything. Treat them as reserved: do not build
palette/theming behaviour on them in this skill's scope. (At the CSS layer `--accent`
resolves to its `#185fa5` fallback, because `brand-500` is a Tailwind theme colour, not a
CSS custom property — this is expected, not a bug.)

## Light AND dark — non-negotiable

Every product surface must read correctly in **both** light and dark mode. The base
palette and the elevation tokens already carry dark-mode overrides (the `@media` block
above). Therefore:

- **Always** drive colour, surface, border, and shadow from the tokens (`var(--…)`), so a
  surface automatically picks up the dark-mode override.
- **Never** hardcode a colour, shadow, or border that bypasses a token — a literal
  `#fff` background or a raw `box-shadow` will not flip in dark mode and will break the
  surface. If you need a value, it should come from (or be added to) `globals.css` with a
  dark-mode counterpart where relevant.
- For text on surfaces use `--foreground` / `--muted-foreground`; for surfaces use
  `--panel-bg` / `--background` / `--muted`; for separators use `--border` /
  `--panel-border`.

## The Panel primitive — the surface contract

`Panel` (`apps/web/src/components/ui/panel.tsx`) is the canonical elevated card/section
surface. **Use it for every card/section/panel on a product surface.** Import it:

```tsx
import { Panel } from "@/components/ui/panel";
```

API:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `children` | `ReactNode` | — | panel body |
| `title` | `ReactNode?` | — | rendered in the header row as `<h2 class="text-sm font-semibold tracking-tight">` (the house section-heading style) |
| `actions` | `ReactNode?` | — | right-aligned header slot (e.g. an "Add" button) |
| `elevation` | `0 \| 1 \| 2 \| 3` | `1` | maps to `--elevation-N` |
| `compact` | `boolean` | `false` | uses `--panel-padding-sm` instead of `--panel-padding` |
| `as` | `"section" \| "div" \| "aside"` | `"section"` | polymorphic root |
| `className` | `string?` | — | **layout-only escape hatch** (grid spans, margins) — e.g. `lg:col-span-2`, `mt-6`. Do not use it to restyle the surface. |
| `aria-label` | `string?` | — | forwarded to the root for assistive tech |

Panel applies `--radius-panel`, `--border-width`/`--panel-border`, `--panel-bg`,
`--panel-padding`(or `-sm`), and the selected `--elevation-N` via inline `style`. The root
carries an `adserve-panel` class as a stable hook.

**When to use Panel — and when not:**

- **Use it** for card/section surfaces: dashboard widgets, list table regions, detail-page
  sections, admin setting groups, etc. (WS4 adopted it in the CRM dashboard, list, and
  detail sections.)
- **Do not** wrap non-surface structural UI in a Panel. A tab strip is the canonical
  counter-example: `detail-tabs.tsx` is `role="tablist"`, not a card — wrapping a tablist
  in an elevated bordered Panel would be a *visual regression*, not an improvement. Lists,
  rows, toolbars, and nav strips are likewise not Panels.
- Header row renders only when `title` or `actions` is provided; otherwise Panel is a bare
  token-styled surface.

## Server/client boundary — the #17 rule (CI-enforced)

Presentational primitives like `Panel` must stay importable from **both** server and
client components. The ESLint rule `boundary/no-server-in-client` is a **CI gate** (one of
the four required checks) and fires when a `"use client"` file imports a server-only
module.

Rules for any design-system primitive you add or edit:

- **Import no server-only module** — no `postgres`, no `@adserve/database` *value* import
  (type-only imports are exempt), no DB client, no server action, no secret. `Panel`
  imports only `react` types, which is why it is neither `"use client"`- nor
  server-restricted and the boundary rule never fires on it.
- Keep primitives **pure and props-only**. Push any data loading up into the page/server
  component and pass results in as props.
- No new runtime dependency for a primitive (e.g. `Panel` joins classes with a tiny local
  `cx` helper rather than pulling in `clsx`).

This is criterion **#16** (Panel uses the elevation/border/radius/padding tokens and is
used by the CRM detail/list/dashboard sections) and **#17** (Panel imports no server-only
module — boundary gate stays green), as shipped in WS4.
