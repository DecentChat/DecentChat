/**
 * CPU Profiling Script for DecentChat Freeze Investigation
 *
 * Uses Playwright + Chrome DevTools Protocol (CDP) to capture a CPU profile
 * during workspace join via invite link, then analyzes it to find bottleneck functions.
 *
 * Strategy:
 *   1. First run: Navigate to invite link → join the real XenaLand workspace
 *      → connect to real bots + user → receive sync data → trigger the freeze
 *   2. Second run: IDB has workspace data → profile page reload with existing data
 *
 * Usage:
 *   npx playwright test tests/profile-freeze.spec.ts --project=chromium --headed
 *
 * Output:
 *   ./profile-output/freeze-profile.cpuprofile  (Chrome DevTools / speedscope.app)
 *   ./profile-output/analysis.txt               (programmatic breakdown)
 *   ./profile-output/perf-logs.txt              (PERF console logs)
 *   ./profile-output/console-logs.txt           (all console logs)
 */

import { test, chromium, type CDPSession } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Config ──────────────────────────────────────────────────────────────────
const PROFILE_OUTPUT_DIR = path.join(__dirname, '..', 'profile-output');
const PROFILE_FILE = path.join(PROFILE_OUTPUT_DIR, 'freeze-profile.cpuprofile');
const PERF_LOG_FILE = path.join(PROFILE_OUTPUT_DIR, 'perf-logs.txt');
const CONSOLE_LOG_FILE = path.join(PROFILE_OUTPUT_DIR, 'console-logs.txt');

// Use local dev server for profiling (tests the current source, not deployed code).
// Playwright config starts Vite on port 5173. Falls back to production if LOCAL=0.
const USE_LOCAL = process.env.PROFILE_REMOTE !== '1';
const BASE_URL = USE_LOCAL ? 'http://127.0.0.1:5173' : 'https://decentchat.app';

const INVITE_PARAMS = '/join/TV3KL5RW?signal=0.peerjs.com%3A443&peer=69fae059671130cd8b&pk=eyJhbGciOiJFUzI1NiIsImNydiI6IlAtMjU2IiwiZXh0Ijp0cnVlLCJrZXlfb3BzIjpbInZlcmlmeSJdLCJrdHkiOiJFQyIsIngiOiJKMGZNc1gxMGEtRXhqVzcxSlFYVTg5TWdaRDV4cXRLclBOU0FRdm1tMEEwIiwieSI6ImFwMzZBbWpZWGJRNXJPRkZQZ0VoUUp4bDY2bmdsYVVzbGYydFVBY01fMkkifQ%3D%3D&name=XenaLand&ws=afcdbd3d-0473-4204-a72f-6b3b33271903&secure=1&path=%2F&exp=1774967089772&i=3c01cdab45d9&inviter=69fae059671130cd8b&sig=9ueK0Vu-H8eEHYCC8UlLh3ssCMAy9zYAhlQmm7XZ8pvhP-A74emo9IHZFEF3B2o_byhaREQMhaZvFyfiPuJZoQ&peer=0b50b146a83d6763b1&peer=c75ba7f325ecbc8e9a&peer=98057f7f5650604033';
const INVITE_URL = `${BASE_URL}${INVITE_PARAMS}`;

const APP_URL = `${BASE_URL}/app`;

// Persistent context dir (IndexedDB survives between runs)
const USER_DATA_DIR = path.join(PROFILE_OUTPUT_DIR, 'chromium-profile-data-v2');

// How long to wait for sync/freeze after joining or reloading
const POST_JOIN_WAIT_MS = 120_000;  // 2 minutes for initial join (lots of sync)
const POST_RELOAD_WAIT_MS = 90_000; // 1.5 minutes for reload

// ── Helpers ─────────────────────────────────────────────────────────────────

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

interface ProfileNode {
  id: number;
  callFrame: {
    functionName: string;
    scriptId: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  hitCount: number;
  children?: number[];
}

interface CPUProfile {
  nodes: ProfileNode[];
  samples: number[];
  timeDeltas: number[];
  startTime: number;
  endTime: number;
}

function analyzeProfile(profile: CPUProfile): string {
  const lines: string[] = [];
  const nodeMap = new Map<number, ProfileNode>();
  for (const node of profile.nodes) {
    nodeMap.set(node.id, node);
  }

  // Self-time from samples + timeDeltas
  const selfTimeByNode = new Map<number, number>();
  for (let i = 0; i < profile.samples.length; i++) {
    const nodeId = profile.samples[i];
    const delta = profile.timeDeltas[i]; // microseconds
    selfTimeByNode.set(nodeId, (selfTimeByNode.get(nodeId) || 0) + delta);
  }

  // Aggregate by function@url:line
  const byFunction = new Map<
    string,
    { selfTime: number; hitCount: number; url: string; line: number }
  >();
  for (const [nodeId, selfTime] of selfTimeByNode) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    const cf = node.callFrame;
    const key = `${cf.functionName || '(anonymous)'}@${cf.url}:${cf.lineNumber}`;
    const entry = byFunction.get(key) || {
      selfTime: 0,
      hitCount: 0,
      url: cf.url,
      line: cf.lineNumber,
    };
    entry.selfTime += selfTime;
    entry.hitCount += node.hitCount;
    byFunction.set(key, entry);
  }

  const sorted = [...byFunction.entries()].sort((a, b) => b[1].selfTime - a[1].selfTime);
  const totalProfileTime = profile.timeDeltas.reduce((s, d) => s + d, 0);

  lines.push(`\n${'='.repeat(80)}`);
  lines.push('CPU PROFILE ANALYSIS');
  lines.push(`${'='.repeat(80)}`);
  lines.push(`Total profile time: ${(totalProfileTime / 1000).toFixed(1)}ms`);
  lines.push(`Total samples: ${profile.samples.length}`);
  lines.push(`Unique functions sampled: ${byFunction.size}`);
  lines.push('');

  // ── Top 50 by self-time ───────────────────────────────────────────────
  lines.push(`${'─'.repeat(80)}`);
  lines.push('TOP 50 FUNCTIONS BY SELF-TIME');
  lines.push(`${'─'.repeat(80)}`);
  lines.push(
    `${'Rank'.padEnd(6)}${'Self-Time'.padEnd(14)}${'%'.padEnd(8)}${'Hits'.padEnd(8)}Function`,
  );
  lines.push(`${'─'.repeat(80)}`);

  for (let i = 0; i < Math.min(50, sorted.length); i++) {
    const [key, data] = sorted[i];
    const pct = ((data.selfTime / totalProfileTime) * 100).toFixed(1);
    const timeMs = (data.selfTime / 1000).toFixed(1);
    lines.push(
      `${String(i + 1).padEnd(6)}${(timeMs + 'ms').padEnd(14)}${(pct + '%').padEnd(8)}${String(data.hitCount).padEnd(8)}${key}`,
    );
  }

  // ── By source file ────────────────────────────────────────────────────
  lines.push(`\n${'─'.repeat(80)}`);
  lines.push('SELF-TIME BY SOURCE FILE (top 20)');
  lines.push(`${'─'.repeat(80)}`);

  const byFile = new Map<string, number>();
  for (const [, data] of sorted) {
    const url = data.url || '(native)';
    const shortUrl = url
      .replace(/.*\/src\//, 'src/')
      .replace(/.*\/node_modules\//, 'node_modules/');
    byFile.set(shortUrl, (byFile.get(shortUrl) || 0) + data.selfTime);
  }
  const sortedFiles = [...byFile.entries()].sort((a, b) => b[1] - a[1]);
  for (let i = 0; i < Math.min(20, sortedFiles.length); i++) {
    const [file, time] = sortedFiles[i];
    const pct = ((time / totalProfileTime) * 100).toFixed(1);
    lines.push(
      `  ${(time / 1000).toFixed(1).padStart(10)}ms  ${pct.padStart(5)}%  ${file}`,
    );
  }

  // ── Longest contiguous runs ───────────────────────────────────────────
  lines.push(`\n${'─'.repeat(80)}`);
  lines.push('LONGEST CONTIGUOUS EXECUTION RUNS (>50ms)');
  lines.push(`${'─'.repeat(80)}`);

  const longRuns: Array<{
    nodeId: number;
    startIdx: number;
    duration: number;
    samples: number;
  }> = [];
  let runStart = 0;
  let runNodeId = profile.samples[0];
  let runDuration = 0;

  for (let i = 1; i < profile.samples.length; i++) {
    const delta = profile.timeDeltas[i];
    if (profile.samples[i] === runNodeId) {
      runDuration += delta;
    } else {
      if (runDuration > 50_000) {
        longRuns.push({
          nodeId: runNodeId,
          startIdx: runStart,
          duration: runDuration,
          samples: i - runStart,
        });
      }
      runNodeId = profile.samples[i];
      runStart = i;
      runDuration = delta;
    }
  }
  if (runDuration > 50_000) {
    longRuns.push({
      nodeId: runNodeId,
      startIdx: runStart,
      duration: runDuration,
      samples: profile.samples.length - runStart,
    });
  }

  longRuns.sort((a, b) => b.duration - a.duration);
  if (longRuns.length === 0) {
    lines.push('  No contiguous runs >50ms on a single function detected.');
    lines.push('  (The freeze may be from rapid cycling between multiple functions.)');
  } else {
    for (const run of longRuns.slice(0, 20)) {
      const node = nodeMap.get(run.nodeId);
      const cf = node?.callFrame;
      const name = cf
        ? `${cf.functionName || '(anonymous)'}@${cf.url}:${cf.lineNumber}`
        : '(unknown)';
      lines.push(
        `  ${(run.duration / 1000).toFixed(1).padStart(8)}ms  ${String(run.samples).padStart(5)} samples  ${name}`,
      );
    }
  }

  // ── Heaviest call stacks ──────────────────────────────────────────────
  lines.push(`\n${'─'.repeat(80)}`);
  lines.push('HEAVIEST CALL STACKS (top 10 by accumulated self-time)');
  lines.push(`${'─'.repeat(80)}`);

  const parentMap = new Map<number, number>();
  for (const node of profile.nodes) {
    if (node.children) {
      for (const childId of node.children) {
        parentMap.set(childId, node.id);
      }
    }
  }

  function getStack(nodeId: number): string[] {
    const stack: string[] = [];
    let current: number | undefined = nodeId;
    while (current !== undefined) {
      const node = nodeMap.get(current);
      if (!node) break;
      const cf = node.callFrame;
      const name = cf.functionName || '(anonymous)';
      const url = (cf.url || '')
        .replace(/.*\/src\//, 'src/')
        .replace(/.*\/node_modules\//, 'nm/');
      if (name !== '(root)' && name !== '(program)' && name !== '(idle)') {
        stack.push(`${name} (${url}:${cf.lineNumber})`);
      }
      current = parentMap.get(current);
    }
    return stack.reverse();
  }

  // Group samples by leaf-to-root stack, accumulate time
  const stackTimeMap = new Map<string, { time: number; stack: string[] }>();
  for (let i = 0; i < profile.samples.length; i++) {
    const nodeId = profile.samples[i];
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    const cf = node.callFrame;
    if (
      cf.functionName === '(idle)' ||
      cf.functionName === '(program)' ||
      cf.functionName === '(garbage collector)'
    )
      continue;

    const stack = getStack(nodeId);
    const stackKey = stack.join(' > ');
    const entry = stackTimeMap.get(stackKey) || { time: 0, stack };
    entry.time += profile.timeDeltas[i];
    stackTimeMap.set(stackKey, entry);
  }

  const sortedStacks = [...stackTimeMap.entries()].sort(
    (a, b) => b[1].time - a[1].time,
  );
  for (let i = 0; i < Math.min(10, sortedStacks.length); i++) {
    const [, data] = sortedStacks[i];
    lines.push(
      `\n  Stack #${i + 1}: ${(data.time / 1000).toFixed(1)}ms (${((data.time / totalProfileTime) * 100).toFixed(1)}%)`,
    );
    for (let j = 0; j < data.stack.length; j++) {
      lines.push(`    ${'  '.repeat(j)}\u2192 ${data.stack[j]}`);
    }
  }

  // ── App vs Native vs Idle breakdown ───────────────────────────────────
  lines.push(`\n${'─'.repeat(80)}`);
  lines.push('TIME BREAKDOWN: App vs Native vs Idle');
  lines.push(`${'─'.repeat(80)}`);

  let appTime = 0,
    nativeTime = 0,
    idleTime = 0,
    gcTime = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const node = nodeMap.get(profile.samples[i]);
    if (!node) continue;
    const cf = node.callFrame;
    const delta = profile.timeDeltas[i];
    if (cf.functionName === '(idle)') {
      idleTime += delta;
    } else if (cf.functionName === '(garbage collector)') {
      gcTime += delta;
    } else if (!cf.url || cf.url.startsWith('native ') || cf.url === '') {
      nativeTime += delta;
    } else {
      appTime += delta;
    }
  }

  lines.push(
    `  App code:          ${(appTime / 1000).toFixed(1).padStart(10)}ms  ${((appTime / totalProfileTime) * 100).toFixed(1)}%`,
  );
  lines.push(
    `  Native/built-in:   ${(nativeTime / 1000).toFixed(1).padStart(10)}ms  ${((nativeTime / totalProfileTime) * 100).toFixed(1)}%`,
  );
  lines.push(
    `  Idle:              ${(idleTime / 1000).toFixed(1).padStart(10)}ms  ${((idleTime / totalProfileTime) * 100).toFixed(1)}%`,
  );
  lines.push(
    `  GC:                ${(gcTime / 1000).toFixed(1).padStart(10)}ms  ${((gcTime / totalProfileTime) * 100).toFixed(1)}%`,
  );

  return lines.join('\n');
}

// ── Test ─────────────────────────────────────────────────────────────────────

test.describe.configure({ mode: 'serial' });
test.setTimeout(600_000); // 10 minutes — need time for sync + profiling

test('profile freeze via real workspace join', async () => {
  ensureDir(PROFILE_OUTPUT_DIR);
  ensureDir(USER_DATA_DIR);

  console.log('\n[PROFILE] Launching persistent Chromium context...');
  console.log(`[PROFILE] User data dir: ${USER_DATA_DIR}`);

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
  });

  const page = context.pages()[0] || (await context.newPage());

  // Collect console logs
  const consoleLogs: string[] = [];
  const perfLogs: string[] = [];
  page.on('console', (msg) => {
    const text = `[${msg.type()}] ${msg.text()}`;
    consoleLogs.push(text);
    if (
      msg.text().includes('[PERF]') ||
      msg.text().includes('[PostConnect]') ||
      msg.text().includes('[Transport]') ||
      msg.text().includes('Long task') ||
      msg.text().includes('Frame gap')
    ) {
      perfLogs.push(text);
      console.log(`  ${text}`);
    }
  });

  // ─── Check if we already have a workspace ─────────────────────────────
  console.log('\n[PROFILE] Phase 1: Checking if workspace exists...');
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(3000);

  const needsJoin = await page.evaluate(() => {
    return !!(
      document.querySelector('#create-ws-btn') ||
      document.querySelector('.welcome') ||
      document.querySelector('.landing')
    );
  });

  if (needsJoin) {
    // ─── JOIN FLOW: Navigate to invite link ──────────────────────────────
    console.log('[PROFILE] No workspace found — joining via invite link...');
    console.log('[PROFILE] This will connect to the REAL XenaLand workspace with bots + user.');

    // Start profiler BEFORE navigating to invite
    const cdp: CDPSession = await context.newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); // 100μs
    await cdp.send('Performance.enable');

    consoleLogs.length = 0;
    perfLogs.length = 0;

    await cdp.send('Profiler.start');
    console.log('[PROFILE] Profiler STARTED. Navigating to invite link...');

    const joinStart = Date.now();

    // Navigate to the invite link — the app will show a join confirmation
    await page.goto(INVITE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    console.log(`[PROFILE] Invite page loaded in ${Date.now() - joinStart}ms`);
    await page.waitForTimeout(2000);

    // The invite page shows a "Join XenaLand" modal with:
    //   - A "Your Display Name" text input
    //   - "Cancel" and "Confirm" buttons
    // We need to fill the name and click Confirm.
    const nameInput = page.locator('input[placeholder="Enter your name"]');
    if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await nameInput.fill('ProfileBot');
      console.log('[PROFILE] Filled display name: ProfileBot');
      await page.waitForTimeout(500);
    } else {
      console.log('[PROFILE] WARNING: Name input not found — trying alternative selectors');
      // Try any visible text input in the modal
      const altInput = page.locator('input[type="text"]').first();
      if (await altInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await altInput.fill('ProfileBot');
        console.log('[PROFILE] Filled display name via alt selector');
      }
    }

    // Click "Confirm" button
    const confirmBtn = page.locator('button:has-text("Confirm")');
    if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirmBtn.click();
      console.log('[PROFILE] Clicked Confirm button');
    } else {
      // Fallback: try Join or Accept
      const joinBtn = page.locator('button:has-text("Join"), button:has-text("Accept")');
      if (await joinBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
        await joinBtn.first().click();
        console.log('[PROFILE] Clicked Join/Accept button (fallback)');
      } else {
        console.log('[PROFILE] ERROR: No Confirm/Join/Accept button found!');
      }
    }

    // Wait for the join + handshake + sync to complete (this is where the freeze happens)
    console.log(`[PROFILE] Waiting ${POST_JOIN_WAIT_MS / 1000}s for join + handshake + sync freeze...`);

    // Poll for freeze indicators
    const pollInterval = 5000;
    const maxPolls = POST_JOIN_WAIT_MS / pollInterval;
    for (let poll = 0; poll < maxPolls; poll++) {
      await page.waitForTimeout(pollInterval);
      const elapsed = Date.now() - joinStart;
      const longTaskCount = perfLogs.filter(l => l.includes('Long task')).length;
      const frameGapCount = perfLogs.filter(l => l.includes('Frame gap')).length;
      const handshakeCount = perfLogs.filter(l => l.includes('handshake(')).length;
      console.log(`[PROFILE] +${(elapsed / 1000).toFixed(0)}s: ${consoleLogs.length} logs, ${longTaskCount} long tasks, ${frameGapCount} frame gaps, ${handshakeCount} handshakes`);

      // If we see significant activity followed by idle, we can stop early
      if (poll > 6 && handshakeCount > 0 && longTaskCount > 0) {
        // Check if things have settled (no new perf logs in last poll)
        const recentPerf = perfLogs.filter(l => {
          // Just check if we got new perf logs recently
          return true;
        });
        if (recentPerf.length === perfLogs.length) {
          console.log('[PROFILE] Activity seems settled, stopping early');
          break;
        }
      }
    }

    // Stop profiler and save
    console.log(`\n[PROFILE] Total join profiling duration: ${Date.now() - joinStart}ms`);
    await saveProfileAndAnalyze(cdp, consoleLogs, perfLogs, 'join');
    
    // Don't close — fall through to reload profiling
    await cdp.send('Profiler.disable');
    await cdp.send('Performance.disable');

    // ─── Now do a RELOAD profile to capture the reload freeze ────────────
    console.log('\n[PROFILE] Phase 2: Profiling page RELOAD with workspace data...');
    await page.goto('about:blank', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const cdp2: CDPSession = await context.newCDPSession(page);
    await cdp2.send('Profiler.enable');
    await cdp2.send('Profiler.setSamplingInterval', { interval: 100 });
    await cdp2.send('Performance.enable');

    consoleLogs.length = 0;
    perfLogs.length = 0;

    await cdp2.send('Profiler.start');
    console.log('[PROFILE] Profiler started BEFORE reload navigation...');

    const reloadStart = Date.now();
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    console.log(`[PROFILE] domcontentloaded in ${Date.now() - reloadStart}ms`);

    // Wait for freeze
    console.log(`[PROFILE] Waiting ${POST_RELOAD_WAIT_MS / 1000}s for reload freeze...`);
    const reloadMaxPolls = POST_RELOAD_WAIT_MS / 5000;
    for (let poll = 0; poll < reloadMaxPolls; poll++) {
      await page.waitForTimeout(5000);
      const elapsed = Date.now() - reloadStart;
      const longTaskCount = perfLogs.filter(l => l.includes('Long task')).length;
      const frameGapCount = perfLogs.filter(l => l.includes('Frame gap')).length;
      console.log(`[PROFILE] +${(elapsed / 1000).toFixed(0)}s: ${consoleLogs.length} logs, ${longTaskCount} long tasks, ${frameGapCount} frame gaps`);
    }

    console.log(`\n[PROFILE] Total reload profiling duration: ${Date.now() - reloadStart}ms`);
    await saveProfileAndAnalyze(cdp2, consoleLogs, perfLogs, 'reload');

    await context.close();
    return;
  }

  // ─── WORKSPACE EXISTS: Profile reload ──────────────────────────────────
  console.log('[PROFILE] Workspace exists in IDB — profiling page reload...');

  await page.goto('about:blank', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  const cdp: CDPSession = await context.newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Performance.enable');

  consoleLogs.length = 0;
  perfLogs.length = 0;

  await cdp.send('Profiler.start');
  console.log('[PROFILE] Profiler started BEFORE page load. Navigating to app...');

  const loadStart = Date.now();
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  console.log(`[PROFILE] domcontentloaded in ${Date.now() - loadStart}ms`);

  // Wait for app init or freeze
  try {
    await page.waitForFunction(
      () => (window as any).__appInitialized === true,
      { timeout: POST_RELOAD_WAIT_MS },
    );
    console.log(`[PROFILE] App initialized in ${Date.now() - loadStart}ms`);
  } catch {
    console.log(
      `[PROFILE] App did NOT init within ${POST_RELOAD_WAIT_MS / 1000}s — THIS IS THE FREEZE`,
    );
  }

  // Extra wait for post-init peer connections + handshakes
  await page.waitForTimeout(30_000);
  console.log(`[PROFILE] Total profiling duration: ${Date.now() - loadStart}ms`);

  await saveProfileAndAnalyze(cdp, consoleLogs, perfLogs, 'reload');
  await context.close();
});


async function saveProfileAndAnalyze(
  cdp: CDPSession,
  consoleLogs: string[],
  perfLogs: string[],
  label: string,
): Promise<void> {
  console.log(`\n[PROFILE] Stopping profiler and saving (${label})...`);

  const result = await cdp.send('Profiler.stop');

  const postMetrics = await cdp.send('Performance.getMetrics');
  console.log(`[PROFILE] Post-${label} metrics:`);
  for (const m of (postMetrics as any).metrics) {
    if (
      ['JSHeapUsedSize', 'JSHeapTotalSize', 'ScriptDuration', 'TaskDuration', 'Nodes', 'Documents'].includes(m.name)
    ) {
      const val = m.name.includes('Size')
        ? `${(m.value / 1024 / 1024).toFixed(1)}MB`
        : m.value.toFixed(1);
      console.log(`  ${m.name}: ${val}`);
    }
  }

  const profile = (result as any).profile;
  const profileJson = JSON.stringify(profile, null, 2);

  const profileFile = PROFILE_FILE.replace('.cpuprofile', `-${label}.cpuprofile`);
  fs.writeFileSync(profileFile, profileJson);
  console.log(`[PROFILE] Saved CPU profile: ${profileFile} (${(profileJson.length / 1024 / 1024).toFixed(1)}MB)`);

  const perfLogFile = PERF_LOG_FILE.replace('.txt', `-${label}.txt`);
  const consoleLogFile = CONSOLE_LOG_FILE.replace('.txt', `-${label}.txt`);
  fs.writeFileSync(perfLogFile, perfLogs.join('\n'));
  fs.writeFileSync(consoleLogFile, consoleLogs.join('\n'));
  console.log(`[PROFILE] Saved ${perfLogs.length} perf logs, ${consoleLogs.length} console logs`);

  console.log(`\n[PROFILE] Analyzing ${label} profile...`);
  const analysis = analyzeProfile(profile as CPUProfile);
  console.log(analysis);

  const analysisFile = path.join(PROFILE_OUTPUT_DIR, `analysis-${label}.txt`);
  fs.writeFileSync(analysisFile, analysis);
  console.log(`\n[PROFILE] Full analysis saved to ${analysisFile}`);
}
