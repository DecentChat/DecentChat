/**
 * Signaling Server Test Helper
 *
 * Starts/stops a PeerJS signaling server on a random available port
 * for E2E integration tests. Each test suite gets its own isolated server.
 */

import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import { createServer } from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const _dirname = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(_dirname, '..', '..', '..');

export interface SignalingServer {
  port: number;
  process: ChildProcess;
  url: string;
}

/**
 * Find a random available port by binding to port 0 and reading the assignment.
 */
async function getRandomPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Could not get port')));
      }
    });
    server.on('error', reject);
  });
}

/**
 * Start a PeerJS signaling server on a random available port.
 * Returns the port and process handle for cleanup.
 */
export async function startSignalingServer(): Promise<SignalingServer> {
  const port = await getRandomPort();

  return new Promise((resolve, reject) => {
    const proc = spawn('bun', ['run', 'scripts/signaling-server.ts'], {
      cwd: ROOT_DIR,
      env: { ...process.env, SIGNAL_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Signaling server did not start within 10s on port ${port}`));
    }, 10000);

    proc.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString();
      if (msg.includes('signaling server running')) {
        clearTimeout(timeout);
        resolve({
          port,
          process: proc,
          url: `http://localhost:${port}/peerjs`,
        });
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[signal:${port}:stderr]`, msg);
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`Signaling server exited with code ${code}`));
      }
    });
  });
}

/**
 * Stop a signaling server cleanly.
 */
export async function stopSignalingServer(server: SignalingServer): Promise<void> {
  return new Promise((resolve) => {
    if (!server.process.pid) {
      resolve();
      return;
    }

    server.process.on('exit', () => resolve());
    server.process.kill('SIGTERM');

    // Force kill after 3s if graceful shutdown hangs
    setTimeout(() => {
      try { server.process.kill('SIGKILL'); } catch {}
      resolve();
    }, 3000);
  });
}

/**
 * Poll the signaling server HTTP endpoint until it responds.
 */
export async function waitForSignalingServer(
  portOrUrl: number | string,
  timeoutMs = 10000,
): Promise<void> {
  const url = typeof portOrUrl === 'number'
    ? `http://localhost:${portOrUrl}/peerjs`
    : portOrUrl;

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Signaling server not reachable at ${url} after ${timeoutMs}ms`);
}
