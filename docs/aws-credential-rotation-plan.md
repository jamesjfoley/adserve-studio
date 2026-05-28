# RDS credential rotation plan (Step 22) — EXECUTED 2026-05-28

> **Status:** Plan executed end-to-end on 2026-05-28. Both DB secrets are
> auto-rotating every 60 days with full EventBridge → ECS auto-redeploy
> chain verified. Deployed resource map at the bottom of this doc.

Reference plan: `docs/aws-infrastructure-plan-ecs-express.md` (step 22).
Current state doc: `docs/aws-deployment-status.md` ("Notes on step 22").

## Current state (verified 2026-05-28)

| Secret | Format | Rotation | Notes |
|---|---|---|---|
| `adserve/database-url` | URL string (`postgresql://adserve_app:…@host:5432/adserve?sslmode=require`) | Not configured | Used by app role |
| `adserve/database-url-migrator` | URL string | Not configured | Used by migrator (drizzle-kit push, seed) |
| `rds!db-bbdf262a-…-ZXOAqQ` | AWS-managed JSON | **Enabled** (RDS-managed) | The `adserve_master` break-glass user — already covered |

- RDS instance `adserve-db` lives in 2 private subnets (`subnet-08907b065b8d35b83`, `subnet-070cbe70f61dc16e5`), SG `sg-012023b2c91d23bde`. Endpoint `adserve-db.c32e6wm047ec.eu-west-2.rds.amazonaws.com`.
- RDS uses a dedicated KMS key (`899cdf00-18fd-42d0-b899-11c71864a505`), not the default Secrets Manager key — the rotation Lambda role must include `kms:Decrypt` and `kms:GenerateDataKey` on that key.
- App reads `DATABASE_URL` as a plain string (no parsing) in `packages/database/src/client.ts:9`.

## Constraints that shaped the design

1. **ECS does not refresh secrets on running tasks.** Containers read the secret once at startup. After a rotation, running tasks still have the **old** password in their cached `DATABASE_URL` env var.
2. **Postgres `ALTER USER PASSWORD` doesn't kill existing connections.** Existing TCP sessions stay valid until they close, but the `postgres` lib's pool (`idle_timeout: 20s` in `client.ts`) reopens dead connections using the cached URL — those will fail until the task is replaced.
3. **AWS-managed rotation Lambdas expect JSON format** (`{engine, host, port, username, password, dbname, …}`). Our secret is a URL string today. Either we reformat (small app change) or write a custom Lambda (avoid the app change but own the infra).
4. **Rotation Lambdas must run inside the VPC** to reach the private RDS subnets.

## Three options considered

### Option A — JSON reformat + AWS-managed Lambda + ECS auto-redeploy (APPROVED)

- Reformat both secrets URL → JSON in place (`PutSecretValue`, same ARN).
- ~5-line change in `packages/database/src/client.ts` to detect JSON and build the URL (URL-string fallback preserved for local dev).
- Deploy AWS's `SecretsManagerRDSPostgreSQLRotationSingleUser` SAR template, one stack per secret. Lambdas run in the same 2 private subnets, new SG `adserve-rotation-lambda-sg` authorized into the RDS SG on 5432.
- **EventBridge rule** on Secrets Manager `RotationSucceeded` events → inline Lambda → `ecs update-service --force-new-deployment` for cluster `adserve-prod`, service `adserve-studio`. This is what closes the loop between rotation and running tasks.
- **Schedule:** 60 days, offset by 30 (app secret rotates day N; migrator rotates day N+30).

**Pros:** entirely AWS-managed, well-trodden path. Self-describing secret format.
**Cons:** small app code change. Small risk of pool-reconnect failures in the ~30s window between rotation completing and the force-new-deployment task swap finishing.

### Option B — Custom rotation Lambda preserving URL format

A ~40-line Python Lambda implementing the four-step Secrets Manager rotation contract (`createSecret`, `setSecret`, `testSecret`, `finishSecret`). Parses URL → generates password → ALTERs role → writes new URL. Same EventBridge → ECS auto-redeploy.

**Pros:** zero app code change.
**Cons:** custom infrastructure to maintain (KMS, VPC plumbing, IAM still required). Same downtime risk as A.

### Option C — Multi-user rotation (alternating user pair)

Provision `adserve_app_a` + `adserve_app_b` (and same for migrator). Use AWS's `SecretsManagerRDSPostgreSQLRotationMultiUser` template. Each rotation alternates which user the secret references; the *other* user retains its previous (still-valid) password until its turn next time.

**Pros:** truly zero observable downtime — existing connections to the now-rotated user drain naturally, and new ECS tasks pick up the alternate user (whose creds are unchanged).
**Cons:** 4 DB roles to manage. GRANT and default-privilege setup needed on both `_a` and `_b`. Disproportionate complexity for current traffic.

## Approved option and parameters

**Option A**, with the following parameters confirmed on 2026-05-28:

| Setting | Value |
|---|---|
| Rotation interval | 60 days, app and migrator offset by 30 |
| Trigger immediate rotation during deploy session | Yes — verify the full chain end-to-end |
| CloudFormation template location | `infra/rotation/` (`app-secret-rotation.yaml`, `migrator-secret-rotation.yaml`, `event-redeploy.yaml`) |
| Out of scope for this task | Clerk secret rotation (no AWS-rotatable; bespoke Lambda → Clerk API would be its own work item) |

## Execution sequence (8 steps)

When this is picked up, follow these in order. **Do not chain steps** — stop and verify after each.

1. **Reformat secrets.** Build new JSON values for both URLs containing `engine`, `host`, `port`, `username`, `password`, `dbname` and optional `connection_url` field. Apply via `aws secretsmanager put-secret-value`. Existing ARN preserved — ECS task definitions need no change.
2. **Modify `packages/database/src/client.ts`** to detect leading `{`, parse JSON, build URL. Keep URL-string fallback for local dev. Add a unit test for both code paths.
3. **Deploy + push** the client.ts change. Verify ECS picks up a new task without error and `/api/health` returns 200.
4. **Deploy rotation stacks** via CloudFormation:
   - SAR app `SecretsManagerRDSPostgreSQLRotationSingleUser`, one stack per secret.
   - VPC config: private subnets `subnet-08907b065b8d35b83`, `subnet-070cbe70f61dc16e5`; new SG `adserve-rotation-lambda-sg`.
   - Authorize the rotation Lambda SG → ingress to `sg-012023b2c91d23bde` on 5432.
5. **Authorize rotation Lambda IAM role on the secrets**: `secretsmanager:GetSecretValue`, `PutSecretValue`, `UpdateSecretVersionStage`, `DescribeSecret`. Plus `kms:Decrypt` / `kms:GenerateDataKey` on the RDS KMS key (`899cdf00-…`).
6. **Configure rotation**:
   ```bash
   aws secretsmanager rotate-secret \
     --secret-id adserve/database-url \
     --rotation-lambda-arn <app-rotation-lambda-arn> \
     --rotation-rules ScheduleExpression="rate(60 days)"
   # (migrator: same command, with offset by 30 days)
   ```
   This **immediately rotates once** — that's our chain verification (approved).
7. **EventBridge rule + auto-redeploy Lambda.** Pattern matches `RotationSucceeded` events on either secret; target is a tiny Python Lambda invoking `ecs update-service --cluster adserve-prod --service adserve-studio --force-new-deployment`.
8. **Verify**: trigger an out-of-cycle rotation (`rotate-secret --rotate-immediately`), watch CloudWatch logs for the rotation Lambda, confirm the EventBridge target fires, confirm ECS rolling deploy starts, confirm new task runs `select 1` against RDS with the new password. Tail `/ecs/adserve-studio` for any 500s from connection pool failures during the swap.

## What this task does NOT cover

- **Clerk secret rotation** (`adserve/clerk-secret-key`, `adserve/clerk-publishable-key`, `adserve/clerk-webhook-secret`). These are managed in the Clerk dashboard and would need a custom Lambda calling Clerk's API. Out of scope.
- **The `adserve_master` secret.** Already enabled by RDS at provisioning time (`--manage-master-user-password`).
- **CDK/Terraform layer.** Plain `aws cloudformation deploy` from local for two stacks; commit the templates to `infra/rotation/`. Don't introduce a full IaC framework just for this.
- **Multi-user rotation upgrade path.** If traffic scale changes and the ~30s pool-reconnect window becomes unacceptable, this plan can be evolved to Option C by adding the `_a`/`_b` role pair. Tracked as a future consideration, not now.

---

## Executed 2026-05-28 — deployed resource map

| Component | Identifier |
|---|---|
| App rotation Lambda | `arn:aws:lambda:eu-west-2:181194339452:function:adserve-rotate-app-secret` |
| Migrator rotation Lambda | `arn:aws:lambda:eu-west-2:181194339452:function:adserve-rotate-migrator-secret` |
| Lambda VPC config | private subnets `subnet-08907b065b8d35b83`, `subnet-070cbe70f61dc16e5` |
| Rotation Lambda SG | `sg-00ab19854e010ad61` (`adserve-rotation-lambda-sg`) — egress only; RDS SG authorizes its ingress on 5432 |
| App rotation IAM role | `adserve-rotation-app-secr-SecretsManagerRDSPostgreS-580jDXczdaUI` (created by SAR) + inline policy `AdserveDatabaseUrlSecretAccess` |
| Migrator rotation IAM role | `adserve-rotation-migrator-SecretsManagerRDSPostgreS-aOfOxBAUQsk8` (created by SAR) + inline policy `AdserveDatabaseUrlMigratorSecretAccess` |
| EventBridge rule | `adserve-rotation-succeeded` — matches `RotationSucceeded` on either secret ARN |
| Auto-redeploy Lambda | `arn:aws:lambda:eu-west-2:181194339452:function:adserve-rotation-redeploy` |
| Auto-redeploy IAM role | `adserve-rotation-redeploy-role` — only `ecs:UpdateService`/`DescribeServices` on `cluster/adserve-prod/service/adserve-studio` |
| CloudFormation stacks | `adserve-rotation-app-secret`, `adserve-rotation-migrator-secret`, `adserve-rotation-event-redeploy` |
| Templates | `infra/rotation/app-secret-rotation.yaml`, `infra/rotation/migrator-secret-rotation.yaml`, `infra/rotation/event-redeploy.yaml` |
| Rotation schedule | `rate(60 days)` on both secrets; first rotation completed 2026-05-28 |
| Secret format | JSON: `{engine, host, port, username, password, dbname, sslmode}` (was URL string pre-step-1) |
| App-side parser | `packages/database/src/client.ts:resolveConnectionString` accepts both URL and JSON |

### Hard dependency added during execution

**CloudTrail trail** (`adserve-management-trail`, template
`infra/cloudtrail/management-trail.yaml`, S3 bucket
`adserve-cloudtrail-logs-181194339452`). Secrets Manager
`RotationSucceeded` events reach EventBridge only via CloudTrail — without
a trail, the events exist only in the 90-day "event history" and never
match EventBridge rules. This was a surprise mid-execution; if a future
session rebuilds rotation from scratch, deploy the trail first.

### Schedule offset status

The plan called for app and migrator to be staggered by 30 days. In this
execution, both rotations were triggered immediately so the full chain
could be verified — that aligned both schedules at T,T+60,T+120,….

To re-establish the offset, run this one-liner at any point ≥30 days from
2026-05-28 (i.e. after 2026-06-27):

```bash
AWS_PROFILE=adserve-admin aws secretsmanager rotate-secret \
  --secret-id adserve/database-url-migrator --region eu-west-2
```

That shifts migrator's clock 30 days behind the app, achieving the
intended offset for all future rotations.

### Quirks worth remembering

1. **`AWSPREVIOUS` must be JSON** for the SAR Lambda to work. The first
   rotation attempt failed because the original URL string was still in
   `AWSPREVIOUS` at the point rotation was first configured. Fix was to
   drop the `AWSPREVIOUS` stage. From the second rotation onwards the
   issue cannot recur because rotation only ever writes JSON.
2. **`process.env.DATABASE_URL` is undefined at Next.js build time** in
   the Docker build (no secrets injected during page-data collection).
   `resolveConnectionString` must accept undefined and pass through.
   Tested both code paths.
3. **EventBridge has a ~5–15 min warm-up** between CloudTrail trail
   creation and events flowing to rules. Don't trust the first rotation
   trigger after creating the trail.

### Verified end-to-end on 2026-05-28

Triggered `rotate-secret` → rotation Lambda completed 4-step cycle in
~3s → `RotationSucceeded` event fired → EventBridge matched → redeploy
Lambda invoked `ecs update-service --force-new-deployment` → ECS rolled
new task → new task picked up rotated secret → `/api/health` stayed 200
throughout. Both secrets verified by connecting via `psql` through a
temporary bastion using the post-rotation credentials.
