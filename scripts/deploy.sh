#!/bin/bash
# Deploy DecentChat client to decentchat.app
# Usage:
#   ./scripts/deploy.sh            — full pre-deploy checks + deploy
#   ./scripts/deploy.sh --force    — skip tests (emergency rollback only)

set -e

FORCE=false
for arg in "$@"; do
  if [ "$arg" = "--force" ]; then
    FORCE=true
  fi
done

cd "$(dirname "$0")/.."

if [ "$FORCE" = "true" ]; then
  echo "⚠️  --force: skipping pre-deploy checks. EMERGENCY USE ONLY."
else
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
lftp -u 'claw.decentchat.app,Xf8q,BVHIp' ftp://37.9.175.197 -e "
  set ssl:verify-certificate no
  set ftp:ssl-force true
  mirror --reverse --delete --verbose decent-client-web/dist/ decentchat.app/web/
  quit
"

echo ""
echo "✅ Deployed to https://decentchat.app"
echo ""
echo "📋 Post-deploy smoke test:"
echo "   → Page loads without JS errors"
echo "   → Create Workspace modal opens"
echo "   → Reload the page — workspace + messages persist"
