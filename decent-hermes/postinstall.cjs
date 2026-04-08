#!/usr/bin/env node
/**
 * postinstall.cjs — set up the decent-hermes patch system for the user.
 *
 * Runs after `npm/bun install @decentchat/hermes-bridge`. Does three things:
 *
 *   1. Sanity-checks that node-datachannel's native binary loaded. Prints
 *      actionable fix instructions if not.
 *
 *   2. Copies the `hermes-patch/` directory (bundled inside this package)
 *      to ~/.hermes/decent-hermes-patch/, then runs apply.sh once so the
 *      DecentChat adapter modifications land in ~/.hermes/hermes-agent/.
 *
 *   3. On macOS: installs a launchd WatchPaths agent at
 *      ~/Library/LaunchAgents/com.decenthermes.patch.plist that automatically
 *      re-runs apply.sh whenever hermes-agent's main branch ref changes
 *      (i.e. after `hermes update` / `git pull` lands new commits).
 *
 * Exits 0 even on non-fatal failures so `npm install` doesn't abort.
 *
 * Requirements on the user's machine:
 *   - hermes-agent installed at ~/.hermes/hermes-agent (standard Hermes layout)
 *   - bash + cp + launchctl (on macOS)
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { execSync } = require("child_process");

function log(msg) {
  console.log(`[decent-hermes postinstall] ${msg}`);
}

// ─── 1. Native binary sanity check ──────────────────────────────────────────
try {
  require("node-datachannel");
} catch (e) {
  const msg = e && e.message ? e.message : String(e);
  console.error("");
  console.error("  ╔══════════════════════════════════════════════════════════╗");
  console.error("  ║  node-datachannel native binary failed to load.         ║");
  console.error("  ║  Hermes DecentChat bridge needs this for P2P connections ║");
  console.error("  ╚══════════════════════════════════════════════════════════╝");
  console.error("");
  console.error("  Error: " + msg);
  console.error("");
  console.error("  Try one of these:");
  console.error("    1. npx prebuild-install --runtime napi --target 8 --module_name node_datachannel");
  console.error("    2. npm rebuild node-datachannel");
  console.error("    3. npm install node-datachannel");
  console.error("");
  // Don't block patch install — user can fix this later
}

// ─── 2. Install the patch system into ~/.hermes/decent-hermes-patch/ ────────
const HOME        = os.homedir();
const HERMES_DIR  = path.join(HOME, ".hermes", "hermes-agent");
const PATCH_DEST  = path.join(HOME, ".hermes", "decent-hermes-patch");
const PATCH_SRC   = path.join(__dirname, "hermes-patch");
const APPLY_SH    = path.join(PATCH_DEST, "apply.sh");

if (!fs.existsSync(HERMES_DIR)) {
  log(`hermes-agent not found at ${HERMES_DIR}`);
  log("Install Hermes first (https://hermes.ai), then re-run:");
  log(`  npm rebuild @decentchat/hermes-bridge`);
  log("Skipping patch install.");
  process.exit(0);
}

if (!fs.existsSync(PATCH_SRC)) {
  log(`patch source not bundled at ${PATCH_SRC} — nothing to install.`);
  process.exit(0);
}

try {
  fs.mkdirSync(PATCH_DEST, { recursive: true });
  // cp -R preserves permissions, follows dirs (bridge/ subdir, nested files)
  execSync(`cp -R "${PATCH_SRC}/"* "${PATCH_DEST}/"`, { stdio: "inherit" });
  log(`Patch files installed to ${PATCH_DEST}`);
} catch (e) {
  log(`Failed to copy patch files: ${e.message}`);
  log("Install aborted — you can copy manually:");
  log(`  cp -R ${PATCH_SRC}/* ${PATCH_DEST}/`);
  process.exit(0);
}

// Make apply.sh executable (cp -R may not preserve the bit on all platforms)
try {
  fs.chmodSync(APPLY_SH, 0o755);
} catch {}

// ─── 3. Run apply.sh once to apply the patch immediately ────────────────────
if (fs.existsSync(APPLY_SH)) {
  try {
    execSync(`bash "${APPLY_SH}"`, { stdio: "inherit" });
    log("apply.sh ran successfully — DecentChat adapter patched into hermes-agent.");
  } catch (e) {
    log(`apply.sh exited non-zero: ${e.message}`);
    log("You can run it manually later:");
    log(`  bash ${APPLY_SH}`);
    // Continue anyway — maybe launchd install can still work
  }
}

// ─── 4. macOS: install + load the launchd WatchPaths agent ──────────────────
if (process.platform !== "darwin") {
  log(`Platform ${process.platform}: launchd watcher not installed.`);
  log("On non-macOS systems, re-run apply.sh manually after any hermes update:");
  log(`  bash ${APPLY_SH}`);
  log("Or set up a filesystem watcher equivalent for your platform (inotify, etc).");
  process.exit(0);
}

const PLIST_NAME     = "com.decenthermes.patch.plist";
const PLIST_TEMPLATE = path.join(PATCH_DEST, PLIST_NAME);
const PLIST_DEST     = path.join(HOME, "Library", "LaunchAgents", PLIST_NAME);

if (!fs.existsSync(PLIST_TEMPLATE)) {
  log(`plist template missing at ${PLIST_TEMPLATE} — skipping launchd install.`);
  process.exit(0);
}

try {
  // Substitute __HOME__ placeholder with actual user homedir
  let plist = fs.readFileSync(PLIST_TEMPLATE, "utf8");
  plist = plist.replace(/__HOME__/g, HOME);

  fs.mkdirSync(path.dirname(PLIST_DEST), { recursive: true });
  fs.writeFileSync(PLIST_DEST, plist);
  log(`Installed plist to ${PLIST_DEST}`);

  // Unload if already loaded (idempotent), then load fresh
  try {
    execSync(`launchctl unload "${PLIST_DEST}"`, { stdio: "ignore" });
  } catch {
    // first install — no existing agent to unload
  }
  execSync(`launchctl load "${PLIST_DEST}"`, { stdio: "inherit" });
  log("launchd agent loaded — patch will auto-reapply after hermes updates.");
  log("");
  log("✅ decent-hermes patch system is active.");
  log(`   Log file: ${HOME}/.hermes/logs/decentchat-patch.log`);
  log(`   Manual reapply: bash ${APPLY_SH}`);
  log(`   Disable watcher: launchctl unload ${PLIST_DEST}`);
} catch (e) {
  log(`launchd install failed: ${e.message}`);
  log("Manual fallback: after each hermes update, run:");
  log(`  bash ${APPLY_SH}`);
}

process.exit(0);
