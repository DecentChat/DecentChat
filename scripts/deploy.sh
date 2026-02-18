#!/bin/bash
# Deploy DecentChat client to decentchat.app
# Usage: ./scripts/deploy.sh

set -e

echo "⚡ Building DecentChat client..."
cd "$(dirname "$0")/.."
bun run build:client

echo "📦 Deploying to decentchat.app..."
lftp -u 'claw.decentchat.app,Xf8q,BVHIp' ftp://37.9.175.197 -e "
  set ssl:verify-certificate no
  set ftp:ssl-force true
  mirror --reverse --delete --verbose decent-client-web/dist/ decentchat.app/web/
  quit
"

echo "✅ Deployed to https://decentchat.app"
