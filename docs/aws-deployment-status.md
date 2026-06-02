# AWS deployment status

This doc **leads with the current prod state + the reusable DB/cutover runbook**
(2026-06-01, after the Phase-1b CRM cutover + production-hardening). The
`## Quick reference` and per-step notes further down are the **2026-05-28
deployment-history** record (reference plan:
`docs/aws-infrastructure-plan-ecs-express.md`).

---

## Current prod state — 2026-06-01

### App
- Cluster `adserve-prod`, service `adserve-studio`, **rev 23 live + healthy**
  (`rolloutState=COMPLETED`, running == desired == 1).
- URL `https://d22lq47907kone.cloudfront.net` (CloudFront `E2X21YZ83XP812` →
  internal ECS Express ALB).
- **Rollback target: rev 22.**
  ```bash
  aws ecs update-service --cluster adserve-prod --service adserve-studio \
    --task-definition adserve-prod-adserve-studio:22 --force-new-deployment
  ```

### DB — RDS instance `adserve-db`, database `adserve`
Endpoint `adserve-db.c32e6wm047ec.eu-west-2.rds.amazonaws.com:5432`.
- Migrations **003–006 applied**; **RLS enabled on 17 tables**.
- **2026-06-02:** `sql/007-reconcile-crm-cardinality.sql` applied to prod RDS for
  both tenants — `contact_belongs_to_account` and `opportunity_has_primary_contact`
  flipped to `many_to_many` (UPDATE 4); `opportunity_belongs_to_account` unchanged.
  Pre/post verified; no `(tenant_id, name)` duplicates found in prod. Temporary
  bastion torn down (verified). Optional `UNIQUE(tenant_id, name)` hardening
  migration still pending (not yet applied).
- **`001-enable-rls` is NULLIF-patched and LIVE on prod** — the `tenant_isolation`
  policies guard the cast as
  `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid` (fixes the
  `/crm` `22P02` crash an empty context used to cause).
- **Gate C complete:** the Phase-2 CRM placeholder perms
  (`contacts`/`companies`/`deals`/`ai`) are retired; `contact`/`account`/
  `opportunity` + `crm.admin` granted; `ai_usage.read` created and granted to
  owner/admin.
- Data: **2 tenants, 0 records** (pre-launch).

### Branch protection on `main`
- Required status checks: `Lint`, `Production build`, `Docker image build`,
  `Tests (RLS-enforced)`. **`enforce_admins = true`** — applies to admins too,
  so there is **no direct-push bypass**; every change to `main` goes through a
  green PR.
- **Break-glass** (emergency only): `gh api -X DELETE
  repos/jamesjfoley/adserve-studio/branches/main/protection/enforce_admins` →
  push → re-enable with `gh api -X POST .../enforce_admins`.

### Hardening — dev/CI mirror prod
- Dev/CI enforce RLS as the NOBYPASSRLS **`adserve_app`** role: the app db
  client connects via **`TEST_APP_DATABASE_URL`** (RLS enforces), fixtures seed
  privileged via **`TEST_DATABASE_URL`**. Local setup:
  `pnpm --filter @adserve/database db:rls-dev-parity` (applies patched 001 +
  creates the role).
- CI (`.github/workflows/ci.yml`) runs the real prod `next build`, a prod
  Docker image build, and the RLS-enforced suite — all four are required checks.

## Reusable bastion runbook (public-subnet / public-IP variant — the one that worked)

**Prereq:** `export AWS_PROFILE=adserve-admin AWS_DEFAULT_REGION=eu-west-2`
(static keys — **no `aws login`**). DB role `adserve_migrator`, secret
`adserve/database-url-migrator`. Per-session ids are kept in shell vars
(`$INSTANCE`/`$BASTION_SG`/`$RULE`), not hardcoded.

### a) Read-only confirms
```bash
VPC=$(aws ec2 describe-security-groups --group-ids sg-012023b2c91d23bde --query 'SecurityGroups[0].VpcId' --output text)
# public subnet (MapPublicIpOnLaunch=true) for the public-IP variant:
aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC" \
  --query 'Subnets[].{id:SubnetId,az:AvailabilityZone,public:MapPublicIpOnLaunch,name:Tags[?Key==`Name`]|[0].Value}' --output table
# (only if ever using a PRIVATE subnet instead — confirm NAT egress for SSM):
aws ec2 describe-nat-gateways --filter "Name=vpc-id,Values=$VPC" --query 'NatGateways[].NatGatewayId' --output text
AMI=$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --query Parameter.Value --output text)
SUBNET=<public subnet id from the table above>
```

### b) Bring-up
```bash
# IAM role + instance profile (SSM)
aws iam create-role --role-name adserve-bastion-ssm-role \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name adserve-bastion-ssm-role --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam create-instance-profile --instance-profile-name adserve-bastion-ssm-profile
aws iam add-role-to-instance-profile --instance-profile-name adserve-bastion-ssm-profile --role-name adserve-bastion-ssm-role
sleep 10  # let the instance profile propagate

# temp bastion SG
BASTION_SG=$(aws ec2 create-security-group --vpc-id "$VPC" \
  --group-name adserve-bastion-temp-sg --description "temp bastion (db session)" --query GroupId --output text)

# allow it into RDS on 5432 — KEEP the rule id for teardown
RULE=$(aws ec2 authorize-security-group-ingress --group-id sg-012023b2c91d23bde \
  --ip-permissions "IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=$BASTION_SG}]" \
  --query 'SecurityGroupRules[0].SecurityGroupRuleId' --output text)

# launch in a PUBLIC subnet with a public IP
INSTANCE=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.micro \
  --iam-instance-profile Name=adserve-bastion-ssm-profile --subnet-id "$SUBNET" \
  --security-group-ids "$BASTION_SG" --associate-public-ip-address \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=adserve-bastion-temp}]' \
  --count 1 --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --instance-ids "$INSTANCE"
until [ "$(aws ssm describe-instance-information --filters Key=InstanceIds,Values=$INSTANCE --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null)" = Online ]; do sleep 10; done
echo "INSTANCE=$INSTANCE  BASTION_SG=$BASTION_SG  RULE=$RULE"   # save these for teardown
```

### c) Port-forward tunnel (separate terminal; leave open — act promptly, sessions idle out)
```bash
aws ssm start-session --target "$INSTANCE" --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["adserve-db.c32e6wm047ec.eu-west-2.rds.amazonaws.com"],"portNumber":["5432"],"localPortNumber":["15432"]}'
# wait for "Port 15432 opened". If it drops, just re-run this (the bastion stays up).
```

### d) Connect / run DB work as the migrator
```bash
PW=$(aws secretsmanager get-secret-value --secret-id adserve/database-url-migrator --query SecretString --output text | python3 -c 'import sys,json;print(json.load(sys.stdin)["password"])')
# plain psql (RLS enforces — migrator is non-superuser + FORCE RLS):
PGSSLMODE=require psql "postgresql://adserve_migrator:$PW@localhost:15432/adserve"
# re-run the idempotent RLS policy file, for example:
PGSSLMODE=require psql "postgresql://adserve_migrator:$PW@localhost:15432/adserve" -v ON_ERROR_STOP=1 -f packages/database/sql/001-enable-rls.sql
# cross-tenant maintenance scripts — session-scoped bypass (auto-clears on disconnect), e.g. Gate C:
GATEC="postgresql://adserve_migrator:$PW@localhost:15432/adserve?sslmode=require&options=-c%20app.bypass_rls%3Don"
DATABASE_URL="$GATEC" pnpm --filter @adserve/crm reprovision-crm
DATABASE_URL="$GATEC" pnpm --filter @adserve/database seed
DATABASE_URL="$GATEC" pnpm --filter @adserve/database seed:backfill-ai-usage-read
```

### e) Teardown (run when done)
```bash
aws ec2 terminate-instances --instance-ids "$INSTANCE" && aws ec2 wait instance-terminated --instance-ids "$INSTANCE"
aws ec2 revoke-security-group-ingress --group-id sg-012023b2c91d23bde --security-group-rule-ids "$RULE"
aws ec2 delete-security-group --group-id "$BASTION_SG"   # retry after a moment if DependencyViolation (ENI still releasing)
aws iam remove-role-from-instance-profile --instance-profile-name adserve-bastion-ssm-profile --role-name adserve-bastion-ssm-role
aws iam delete-instance-profile --instance-profile-name adserve-bastion-ssm-profile
aws iam detach-role-policy --role-name adserve-bastion-ssm-role --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam delete-role --role-name adserve-bastion-ssm-role
```

## Gotchas (don't relearn these)
- **`adserve-admin` uses static keys → NO `aws login`.** Just
  `export AWS_PROFILE=adserve-admin AWS_DEFAULT_REGION=eu-west-2`.
- **SSM port-forward sessions idle out** — start DB work promptly after
  "Port 15432 opened"; if it drops, re-run `start-session` (the bastion stays up).
- **Migrator scripts touching RLS tables need session-scoped bypass** via the
  connection: `DATABASE_URL=…?options=-c app.bypass_rls=on` (URL-encoded
  `?options=-c%20app.bypass_rls%3Don`). It sets the GUC in the startup packet →
  **auto-clears when the connection closes, even on crash.** **NEVER**
  `ALTER ROLE adserve_migrator SET app.bypass_rls=on` — a crash before `RESET`
  leaves the migrator silently bypassing RLS (the exact failure class the
  hardening fixed).
- **`.env`/`.env.local` set a local `DATABASE_URL`, but nothing calls dotenv to
  override it**, so an **exported** `DATABASE_URL` wins —
  `DATABASE_URL=… pnpm …` reliably targets the tunnel.
- **The seed script is `seed`** (`pnpm --filter @adserve/database seed`), not
  `db:seed`, inside the package. **Gate C order:** `reprovision-crm` → `seed` →
  `seed:backfill-ai-usage-read`.
- **`sql/001-enable-rls.sql` is atomic (single `BEGIN…COMMIT`) + idempotent**
  (`DROP POLICY IF EXISTS` + `CREATE`) — safe to re-run on prod; the policy swap
  never leaves a window with policies absent.

---

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
| Bastion EC2 instance | No standing bastion — spin up/tear down per-session (last spinup `i-05b482184743b756c` torn down 2026-05-28) |
| RDS Security Group | `sg-012023b2c91d23bde` — ingress 5432 from ECS SG (`sg-0b8c4e804a9231980`) + rotation Lambda SG (`sg-00ab19854e010ad61`) only |
| CloudTrail trail | `adserve-management-trail` — single-region, mgmt events. Required for Secrets Manager → EventBridge events. |
| Rotation Lambdas | `adserve-rotate-app-secret`, `adserve-rotate-migrator-secret` (60-day schedule) |
| Auto-redeploy Lambda | `adserve-rotation-redeploy` — fired by EventBridge rule `adserve-rotation-succeeded` |
| Last successful deploy | commit `30a29f0` (CloudTrail template) — currently rolling task def `:13` |

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
| 21 | `withTenant()` / `withSuperAdminBypass()` query refactor (61 sites) | ✓ Complete — see "Notes on step 21" below |
| 22 | RDS credential rotation in Secrets Manager | ✓ Complete — see "Notes on step 22" below |
| — | GitHub Actions Node 24 readiness | ✓ Bumped checkout, setup-node, pnpm/action-setup, configure-aws-credentials to `@v6` — see "GitHub Actions" below |
| — | CloudTrail trail (added as dependency of step 22) | ✓ Complete — `infra/cloudtrail/management-trail.yaml`, see "Notes on step 22" |
| — | CloudWatch alarms (pre-Phase 3 monitoring) | ✓ Complete — `infra/monitoring/alarms.yaml`, see "Notes on monitoring" |

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

## Notes on step 21

61 RLS query sites wrapped across 30 files. Every bare `db.*` call against
the 14 RLS-protected tables in `apps/web/src/` now runs through either
`withTenant()` or `withSuperAdminBypass()`. Required for the production
switchover where `adserve_app` runs as NOSUPERUSER/NOBYPASSRLS.

Highlights:
- 2 new helpers extracted to reduce duplication: `lib/role-permissions.ts`
  (`validatePermissionsForTenant`) and `lib/super-admin-queries.ts`
  (`loadTenantMembers`, `loadTenantModuleStates`).
- 3 helpers refactored to take a `tx` argument so the caller owns the
  wrapper: `lib/tenant-provision.ts:provisionTenant`,
  `admin/roles/_lib/visible-permissions.ts:getVisiblePermissions`,
  `admin/roles/[id]/route.ts:loadRole`.
- `lib/auth.ts` removed as dead code (zero callers; superseded by
  `lib/permissions.ts`).
- 3 existing `db.transaction()` blocks flattened into the outer wrapper.
- Settings PATCH race condition fixed in
  `api/super-admin/tenants/[id]/route.ts`.
- Outcome-union return pattern used in PATCH/DELETE handlers that need to
  return per-error status codes from inside a transaction wrapper.

Shipped in commit `0ba7c87`. Final grep confirms zero bare `db.*` calls
remain against any RLS-protected table.

## Notes on step 22

Full credential rotation chain live and verified end-to-end. Plan and
deployed-resource map are in `docs/aws-credential-rotation-plan.md`.

| Resource | Identifier |
|---|---|
| Rotation Lambda (app) | `arn:aws:lambda:eu-west-2:181194339452:function:adserve-rotate-app-secret` |
| Rotation Lambda (migrator) | `arn:aws:lambda:eu-west-2:181194339452:function:adserve-rotate-migrator-secret` |
| Rotation Lambda SG | `sg-00ab19854e010ad61` (`adserve-rotation-lambda-sg`) |
| EventBridge rule | `adserve-rotation-succeeded` |
| Auto-redeploy Lambda | `arn:aws:lambda:eu-west-2:181194339452:function:adserve-rotation-redeploy` |
| Auto-redeploy IAM role | `adserve-rotation-redeploy-role` (scoped to `ecs:UpdateService` on the single service) |
| CloudFormation stacks | `adserve-rotation-app-secret`, `adserve-rotation-migrator-secret`, `adserve-rotation-event-redeploy` |
| CloudTrail trail (dependency) | `adserve-management-trail` (S3 bucket `adserve-cloudtrail-logs-181194339452`) |
| Schedule | `rate(60 days)` on both secrets — first rotation triggered 2026-05-28 |
| Master credential | RDS-managed via `rds!db-bbdf262a-…` (already auto-rotating since step 4) |

**Application changes:**
- Secrets reformatted in place URL → JSON. Same ARNs (no ECS task definition
  change needed).
- `packages/database/src/client.ts` accepts either URL or JSON format via
  exported `resolveConnectionString()`. Backward compatible for local dev.

**CloudTrail trail is a hard dependency.** Discovered mid-execution that
Secrets Manager `RotationSucceeded` events flow to EventBridge only via
CloudTrail. Without a trail, the events live only in the 90-day "event
history" and never reach EventBridge rules. Trail captures management
events in `eu-west-2`, retains 90 days in S3. ~$2–3/month cost.

**Schedule offset note.** The plan called for a 30-day offset between app
and migrator rotations. To verify both chains in this session both rotations
were triggered immediately, which aligned the schedules at T,T+60,T+120
each. To re-establish the offset, run this at any point ≥30 days from
today:

```bash
AWS_PROFILE=adserve-admin aws secretsmanager rotate-secret \
  --secret-id adserve/database-url-migrator --region eu-west-2
```

That shifts migrator's clock to (rotation time)+60,+120,… while app stays
on its current cadence.

**Complications encountered:**
1. First rotation attempt failed because `AWSPREVIOUS` still held the
   pre-step-1 URL string and the SAR Lambda unconditionally JSON-parses it.
   Fix: removed `AWSPREVIOUS` stage from both secrets; auto-retry then
   succeeded. From the second rotation onwards, `AWSPREVIOUS` is JSON and
   the issue cannot recur.
2. The initial `client.ts` change crashed Docker build because
   `process.env.DATABASE_URL` is undefined during Next.js page-data
   collection in CI. Fixed in commit `64d93d4` by passing undefined
   through unchanged.
3. CloudTrail dependency wasn't in the plan; added during execution.

## Notes on monitoring

Pre-Phase-3 baseline alarms deployed via CloudFormation stack
`adserve-monitoring-alarms` (template `infra/monitoring/alarms.yaml`).
6 alarms + 1 metric filter, all targeting one SNS topic
`adserve-alerts`.

| Alarm | Fires when |
|---|---|
| `adserve-ecs-running-task-count-zero` | `RunningTaskCount < 1` for 2 consecutive minutes (missing data treated as breaching) |
| `adserve-ecs-cpu-high` | `CPUUtilization > 80%` for 5 consecutive minutes |
| `adserve-rotation-app-lambda-errors` | App-secret rotation Lambda reports any error in a 5-min window |
| `adserve-rotation-migrator-lambda-errors` | Migrator-secret rotation Lambda reports any error in a 5-min window |
| `adserve-rotation-redeploy-lambda-errors` | Auto-redeploy Lambda reports any error in a 5-min window |
| `adserve-ecs-error-rate-high` | More than 10 ERROR-level log lines in a 5-min window (via metric filter on `/ecs/adserve-studio`) |

Dependencies:
- Container Insights is **enabled** on cluster `adserve-prod` —
  required for the `RunningTaskCount` metric. Cost ~$3/month for the
  added per-task metrics.
- Metric filter `adserve-ecs-error-lines` on the ECS log group with
  pattern `?ERROR ?"Error:"` — produces custom metric
  `AdServe/ErrorLineCount`.

**Manual follow-up:** SNS topic `adserve-alerts` has no subscribers
yet. Add an email subscription with:

```bash
AWS_PROFILE=adserve-admin aws sns subscribe \
  --topic-arn arn:aws:sns:eu-west-2:181194339452:adserve-alerts \
  --protocol email --notification-endpoint <your-email> \
  --region eu-west-2
```

Confirmation link will arrive in the inbox.

Auto-created `adserve-prod/adserve-studio/RollbackAlarm` in the alarm
list is **not** from our stack — it's created by ECS Express Mode's
autoscaling/deployment logic for rollback detection. Leave alone.

## Things you can rely on across the session boundary

- **Platform is in a steady operational state.** All 22 plan steps complete except step 20 (custom domain) which is deferred. Ready for Phase 3 (CRM module data plane).
- **`origin/main` is fully up to date** with everything we've done in code.
- **No standing bastion.** All bastion infra (EC2, SG, IAM role + instance profile) torn down 2026-05-28. RDS SG ingress on port 5432 allows only the ECS service SG (`sg-0b8c4e804a9231980`) and the rotation Lambda SG (`sg-00ab19854e010ad61`). To do DB work in a future session, spin up a fresh bastion the same way as step 9 (recipe in `docs/aws-infrastructure-plan-ecs-express.md`).
- **AWS CLI auth.** Use `AWS_PROFILE=adserve-admin` for CLI calls. The `default` profile requires interactive browser-flow `aws login`.
- **Credential rotation is live and self-healing.** Both DB secrets auto-rotate every 60 days. `RotationSucceeded` events fire an EventBridge rule that force-redeploys the ECS service so it picks up the new secret value within a few minutes. CloudTrail trail is the load-bearing dependency for that event delivery.
- **Secret format is JSON, not URL string.** `packages/database/src/client.ts:resolveConnectionString` parses either; ECS task definitions inject the raw secret unchanged.
- **`adserve_app` connects as NOSUPERUSER/NOBYPASSRLS in production.** Every tenant API route wraps queries in `withTenant()`; every super-admin path wraps in `withSuperAdminBypass()`. RLS enforces on RDS.
- **DB has one real test tenant** (Katherine's Organization, owner `mrjamesfoley@gmail.com`). Safe to leave for ongoing tests; harmless to delete.

## Suggested next session start

Platform foundation is complete. Step 20 (custom domain) is the only deferred plan item — everything else is in steady state. Reasonable next pieces of work:

1. **Phase 3 — CRM module data plane.** The platform is built to host this and Phase 2 is fully shipped. Pick up at `task_phase_2_complete` / `task_rls_production_switchover` memory entries for context.
2. **Step 20 — custom domain + ACM cert.** Currently on `d22lq47907kone.cloudfront.net`. Needs a domain + ACM cert in us-east-1 + CloudFront alternate name + Clerk webhook endpoint update. Maybe 1–2 hours.
3. **Re-establish rotation offset.** Run `aws secretsmanager rotate-secret --secret-id adserve/database-url-migrator --region eu-west-2` at any time ≥30 days from now (after 2026-06-27) to desynchronize the app/migrator rotation schedules. Optional hygiene.
4. **Audit Phase 1/2 telemetry.** No alerts wired up yet — would be reasonable to add CloudWatch alarms on ECS task failures, rotation failures, and the auto-redeploy Lambda's errors.

Browser smoke-test recommended whichever path comes next: sign in at `https://d22lq47907kone.cloudfront.net`, confirm `/dashboard` and `/admin` load for the test tenant.
