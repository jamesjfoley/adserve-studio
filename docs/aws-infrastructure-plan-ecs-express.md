# AdServe Studio — AWS Infrastructure Plan
# Hosting on ECS Express Mode with GitHub Actions CI/CD

## Overview

This plan covers deploying AdServe Studio to AWS using ECS Express Mode, with GitHub Actions automating the build-and-deploy pipeline on every push to `main`. All architectural decisions have been made — this is ready for expert review and execution.

**What is ECS Express Mode?** Launched November 2025, ECS Express Mode is a feature of Amazon ECS that reduces container deployment to three required inputs: a container image, a task execution IAM role, and an infrastructure IAM role. It automatically provisions the ALB, target groups, security groups, auto-scaling, HTTPS domain, and Fargate tasks. All provisioned resources remain visible and configurable in your AWS account — you're not locked into an abstraction.

---

## Architecture

```
GitHub (push to main)
    │
    ▼
GitHub Actions workflow
    ├── Build Docker image (Next.js standalone)
    ├── Push to Amazon ECR
    └── Deploy via aws-actions/amazon-ecs-deploy-express-service@v1
            │
            ▼
    ┌───────────────────────────────────────────────────┐
    │                Dedicated VPC                       │
    │  ┌─────────────────────────────────────────────┐  │
    │  │  Public subnets (2 AZs)                     │  │
    │  │  └── ALB (auto-provisioned by Express Mode) │  │
    │  └─────────────────────────────────────────────┘  │
    │  ┌─────────────────────────────────────────────┐  │
    │  │  Private subnets (2 AZs)                    │  │
    │  │  ├── ECS Fargate tasks (app)                │  │
    │  │  ├── RDS PostgreSQL 16                      │  │
    │  │  └── NAT Gateway (for ECR pull, Clerk API)  │  │
    │  └─────────────────────────────────────────────┘  │
    └───────────────────────────────────────────────────┘
            │
    Secrets Manager
    (DATABASE_URL, DATABASE_URL_MIGRATOR, Clerk keys, webhook secret)
```

### Architectural decisions (all resolved)

**1. Dedicated VPC — not default VPC.** The default VPC uses public subnets only, has the same CIDR everywhere (`172.31.0.0/16`), and doesn't follow AWS security best practices. A dedicated VPC provides proper network isolation: public subnets for the ALB, private subnets for ECS tasks and RDS, and a NAT Gateway for outbound internet access (ECR image pulls, Clerk API calls). This is the standard production pattern for ECS Fargate with RDS.

**2. RDS PostgreSQL 16 on `db.t4g.small` — not `db.t4g.micro`.** The `micro` instance has only 1 GB RAM and limited CPU credits. For a Next.js app running server-side rendering with multiple concurrent database connections, this is too tight. `db.t4g.small` (2 GB RAM, 2 vCPUs burstable) provides comfortable headroom for early production use without over-provisioning. Upgrade path: when sustained CPU credit consumption exceeds 60% or connection count regularly exceeds 50, move to `db.t4g.medium` (4 GB). If you reach 200+ concurrent connections, add RDS Proxy.

**3. Three database roles for RLS enforcement.** The application connects as `adserve_app`, a non-superuser role with `SELECT`, `INSERT`, `UPDATE`, `DELETE` on all tables. This means the RLS policies from Phase 2 Task 8 actually enforce in production — every query is subject to the `tenant_isolation` policy. A separate `adserve_migrator` role owns schema changes (used by `drizzle-kit push` and seed scripts). The RDS master user (`adserve_master`, created automatically by RDS with `rds_superuser` privileges) is used only for emergency access. This three-role pattern (master for emergencies, migrator for schema, app for runtime) is the AWS-recommended approach for RDS PostgreSQL with RLS.

**4. Secrets Manager for all sensitive values — not Parameter Store.** Both services work with ECS, but Secrets Manager is the right choice here for three reasons: it supports automatic rotation for RDS credentials (useful when you enable rotation later), ECS has native `valueFrom` integration that injects secrets without exposing them in task definitions, and the cost is negligible ($0.40/secret/month for 5 secrets = $2.00/month). Parameter Store's advantage is cost (free tier), but at 5 secrets the saving is under $2/month — not worth losing the rotation capability.

**5. GitHub OIDC — no stored AWS credentials.** OIDC federation allows GitHub Actions to assume an IAM role without storing long-lived AWS access keys. The trust policy is scoped to `repo:jamesjfoley/adserve-studio:ref:refs/heads/main` so only pushes to main on your specific repo can trigger deployments. This is the AWS-recommended approach for GitHub Actions and eliminates the credential rotation burden entirely.

**6. ALB sharing across services is an advantage.** ECS Express Mode consolidates up to 25 services behind a single ALB using host-header routing. This means when you later add a staging environment or additional microservices, they share the ALB cost (~$16/month) rather than each paying for their own. No action needed — Express Mode handles this automatically. Be aware that if you customise the ALB outside of Express Mode (e.g. adding a custom domain), Express Mode won't overwrite your changes on subsequent deploys, but it also won't verify compatibility. Document any manual ALB changes.

- **Single service:** The Next.js app (web + API routes) runs as one ECS Express Mode service. No separate backend service needed — Next.js handles everything.
- **Region:** `eu-west-2` (London) — closest to your location. ECS Express Mode is available in all regions.

---

## Pre-requisites (one-time AWS account setup)

Before running any deployment, these need to exist in your AWS account. These are manual or CLI steps done once.

### Step 1 — Dedicated VPC

Create a VPC with proper subnet isolation. You can do this via the AWS console VPC wizard ("VPC with public and private subnets") or CLI.

**VPC specification:**
- CIDR: `10.0.0.0/16`
- 2 public subnets: `10.0.1.0/24` (AZ-a), `10.0.2.0/24` (AZ-b) — for the ALB
- 2 private subnets: `10.0.10.0/24` (AZ-a), `10.0.20.0/24` (AZ-b) — for ECS tasks and RDS
- Internet Gateway attached to public subnets
- NAT Gateway in one public subnet, with a route from private subnets (for outbound internet: ECR pulls, Clerk API, Secrets Manager)
- DNS hostnames enabled (required for RDS endpoint resolution)

```bash
# Using the VPC wizard is recommended for this — it creates IGW, NAT, route tables, etc.
# If using CLI:
aws ec2 create-vpc --cidr-block 10.0.0.0/16 --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=adserve-vpc}]'
# Then create subnets, IGW, NAT Gateway, and route tables per the spec above.
```

**Cost note:** The NAT Gateway costs ~$32/month (fixed) + data transfer. This is the largest fixed cost in the infrastructure. For cost-sensitive early-stage deployments, you could place ECS tasks in public subnets with auto-assigned public IPs instead (no NAT needed), but this is less secure. The plan assumes private subnets + NAT as the production-grade default.

### Step 2 — ECR repository

Create an Elastic Container Registry repository to store Docker images.

```bash
aws ecr create-repository \
  --repository-name adserve-studio \
  --image-scanning-configuration scanOnPush=true \
  --region eu-west-2
```

Note the repository URI (e.g. `123456789012.dkr.ecr.eu-west-2.amazonaws.com/adserve-studio`).

### Step 3 — IAM roles for ECS Express Mode

ECS Express Mode requires two IAM roles:

**Task Execution Role** — allows ECS to pull images from ECR and read secrets from Secrets Manager.

```bash
aws iam create-role \
  --role-name ecsTaskExecutionRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ecs-tasks.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

aws iam attach-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

Add an inline policy to allow reading from Secrets Manager:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["secretsmanager:GetSecretValue"],
    "Resource": "arn:aws:secretsmanager:eu-west-2:<account-id>:secret:adserve/*"
  }]
}
```

**Infrastructure Role** — allows ECS Express Mode to create and manage ALBs, target groups, security groups, etc.

```bash
aws iam create-role \
  --role-name ecsInfrastructureRoleForExpressServices \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ecs.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

aws iam attach-role-policy \
  --role-name ecsInfrastructureRoleForExpressServices \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleForExpressGatewayServices
```

Note: If you use the ECS console for the first deployment, it can create these roles automatically via the "Create new role" dropdown.

### Step 4 — RDS PostgreSQL instance

Create a PostgreSQL 16 instance in the private subnets of your dedicated VPC.

**Create a DB subnet group first:**

```bash
aws rds create-db-subnet-group \
  --db-subnet-group-name adserve-db-subnets \
  --db-subnet-group-description "Private subnets for AdServe RDS" \
  --subnet-ids <private-subnet-a-id> <private-subnet-b-id>
```

**Create an RDS security group:**

```bash
aws ec2 create-security-group \
  --group-name adserve-rds-sg \
  --description "Allow PostgreSQL from ECS tasks" \
  --vpc-id <vpc-id>

# Inbound rule will be added after the first ECS deployment (once we know the ECS SG ID)
```

**Create the instance:**

```bash
aws rds create-db-instance \
  --db-instance-identifier adserve-db \
  --db-instance-class db.t4g.small \
  --engine postgres \
  --engine-version 16 \
  --master-username adserve_master \
  --manage-master-user-password \
  --allocated-storage 20 \
  --storage-type gp3 \
  --db-name adserve \
  --vpc-security-group-ids <adserve-rds-sg-id> \
  --db-subnet-group-name adserve-db-subnets \
  --no-publicly-accessible \
  --storage-encrypted \
  --backup-retention-period 7 \
  --multi-az false
```

Note: `--manage-master-user-password` stores the master password in Secrets Manager automatically (AWS feature since 2023). You don't need to generate or store it yourself.

**After the instance is ready, create the application and migrator database roles:**

Connect via a bastion host or SSM Session Manager, then:

```sql
-- 1. Application role (used by the running ECS service)
-- Non-superuser. RLS policies enforce against this role.
CREATE ROLE adserve_app WITH LOGIN PASSWORD '<strong-password>';
GRANT CONNECT ON DATABASE adserve TO adserve_app;
GRANT USAGE ON SCHEMA public TO adserve_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO adserve_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO adserve_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO adserve_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO adserve_app;

-- 2. Migrator role (used for schema changes only)
-- Has CREATE privileges but is NOT used at runtime.
CREATE ROLE adserve_migrator WITH LOGIN PASSWORD '<strong-password>';
GRANT CONNECT ON DATABASE adserve TO adserve_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO adserve_migrator;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO adserve_migrator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO adserve_migrator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO adserve_migrator;

-- 3. Master role (adserve_master) — already created by RDS.
-- Used for emergency access only. Has rds_superuser privileges.
-- Password managed automatically by RDS via Secrets Manager.
-- Never used by the application or CI/CD pipeline.
```

**Why three roles:**
- `adserve_app` — what the ECS container connects as. RLS enforces. Cannot modify schema.
- `adserve_migrator` — what the migration task connects as. Can run `drizzle-kit push` and seed scripts. Not subject to RLS (but also never runs application queries).
- `adserve_master` — emergency break-glass access. RDS manages the password in Secrets Manager automatically.

**Security group update (after first ECS deployment):**

```bash
# Once the ECS Express Mode service exists, find its security group:
# ECS console → Cluster → Service → Resources → Security group
aws ec2 authorize-security-group-ingress \
  --group-id <adserve-rds-sg-id> \
  --protocol tcp \
  --port 5432 \
  --source-group <ecs-service-sg-id>
```

### Step 5 — Secrets Manager

Store all sensitive configuration. Use the `adserve/` prefix for organisation.

```bash
# Application database connection (adserve_app role)
aws secretsmanager create-secret \
  --name adserve/database-url \
  --secret-string "postgresql://adserve_app:<password>@<rds-endpoint>:5432/adserve"

# Migrator database connection (adserve_migrator role)
aws secretsmanager create-secret \
  --name adserve/database-url-migrator \
  --secret-string "postgresql://adserve_migrator:<password>@<rds-endpoint>:5432/adserve"

# Clerk authentication
aws secretsmanager create-secret \
  --name adserve/clerk-secret-key \
  --secret-string "<your-clerk-secret-key>"

aws secretsmanager create-secret \
  --name adserve/clerk-publishable-key \
  --secret-string "<your-clerk-publishable-key>"

aws secretsmanager create-secret \
  --name adserve/clerk-webhook-secret \
  --secret-string "<your-clerk-webhook-secret>"
```

### Step 6 — GitHub OIDC provider and IAM role for GitHub Actions

OIDC federation allows GitHub Actions to assume an IAM role without storing long-lived credentials. The trust policy is scoped to your specific repo and branch.

```bash
# Create the OIDC provider (one-time per AWS account)
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1

# Create the IAM role for GitHub Actions
aws iam create-role \
  --role-name GitHubActionsECSDeployRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com"},
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:jamesjfoley/adserve-studio:ref:refs/heads/main"
        }
      }
    }]
  }'
```

Attach policies to this role allowing: ECR push (`ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:PutImage`, etc.), ECS Express Mode deploy (`ecs:CreateExpressGatewayService`, `ecs:UpdateExpressGatewayService`, `ecs:DescribeServices`), Secrets Manager read, and `iam:PassRole` for the task execution and infrastructure roles.

### Step 7 — GitHub repository variables

Set these in your GitHub repo (Settings → Secrets and variables → Actions):

**Variables (not sensitive):**

| Variable | Value |
|---|---|
| `AWS_REGION` | `eu-west-2` |
| `AWS_ACCOUNT_ID` | Your AWS account ID |
| `ECR_REPOSITORY` | `adserve-studio` |
| `ECS_CLUSTER` | Cluster name (created by Express Mode on first deploy, or specify one) |
| `EXECUTION_ROLE_ARN` | ARN of `ecsTaskExecutionRole` |
| `INFRASTRUCTURE_ROLE_ARN` | ARN of `ecsInfrastructureRoleForExpressServices` |
| `PRIVATE_SUBNET_IDS` | Comma-separated private subnet IDs |
| `ECS_SECURITY_GROUP_ID` | Security group ID for the ECS service |

**Secrets (sensitive):**

| Secret | Value |
|---|---|
| `GITHUB_ACTIONS_ROLE_ARN` | ARN of `GitHubActionsECSDeployRole` |

---

## Dockerfile for AdServe Studio

Add to the project root. Uses Next.js standalone output with pnpm in a Turborepo monorepo.

```dockerfile
# Stage 1: Install dependencies
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
RUN corepack enable pnpm
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/database/package.json ./packages/database/
RUN pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:20-alpine AS builder
RUN corepack enable pnpm
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules
COPY . .

# Build the database package first (shared dependency)
RUN pnpm --filter @adserve/database build

# Build the web app with standalone output
RUN pnpm --filter @adserve/web build

# Stage 3: Production runner
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]
```

**Required Next.js config changes** — add to `apps/web/next.config.ts`:

```ts
import path from 'path';

const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // ... existing config
};
```

`output: 'standalone'` creates a minimal production build. `outputFileTracingRoot` tells Next.js to trace dependencies from the monorepo root so the `@adserve/database` package is included.

---

## GitHub Actions workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to ECS Express Mode

on:
  push:
    branches: [main]

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.GITHUB_ACTIONS_ROLE_ARN }}
          aws-region: ${{ vars.AWS_REGION }}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build, tag, and push Docker image
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/${{ vars.ECR_REPOSITORY }}:$IMAGE_TAG .
          docker tag $ECR_REGISTRY/${{ vars.ECR_REPOSITORY }}:$IMAGE_TAG $ECR_REGISTRY/${{ vars.ECR_REPOSITORY }}:latest
          docker push $ECR_REGISTRY/${{ vars.ECR_REPOSITORY }}:$IMAGE_TAG
          docker push $ECR_REGISTRY/${{ vars.ECR_REPOSITORY }}:latest

      - name: Deploy to ECS Express Mode
        uses: aws-actions/amazon-ecs-deploy-express-service@v1
        with:
          service-name: adserve-studio
          cluster: ${{ vars.ECS_CLUSTER }}
          image: ${{ steps.login-ecr.outputs.registry }}/${{ vars.ECR_REPOSITORY }}:${{ github.sha }}
          execution-role-arn: ${{ vars.EXECUTION_ROLE_ARN }}
          infrastructure-role-arn: ${{ vars.INFRASTRUCTURE_ROLE_ARN }}
          container-port: '3000'
          cpu: '512'
          memory: '1024'
          subnets: ${{ vars.PRIVATE_SUBNET_IDS }}
          security-groups: ${{ vars.ECS_SECURITY_GROUP_ID }}
          environment-variables: |
            [
              {"name": "NODE_ENV", "value": "production"}
            ]
          secrets: |
            [
              {"name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:${{ vars.AWS_REGION }}:${{ vars.AWS_ACCOUNT_ID }}:secret:adserve/database-url"},
              {"name": "CLERK_SECRET_KEY", "valueFrom": "arn:aws:secretsmanager:${{ vars.AWS_REGION }}:${{ vars.AWS_ACCOUNT_ID }}:secret:adserve/clerk-secret-key"},
              {"name": "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "valueFrom": "arn:aws:secretsmanager:${{ vars.AWS_REGION }}:${{ vars.AWS_ACCOUNT_ID }}:secret:adserve/clerk-publishable-key"},
              {"name": "CLERK_WEBHOOK_SECRET", "valueFrom": "arn:aws:secretsmanager:${{ vars.AWS_REGION }}:${{ vars.AWS_ACCOUNT_ID }}:secret:adserve/clerk-webhook-secret"}
            ]
          tags: |
            [
              {"key": "Project", "value": "adserve-studio"},
              {"key": "Environment", "value": "production"}
            ]
```

**How it works:** On every push to `main`, GitHub Actions authenticates to AWS via OIDC (no stored credentials), builds the Docker image, pushes it to ECR, then calls the ECS Express Mode deploy action. The action creates the service on first run and updates it on subsequent runs. ECS Express Mode handles the ALB, target groups, auto-scaling, and HTTPS domain automatically.

---

## Database migration strategy

The RDS instance starts empty. You need to run the initial schema setup and seed data.

**Approach: One-off ECS migration task using the `adserve_migrator` role.**

The migration task uses the `adserve/database-url-migrator` secret which points to the `adserve_migrator` role (which has schema-modification privileges). This task is run manually after each deployment that includes schema changes — not on every container start.

```bash
# After RDS is ready and the ECS service has been deployed once:
aws ecs run-task \
  --cluster <cluster-name> \
  --task-definition adserve-studio \
  --launch-type FARGATE \
  --network-configuration '{
    "awsvpcConfiguration": {
      "subnets": ["<private-subnet-a>", "<private-subnet-b>"],
      "securityGroups": ["<ecs-sg-id>"],
      "assignPublicIp": "DISABLED"
    }
  }' \
  --overrides '{
    "containerOverrides": [{
      "name": "adserve-studio",
      "command": ["sh", "-c", "npx drizzle-kit push && node packages/database/src/seed/index.js"],
      "environment": [{
        "name": "DATABASE_URL",
        "value": "<migrator-connection-string>"
      }]
    }]
  }'
```

**RLS setup:** After the initial schema push, run `001-enable-rls.sql` against the RDS instance (using the master role). Since the application connects as `adserve_app` (non-superuser), RLS enforces from the moment the app starts.

**Important divergence from local dev:** In local dev, the `jamesfoley` superuser bypasses RLS silently. In production, `adserve_app` is subject to all RLS policies. The `withTenant()` helper must set `app.current_tenant_id` before any tenant-scoped query, and `withSuperAdminBypass()` must set `app.bypass_rls = 'on'` for super admin queries. The 44 query sites identified in Task 8 must be wrapped before production deployment. This refactor should be its own task.

---

## Post-deployment steps

### Clerk webhook

With a real HTTPS endpoint, wire up the Clerk webhook that was deferred in local dev:

1. Go to Clerk Dashboard → Webhooks
2. Add endpoint: `https://<your-ecs-domain>/api/webhooks/clerk`
3. Subscribe to events: `organizationMembership.created`, `user.created`, `user.updated`, `user.deleted`
4. Copy the webhook signing secret and update `adserve/clerk-webhook-secret` in Secrets Manager
5. Restart the ECS tasks to pick up the new secret value

### Custom domain (when ready)

1. Register your domain and create a hosted zone in Route 53
2. Request an ACM certificate for your domain (with DNS validation)
3. On the ECS Express Mode service's ALB listener rule, add your custom domain as a host header condition (alongside the existing AWS domain)
4. Add the ACM certificate to the HTTPS listener
5. Create a Route 53 alias record (type A) pointing to the ALB
6. Update Clerk's allowed origins and redirect URLs to include the custom domain

### Scaling

ECS Express Mode configures CPU-based auto-scaling by default. Starting config:

- **CPU:** 512 (0.5 vCPU)
- **Memory:** 1024 MB (1 GB)
- **Min tasks:** 1
- **Max tasks:** 4 (adjust based on traffic)
- **Scale target:** 70% average CPU

Adjust via the ECS console or CLI after deployment.

---

## Cost estimate (approximate monthly, eu-west-2)

| Resource | Estimate |
|---|---|
| ECS Fargate (1 task, 0.5 vCPU, 1 GB, 24/7) | ~$15–20 |
| ALB (shared across up to 25 Express services) | ~$16 + $0.008/LCU-hour |
| RDS PostgreSQL (db.t4g.small, 20 GB gp3) | ~$26–30 |
| NAT Gateway (fixed + data transfer) | ~$32 + data |
| ECR (image storage) | ~$1 |
| Secrets Manager (5 secrets) | ~$2 |
| Data transfer | Minimal at low traffic |
| **Total (low-traffic production)** | **~$95–105/month** |

The NAT Gateway is the largest fixed cost. For a cost-sensitive staging/dev environment, you could use public subnets for ECS tasks (no NAT needed), reducing the total to ~$60–70/month. The production environment should use private subnets.

---

## Execution checklist

This is the order of operations for the first deployment:

**Application preparation:**
1. [ ] Set `output: 'standalone'` and `outputFileTracingRoot` in `next.config.ts`
2. [ ] Add the Dockerfile to the project root
3. [ ] Test the Docker build locally: `docker build -t adserve-studio .`
4. [ ] Test the Docker run locally: `docker run -p 3000:3000 -e DATABASE_URL=... adserve-studio`

**AWS infrastructure (one-time):**
5. [ ] Create the dedicated VPC with public and private subnets (Step 1)
6. [ ] Create the ECR repository (Step 2)
7. [ ] Create IAM roles — or use the ECS console to create them automatically (Step 3)
8. [ ] Create the RDS instance in the private subnets (Step 4)
9. [ ] Create the three database roles: `adserve_app`, `adserve_migrator`, plus the auto-created `adserve_master`
10. [ ] Store secrets in Secrets Manager — 5 secrets with `adserve/` prefix (Step 5)
11. [ ] Set up GitHub OIDC provider and deploy role (Step 6)
12. [ ] Set GitHub repository variables and secrets (Step 7)

**First deployment:**
13. [ ] Add the GitHub Actions workflow file
14. [ ] Push to `main` — first deployment creates the ECS Express Mode service
15. [ ] After deployment: note the ECS service security group, add inbound rule to RDS SG for port 5432
16. [ ] Run the database migration task (schema push + seed + RLS script)
17. [ ] Verify the app is accessible at the AWS-provided domain
18. [ ] Configure the Clerk webhook endpoint
19. [ ] Test: sign in, create a tenant via dev endpoint, verify the full flow

**Polish (when ready):**
20. [ ] Set up custom domain with ACM certificate
21. [ ] Complete the `withTenant()` / `withSuperAdminBypass()` query refactor (44 sites)
22. [ ] Enable RDS credential rotation in Secrets Manager

---

## What this plan does NOT cover (future work)

- **CDN / static asset caching** — CloudFront in front of the ALB for edge caching
- **Redis** — ElastiCache for session storage or caching if needed beyond Clerk
- **Staging environment** — a second ECS Express service with a separate RDS instance, triggered by a different branch
- **Monitoring and alerting** — CloudWatch alarms, error tracking (Sentry or similar)
- **Backup and disaster recovery** — RDS automated backups are enabled (7-day retention) but no cross-region replication
- **WAF** — AWS WAF for rate limiting and bot protection
- **The `withTenant()` / `withSuperAdminBypass()` query refactor** — the 44 query sites that need wrapping before RLS enforces in the running application
