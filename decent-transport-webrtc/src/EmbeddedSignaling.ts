/**
 * EmbeddedSignaling — Minimal signaling server that runs inside the app
 * 
 * Every DecentChat instance can BE a signaling server.
 * When Alice creates a workspace, her instance starts a tiny WebSocket
 * server that helps peers find each other. Once WebRTC is established,
 * the signaling server is no longer needed.
 * 
 * This eliminates dependency on external signaling infrastructure.
 * 
 * Usage:
 *   const server = new EmbeddedSignaling({ port: 9000 });
 *   await server.start();
 *   // Share: decent://YOUR_IP:9000/INVITE_CODE
 *   // Other peers connect to your signaling server
 *   await server.stop();
 * 
 * Note: This runs in Node.js/Bun environments (server-side).
 * Browser clients connect TO this server, they don't run it.
 * For browser-only setups, use public signaling servers.
 */

export interface EmbeddedSignalingConfig {
  /** Port to listen on (default: 9000) */
  port?: number;
  /** Host to bind to (default: 0.0.0.0 = all interfaces) */
  host?: string;
  /** Path prefix (default: /peerjs) */
  path?: string;
  /** Max concurrent connections (default: 50) */
  maxConnections?: number;
  /** Enable verbose logging */
  debug?: boolean;
}

interface RegisteredPeer {
  peerId: string;
  ws: any; // WebSocket instance
  registeredAt: number;
}

/**
 * Minimal PeerJS-compatible signaling server.
 * 
 * Handles:
 * - Peer registration (OPEN message)
 * - Offer/answer/candidate relay between peers
 * - Peer discovery (list of connected peers)
 * - Heartbeat/keepalive
 */
export class EmbeddedSignaling {
  private config: Required<EmbeddedSignalingConfig>;
  private server: any = null; // HTTP server
  private wss: any = null; // WebSocket server
  private peers = new Map<string, RegisteredPeer>();
  private running = false;

  constructor(config: EmbeddedSignalingConfig = {}) {
    this.config = {
      port: config.port ?? 9000,
      host: config.host ?? '0.0.0.0',
      path: config.path ?? '/peerjs',
      maxConnections: config.maxConnections ?? 50,
      debug: config.debug ?? false,
    };
  }

  /**
   * Start the signaling server
   */
  async start(): Promise<{ host: string; port: number; url: string }> {
    if (this.running) throw new Error('Signaling server already running');

    // Dynamic import — only needed in Node/Bun environments
    const http = await import('http');

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req: any, res: any) => {
        // Health check endpoint
        if (req.url === `${this.config.path}/` || req.url === this.config.path) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            name: 'DecentChat Signaling',
            peers: this.peers.size,
            uptime: process.uptime(),
          }));
          return;
        }

        // PeerJS expects GET /peerjs/id for generating IDs
        if (req.url?.startsWith(`${this.config.path}/id`)) {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(this.generatePeerId());
          return;
        }

        // PeerJS peers list
        if (req.url?.startsWith(`${this.config.path}/peers`)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(Array.from(this.peers.keys())));
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      });

      // WebSocket upgrade handling
      this.server.on('upgrade', (request: any, socket: any, head: any) => {
        // Extract peer ID from URL: /peerjs?key=peerjs&id=PEER_ID&token=TOKEN
        const url = new URL(request.url, `http://${request.headers.host}`);
        const peerId = url.searchParams.get('id');
        const key = url.searchParams.get('key') || 'peerjs';

        if (!peerId) {
          socket.destroy();
          return;
        }

        if (this.peers.size >= this.config.maxConnections) {
          socket.destroy();
          return;
        }

        // Accept WebSocket upgrade manually
        this.handleWebSocketUpgrade(request, socket, head, peerId);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        this.running = true;
        const url = `ws://${this.config.host === '0.0.0.0' ? 'localhost' : this.config.host}:${this.config.port}${this.config.path}`;
        if (this.config.debug) {
          console.log(`[DecentChat Signaling] Running on ${url} (${this.peers.size} peers)`);
        }
        resolve({ host: this.config.host, port: this.config.port, url });
      });

      this.server.on('error', (err: Error) => {
        reject(err);
      });
    });
  }

  private handleWebSocketUpgrade(request: any, socket: any, head: any, peerId: string): void {
    // Minimal WebSocket handshake (RFC 6455)
    const crypto = globalThis.crypto || require('crypto');
    const key = request.headers['sec-websocket-key'];
    const GUID = '258EAFA5-E914-47DA-95CA-5AB5DC11D65A';

    // Use Node.js crypto for the SHA-1 hash needed by WebSocket handshake
    let acceptKey: string;
    try {
      const nodeCrypto = require('crypto');
      acceptKey = nodeCrypto.createHash('sha1').update(key + GUID).digest('base64');
    } catch {
      socket.destroy();
      return;
    }

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
      '\r\n'
    );

    // Create a minimal WebSocket wrapper
    const ws = this.createWSWrapper(socket);

    // Register peer
    this.peers.set(peerId, { peerId, ws, registeredAt: Date.now() });

    if (this.config.debug) {
      console.log(`[Signaling] Peer registered: ${peerId} (${this.peers.size} total)`);
    }

    // Send OPEN message (PeerJS protocol)
    ws.send(JSON.stringify({ type: 'OPEN' }));

    ws.on('message', (data: string) => {
      try {
        const msg = JSON.parse(data);
        this.handlePeerMessage(peerId, msg);
      } catch (e) {
        if (this.config.debug) console.error('[Signaling] Invalid message from', peerId);
      }
    });

    ws.on('close', () => {
      this.peers.delete(peerId);
      if (this.config.debug) {
        console.log(`[Signaling] Peer disconnected: ${peerId} (${this.peers.size} remaining)`);
      }
    });
  }

  /**
   * Relay signaling messages between peers (offer, answer, candidate)
   */
  private handlePeerMessage(fromPeerId: string, msg: any): void {
    // PeerJS message format: { type: 'OFFER'|'ANSWER'|'CANDIDATE'|..., dst: targetPeerId, payload: ... }
    const { type, dst, payload } = msg;

    if (!dst) return;

    const targetPeer = this.peers.get(dst);
    if (!targetPeer) {
      // Target peer not connected — send error back
      const sender = this.peers.get(fromPeerId);
      if (sender) {
        sender.ws.send(JSON.stringify({
          type: 'ERROR',
          payload: { msg: `Peer ${dst} not found` },
        }));
      }
      return;
    }

    // Relay the message to the target peer
    targetPeer.ws.send(JSON.stringify({
      type,
      src: fromPeerId,
      dst,
      payload,
    }));

    if (this.config.debug) {
      console.log(`[Signaling] ${type}: ${fromPeerId} → ${dst}`);
    }
  }

  /**
   * Create a minimal WebSocket wrapper around a raw socket
   */
  private createWSWrapper(socket: any): { send: (data: string) => void; on: (event: string, cb: Function) => void } {
    const listeners: Record<string, Function[]> = {};

    const wrapper = {
      send(data: string) {
        const payload = Buffer.from(data);
        const frame = createWSFrame(payload);
        socket.write(frame);
      },
      on(event: string, cb: Function) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
      },
    };

    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      // Parse WebSocket frames
      while (buffer.length >= 2) {
        const result = parseWSFrame(buffer);
        if (!result) break;
        const { payload, bytesConsumed, opcode } = result;
        buffer = buffer.slice(bytesConsumed);

        if (opcode === 0x8) {
          // Close frame
          listeners['close']?.forEach(cb => cb());
          socket.end();
          return;
        }

        if (opcode === 0x9) {
          // Ping → Pong
          const pong = createWSFrame(payload, 0xA);
          socket.write(pong);
          continue;
        }

        if (opcode === 0x1 || opcode === 0x2) {
          // Text or binary
          listeners['message']?.forEach(cb => cb(payload.toString('utf8')));
        }
      }
    });

    socket.on('close', () => {
      listeners['close']?.forEach(cb => cb());
    });

    socket.on('error', () => {
      listeners['close']?.forEach(cb => cb());
    });

    return wrapper;
  }

  /**
   * Stop the signaling server
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    // Close all peer connections
    for (const peer of this.peers.values()) {
      try { peer.ws.send(JSON.stringify({ type: 'CLOSE' })); } catch {}
    }
    this.peers.clear();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.running = false;
          resolve();
        });
      } else {
        this.running = false;
        resolve();
      }
    });
  }

  /** Check if server is running */
  isRunning(): boolean {
    return this.running;
  }

  /** Get count of connected peers */
  getPeerCount(): number {
    return this.peers.size;
  }

  /** Get list of connected peer IDs */
  getConnectedPeers(): string[] {
    return Array.from(this.peers.keys());
  }

  /** Get server info */
  getInfo(): { host: string; port: number; peers: number; running: boolean } {
    return {
      host: this.config.host,
      port: this.config.port,
      peers: this.peers.size,
      running: this.running,
    };
  }

  private generatePeerId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 16; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  }
}

// ── WebSocket frame helpers ─────────────────────────────────────────────────

function createWSFrame(payload: Buffer, opcode: number = 0x1): Buffer {
  const len = payload.length;
  let header: Buffer;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode; // FIN + opcode
    header[1] = len; // No mask (server → client)
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}

function parseWSFrame(buffer: Buffer): { payload: Buffer; bytesConsumed: number; opcode: number } | null {
  if (buffer.length < 2) return null;

  const opcode = buffer[0] & 0x0F;
  const masked = (buffer[1] & 0x80) !== 0;
  let payloadLen = buffer[1] & 0x7F;
  let offset = 2;

  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    payloadLen = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  let maskKey: Buffer | null = null;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    maskKey = buffer.slice(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + payloadLen) return null;

  let payload = buffer.slice(offset, offset + payloadLen);

  if (maskKey) {
    payload = Buffer.from(payload); // Copy before unmask
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= maskKey[i % 4];
    }
  }

  return { payload, bytesConsumed: offset + payloadLen, opcode };
}
