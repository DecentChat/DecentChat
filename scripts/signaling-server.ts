/**
 * Local PeerJS signaling server for development and self-hosting
 *
 * Usage: bun run scripts/signaling-server.ts
 * Default: http://localhost:9000/peerjs
 *
 * Features:
 * - PeerJS signaling (WebRTC connection brokering)
 * - Workspace peer registry (POST/GET /workspace/:id/peers)
 */

import { PeerServer } from 'peer';
import express from 'express';
import type { Server as HttpServer } from 'node:http';

const port = parseInt(process.env.SIGNAL_PORT || '9000');
const shutdownToken = process.env.SIGNAL_SHUTDOWN_TOKEN?.trim() || '';
const startedAt = new Date().toISOString();

// ── Workspace peer registry ──────────────────────────────────────────────
// Maps workspaceId → Set of online peer IDs
const workspacePeers = new Map<string, Set<string>>();
// Maps peerId → Set of workspaceIds (for cleanup on disconnect)
const peerWorkspaces = new Map<string, Set<string>>();
let httpServer: HttpServer | null = null;
let shutdownInFlight: Promise<void> | null = null;
let shuttingDown = false;

/**
 * Register a peer as online in a workspace.
 */
function registerPeer(peerId: string, workspaceId: string): void {
  if (!workspacePeers.has(workspaceId)) {
    workspacePeers.set(workspaceId, new Set());
  }
  workspacePeers.get(workspaceId)!.add(peerId);

  if (!peerWorkspaces.has(peerId)) {
    peerWorkspaces.set(peerId, new Set());
  }
  peerWorkspaces.get(peerId)!.add(workspaceId);
}

/**
 * Unregister a peer from all workspaces (on disconnect).
 */
function unregisterPeer(peerId: string): void {
  const workspaces = peerWorkspaces.get(peerId);
  if (workspaces) {
    Array.from(workspaces).forEach(wsId => {
      const peers = workspacePeers.get(wsId);
      if (peers) {
        peers.delete(peerId);
        if (peers.size === 0) workspacePeers.delete(wsId);
      }
    });
    peerWorkspaces.delete(peerId);
  }
}

/**
 * Get online peer IDs for a workspace.
 */
function getWorkspacePeers(workspaceId: string): string[] {
  const peers = workspacePeers.get(workspaceId);
  return peers ? Array.from(peers) : [];
}

function readToken(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

function isLoopback(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  return remoteAddress === '127.0.0.1'
    || remoteAddress === '::1'
    || remoteAddress === '::ffff:127.0.0.1';
}

async function closeServerWithTimeout(timeoutMs = 4000): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const timeout = setTimeout(() => {
      console.warn('[Signal] Graceful shutdown timed out; forcing process exit');
      finish();
    }, timeoutMs);
    timeout.unref();

    if (!httpServer) {
      clearTimeout(timeout);
      finish();
      return;
    }

    try {
      httpServer.close(() => {
        clearTimeout(timeout);
        finish();
      });
    } catch (error) {
      console.error('[Signal] Failed to close HTTP server cleanly:', error);
      clearTimeout(timeout);
      finish();
    }
  });
}

async function gracefulShutdown(reason: string): Promise<void> {
  if (shutdownInFlight) return shutdownInFlight;

  shuttingDown = true;
  console.log(`[Signal] Shutdown requested (${reason})`);

  shutdownInFlight = (async () => {
    await closeServerWithTimeout();
    console.log('[Signal] Shutdown complete');
    process.exit(0);
  })().catch((error) => {
    console.error('[Signal] Shutdown failed:', error);
    process.exit(1);
  });

  return shutdownInFlight;
}

// ── PeerJS signaling server ──────────────────────────────────────────────

const server = PeerServer({
  port,
  path: '/peerjs',
  allow_discovery: true,
}, (startedServer) => {
  httpServer = startedServer;
  console.log(`⚡ DecentChat signaling server running on http://localhost:${port}/peerjs`);
  console.log(`📡 Workspace discovery API: http://localhost:${port}/workspace/:id/peers`);
});

server.on('connection', (client) => {
  console.log(`[Signal] Peer connected: ${client.getId()}`);
});

server.on('disconnect', (client) => {
  const peerId = client.getId();
  console.log(`[Signal] Peer disconnected: ${peerId}`);
  unregisterPeer(peerId);
});

// ── REST endpoints for workspace discovery ───────────────────────────────
// The PeerServer instance is an Express app, so we can add routes directly.
// Ensure JSON body parsing is available for POST routes.
server.use(express.json());
server.use((_req: any, res: any, next: any) => {
  res.setHeader('x-decentchat-signal', '1');
  next();
});

server.get('/__decentchat/health', (_req: any, res: any) => {
  res.json({
    ok: true,
    service: 'decentchat-signaling',
    port,
    pid: process.pid,
    startedAt,
    shuttingDown,
  });
});

server.post('/__decentchat/shutdown', (req: any, res: any) => {
  const providedToken = readToken(req.headers?.['x-signal-shutdown-token']) || readToken(req.query?.token);
  if (shutdownToken) {
    if (providedToken !== shutdownToken) {
      return res.status(403).json({ ok: false, error: 'invalid shutdown token' });
    }
  } else if (!isLoopback(req.socket?.remoteAddress)) {
    return res.status(403).json({ ok: false, error: 'shutdown endpoint is localhost-only without token' });
  }

  void gracefulShutdown('api');
  res.json({ ok: true, shuttingDown: true });
});

/**
 * POST /workspace/:workspaceId/register
 * Body: { peerId: string }
 * Register a peer as online in a workspace.
 */
server.post('/workspace/:workspaceId/register', (req: any, res: any) => {
  const { workspaceId } = req.params;
  const { peerId } = req.body || {};

  if (!peerId || typeof peerId !== 'string') {
    return res.status(400).json({ error: 'peerId is required' });
  }

  registerPeer(peerId, workspaceId);
  console.log(`[Registry] ${peerId.slice(0, 8)} registered in workspace ${workspaceId.slice(0, 8)}`);
  res.json({ ok: true });
});

/**
 * GET /workspace/:workspaceId/peers
 * Returns list of online peer IDs for a workspace.
 */
server.get('/workspace/:workspaceId/peers', (req: any, res: any) => {
  const { workspaceId } = req.params;
  const peers = getWorkspacePeers(workspaceId);
  res.json({ peers });
});

process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
