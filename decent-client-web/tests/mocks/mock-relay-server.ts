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

import { WebSocketServer, WebSocket } from 'ws';

export interface RelayServer {
  port: number;
  close: () => void;
}

export function startRelayServer(port: number = 0): Promise<RelayServer> {
  return new Promise((resolve, reject) => {
    const peers = new Map<string, WebSocket>();

    const wss = new WebSocketServer({ port }, () => {
      const address = wss.address();
      const actualPort = typeof address === 'object' ? address.port : port;
      console.log(`[MockRelay] Listening on port ${actualPort}`);

      resolve({
        port: actualPort,
        close: () => {
          for (const ws of peers.values()) {
            ws.close();
          }
          wss.close();
        },
      });
    });

    wss.on('error', reject);

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
