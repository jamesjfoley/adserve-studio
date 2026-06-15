#!/usr/bin/env bash
# Sync CRM content between LOCAL dev DB and the HOSTED preview RDS.
# See docs/preview-environment.md and packages/database/src/scripts/sync-preview.ts.
#
#   scripts/sync-preview.sh push        # local  -> hosted (full replace), dry-run
#   scripts/sync-preview.sh push --apply
#   scripts/sync-preview.sh pull --apply # hosted -> local  (full replace)
#   scripts/sync-preview.sh sync --apply # bidirectional, newest-wins merge
#
set -euo pipefail

MODE="${1:-}"
if [[ -z "$MODE" ]]; then
  echo "Usage: scripts/sync-preview.sh <push|pull|sync> [--apply]" >&2
  exit 1
fi
shift || true

export AWS_PROFILE="${AWS_PROFILE:-adserve-admin}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-eu-west-2}"

# Pull the hosted preview DB URL from Secrets Manager (never stored in the repo).
HOSTED_DATABASE_URL="$(aws secretsmanager get-secret-value \
  --secret-id adserve/preview-database-url --query SecretString --output text)"
export HOSTED_DATABASE_URL
export LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL:-postgresql://jamesfoley@localhost:5432/adserve}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
pnpm --filter @adserve/database exec tsx src/scripts/sync-preview.ts "$MODE" "$@"
