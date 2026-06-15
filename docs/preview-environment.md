# Prototype preview environment (Stage 2)

Isolated, colleague-facing hosted copy of the `prototype/crm-campaigns` prototype.
Built 2026-06-15. **This is NOT production** — separate DB, separate compute, dummy
data, in-app PROTOTYPE banner. Per `docs/prototype-mode.md` it NEVER merges to
`main` and NEVER touches prod ECS / prod RDS.

Compute runs on **Amazon ECS Express Mode**, AWS's recommended managed path for
containerised web apps. This mirrors the production platform, which also runs on ECS.

## Access

- **URL:** https://ad-40e35505049b4cf49604ac1bbbf235f1.ecs.eu-west-2.on.aws
- **Your login:** `jamesjfoley@gmail.com` (your existing Clerk account — Owner of
  "My Organization", restored from the local dump).
- **Shared colleague login:** `preview-demo@adserve.com` / `AdServePreview!2026`
  (Clerk user `user_3FBYUaAkNVH2K6Mo7xKqcnmUc50`, Admin of "My Organization").
- Auth is the **reused Clerk dev instance** (`pk_test_…clear-anchovy-28`). The
  Clerk webhook still points at prod, so **self-service signup does not provision
  into the preview** — colleagues must use the shared login above (or be added as a
  membership row by hand). Documented limitation, acceptable for a demo.

## Architecture

Compute is an **ECS Express Mode gateway service** (`aws ecs create-express-gateway-service`),
which auto-provisions an internet-facing ALB, target groups, auto-scaling, networking,
and a public HTTPS endpoint (`*.ecs.eu-west-2.on.aws`) — no CloudFront/ACM needed. The
image is built locally (`docker build --platform linux/amd64`) and pushed to the
existing ECR repo with a `preview-*` tag. All in account `181194339452`, `eu-west-2`.

| Resource | Identifier |
|---|---|
| ECS Express service | `adserve-studio-preview` in cluster `adserve-prod` — `arn:aws:ecs:eu-west-2:181194339452:service/adserve-prod/adserve-studio-preview` |
| Public endpoint | `ad-40e35505049b4cf49604ac1bbbf235f1.ecs.eu-west-2.on.aws` |
| ECR image tag | `adserve-studio:preview-8b9c82f` (built from commit `8b9c82f`; redeploys bump the tag) |
| Execution role (shared w/ prod) | `ecsTaskExecutionRole` (grants `adserve/*` Secrets access) |
| Infrastructure role (shared w/ prod) | `ecsInfrastructureRoleForExpressServices` |
| Task security group (auto-created) | `sg-0f992fd29137c3488` — authorized into the RDS SG on 5432 |
| Log group | `/ecs/adserve-studio-preview` |
| Task subnets | public-a/b (`subnet-023dc6738c3bffc59`, `subnet-09653e3898a827bf5`) |
| RDS instance | `adserve-preview-db` (Postgres 16.13, db.t4g.micro, publicly accessible, no backups) |
| RDS endpoint | `adserve-preview-db.c32e6wm047ec.eu-west-2.rds.amazonaws.com:5432` |
| RDS DB SG | `sg-0f8f50746481785b3` (ingress 5432 from your IP + the ECS task SG) |
| RDS subnet group | `adserve-preview-subnet-group` |
| DB secret | `adserve/preview-database-url` |
| Clerk demo user | `preview-demo@adserve.com` (`user_3FBYUaAkNVH2K6Mo7xKqcnmUc50`) |

### Key implementation notes
- **App connects as the RDS master role with RLS disabled** on all tables — mirrors
  the local `pnpm dev` (superuser, RLS-bypassed) experience, so the preview behaves
  exactly like the prototype does locally. This is deliberate; the preview is NOT a
  prod-RLS-fidelity test.
- **PROTOTYPE banner** renders only when the image is built with
  `--build-arg NEXT_PUBLIC_PROTOTYPE=true` (committed `9069759`).
- Tasks run in public subnets (ECS Express default for an internet-facing gateway);
  the RDS SG only admits the task SG and your IP.

## Redeploy (after new prototype commits)

**One command — this is what "push the latest prototype to the hosted platform" runs.**
It rebuilds the image from current HEAD, updates the ECS Express service, waits for the
rollout, then runs a **bidirectional data sync** so local and hosted converge:

```bash
scripts/deploy-preview.sh                 # code + bidirectional data sync (default)
scripts/deploy-preview.sh --no-sync       # code only
scripts/deploy-preview.sh --data-mode push  # code, then local->hosted full-replace
```

The container config (env + secret bindings) lives in `scripts/ecs-express-source.json`;
the deploy script only swaps the image tag, so settings never drift.

## Data sync (local ⇄ hosted)

On-demand sync of "My Organization" CRM content (`records` + `record_relationships`,
auto-ensuring referenced users). Does NOT touch tenants/roles/memberships (the hosted
demo login survives) or schema. **Dry-run by default — add `--apply` to write.**

```bash
scripts/sync-preview.sh sync          # preview a bidirectional merge (no writes)
scripts/sync-preview.sh sync  --apply # bidirectional: additive + newest-updated_at-wins
scripts/sync-preview.sh push  --apply # local  -> hosted, FULL REPLACE within tenant
scripts/sync-preview.sh pull  --apply # hosted -> local,  FULL REPLACE within tenant
```

Implemented in `packages/database/src/scripts/sync-preview.ts` (wrapper fetches the
hosted URL from Secrets Manager). **Semantics & limits:**
- `sync` propagates adds in both directions and edits via newest `updated_at`
  (incl. `is_archived` archive/restore "deletes"). It does **not** propagate *hard*
  deletes, and concurrent edits to the same record resolve last-write-wins.
- `push`/`pull` are a tenant-scoped **full replace** — they propagate hard deletes too,
  but overwrite independent changes on the target side.
- Schema changes (new entity type / field) are out of scope — the tool errors clearly
  if a referenced entity type/relationship is missing in the target; full-refresh first.

## Teardown (stops all preview cost)

```bash
export AWS_PROFILE=adserve-admin AWS_DEFAULT_REGION=eu-west-2
ARN=arn:aws:ecs:eu-west-2:181194339452:service/adserve-prod/adserve-studio-preview
# ECS Express tears down its own ALB/target groups/scaling on delete:
aws ecs delete-express-gateway-service --service-arn $ARN --monitor-resources
aws logs delete-log-group --log-group-name /ecs/adserve-studio-preview
aws rds delete-db-instance --db-instance-identifier adserve-preview-db --skip-final-snapshot --delete-automated-backups
aws rds delete-db-subnet-group --db-subnet-group-name adserve-preview-subnet-group
aws ec2 delete-security-group --group-id sg-0f8f50746481785b3   # RDS SG (after RDS is gone)
aws secretsmanager delete-secret --secret-id adserve/preview-database-url --force-delete-without-recovery
# Clerk demo user (optional):
SK=$(aws secretsmanager get-secret-value --secret-id adserve/clerk-secret-key --query SecretString --output text)
curl -X DELETE https://api.clerk.com/v1/users/user_3FBYUaAkNVH2K6Mo7xKqcnmUc50 -H "Authorization: Bearer $SK"
```

The execution + infrastructure roles are SHARED with production — do **not** delete them.

## Estimated cost
~$30–45 / month while running (ECS Express: 1 Fargate task 0.5 vCPU/1 GB + ALB +
RDS db.t4g.micro + storage). Tear down with the script above when no longer needed.
