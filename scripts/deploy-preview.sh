#!/usr/bin/env bash
# Push the latest prototype code to the hosted preview AND sync data.
# This is THE command behind "push the latest prototype to the hosted platform".
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

echo "==> [2/4] Updating App Runner service to $TAG…"
ARN="$(aws apprunner list-services \
  --query "ServiceSummaryList[?ServiceName=='adserve-studio-preview'].ServiceArn | [0]" --output text)"
if [[ -z "$ARN" || "$ARN" == "None" ]]; then
  echo "❌ preview service 'adserve-studio-preview' not found." >&2; exit 1
fi
SRC="$(mktemp)"
sed "s|__IMAGE_TAG__|$TAG|" scripts/apprunner-source.json > "$SRC"
aws apprunner update-service --service-arn "$ARN" --source-configuration "file://$SRC" >/dev/null
rm -f "$SRC"

echo "==> [3/4] Waiting for deployment to go live…"
for i in $(seq 1 80); do
  S="$(aws apprunner describe-service --service-arn "$ARN" --query 'Service.Status' --output text)"
  echo "    [$i] $S"
  [[ "$S" == "RUNNING" ]] && break
  case "$S" in *FAILED*) echo "❌ deployment failed — check App Runner logs." >&2; exit 1 ;; esac
  sleep 15
done

if [[ "$DO_SYNC" == "1" ]]; then
  echo "==> [4/4] Syncing data ($DATA_MODE)…"
  "$REPO_ROOT/scripts/sync-preview.sh" "$DATA_MODE" --apply
else
  echo "==> [4/4] Skipping data sync (--no-sync)."
fi

URL="$(aws apprunner describe-service --service-arn "$ARN" --query 'Service.ServiceUrl' --output text)"
echo ""
echo "✅ Preview updated to $TAG — https://$URL"
