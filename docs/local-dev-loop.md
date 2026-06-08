# Local dev-loop runbook

How to get AdServe Studio running on your machine and the tight edit→see→test→build
loop you repeat all day. **Everything here is local and private to your machine** — none
of it pushes, merges, or deploys (see "When this goes to AWS" at the end).

> Note: the older `docs/01-setup-guide.md` describes a Docker Compose Postgres/Redis. The
> machine this was verified on runs **Homebrew PostgreSQL 16 + Redis** instead, which is
> what this runbook documents. (Commands below were run and confirmed working on
> 2026-06-02.)

---

## One-time local setup

The minimum to log in and see the CRM locally.

### 1. Prerequisites

- **Node 20+** and **pnpm 9** (repo pins `pnpm@9.15.0`, `node >=20`).
  ```bash
  brew install node@20
  npm install -g pnpm
  ```
- **PostgreSQL 16 + Redis via Homebrew**, both running as services:
  ```bash
  brew install postgresql@16 redis
  brew services start postgresql@16
  brew services start redis
  ```
  Verify:
  ```bash
  pg_isready -h localhost -p 5432        # -> accepting connections
  redis-cli ping                         # -> PONG
  ```
  > Redis is currently **declared but unused** — `REDIS_URL` is in the env template and the
  > service runs, but no application code references it yet. You can run the dev loop
  > without Redis today; it's listed here so the env matches the template.

### 2. Install dependencies

```bash
pnpm install
```

### 3. Create the local database

```bash
createdb adserve          # owned by your local superuser role (e.g. jamesfoley)
```

### 4. `.env.local` (variable NAMES only — fill in your own values)

Copy the template and fill it in:

```bash
cp .env.example .env.local
```

The variables the app reads locally:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Local app DB connection — `postgresql://<you>@localhost:5432/adserve` |
| `REDIS_URL` | Declared for parity; not consumed by code yet |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk dev-instance publishable key |
| `CLERK_SECRET_KEY` | Clerk dev-instance secret key |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Clerk auth route paths |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` / `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` | Post-auth redirect paths |
| `ANTHROPIC_API_KEY` | AI features (CRM AI summaries etc.) |
| `NEXT_PUBLIC_APP_URL` | App base URL (e.g. `http://localhost:3000`) |
| `NODE_ENV` | `development` locally — **gates the `/api/dev/*` provisioning endpoints** |

> **DB role — local vs. the test harness (important).** Locally the app connects as your
> Homebrew **superuser** (`postgresql://<you>@localhost:5432/adserve`), which **silently
> bypasses RLS** — so RLS bugs hide in dev. The **test suite deliberately does not** use
> this connection: `apps/web/vitest.config.ts` points the app's runtime queries at the
> non-superuser **`adserve_app`** role (`TEST_APP_DATABASE_URL`, default
> `postgresql://adserve_app:adserve_app_dev@localhost:5432/adserve`, `NOBYPASSRLS`) so RLS
> actually enforces in tests, exactly like prod. Fixtures still seed via the privileged
> role (`TEST_DATABASE_URL`, default `postgresql://<you>@localhost:5432/adserve`). You do
> not normally set these two by hand — the defaults are baked into the vitest config.

### 5. Apply schema, RLS, the app-role, and platform seed

```bash
pnpm db:generate                              # drizzle-kit generate (migration files from schema)
pnpm db:migrate                               # drizzle-kit migrate (apply to local DB)
pnpm db:seed                                  # seed platform modules + permissions

# RLS + the local adserve_app role, so the test harness mirrors prod:
pnpm --filter @adserve/database db:rls-dev-parity   # runs sql/001-enable-rls.sql + sql/dev-rls-roles.sql
```

`db:seed` seeds **platform-level** modules and permissions only — it does **not** create a
tenant. The tenant is provisioned at runtime in step 7.

### 6. Clerk dev instance

In the Clerk dashboard for your dev application:
- **Enable Organizations** (Configure → Organizations) — this maps to our multi-tenancy.
- Copy the dev **publishable** and **secret** keys into `.env.local` (step 4).
- No webhook setup is needed locally — the dev endpoints in step 7 stand in for the Clerk
  webhooks that fire in prod.

### 7. Log in and provision a dev tenant

```bash
pnpm dev                       # then open http://localhost:3000
```

1. Sign up / sign in through Clerk, and **create + select an Organization** in the UI.
2. Hit the dev provisioning endpoints (both are `GET`, both 404 unless `NODE_ENV=development`):
   - `http://localhost:3000/api/dev/sync-user` — upserts your Clerk user into the DB
     (stands in for the Clerk `user.created` webhook).
   - `http://localhost:3000/api/dev/provision-tenant` — creates the tenant from your
     selected Clerk org and activates the CRM module (stands in for the org webhook).

After that you can navigate to `/crm` and see the CRM locally.

---

## Inner loop (repeat freely — all local, no push/merge/deploy)

| Command | What it catches |
|---|---|
| `pnpm dev` | Runs Next.js at **http://localhost:3000** with hot reload. The fast visual loop — see UI/route/behaviour changes immediately; `/api/health` returns `{"status":"ok"}` once it's up (boots in ~2s). |
| `pnpm test` | Runs the full Vitest suite across all 5 workspaces under the **RLS-enforced `adserve_app`** harness (~483 tests). Catches logic regressions **and** tenant-isolation/RLS bugs that the superuser dev DB would hide. Web-only, faster: `pnpm --filter @adserve/web test`. |
| `pnpm build` | A real `next build` (turbo `build`). Catches what dev mode tolerates: type errors, server/client boundary violations, bad imports, and prod-only build failures — the same build CI runs. |

Lint separately when you want just the boundary/style gate: `pnpm lint` (turbo `lint` →
`eslint .`, includes the server/client boundary rule). `pnpm db:studio` opens Drizzle
Studio to browse the local DB.

---

## When this goes to AWS

**Nothing above touches AWS.** The local DB, Clerk dev keys, and dev provisioning
endpoints are private to your machine. The app ships to production **only on merge to
`main`**, which triggers the GitHub Actions deploy to ECS — gated behind the four CI
checks (lint, production build, Docker image build, RLS-enforced tests) and a human merge
approval. Until you merge, your inner loop is yours alone.
