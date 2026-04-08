#!/usr/bin/env bash
# apply.sh — Re-apply the DecentChat adapter patch to hermes-agent after updates.
#
# Run manually:   bash ~/.hermes/decent-hermes-patch/apply.sh
# Run by launchd: automatically on hermes git update
#
# What it does:
#   1. Checks if the patch is already applied (idempotent)
#   2. Applies the Python adapter patch to hermes-agent
#   3. Copies the compiled bridge bundle into hermes-agent/scripts/decentchat-bridge/

set -euo pipefail

HERMES_DIR="$HOME/.hermes/hermes-agent"
PATCH_DIR="$(cd "$(dirname "$0")" && pwd)"
PATCH_FILE="$PATCH_DIR/decentchat.patch"
BRIDGE_SRC="$PATCH_DIR/bridge"
BRIDGE_DEST="$HERMES_DIR/scripts/decentchat-bridge"
LOG_FILE="$HOME/.hermes/logs/decentchat-patch.log"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

log "=== decent-hermes patch apply started ==="

# ── 1. Check hermes-agent exists ─────────────────────────────────────────────
if [[ ! -d "$HERMES_DIR/.git" ]]; then
  log "ERROR: hermes-agent not found at $HERMES_DIR"
  exit 1
fi

# ── 2. Apply the Python adapter patch (idempotent) ───────────────────────────
cd "$HERMES_DIR"

if git apply --check --reverse "$PATCH_FILE" 2>/dev/null; then
  log "Patch already applied — skipping."
else
  log "Checking if patch applies cleanly..."
  if git apply --check "$PATCH_FILE" 2>/dev/null; then
    log "Applying patch..."
    git apply "$PATCH_FILE"
    log "Patch applied successfully."
  else
    log "WARNING: Patch does not apply cleanly (hermes may have changed). Attempting 3-way merge..."
    if git apply --3way "$PATCH_FILE" 2>>"$LOG_FILE"; then
      log "3-way merge succeeded."
    else
      log "ERROR: Patch failed. Manual intervention required."
      log "  Patch file: $PATCH_FILE"
      log "  Hermes dir: $HERMES_DIR"
      # Send a notification if terminal-notifier is available
      if command -v terminal-notifier &>/dev/null; then
        terminal-notifier \
          -title "decent-hermes" \
          -message "Patch failed after hermes update — manual fix needed" \
          -sound default 2>/dev/null || true
      fi
      exit 1
    fi
  fi
fi

# ── 3. Copy bridge bundle ─────────────────────────────────────────────────────
if [[ -d "$BRIDGE_SRC" && -f "$BRIDGE_SRC/bridge.js" && -f "$BRIDGE_SRC/package.json" ]]; then
  log "Copying bridge bundle to $BRIDGE_DEST..."
  mkdir -p "$BRIDGE_DEST"
  cp -f "$BRIDGE_SRC/bridge.js" "$BRIDGE_DEST/bridge.js"
  cp -f "$BRIDGE_SRC/package.json" "$BRIDGE_DEST/package.json"

  # Install native deps if node_modules is missing or outdated
  if [[ ! -d "$BRIDGE_DEST/node_modules" ]]; then
    log "Installing bridge dependencies..."
    npm install --silent --prefix "$BRIDGE_DEST" 2>>"$LOG_FILE"
    log "Bridge dependencies installed."
  else
    log "Bridge node_modules already present — skipping npm install."
  fi
else
  log "WARNING: Bridge bundle not found at $BRIDGE_SRC (bridge.js + package.json required) — skipping bridge copy."
  log "  Run 'cd ~/Projects/decent-chat/decent-hermes && bun run build' then copy dist/bridge.js to decent-hermes/hermes-patch/bridge/bridge.js and re-run this script."
fi

log "=== decent-hermes patch apply complete ==="
