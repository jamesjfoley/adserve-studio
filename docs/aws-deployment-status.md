# AWS deployment status

Snapshot of where the production AWS deployment stands at end of session
2026-05-22. Reference plan: `docs/aws-infrastructure-plan-ecs-express.md`.

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
| Last successful deploy | `26312437618` — Phase 2 + webhook fix |

## Checklist progress

| # | Step | Status |
|---|---|---|
| 1–14 | Application prep + AWS infra + first deploy | ✓ Complete |
| 15 | ECS service security group registered with RDS SG | ✓ Complete (`ECS_SECURITY_GROUP_ID=sg-0b8c4e804a9231980`) |
| 16 | Database migration (schema push + RLS + seed + provisioning function) | ✓ Complete — see "Notes on step 16" below |
| 17 | Verify app accessible at AWS-provided domain | ✓ Complete via CloudFront — see "Notes on step 17" below |
| 18 | Configure Clerk webhook endpoint | ✓ Complete — secret rotated to real `whsec_…`, description corrected, ECS task restarted, signature verification verified live |
| 19 | End-to-end test (sign-up + create tenant) | ⏸ In progress — sign-up flow blocked on two fixes (see below) |
| 20 | Custom domain + ACM cert | Deferred — `cloudfront.net` URL in use for now |
| 21 | `withTenant()` / `withSuperAdminBypass()` query refactor (44 sites) | Deferred — tracked in memory `task_rls_production_switchover` |
| 22 | RDS credential rotation in Secrets Manager | Not started |

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

## Step 19 — what's blocking

Three Clerk webhooks fired on first sign-up attempt (`user.created`, `organization.created`, `organizationMembership.created`). All three failed with PostgreSQL error `42501` "permission denied for table users/tenants/...". Signature verification passes (we're past that gate); the rejection happens at the DB-privilege check before any row is inserted.

DB state on session close: **all tenant tables empty** (0 users, 0 tenants, 0 roles, 0 memberships, 0 invitations). Seed data (7 modules, 27 permissions) intact. Clean slate — the fixes can be retried without dirty state.

The session ended without applying fixes. Clerk will keep retrying webhook deliveries on its standard schedule; every retry continues to fail until the fixes land. **This is expected and will self-resolve once the fixes are applied** — Clerk webhook retries will catch up and populate the DB.

### Required fix 1 — GRANTs for `adserve_app`

The role exists with the right attributes (`NOSUPERUSER`, `NOBYPASSRLS`) but has zero privileges on any public-schema table.

```sql
-- Run as adserve_migrator (which owns the tables) on RDS:
GRANT USAGE ON SCHEMA public TO adserve_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO adserve_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO adserve_app;

-- And so future tables (created by future drizzle-kit push as adserve_migrator)
-- also inherit grants — without this, every new table needs a manual GRANT.
ALTER DEFAULT PRIVILEGES FOR ROLE adserve_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO adserve_app;
ALTER DEFAULT PRIVILEGES FOR ROLE adserve_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO adserve_app;
```


After this lands, `user.created` webhook will succeed immediately (the `users` table has no RLS, so privilege is the only gate). `/dashboard` will SSR cleanly. But the two organisation-related webhooks will still fail — with a different error this time: `new row violates row-level security policy for table "tenants"`.

### Required fix 2 — `withSuperAdminBypass()` in the webhook handlers

`apps/web/src/app/api/webhooks/clerk/route.ts` currently uses bare `db.insert(...)` everywhere. For RLS-protected tables (`tenants`, `roles`, `role_permissions`, `tenant_memberships`, `tenant_modules`, `tenant_invitations`) the inserts will fail the `WITH CHECK` clause once GRANTs are in place — because no `app.current_tenant_id` or `app.bypass_rls` session variable is set.

The fix is to wrap the `organization.created` and `organizationMembership.created` case bodies in `withSuperAdminBypass(async (tx) => { ... })` (imported from `@adserve/database`) and use `tx` instead of `db` for the inserts inside. The `user.created` and `user.updated` cases don't need wrapping — `users` table is not RLS-protected.

A draft of the change wasn't committed in this session — both fixes (GRANTs + handler refactor) are queued for next session.

## Things you can rely on across the session boundary

- **`origin/main` is fully up to date with everything we've done in code**. Both checkouts (`main` and the worktree on `claude/sad-shamir-e2a0ed`) are in sync with their origins. Nothing uncommitted, nothing unpushed.
- **The bastion EC2 (`i-0ee70c07b19b3d743`)** is still running. To resume DB work next session, just re-open an SSM port-forward against it on local port 15432 → `adserve-db.c32e6wm047ec.eu-west-2.rds.amazonaws.com:5432`. The RDS security group's temporary ingress rule from the bastion SG is still in place.
- **CloudFront, ALB rule, secrets, ECS service, all task definitions and roles** are in the state described above. No teardown actions queued.
- **Clerk webhook retries** will keep failing until both fixes land. After the fixes:
  - Clerk webhook UI shows the retry history with delivery results.
  - The retries will eventually push `user.created`, `organization.created`, `organizationMembership.created` through and the DB will populate.
  - No need to re-trigger by signing up again.

## Suggested next session start

1. Re-open SSM port-forward to bastion (`i-0ee70c07b19b3d743`).
2. Apply the GRANT block above via `psql` as `adserve_migrator`. Verify `users` table privileges via `information_schema.table_privileges`.
3. Edit `apps/web/src/app/api/webhooks/clerk/route.ts` to wrap the org-related cases in `withSuperAdminBypass`. Commit, push.
4. Wait for the auto-deploy. Force a new ECS deployment to pick up the new task definition (probably unnecessary — `push to main` triggers it automatically).
5. Watch CloudWatch for the next Clerk webhook retry — should now succeed (200 from the handler).
6. Query DB to confirm rows populated for the test tenant.
7. Sign in via browser to confirm `/dashboard` and `/admin` work end-to-end.
