# AdServe Studio — Claude Code Project Guide

Multi-tenant advertising operations platform. This file is the orientation document for any Claude Code session working in this repo.

## Tech stack

- **Framework:** Next.js 15 (App Router), TypeScript
- **Database:** PostgreSQL 16, Drizzle ORM (`drizzle-kit push` for schema)
- **Auth:** Clerk (organisations + users)
- **Styling:** Tailwind CSS
- **Build:** Turborepo with pnpm workspaces
- **Runtime (prod):** AWS ECS Express Mode (Fargate), eu-west-2

## Monorepo layout

```
apps/
  web/                  Next.js application (web + API routes, single deployable)
packages/
  database/             Drizzle schema, migrations, seed scripts (@adserve/database)
docs/                   Platform docs (see "Existing docs" below)
```

`@adserve/database` is consumed by `apps/web`. The Dockerfile relies on `outputFileTracingRoot` so Next.js traces from the monorepo root and bundles this package into the standalone output.

## Architectural principle — non-negotiable

**Super admin and tenant admin are completely separate tracks.** Never combined.

- Super admin accounts (`is_super_admin = true`) never belong to a tenant.
- Tenant accounts never have `is_super_admin = true`.
- Super admin UI lives at `/super-admin`. Tenant admin UI lives at `/admin`.
- Permission infrastructure, role assignments, navigation, and queries respect this split.
- When in doubt: do not mix them. Ask before introducing any code path that touches both.

## Status — what's built

**Phase 1 (super admin) — complete.** Dashboard, tenants, users, modules at `/super-admin`.

**Phase 2 (tenant admin) — complete.** Dashboard, users, roles, settings at `/admin`. Delivered:
- RBAC primitives: `requirePermission`, `<PermissionGate>`, `usePermissions` hook
- Hard role separation enforced in middleware and provisioning
- User and role management within a tenant
- Tenant settings
- RLS policies on 14 tables (see `001-enable-rls.sql` and Task 8)
- Dev provisioning endpoints: `/api/dev/sync-user`, `/api/dev/provision-tenant`

## Row-Level Security — important divergence between dev and prod

| Environment | Connection role | Superuser? | RLS behaviour |
|---|---|---|---|
| Local dev | `jamesfoley` | yes | **Bypasses RLS silently** — policies exist but do nothing |
| Production | `adserve_app` | no | **RLS enforces** on every query |

This means production exposes RLS bugs that local dev hides. The `withTenant()` / `withSuperAdminBypass()` query refactor (44 sites identified in Task 8) is a deferred task on branch `claude/sad-shamir-e2a0ed` and **must be completed before RLS-protected features ship to production.** Track: `task_rls_production_switchover` in memory.

## Database

**Local dev:** `postgresql://jamesfoley@localhost:5432/adserve` (Homebrew PostgreSQL 16).

**Production (planned):** Amazon RDS PostgreSQL 16, `db.t4g.small`, private subnets. Three roles:

| Role | Purpose | Privileges |
|---|---|---|
| `adserve_master` | Emergency break-glass only. Password managed by RDS in Secrets Manager. Never used by app or CI. | `rds_superuser` |
| `adserve_migrator` | Schema changes — `drizzle-kit push`, seed scripts. Run via one-off ECS task. | `CREATE` on schema, `ALL` on tables/sequences |
| `adserve_app` | Runtime connection from ECS containers. Non-superuser — **RLS enforces.** | `SELECT/INSERT/UPDATE/DELETE` only |

Secrets in AWS Secrets Manager (5 total, `adserve/` prefix):
`database-url`, `database-url-migrator`, `clerk-secret-key`, `clerk-publishable-key`, `clerk-webhook-secret`.

## AWS infrastructure (planned, not yet deployed)

Full plan: `docs/aws-infrastructure-plan-ecs-express.md` — expert-approved, all decisions resolved.

Headline decisions:
- **Dedicated VPC** (`10.0.0.0/16`), 2 public + 2 private subnets across 2 AZs, NAT Gateway for egress.
- **ECS Express Mode** with auto-provisioned ALB, target groups, scaling, HTTPS domain.
- **CI/CD:** GitHub Actions, OIDC federation (no stored AWS keys), trust scoped to `repo:jamesjfoley/adserve-studio:ref:refs/heads/main`.
- **Region:** `eu-west-2` (London).
- **Initial deployment uses existing Clerk dev keys** (production Clerk instance is deferred).
- **Docker builds run only in GitHub Actions** — Docker Desktop is not installed locally. Local "test the Docker build" checklist items (steps 3–4) will be executed by pushing a branch and letting CI build, not by `docker build` on this machine.

The plan has a **23-step execution checklist** (lines 577–605 of the plan). We are not starting until I'm told which step is next.

## Existing docs

- `docs/00-platform-foundation.md` — platform foundation
- `docs/01-setup-guide.md` — local setup guide
- `docs/aws-infrastructure-plan-ecs-express.md` — the AWS plan (source of truth for infra work)

## Working protocol — review before build

Every task in this project follows this pattern:

1. Read the full task specification.
2. Review the existing codebase — read relevant files.
3. Confirm understanding back to the user: what will be built, which files change, dependencies, risks, alternatives.
4. Suggest a better approach if one is obvious.
5. **Wait for explicit approval before writing code.**
6. After implementation, summarise what changed and give verification steps.
7. The user tests and confirms before the next step begins.

For the AWS rollout specifically: execute **one checklist step at a time**, then stop and wait. Do not chain steps.

## Things I should not do without being asked

- Modify Clerk configuration or rotate keys.
- Run `drizzle-kit push` against any database other than local dev.
- Touch the `is_super_admin` flag in any seed or migration.
- Refactor query sites for RLS as a side effect of another task — that's its own tracked piece of work.
- Run `docker build` locally (Docker Desktop is not available).
- Push to `main` (that triggers the production deploy pipeline once it exists).

## Local quick reference

```bash
pnpm dev               # turbo dev — runs apps/web
pnpm build             # turbo build
pnpm db:generate       # drizzle-kit generate
pnpm db:migrate        # drizzle-kit migrate (local dev)
pnpm db:seed           # seed local dev
pnpm db:studio         # drizzle studio
```
