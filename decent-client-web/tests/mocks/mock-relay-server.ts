/**
 * Mock Relay Server — Tiny WebSocket server that relays messages between
 * MockTransport instances running in different Playwright browser contexts.
 *
 * Protocol:
 *   __register { peerId }       → registers this WS connection as a peer
 *   __connect { targetPeerId }  → request connection to another peer
 *   __connect_accept { peerId } → accept an incoming connection
 *   __disconnect { targetPeerId } → disconnect from a peer
 *   __data { targetPeerId, data } → send data to a connected peer
 *
 * Relay responses:
 *   __registered {}               → registration confirmed
 *   __peer_connected { peerId }   → connection established
 *   __connect_request { peerId }  → incoming connection request
 *   __peer_disconnected { peerId } → peer disconnected
 *   __data { from, data }         → incoming data from peer
 *   __error { message }           → error
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

export interface RelayServer {
  port: number;
  close: () => void;
}

export function startRelayServer(port: number = 0): Promise<RelayServer> {
  return new Promise((resolve, reject) => {
    const peers = new Map<string, WebSocket>();
    const workspacePeers = new Map<string, Set<string>>();
    const peerWorkspaces = new Map<string, Set<string>>();

    const setCorsHeaders = (res: ServerResponse) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    };

    const registerWorkspacePeer = (workspaceId: string, peerId: string) => {
      let members = workspacePeers.get(workspaceId);
      if (!members) {
        members = new Set<string>();
        workspacePeers.set(workspaceId, members);
      }
      members.add(peerId);

      let spaces = peerWorkspaces.get(peerId);
      if (!spaces) {
        spaces = new Set<string>();
        peerWorkspaces.set(peerId, spaces);
      }
      spaces.add(workspaceId);
    };

    const cleanupPeerWorkspaceMembership = (peerId: string) => {
      const spaces = peerWorkspaces.get(peerId);
      if (!spaces) return;
      for (const wsId of spaces) {
        const members = workspacePeers.get(wsId);
        if (!members) continue;
        members.delete(peerId);
        if (members.size === 0) workspacePeers.delete(wsId);
      }
      peerWorkspaces.delete(peerId);
    };

    const parseJsonBody = async (req: IncomingMessage): Promise<any> => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      if (chunks.length === 0) return {};
      const raw = Buffer.concat(chunks).toString('utf8');
      return raw ? JSON.parse(raw) : {};
    };

    const httpServer = createServer(async (req, res) => {
      setCorsHeaders(res);
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      const url = new URL(req.url || '/', 'http://localhost');
      const match = url.pathname.match(/^\/workspace\/([^/]+)\/(register|peers)$/);
      if (!match) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }

      const workspaceId = decodeURIComponent(match[1]);
      const action = match[2];

      if (action === 'register') {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const body = await parseJsonBody(req);
          const peerId = typeof body?.peerId === 'string' ? body.peerId : '';
          if (!peerId) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'missing_peer_id' }));
            return;
          }
          registerWorkspacePeer(workspaceId, peerId);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
          return;
        } catch {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'invalid_json' }));
          return;
        }
      }

      if (action === 'peers') {
        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const members = workspacePeers.get(workspaceId) ?? new Set<string>();
        const online = Array.from(members).filter((peerId) => {
          const ws = peers.get(peerId);
          return !!ws && ws.readyState === WebSocket.OPEN;
        });
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ peers: online }));
        return;
      }
    });

    const wss = new WebSocketServer({ server: httpServer });
    wss.on('error', reject);

    httpServer.listen(port, () => {
      const address = httpServer.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      console.log(`[MockRelay] Listening on port ${actualPort}`);

      resolve({
        port: actualPort,
        close: () => {
          for (const ws of peers.values()) {
            ws.close();
          }
          wss.close();
          httpServer.close();
        },
      });
    });

    httpServer.on('error', reject);

    wss.on('connection', (ws) => {
      let myPeerId: string | null = null;

      ws.on('message', (raw) => {
        let msg: any;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }

        switch (msg.type) {
          case '__register': {
            myPeerId = msg.peerId;
            const existing = peers.get(myPeerId);
            if (existing && existing !== ws && existing.readyState === WebSocket.OPEN) {
              existing.close();
            }
            peers.set(myPeerId, ws);
            ws.send(JSON.stringify({ type: '__registered' }));
            break;
          }

          case '__connect': {
            const target = peers.get(msg.targetPeerId);
            if (!target || target.readyState !== WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: '__error',
                message: `Peer ${msg.targetPeerId} not found`,
              }));
              return;
            }
            // Forward connect request to target
            target.send(JSON.stringify({
              type: '__connect_request',
              peerId: myPeerId,
            }));
            break;
          }

          case '__connect_accept': {
            // The target accepted our connection — notify the initiator
            const initiator = peers.get(msg.peerId);
            if (initiator && initiator.readyState === WebSocket.OPEN) {
              initiator.send(JSON.stringify({
                type: '__peer_connected',
                peerId: myPeerId,
              }));
            }
            break;
          }

          case '__disconnect': {
            const target = peers.get(msg.targetPeerId);
            if (target && target.readyState === WebSocket.OPEN) {
              target.send(JSON.stringify({
                type: '__peer_disconnected',
                peerId: myPeerId,
              }));
            }
            break;
          }

          case '__data': {
            const target = peers.get(msg.targetPeerId);
            if (target && target.readyState === WebSocket.OPEN) {
              target.send(JSON.stringify({
                type: '__data',
                from: myPeerId,
                data: msg.data,
              }));
            }
            break;
          }
        }
      });

      ws.on('close', () => {
        if (myPeerId) {
          peers.delete(myPeerId);
          cleanupPeerWorkspaceMembership(myPeerId);
          // Notify all peers about disconnection
          for (const [peerId, peerWs] of peers) {
            if (peerWs.readyState === WebSocket.OPEN) {
              peerWs.send(JSON.stringify({
                type: '__peer_disconnected',
                peerId: myPeerId,
              }));
            }
          }
        }
      });
    });
  });
}

// Allow running standalone for debugging
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.argv[2] || '9876', 10);
  startRelayServer(port).then(({ port }) => {
    console.log(`Mock relay server running on ws://localhost:${port}`);
  });
}
