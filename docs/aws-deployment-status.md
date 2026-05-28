# AWS deployment status

Snapshot of where the production AWS deployment stands at end of session
2026-05-28. Reference plan: `docs/aws-infrastructure-plan-ecs-express.md`.

## Quick reference

| Item | Value |
|---|---|
| Public URL (working) | `https://d22lq47907kone.cloudfront.net` |
| CloudFront distribution | `E2X21YZ83XP812` |
| CloudFront VPC origin | `vo_JLHKrnt5LFsFFIAjf5TCt5` |
| Internal ECS Express ALB DNS | `ad-e50ee5e0ce8240d383f3cba5d8a46572.ecs.eu-west-2.on.aws` (private — VPC-internal) |
| ECS cluster | `adserve-prod` (NOT `adserve`) |
| ECS service | `adserve-studio` |
| Region | `eu-west-2` |
| Bastion EC2 instance | `i-0ee70c07b19b3d743` (still running — reusable) |
| Bastion SG | `sg-0cfd59b93f11c47de` |
| Last successful deploy | `26565477286` — GRANTs + withSuperAdminBypass wrap (commit `b4c1626`) |

## Checklist progress

| # | Step | Status |
|---|---|---|
| 1–14 | Application prep + AWS infra + first deploy | ✓ Complete |
| 15 | ECS service security group registered with RDS SG | ✓ Complete (`ECS_SECURITY_GROUP_ID=sg-0b8c4e804a9231980`) |
| 16 | Database migration (schema push + RLS + seed + provisioning function) | ✓ Complete — see "Notes on step 16" below |
| 17 | Verify app accessible at AWS-provided domain | ✓ Complete via CloudFront — see "Notes on step 17" below |
| 18 | Configure Clerk webhook endpoint | ✓ Complete — secret rotated to real `whsec_…`, description corrected, ECS task restarted, signature verification verified live |
| 19 | End-to-end test (sign-up + create tenant) | ✓ Complete — see "Notes on step 19" below |
| 20 | Custom domain + ACM cert | Deferred — `cloudfront.net` URL in use for now |
| 21 | `withTenant()` / `withSuperAdminBypass()` query refactor (44 sites) | Deferred — tracked in memory `task_rls_production_switchover` |
| 22 | RDS credential rotation in Secrets Manager | Plan approved, execution deferred — see `docs/aws-credential-rotation-plan.md` |
| — | GitHub Actions Node 24 readiness | ✓ Bumped checkout, setup-node, pnpm/action-setup, configure-aws-credentials to `@v6` — see "GitHub Actions" below |

## Notes on step 16

- Database migration was completed using a temporary bastion + SSM port-forward (`localport=15432`).
- Order of operations: `drizzle-kit push --force` (as `adserve_migrator`) → `psql -f packages/database/sql/001-enable-rls.sql` → `psql -f database/002-tenant-provisioning.sql` → `pnpm db:seed`.
- All four steps succeeded. Verified end state: 18 tables, 14 RLS policies (all named `tenant_isolation`), 27 `permissions` rows (11 platform + 16 CRM), 7 `modules`, both `provision_tenant` and `install_crm_schema` functions present.
- Tables are owned by `adserve_migrator`. `adserve_app` has **no privileges on any table** — this is the root cause of the Step 19 block. See "Required fix 1" below.

## Notes on step 17

- ECS Express Mode auto-provisioned an **internal** ALB (private subnets, scheme=internal). The plan implicitly assumed an internet-facing ALB; the action infers scheme from subnet type, and the deploy.yml passed `vars.PRIVATE_SUBNET_IDS`.
- Switching the existing service to internet-facing requires destroying and recreating the entire service (Express Mode "first service in a VPC" rule binds the ALB scheme).
- Resolved by putting **CloudFront with a VPC origin in front of the internal ALB** rather than rebuilding the service. Reasons documented in chat history: keeps tasks in private subnets, no domain or ACM cert needed for now, no conflict with Express Mode, reversible.
- CloudFront → ALB cert validation required: origin DomainName must be the `.on.aws` URL (the ALB's cert is issued for that host only); SNI is set from the origin DomainName.
- Initially set the origin request policy to `Managed-AllViewerExceptHostHeader`, which rewrote the Host header to the `.on.aws` value. This caused Clerk's frontend SDK to redirect the browser to the (unreachable) `.on.aws` URL.
- Fix landed in this session: switched the origin request policy to `Managed-AllViewer` (forwards the viewer Host honestly), AND added `d22lq47907kone.cloudfront.net` to the ALB listener rule's host-header condition so the rule accepts both hosts. **Both changes are required together** — the policy change alone would break the ALB host-routing.

## Notes on step 18

- Secret `adserve/clerk-webhook-secret` was a placeholder until this session — rotated to real `whsec_…` value.
- Webhook signature verification was a TODO in the route handler at start of session; fix landed in commit `83898a5` (merged via PR #1).
- `user.deleted` handler also added in `83898a5` (Clerk plan calls for subscribing to it).
- Verified live with unsigned POSTs — all return 401 as expected.

## Notes on step 19

End-to-end sign-up verified on `b4c1626`. Both fixes landed together in commit
`b4c1626` and deploy run `26565477286`.

**Fix 1 — GRANTs for `adserve_app`** (applied as `adserve_migrator` via the
bastion port-forward):

```sql
GRANT USAGE ON SCHEMA public TO adserve_app;          -- already in place from step 9; no-op
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO adserve_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO adserve_app;
ALTER DEFAULT PRIVILEGES FOR ROLE adserve_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO adserve_app;
ALTER DEFAULT PRIVILEGES FOR ROLE adserve_migrator IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO adserve_app;
```

Verification: `information_schema.table_privileges` reports 72 (table,
privilege) pairs for `adserve_app` (18 tables × 4 privileges). `pg_default_acl`
has the two ALTER DEFAULT entries scoped to `adserve_migrator`, so future
drizzle-kit pushes inherit grants automatically.

`USAGE, SELECT` on sequences was reduced to `USAGE` only — `nextval()` from
Drizzle inserts needs USAGE; SELECT on sequences is only needed for `currval()`
and direct sequence reads, neither of which the app uses.

**Fix 2 — `withSuperAdminBypass()` wrap** in
`apps/web/src/app/api/webhooks/clerk/route.ts`:

- `organization.created` and `organizationMembership.created` case bodies are
  wrapped in `await withSuperAdminBypass(async (tx) => { ... })`; every `db.`
  inside became `tx.`. Inner early-exits switched from `break` to `return` so
  they exit the inner async fn (the `break` after the wrapper still exits the
  switch case).
- `user.created`, `user.updated`, `user.deleted` cases unchanged — `users`
  table is not RLS-protected.
- Side benefit: tenant provisioning is now atomic. If any of the ~7 inserts
  fails, the whole transaction rolls back — no orphaned tenant/role rows.

**Replay mechanics.** Clerk's auto-retry schedule had long since exhausted on
the original 24 May failures by the time we deployed today, so retries did
not land naturally. To exercise the new code against the original payloads,
used Clerk dashboard → Webhooks → "Recover failed messages…" twice (windows
covering 14 May → today). Both finished green; all three messages
(`user.created`, `organization.created`, `organizationMembership.created`)
replayed successfully against the new task.

**Verified DB state after replay** (queried via bastion port-forward as
`adserve_migrator`; required `SET app.bypass_rls = 'on'` since the migrator
role is `NOBYPASSRLS`):

| Table | Rows |
|---|---|
| `users` | 1 (`mrjamesfoley@gmail.com`) |
| `tenants` | 1 ("Katherine's Organization", `org_3E6DFGM0twrGb2eyw7xcXeY8edd`) |
| `roles` | 3 (Owner, Admin, Member) |
| `role_permissions` | 53 (27 owner + 26 admin) |
| `tenant_modules` | 1 (CRM enabled) |
| `tenant_memberships` | 1 (mrjamesfoley → Owner) |

**Side-finding: RLS actively enforces on RDS.** `adserve_migrator` has
`rolbypassrls=false`, so even the migrator hits policies. Counts came back as
0 from a plain query and only returned real values after `SET app.bypass_rls
= 'on'`. This is the opposite of local dev (where `jamesfoley` is a superuser
and silently bypasses) — and confirms the production RLS gate is real. The
`withTenant()` / `withSuperAdminBypass()` refactor (step 21) becomes load-
bearing the moment any RLS-protected query path is invoked by app code, not
just by the webhook bootstrap.

## GitHub Actions

Bumped on 2026-05-28 (commit `e3e4d71`) ahead of GitHub's 2 June 2026
Node-20 deprecation deadline:

| Action | Was | Now | Reason |
|---|---|---|---|
| `actions/checkout` | `@v4` | `@v6` | Node 24 |
| `actions/setup-node` | `@v4` | `@v6` | Node 24 |
| `pnpm/action-setup` | `@v4` | `@v6` | Node 24 |
| `aws-actions/configure-aws-credentials` | `@v4` | `@v6` | Node 24 |
| `aws-actions/amazon-ecr-login` | `@v2` | `@v2` | Not flagged; v2 is latest |
| `aws-actions/amazon-ecs-deploy-express-service` | `@v1` | `@v1` | **Still emits the deprecation warning** — no v2 released yet. Stuck on this until AWS publishes a Node 24 build of the action. Revisit before 16 Sep 2026 (Node 20 removed from runners). |

CI run `26567917576` and deploy run `26567917612` both passed cleanly on the
bumped versions.

## Step 22 — credential rotation plan (approved, execution deferred)

Plan documented in `docs/aws-credential-rotation-plan.md`. **Option A
approved**: JSON-reformat both `adserve/database-url` and
`adserve/database-url-migrator` secrets, deploy AWS's
`SecretsManagerRDSPostgreSQLRotationSingleUser` SAR template (one stack per
secret), wire EventBridge → ECS auto-redeploy. 60-day schedule, app and
migrator offset by 30 days. Master credential rotation (`adserve_master`)
is already handled by RDS via the auto-created
`rds!db-bbdf262a-…` secret.

The 8-step execution sequence and confirmed parameters are in the plan
doc — start there when this is picked up.

## Things you can rely on across the session boundary

- **`origin/main` is fully up to date** with everything we've done in code. HEAD = `e3e4d71` (this status doc update will move it forward by one). Nothing uncommitted will be left when this commit lands.
- **The bastion EC2 (`i-0ee70c07b19b3d743`)** is still running. Resume DB work with an SSM port-forward against it (`localPortNumber=15432`, `host=adserve-db.c32e6wm047ec.eu-west-2.rds.amazonaws.com`, `portNumber=5432`). The RDS SG's temporary ingress rule from the bastion SG is still in place. SSM sessions idle-timeout after a while; just re-open if needed.
- **AWS CLI auth note:** the `default` profile uses `aws login` (browser flow). The `adserve-admin` profile has static IAM keys and works directly — use `AWS_PROFILE=adserve-admin` for all CLI calls.
- **CloudFront, ALB rule, secrets, ECS service, all task definitions and roles** are in the state described above. No teardown actions queued.
- **RDS GRANTs and default privileges** for `adserve_app` are now in place. Any future `drizzle-kit push` against RDS (run as `adserve_migrator`) will create new tables with the grants already inherited — no manual GRANT needed per migration.
- **DB has one real test tenant** (Katherine's Organization, owner `mrjamesfoley@gmail.com`). Safe to leave for ongoing tests; harmless to delete.

## Suggested next session start

Steps 19 and the GitHub Actions Node 24 readiness are closed; step 22 has an approved plan ready to execute. Pick one of these:

1. **Step 22 — execute the rotation plan** in `docs/aws-credential-rotation-plan.md`. All 8 steps, parameters confirmed. Touches infra and one ~5-line app change to `packages/database/src/client.ts`. Will trigger one immediate rotation to verify the chain end-to-end.
2. **Step 20 — custom domain + ACM cert.** Currently on `d22lq47907kone.cloudfront.net`; needs a real domain + ACM cert + CloudFront alternate name + Clerk webhook endpoint update.
3. **Step 21 — `withTenant()` / `withSuperAdminBypass()` query refactor.** Now load-bearing for any RLS-protected query path the app invokes; production RLS is real (verified in step 19). Tracked in memory `task_rls_production_switchover`; branch `claude/sad-shamir-e2a0ed` has the audit of ~44 sites.
4. **Phase 3 work** — CRM module data plane, now that the platform foundation is live.

Browser smoke-test still recommended whichever path comes next: sign in at `https://d22lq47907kone.cloudfront.net`, confirm `/dashboard` and `/admin` load for the test tenant.
