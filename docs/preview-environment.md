# Prototype preview environment (Stage 2)

Isolated, colleague-facing hosted copy of the `prototype/crm-campaigns` prototype.
Built 2026-06-15. **This is NOT production** — separate DB, separate compute, dummy
data, in-app PROTOTYPE banner. Per `docs/prototype-mode.md` it NEVER merges to
`main` and NEVER touches prod ECS / prod RDS.

## Access

- **URL:** https://uygprsxwu9.eu-west-2.awsapprunner.com
- **Your login:** `jamesjfoley@gmail.com` (your existing Clerk account — Owner of
  "My Organization", restored from the local dump).
- **Shared colleague login:** `preview-demo@adserve.com` / `AdServePreview!2026`
  (Clerk user `user_3FBYUaAkNVH2K6Mo7xKqcnmUc50`, Admin of "My Organization").
- Auth is the **reused Clerk dev instance** (`pk_test_…clear-anchovy-28`). The
  Clerk webhook still points at prod, so **self-service signup does not provision
  into the preview** — colleagues must use the shared login above (or be added as a
  membership row by hand). Documented limitation, acceptable for a demo.

## Architecture

Compute is **AWS App Runner** (not ECS) — chosen over ECS+ALB+CloudFront because it
provides a free HTTPS `*.awsapprunner.com` URL out of the box. Image is built locally
(`docker build --platform linux/amd64`) and pushed to the existing ECR repo with a
`preview-*` tag. All in account `181194339452`, `eu-west-2`.

| Resource | Identifier |
|---|---|
| App Runner service | `adserve-studio-preview` — `arn:aws:apprunner:eu-west-2:181194339452:service/adserve-studio-preview/93cc08c75e95489ca085976925177bf6` |
| ECR image tag | `adserve-studio:preview-9069759` (built from commit `9069759`) |
| App Runner access role (ECR) | `adserve-preview-apprunner-access` |
| App Runner instance role (Secrets) | `adserve-preview-apprunner-instance` |
| VPC connector | `adserve-preview-vpc-connector` |
| App Runner SG | `sg-0719272f88bdf4550` |
| RDS instance | `adserve-preview-db` (Postgres 16.13, db.t4g.micro, publicly accessible, no backups) |
| RDS endpoint | `adserve-preview-db.c32e6wm047ec.eu-west-2.rds.amazonaws.com:5432` |
| RDS DB SG | `sg-0f8f50746481785b3` (ingress 5432 from your IP + App Runner SG) |
| RDS subnet group | `adserve-preview-subnet-group` (public subnets) |
| DB secret | `adserve/preview-database-url` |
| Clerk demo user | `preview-demo@adserve.com` (`user_3FBYUaAkNVH2K6Mo7xKqcnmUc50`) |

### Key implementation notes
- **App connects as the RDS master role with RLS disabled** on all tables — mirrors
  the local `pnpm dev` (superuser, RLS-bypassed) experience, so the preview behaves
  exactly like the prototype does locally. This is deliberate; the preview is NOT a
  prod-RLS-fidelity test.
- **`HOSTNAME=0.0.0.0` is set in the App Runner runtime env.** App Runner injects its
  own `HOSTNAME` (the instance's internal DNS name), which overrides the Dockerfile's
  `ENV HOSTNAME=0.0.0.0` and makes Next.js standalone bind to the wrong interface →
  health checks fail. Forcing it back in the runtime env is required. (Prod ECS is
  unaffected — Fargate doesn't override `HOSTNAME`.)
- **PROTOTYPE banner** renders only when the image is built with
  `--build-arg NEXT_PUBLIC_PROTOTYPE=true` (committed `9069759`).

## Redeploy (after new prototype commits)

```bash
export AWS_PROFILE=adserve-admin AWS_DEFAULT_REGION=eu-west-2
REG=181194339452.dkr.ecr.eu-west-2.amazonaws.com
SHA=$(git rev-parse --short HEAD)
aws ecr get-login-password | docker login --username AWS --password-stdin $REG
docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlYXItYW5jaG92eS0yOC5jbGVyay5hY2NvdW50cy5kZXYk \
  --build-arg NEXT_PUBLIC_PROTOTYPE=true \
  -t $REG/adserve-studio:preview-$SHA -t $REG/adserve-studio:preview-latest .
docker push $REG/adserve-studio:preview-$SHA && docker push $REG/adserve-studio:preview-latest
# point the service at the new tag:
aws apprunner update-service --service-arn <service-arn> \
  --source-configuration "ImageRepository={ImageIdentifier=$REG/adserve-studio:preview-$SHA,ImageRepositoryType=ECR}"
```

## Teardown (stops all preview cost)

```bash
export AWS_PROFILE=adserve-admin AWS_DEFAULT_REGION=eu-west-2
ARN=arn:aws:apprunner:eu-west-2:181194339452:service/adserve-studio-preview/93cc08c75e95489ca085976925177bf6
aws apprunner delete-service --service-arn $ARN
# wait for the service to delete, then:
aws apprunner delete-vpc-connector --vpc-connector-arn arn:aws:apprunner:eu-west-2:181194339452:vpcconnector/adserve-preview-vpc-connector/1/418d0a7af6164d59aa8b289adf74d5bc
aws rds delete-db-instance --db-instance-identifier adserve-preview-db --skip-final-snapshot --delete-automated-backups
aws rds delete-db-subnet-group --db-subnet-group-name adserve-preview-subnet-group
aws ec2 delete-security-group --group-id sg-0719272f88bdf4550   # App Runner SG
aws ec2 delete-security-group --group-id sg-0f8f50746481785b3   # RDS SG
aws secretsmanager delete-secret --secret-id adserve/preview-database-url --force-delete-without-recovery
aws iam delete-role-policy --role-name adserve-preview-apprunner-instance --policy-name read-adserve-secrets
aws iam delete-role --role-name adserve-preview-apprunner-instance
aws iam detach-role-policy --role-name adserve-preview-apprunner-access --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
aws iam delete-role --role-name adserve-preview-apprunner-access
# Clerk demo user (optional):
SK=$(aws secretsmanager get-secret-value --secret-id adserve/clerk-secret-key --query SecretString --output text)
curl -X DELETE https://api.clerk.com/v1/users/user_3FBYUaAkNVH2K6Mo7xKqcnmUc50 -H "Authorization: Bearer $SK"
```

## Estimated cost
~$25–40 / month while running (App Runner 1 vCPU/2 GB + RDS db.t4g.micro + storage).
Tear down with the script above when no longer needed.
