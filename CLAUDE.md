# AdServe Studio — Claude Code Project Guide

Multi-tenant advertising operations platform. This file is the orientation document for any Claude Code session working in this repo.

## Tech stack

- **Framework:** Next.js 15 (App Router), TypeScript
- **Database:** PostgreSQL 16, Drizzle ORM (`drizzle-kit push` for schema)
- **Auth:** Clerk (organisations + users)
- **Styling:** Tailwind CSS. In-app product UI (CRM / `/admin` / `/super-admin` under `apps/web`) follows the **`adserve-design`** skill (locked tokens + `Panel`), which **governs** product surfaces; the `frontend-design` skill is for marketing pages / throwaway prototypes only.
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
- `docs/prototype-mode.md` — Prototype Mode operating contract (an alternate track to the autonomous / agent-workflow protocol below: single-pass quarantined prototype build, then resume the multi-agent pipeline for the production rebuild)

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

## Review-before-build protocol (autonomous mode)

For all Phase 3 work, the following protocol is mandatory:

1. Before implementing any task, produce a written plan in the established format.
2. Invoke the architect-reviewer subagent on the plan: `@architect-reviewer review this plan`. Wait for its review before proceeding.
3. If the reviewer says "needs revision," refine the plan and re-invoke the reviewer. Repeat until approved.
4. If the reviewer flags "HUMAN ATTENTION REQUIRED," do NOT stop the run. Handle it per the Autonomous execution policy below: decide-and-proceed for anything reversible; queue-and-continue for the short irreversible/external list.
5. Once approved, implement the task as specified.
6. After implementation, produce an implementation report (same format as previous tasks).
7. Invoke the architect-reviewer on the report: `@architect-reviewer review this implementation report`. Wait for its review.
8. If the reviewer approves, commit on a branch and proceed to the next task. Pushing the feature branch to origin is fine (backup, CI validation, remote review from James's phone). Merging/pushing to `main` is NOT done unattended (see gate list).
9. If the reviewer flags gate-moment items, handle them per the Autonomous execution policy — never stop the run.

This protocol replaces the previous workflow of relaying plans and reports through James manually. The original "Working protocol — review before build" section above (with its "wait for explicit approval") is superseded by this autonomous mode for all Phase 3 work.

### Autonomous execution policy (overnight / unattended is the DEFAULT)

James sets these phases running overnight or while out of the office and will always go with the recommendation, so a paused run just wastes hours. Run each phase end-to-end with ZERO interrupts or approval questions.

- **Decide every scope, design, and workflow question yourself.** Record the decision + a one-line rationale in `docs/phase-3-status.md` and proceed. Mistakes get corrected afterward — that's fine and expected.
- **Never pause to ask "should I proceed?"** The answer is always yes. Don't ask permission for routine actions (bash commands, branch pushes, deletions of generated artefacts, etc.).
- The architect-reviewer's "needs revision" loop is handled by the main agent (refine + re-review), never by pausing for James.
- **The dividing line for what to run unattended is REVERSIBILITY, not how "basic" the action is.** "We can correct mistakes afterward" only holds for reversible work — so do all reversible work autonomously: writing/editing code, migrations against the LOCAL dev DB only, commits, branch creation/flatten/delete, and pushing FEATURE BRANCHES to origin.
- **A short list of IRREVERSIBLE / external / costly actions are NOT executed unattended.** They do NOT pause the run either — do everything else, then collect them into a "GATED ACTIONS — awaiting James" list surfaced at the end of the run (and via a phone push). They are:
  - merging or pushing to `main` (production deploy trigger)
  - applying migrations to the production RDS database
  - rotating/changing Clerk keys or Secrets Manager secrets
  - adding a new paid external service, or a non-trivial new external dependency
  - destructive/irreversible data ops: dropping tables, deleting data, `git push --force`
  - any change to production AWS resources
  - scope changes versus the originally-defined task in `docs/phase-3-plan.md` (architectural pivots that redefine what a task is supposed to deliver)
  If James has explicitly authorised one of these for a given run, do it.
- **Phone escalation.** If a genuinely must-have question arises (unresolvable by judgment AND it blocks all further progress), send a `PushNotification` (reaches James's phone when Remote Control is connected), record your best-guess default, and proceed on that default if at all possible rather than halting. Only stop the whole run if proceeding is genuinely impossible. Also send a push at the end of a long unattended run summarising the GATED ACTIONS queue.

## Progress visibility (don't go silent on the product owner)

The main agent must keep its work visible to James at all times. Long silent periods may cause him to assume the process has stalled and intervene, potentially disrupting work in progress. Treat silence as a signal that must be earned — i.e., only justified by genuine waiting for a tool result, not by extended internal reasoning.

1. **Announce intentions before long operations.** Before running tests, typechecks, lint, builds, or any command expected to take more than a few seconds, state what's about to run and roughly how long it should take. Example: "Running full test suite — usually 30–60 seconds."

2. **Narrate transitions between protocol stages.** When moving between stages (planning → reviewer invocation → refinement → implementation → testing → reviewer invocation → commit), state which stage is starting. Example: "Plan approved by reviewer. Beginning implementation now."

3. **Don't disappear into long thinking.** If an analysis or reasoning step is taking more than ~30 seconds of wall-clock time, surface a one-line status: "Still analysing the relationship schema before writing the query builder." A single line is enough; silence is not.

4. **State current focus during multi-step implementation.** When working across multiple files, periodically say what's being worked on. Example: "Now editing apps/web/src/lib/crm/query.ts" or "Writing the activation idempotency test."

5. **Announce reviewer invocations and their outcomes.** Before invoking the architect-reviewer subagent: "Sending the plan to the architect-reviewer now." After it returns: "Reviewer returned: [verdict]." Don't let the gap between invocation and response feel like a stall.

6. **Failures and errors must be announced immediately.** If a test fails, a typecheck errors, or a tool call returns unexpected results, state what happened in the next message before deciding how to handle it. Never silently retry, suppress, or skip past.

7. **End every task with a clear status line.** Examples: "Task 1.3 plan approved, beginning implementation." / "Task 1.3 done, reviewer approved, committed to branch task/1.3-record-pages. Moving to Task 1.4." James should be able to glance at the terminal and know exactly where the build is.

8. **If genuinely blocked or uncertain, say so explicitly.** "I'm uncertain how to proceed because X — pausing for clarification" is far better than going quiet. Silence on a hard problem looks identical to silence on a crashed process; the difference must be stated.

The cost of being slightly verbose is essentially zero. The cost of the product owner intervening at a critical moment because the process appeared stalled is potentially significant. Err on the side of more narration, not less.

## Agent workflow (see docs/agent-workflow.md)
- Development runs through named agents: planner → architect-reviewer (plan review) → builder →
  qa → architect-reviewer (diff review + open PR + gate-check), orchestrated by the lead session.
  Agents do not converse peer-to-peer; the lead delegates. architect-reviewer is ONE combined
  role, not a separate architect and reviewer.
- The plan at docs/plans/<feature>.md with explicit acceptance criteria is the contract.
  Build to it, test from it, review against it.
- ARCHITECTURE.md holds the invariants. A change that violates one is a blocking defect.
- Autonomous up to opening the PR. Merging to main and deploying to prod are each a human gate;
  architect-reviewer opens PRs but NEVER merges or deploys.
- Standing human gates (any time): prod deploys, destructive/irreversible DB ops, RLS/policy
  changes, IAM/secrets/permission changes, infra changes.
- Protected paths builder must not edit without an explicit human go-ahead:
  packages/database/sql/**, RLS-table Drizzle schema, .github/workflows/**, infra/secrets config.
- Tests run under the RLS-enforced adserve_app harness, never a superuser DB.
