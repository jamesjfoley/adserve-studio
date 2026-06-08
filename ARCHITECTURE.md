# ARCHITECTURE.md — AdServe Studio invariants

These are the invariants every agent (and human) must preserve. Violating one is a
**blocking defect**, not a style preference. `architect` reviews every plan and diff
against this file. When this file and the code disagree, that is itself a defect to
surface — not a licence to ignore the invariant.

> Source of truth is the repo. If anything below has drifted from the actual code,
> flag it rather than silently "correcting" the code to match the doc.

## 1. Multi-tenancy & data isolation (highest blast radius)

- Every tenant-scoped table is RLS-protected with `FORCE ROW LEVEL SECURITY`.
  Isolation is enforced by Postgres, **not** by application-layer filtering.
- The runtime DB role `adserve_app` is `NOBYPASSRLS`. Never rely on app code to
  scope tenant data — assume the app role cannot see across tenants and design to that.
- All tenant-scoped reads/writes go through `withTenant(tenantId, …)`, which sets the
  `app.current_tenant_id` GUC. A query that forgets the context must return **zero rows**,
  never another tenant's rows.
- RLS policies use `NULLIF` on the tenant GUC so an empty/missing context yields zero rows
  rather than a `22P02` cast error. **Do not reintroduce a bare `''::uuid` cast** — that was
  the production `/crm` crash. The fix lives in `001-enable-rls.sql` (atomic, idempotent).
- Cross-tenant service/webhook writes use `withSuperAdminBypass()` (session-scoped GUC),
  **never** a persistent `ALTER ROLE`. Every bypass call site must be justified in the plan
  and covered by a cross-tenant RLS test (bypass sees both tenants; `withTenant(A)` sees only A).
- The records model is a single JSONB `records` table keyed by tenant + type. This is
  deliberate. Sharding into per-type tables is an architecture decision, not an implementation
  choice — it does not happen inside a feature build.

## 2. Permissions

- CRM permission model is a create/update split, ~22 permissions. Every new surface must
  declare its permission and **enforce it server-side**. Client-side gating is cosmetic only.

## 3. Server/client boundary (Next.js 15)

- Server-only modules (DB client, secrets, server actions) must never be imported into client
  components. This is enforced by the custom ESLint boundary rule, which is a CI gate — a
  violation fails lint/build, not at runtime. Do not work around the rule; fix the boundary.

## 4. Cost metering

- AI usage is metered in **micros**. Cap is **$50 USD = 50,000,000 micros**. Cost math is exact;
  no £/$ mixing. Unmapped models must **fail safe** (surface/raise), never silently bill zero.

## 5. The four gates (merge to `main` is impossible without all green)

1. **Lint** — includes the server/client boundary rule.
2. **Production build** — a real `next build` (not dev).
3. **Docker image build** — catches workspace-dependency copy gaps.
4. **Tests** — run under the **RLS-enforced `adserve_app` harness**. A superuser dev DB
   silently bypasses RLS and hides isolation bugs; tests run as the non-bypassing role.

`main` is protected with `enforce_admins`. Break-glass is a deliberate, logged human action
(DELETE protection → push → re-POST), never a routine path.

## 6. Reversibility / blast radius (drives the gate policy)

Irreversible or high-blast-radius operations **always require a human**, regardless of where
they occur in the workflow:

- Prod deploys.
- Destructive or irreversible DB operations.
- RLS / policy changes (`packages/database/sql/**`, RLS-table schema).
- IAM / secrets / permission changes.
- Infra changes (ECS, CloudFront, ALB, security groups).

The ALB scheme is **immutable** post-creation; public access is via CloudFront VPC origin →
internal ALB. Do not propose changing the ALB scheme.

## 7. Prototype Mode (see `docs/prototype-mode.md`)

`prototype/<module>` branches are **quarantined**: they may be pushed and deployed to an isolated
preview environment, but **never merge to `main` and never reach prod**. The multi-tenancy / data
isolation invariants in §1 and the server-side permission rule in §2 still hold under Prototype
Mode — enforced by the tenant-isolation + authz smoke tests kept under the `adserve_app`
(`NOBYPASSRLS`) harness (§5 gate 4), since local `pnpm dev` runs as a superuser and silently
bypasses RLS.
