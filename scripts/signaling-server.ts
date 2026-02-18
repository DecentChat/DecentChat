/**
 * Local PeerJS signaling server for development and self-hosting
 * 
 * Usage: bun run scripts/signaling-server.ts
 * Default: http://localhost:9000/peerjs
 */

import { PeerServer } from 'peer';

const port = parseInt(process.env.SIGNAL_PORT || '9000');

const server = PeerServer({
  port,
  path: '/peerjs',
  allow_discovery: true,
});

server.on('connection', (client) => {
  console.log(`[Signal] Peer connected: ${client.getId()}`);
});

server.on('disconnect', (client) => {
  console.log(`[Signal] Peer disconnected: ${client.getId()}`);
});

console.log(`⚡ DecentChat signaling server running on http://localhost:${port}/peerjs`);
