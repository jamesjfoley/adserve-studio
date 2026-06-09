# AdServe Studio — In-product design language

Codified from `style_guides/` (the canonical reference screens). This is the house look every
in-app surface must follow. It complements the `adserve-design` skill (the locked tokens + Panel
contract); this doc is the *applied* layer — the patterns and primitives built on those tokens.

> Reference screens: `style_guides/Home_Page.png` (list pages), `Detail_Page.png` /
> `Three_Panel_page.png` (record forms), `Dashboard_and_Table.png` (dashboards), `Table_on_Page.png`,
> `Left_Nav_Bar.png` (app shell).

## 1. The surface system (the core of the look)

Three contrasting levels — never flatten them:

| Level | Token | Light | Role |
|---|---|---|---|
| Page | `--page-bg` | soft grey `#f4f5f7` | the canvas behind everything |
| Panel | `--panel-bg` | white `#ffffff` | every card/section sits on the page |
| Field | `--field-bg` | light grey `#f3f4f6` | inputs are recessed *wells* on the white panel |

Panels carry `--panel-border` (hairline) + `--elevation-1` (a whisper of shadow) + `--radius-panel`.
A panel with a heading shows a **header band** (`--panel-header-bg` + bottom border) above its body.
All of this is automatic if you use `Panel`. Dark mode flips every level via the tokens — never
hardcode a colour/shadow.

## 2. Primitives (use these; don't re-invent)

- **`Panel`** (`components/ui/panel.tsx`) — every card/section. `title`/`actions` → header band.
  `bodyClassName` is a layout escape for full-height bodies.
- **`PageHeader`** (`components/ui/page-header.tsx`) — page/record header: `eyebrow` (uppercase,
  e.g. "CONTACT"), big `title`, inline `status`, `subtitle`, right-aligned `actions`.
- **`StatusPill`** (`components/ui/status-pill.tsx`) — soft tinted status chip; `statusTone()` maps
  CRM statuses to success/info/warning/neutral.
- **Form fields** — `DynamicForm` renders each layout section as a `Panel`; fields use the shared
  filled `inputClassName` (`FieldShell`). Labels are small + muted above the field.

## 3. Page patterns

**List page (→ `Home_Page.png`):** `PageHeader` (title + count subtitle + a primary "New …" CTA on
the right) → a single white `Panel` holding a **centred search** at the top, then the table:
table-header band (`--table-header-bg`, small muted column labels with sort/filter affordances),
**zebra rows** (`--row-alt`) with `--row-hover`, the primary column as an accent link, statuses as
`StatusPill`s, a `Showing X of Y` footer.

**Detail / record page (→ `Detail_Page.png`, `Three_Panel_page.png`):** `PageHeader`
(eyebrow + title + `(Status)` + actions) → tab strip → content as `Panel`s (one- to three-column
grids of panels), each a labelled header band over a body of filled fields. A sticky bottom action
bar (`Cancel` / `Save`) where the page is a form.

**Dashboard (→ `Dashboard_and_Table.png`):** a row of KPI stat cards (small uppercase label, big
number, sub-detail) → chart panels → a table panel.

## 4. Buttons & accents

- **Primary CTA:** solid `--accent` (the per-org palette) + `--accent-foreground`.
- **Secondary:** white/`--panel-bg` with `--border`, hover `--muted`.
- **Destructive:** red outline.
- The accent is the ONLY hue that changes per org (WS6 palette); everything else is the neutral
  surface system. Links/active-states use `--accent`.

## 5. Hard rules

- Drive every colour/surface/shadow/radius/spacing from tokens (`var(--…)`). No raw hex/px that a
  token already expresses; no value that won't flip in dark mode.
- Use `Panel` for surfaces; don't wrap tab strips / toolbars / nav in a Panel.
- Keep presentational primitives server-safe (react-only imports) — the `boundary/no-server-in-client`
  CI gate must stay green.
