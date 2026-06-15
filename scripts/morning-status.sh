#!/usr/bin/env bash
# Start-of-day status check for the AdServe prototype + hosted preview.
# Read-only. Run: scripts/morning-status.sh
set -uo pipefail
export AWS_PROFILE="${AWS_PROFILE:-adserve-admin}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-eu-west-2}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "──────── Services ────────"
brew services list 2>/dev/null | grep -E "postgresql@16|redis" || echo "(brew not available)"

echo "──────── Git ────────"
echo "branch : $(git branch --show-current)"
git status -sb | head -3
echo "recent :"; git log --oneline -5

echo "──────── Hosted preview (ECS Express Mode) ────────"
ARN="arn:aws:ecs:eu-west-2:181194339452:service/adserve-prod/adserve-studio-preview"
EP=$(aws ecs describe-express-gateway-service --service-arn "$ARN" \
      --query 'service.activeConfigurations[0].ingressPaths[0].endpoint' --output text 2>/dev/null)
IMG=$(aws ecs describe-express-gateway-service --service-arn "$ARN" \
      --query 'service.activeConfigurations[0].primaryContainer.image' --output text 2>/dev/null | sed 's#.*/##')
if [ -n "${EP:-}" ] && [ "$EP" != "None" ]; then
  echo "url    : https://$EP"
  echo "image  : $IMG"
  echo "health : $(curl -s -o /dev/null -w '%{http_code}' --max-time 12 "https://$EP/api/health" 2>/dev/null)"
else
  echo "(preview service not found — may have been torn down)"
fi

echo "──────── Preview DB sanity (expect only real data) ────────"
HOSTED=$(aws secretsmanager get-secret-value --secret-id adserve/preview-database-url --query SecretString --output text 2>/dev/null)
if [ -n "${HOSTED:-}" ]; then
  psql "$HOSTED" -t -A -F' ' -c "select 'users   :', count(*) from users;" 2>/dev/null
  psql "$HOSTED" -t -A -F' ' -c "select 'tenants :', string_agg(name, ', ') from tenants;" 2>/dev/null
  psql "$HOSTED" -t -A -F' ' -c "select 'records :', count(*) from records;" 2>/dev/null
else
  echo "(could not read preview DB secret)"
fi

echo "──────── Reminders ────────"
echo "• Push prototype to hosted:  scripts/deploy-preview.sh   (code + bidirectional data sync)"
echo "• Sync data only:            scripts/sync-preview.sh sync --apply"
echo "• Full env doc / teardown:   docs/preview-environment.md"
echo "• Preview costs ~\$30-45/mo while up — tear down when colleagues are done."
