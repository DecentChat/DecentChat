#!/bin/bash
# Deploy DecentChat docs (VitePress) via FTP/SFTP mirror
# Usage:
#   ./scripts/deploy-docs.sh

set -e

cd "$(dirname "$0")/.."

ENV_FILE=".env.deploy"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

: "${DEPLOY_HOST:?Missing DEPLOY_HOST (set in .env.deploy or environment)}"
: "${DEPLOY_USER:?Missing DEPLOY_USER (set in .env.deploy or environment)}"
: "${DEPLOY_PASS:?Missing DEPLOY_PASS (set in .env.deploy or environment)}"
: "${DEPLOY_DOCS_REMOTE_PATH:=decentchat.app/docs/}"

echo "📚 Building docs..."
bun run docs:build

echo "📦 Deploying docs to $DEPLOY_DOCS_REMOTE_PATH"
lftp -u "$DEPLOY_USER,$DEPLOY_PASS" "ftp://$DEPLOY_HOST" -e "
  set ssl:verify-certificate no
  set ftp:ssl-force true
  mirror --reverse --delete --verbose docs/.vitepress/dist/ $DEPLOY_DOCS_REMOTE_PATH
  quit
"

echo ""
echo "✅ Docs deployed"
echo ""
echo "Post-deploy check:"
echo "  - Docs home loads"
echo "  - Sidebar navigation works"
echo "  - Search returns results"
