#!/usr/bin/env bash
# Push the latest prototype code to the hosted preview AND sync data.
# This is THE command behind "push the latest prototype to the hosted platform".
#
# Compute is Amazon ECS Express Mode (service 'adserve-studio-preview' in cluster
# adserve-prod) — AWS's recommended managed container service, same as production.
#
#   scripts/deploy-preview.sh              # build+deploy code, then bidirectional data sync
#   scripts/deploy-preview.sh --no-sync    # code only, skip the data sync
#   scripts/deploy-preview.sh --data-mode push   # use 'push' (local->hosted full replace) instead of 'sync'
#
# See docs/preview-environment.md.
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-adserve-admin}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-eu-west-2}"

DATA_MODE="sync"
DO_SYNC=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-sync) DO_SYNC=0 ;;
    --data-mode) DATA_MODE="$2"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
  shift
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ACCOUNT=181194339452
REG="$ACCOUNT.dkr.ecr.eu-west-2.amazonaws.com"
CLERK_PK="pk_test_Y2xlYXItYW5jaG92eS0yOC5jbGVyay5hY2NvdW50cy5kZXYk"
CLUSTER="adserve-prod"
SERVICE="adserve-studio-preview"
SHA="$(git rev-parse --short HEAD)"
TAG="preview-$SHA"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "⚠️  Uncommitted changes present — building from the working tree (not a clean commit)." >&2
fi

echo "==> [1/4] Building image $TAG (linux/amd64)…"
aws ecr get-login-password | docker login --username AWS --password-stdin "$REG" >/dev/null
docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$CLERK_PK" \
  --build-arg NEXT_PUBLIC_PROTOTYPE=true \
  -t "$REG/adserve-studio:$TAG" -t "$REG/adserve-studio:preview-latest" .
docker push "$REG/adserve-studio:$TAG"
docker push "$REG/adserve-studio:preview-latest"

echo "==> [2/4] Updating ECS Express service to $TAG…"
ARN="$(aws ecs describe-express-gateway-service \
  --service-arn "arn:aws:ecs:eu-west-2:$ACCOUNT:service/$CLUSTER/$SERVICE" \
  --query 'service.serviceArn' --output text 2>/dev/null || true)"
if [[ -z "$ARN" || "$ARN" == "None" ]]; then
  echo "❌ ECS Express service '$SERVICE' not found in cluster '$CLUSTER'." >&2; exit 1
fi
SRC="$(mktemp)"
sed "s|__IMAGE_TAG__|$TAG|" scripts/ecs-express-source.json > "$SRC"
aws ecs update-express-gateway-service --service-arn "$ARN" --primary-container "file://$SRC" >/dev/null
rm -f "$SRC"

echo "==> [3/4] Waiting for the ECS rollout to complete…"
for i in $(seq 1 80); do
  STATE="$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
    --query 'services[0].deployments[0].rolloutState' --output text 2>/dev/null || echo PENDING)"
  echo "    [$i] rollout: $STATE"
  [[ "$STATE" == "COMPLETED" ]] && break
  [[ "$STATE" == "FAILED" ]] && { echo "❌ rollout failed — check ECS/CloudWatch logs." >&2; exit 1; }
  sleep 15
done

if [[ "$DO_SYNC" == "1" ]]; then
  echo "==> [4/4] Syncing data ($DATA_MODE)…"
  "$REPO_ROOT/scripts/sync-preview.sh" "$DATA_MODE" --apply
else
  echo "==> [4/4] Skipping data sync (--no-sync)."
fi

EP="$(aws ecs describe-express-gateway-service --service-arn "$ARN" \
  --query 'service.activeConfigurations[0].ingressPaths[0].endpoint' --output text 2>/dev/null || true)"
echo ""
echo "✅ Preview updated to $TAG — https://$EP"
