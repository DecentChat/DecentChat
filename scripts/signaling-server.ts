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

const port = parseInt(process.env.SIGNAL_PORT || '9000');

// ── Workspace peer registry ──────────────────────────────────────────────
// Maps workspaceId → Set of online peer IDs
const workspacePeers = new Map<string, Set<string>>();
// Maps peerId → Set of workspaceIds (for cleanup on disconnect)
const peerWorkspaces = new Map<string, Set<string>>();

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

// ── PeerJS signaling server ──────────────────────────────────────────────

const server = PeerServer({
  port,
  path: '/peerjs',
  allow_discovery: true,
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

console.log(`⚡ DecentChat signaling server running on http://localhost:${port}/peerjs`);
console.log(`📡 Workspace discovery API: http://localhost:${port}/workspace/:id/peers`);
