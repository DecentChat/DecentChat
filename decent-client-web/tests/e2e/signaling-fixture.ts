/**
 * Signaling Server Fixture — manages PeerJS signaling server lifecycle for E2E tests
 *
 * Starts a real PeerJS signaling server on a test port before tests run,
 * and tears it down after. Provides connection status tracking for assertions.
 */

import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const SIGNAL_PORT = 9000;
const _dirname = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(_dirname, '..', '..', '..');

let signalingProcess: ChildProcess | null = null;

/**
 * Start the signaling server for tests.
 * Returns when the server is ready to accept connections.
 */
export async function startSignalingServer(): Promise<void> {
  if (signalingProcess) return; // Already running

  return new Promise((resolve, reject) => {
    const proc = spawn('bun', ['run', 'scripts/signaling-server.ts'], {
      cwd: ROOT_DIR,
      env: { ...process.env, SIGNAL_PORT: String(SIGNAL_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    signalingProcess = proc;

    const timeout = setTimeout(() => {
      reject(new Error('Signaling server did not start within 10s'));
    }, 10000);

    proc.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString();
      if (msg.includes('signaling server running')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      // PeerJS logs warnings to stderr — not necessarily errors
      const msg = data.toString().trim();
      if (msg) console.log('[signal:stderr]', msg);
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      signalingProcess = null;
      reject(err);
    });

    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        signalingProcess = null;
        reject(new Error(`Signaling server exited with code ${code}`));
      }
    });
  });
}

/**
 * Stop the signaling server.
 */
export async function stopSignalingServer(): Promise<void> {
  if (!signalingProcess) return;

  return new Promise((resolve) => {
    const proc = signalingProcess!;
    signalingProcess = null;

    proc.on('exit', () => resolve());

    // Try graceful shutdown first
    proc.kill('SIGTERM');

    // Force kill after 3s
    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      resolve();
    }, 3000);
  });
}

/**
 * Check if the signaling server is reachable via HTTP.
 */
export async function isSignalingServerReady(): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${SIGNAL_PORT}/peerjs`);
    return response.ok || response.status === 404; // PeerJS returns 404 on base path but server is up
  } catch {
    return false;
  }
}

/**
 * Wait for signaling server to be reachable (polls HTTP endpoint).
 */
export async function waitForSignalingServer(timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isSignalingServerReady()) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Signaling server not reachable after ${timeoutMs}ms`);
}
