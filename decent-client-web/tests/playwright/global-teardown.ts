import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConnection } from 'node:net';

const SIGNAL_PORT = Number(process.env.PW_SIGNAL_PORT || '9000');
const STATE_FILE = path.join(os.tmpdir(), `decentchat-playwright-signal-${SIGNAL_PORT}.json`);

interface SignalState {
  pid: number;
  port: number;
  token: string;
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

async function waitForPortClosed(port: number, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!(await isTcpPortOpen(port))) return true;
    await sleep(150);
  }
  return false;
}

async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!isPidAlive(pid)) return true;
    await sleep(150);
  }
  return false;
}

function killPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error: any) {
    if (error?.code !== 'ESRCH') {
      console.warn(`[Playwright teardown] Failed to send ${signal} to signaling pid ${pid}:`, error);
    }
  }
}

async function readState(): Promise<SignalState | null> {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<SignalState>;
    if (typeof parsed.pid !== 'number' || typeof parsed.port !== 'number' || typeof parsed.token !== 'string') {
      return null;
    }
    return parsed as SignalState;
  } catch {
    return null;
  }
}

async function removeStateFile(): Promise<void> {
  await fs.rm(STATE_FILE, { force: true }).catch(() => {});
}

export default async function globalTeardown(): Promise<void> {
  const state = await readState();
  if (!state) {
    await removeStateFile();
    return;
  }

  const shutdownAccepted = await requestSignalShutdown(state.port, state.token);
  if (shutdownAccepted) {
    const closed = await waitForPortClosed(state.port, 5000);
    if (closed) {
      await removeStateFile();
      return;
    }
  }

  if (isPidAlive(state.pid)) {
    killPid(state.pid, 'SIGTERM');
    const exited = await waitForPidExit(state.pid, 3000);
    if (!exited) {
      killPid(state.pid, 'SIGKILL');
      await waitForPidExit(state.pid, 1500);
    }
  }

  await removeStateFile();
}
