#!/bin/bash
# Deploy DecentChat client to decentchat.app
# Usage:
#   ./scripts/deploy.sh            — full pre-deploy checks + deploy
#   ./scripts/deploy.sh --force    — skip tests (emergency rollback only)

set -euo pipefail

FORCE=false
for arg in "$@"; do
  if [ "$arg" = "--force" ]; then
    FORCE=true
  fi
done

cd "$(dirname "$0")/.."

# ── Load deploy env ───────────────────────────────────────────────────────
ENV_FILE=".env.deploy"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

: "${DEPLOY_HOST:?Missing DEPLOY_HOST (set in .env.deploy or environment)}"
: "${DEPLOY_USER:?Missing DEPLOY_USER (set in .env.deploy or environment)}"
: "${DEPLOY_PASS:?Missing DEPLOY_PASS (set in .env.deploy or environment)}"
: "${DEPLOY_REMOTE_PATH:=/decentchat.app/web/}"

if [ "$FORCE" = "true" ]; then
  echo "⚠️  --force: skipping pre-deploy checks. EMERGENCY USE ONLY."
else
  # ── Gate 0: AI code review (optional) ────────────────────────────────────
  if [ "${SKIP_REVIEW:-}" != "1" ] && command -v claude &>/dev/null; then
    echo "🤖 Running AI code review (SKIP_REVIEW=1 to skip)..."
    ./scripts/review.sh main..HEAD || true
    echo ""
  fi

  # ── Gate 1: Protocol unit tests ──────────────────────────────────────────
  echo "🧪 Running protocol unit tests..."
  (cd decent-protocol && bun test)
  echo "✅ Protocol tests passed"

  # ── Gate 2: TypeScript typecheck ─────────────────────────────────────────
  echo "🔍 Running TypeScript typecheck..."
  (cd decent-client-web && bun run typecheck)
  echo "✅ TypeScript clean"
fi

# ── Gate 3: Production build ──────────────────────────────────────────────
echo "⚡ Building DecentChat client..."
bun run build:client
echo "✅ Build succeeded"

# ── Deploy ────────────────────────────────────────────────────────────────
echo "📦 Deploying to decentchat.app..."
lftp -u "$DEPLOY_USER,$DEPLOY_PASS" "sftp://$DEPLOY_HOST" -e "
  set sftp:auto-confirm yes
  mirror --reverse --verbose decent-client-web/dist/ $DEPLOY_REMOTE_PATH
  bye
"

echo ""
echo "✅ Deployed to https://decentchat.app"
echo ""
echo "📋 Post-deploy smoke test:"
echo "   → Page loads without JS errors"
echo "   → Create Workspace modal opens"
echo "   → Reload the page — workspace + messages persist"
