#!/usr/bin/env node
/**
 * postinstall.cjs — verify that node-datachannel's native binary is usable.
 *
 * node-datachannel uses prebuild-install to download a platform-specific
 * binary. That download can fail silently (corporate proxies, missing
 * prebuilds for the arch, etc.). This script catches it early and prints
 * actionable fix instructions instead of letting it blow up at runtime.
 *
 * Always exits 0 so the overall install isn't blocked.
 */

"use strict";

try {
  require("node-datachannel");
} catch (e) {
  const msg = e && e.message ? e.message : String(e);

  console.error("");
  console.error("  ╔══════════════════════════════════════════════════════════╗");
  console.error("  ║  node-datachannel native binary failed to load.         ║");
  console.error("  ║  DecentChat needs this for P2P WebRTC connections.      ║");
  console.error("  ╚══════════════════════════════════════════════════════════╝");
  console.error("");
  console.error("  Error: " + msg);
  console.error("");
  console.error("  Try one of these:");
  console.error("");
  console.error("    1. Re-run the prebuild download:");
  console.error("       npx prebuild-install --runtime napi --target 8 --module_name node_datachannel");
  console.error("");
  console.error("    2. Rebuild from source (needs cmake + a C++ compiler):");
  console.error("       npm rebuild node-datachannel");
  console.error("");
  console.error("    3. Install it directly:");
  console.error("       npm install node-datachannel");
  console.error("");
}
