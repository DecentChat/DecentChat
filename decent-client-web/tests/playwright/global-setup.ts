import type { FullConfig } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

const SIGNAL_PORT = Number(process.env.PW_SIGNAL_PORT || '9000');
const ENABLE_SIGNALING = process.env.PW_ENABLE_SIGNALING !== '0';
const SIGNAL_RUN_KEY = process.env.PW_SIGNAL_RUN_KEY || 'default';
const SIGNAL_RUN_KEY_SAFE = SIGNAL_RUN_KEY.replace(/[^a-zA-Z0-9_-]/g, '_');
const SIGNAL_SHUTDOWN_TOKEN = process.env.PW_SIGNAL_SHUTDOWN_TOKEN
  || `decentchat-playwright-${SIGNAL_PORT}-${SIGNAL_RUN_KEY_SAFE}`;
const STATE_FILE = path.join(os.tmpdir(), `decentchat-playwright-signal-${SIGNAL_PORT}-${SIGNAL_RUN_KEY_SAFE}.json`);
const _dirname = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(_dirname, '..', '..', '..');

type ExistingService = 'free' | 'decentchat' | 'occupied';

interface SignalState {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 1000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref();
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    if (error?.code === 'ESRCH') return false;
    return true;
  }
}

async function isTcpPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(700);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function isDecentSignalHealthOk(port: number): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`http://127.0.0.1:${port}/__decentchat/health`, undefined, 900);
    if (!response.ok) return false;
    const payload = await response.json() as { service?: string };
    return payload?.service === 'decentchat-signaling';
  } catch {
    return false;
  }
}

async function requestSignalShutdown(port: number, token: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(
      `http://127.0.0.1:${port}/__decentchat/shutdown?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: {
          'x-signal-shutdown-token': token,
        },
      },
      1500,
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function detectExistingService(port: number): Promise<ExistingService> {
  if (await isDecentSignalHealthOk(port)) return 'decentchat';
  if (await isTcpPortOpen(port)) return 'occupied';
  return 'free';
}

async function waitForPortClosed(port: number, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!(await isTcpPortOpen(port))) return;
    await sleep(150);
  }
  throw new Error(`[Playwright setup] Timed out waiting for signaling port ${port} to close.`);
}

async function waitForSignalHealth(port: number, timeoutMs: number, pid: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isDecentSignalHealthOk(port)) return;
    if (!isPidAlive(pid)) {
      throw new Error(`[Playwright setup] signaling-server process ${pid} exited before becoming healthy.`);
    }
    await sleep(150);
  }
  throw new Error(`[Playwright setup] signaling-server did not become healthy on :${port} within ${timeoutMs}ms.`);
}

async function startDetachedSignalingServer(port: number, token: string): Promise<number> {
  const child = spawn('bun', ['run', 'scripts/signaling-server.ts'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      SIGNAL_PORT: String(port),
      SIGNAL_SHUTDOWN_TOKEN: token,
    },
    detached: true,
    stdio: 'ignore',
  });

  const pid = child.pid;
  if (!pid) {
    throw new Error('[Playwright setup] signaling-server failed to start (missing child pid).');
  }

  child.unref();
  await waitForSignalHealth(port, 20000, pid);
  return pid;
}

async function removeStateFile(): Promise<void> {
  await fs.rm(STATE_FILE, { force: true }).catch(() => {});
}

async function writeState(state: SignalState): Promise<void> {
  await fs.writeFile(STATE_FILE, JSON.stringify(state), 'utf8');
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  if (!ENABLE_SIGNALING) {
    await removeStateFile();
    return;
  }

  process.env.PW_SIGNAL_PORT = String(SIGNAL_PORT);
  await removeStateFile();

  const existing = await detectExistingService(SIGNAL_PORT);
  if (existing === 'decentchat') {
    console.log(`[Playwright setup] Found DecentChat signaling server on :${SIGNAL_PORT}; attempting ownership-safe restart.`);
    const stopped = await requestSignalShutdown(SIGNAL_PORT, SIGNAL_SHUTDOWN_TOKEN);
    if (!stopped) {
      throw new Error(
        `[Playwright setup] Existing signaling server on :${SIGNAL_PORT} refused shutdown for this run key (${SIGNAL_RUN_KEY_SAFE}). ` +
        'Another Playwright run is likely active on the same signaling port. ' +
        'Set PW_SIGNAL_PORT to a unique port (or wait for the other run to finish) and retry.',
      );
    }
    await waitForPortClosed(SIGNAL_PORT, 5000);
  } else if (existing === 'occupied') {
    throw new Error(
      `[Playwright setup] Port ${SIGNAL_PORT} is occupied by a non-DecentChat service. ` +
      'Stop that process or set PW_SIGNAL_PORT to an unused port.',
    );
  }

  const pid = await startDetachedSignalingServer(SIGNAL_PORT, SIGNAL_SHUTDOWN_TOKEN);
  await writeState({
    pid,
    port: SIGNAL_PORT,
    token: SIGNAL_SHUTDOWN_TOKEN,
    startedAt: new Date().toISOString(),
  });
  console.log(`[Playwright setup] Started fresh DecentChat signaling server on :${SIGNAL_PORT} (pid ${pid}).`);
}
