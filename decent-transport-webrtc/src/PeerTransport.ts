/**
 * PeerTransport - WebRTC/PeerJS implementation of the mesh Transport interface
 *
 * Supports MULTIPLE signaling servers simultaneously for federation.
 * Alice on signal.alice.com and Bob on signal.bob.com can chat if they
 * share at least one signaling server (like email MX records).
 *
 * Deduplicates peer connections — if the same peer is discovered via
 * multiple signaling servers, only one connection is kept.
 */

import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import type { Transport } from 'decent-protocol';

export interface SignalingServer {
  /** Server URL (e.g. "https://signal.example.com/peerjs") */
  url: string;
  /** Optional label for logging */
  label?: string;
}

export interface PeerTransportConfig {
  /** Single signaling server URL (legacy, use signalingServers for multi) */
  signalingServer?: string;
  /** Multiple signaling servers for federation */
  signalingServers?: (string | SignalingServer)[];
  /** ICE/STUN/TURN servers for NAT traversal */
  iceServers?: RTCIceServer[];
  /** PeerJS debug level: 0 = none, 1 = warnings, 2 = all (default: 1) */
  debug?: 0 | 1 | 2 | 3;
  /** Max connection retries per server (default: 3) */
  maxRetries?: number;
  /** Retry delay in ms (default: 2000, doubles each retry) */
  retryDelayMs?: number;
}

/**
 * Default ICE servers including free STUN + public TURN relays
 * For production, use your own TURN server (e.g. coturn)
 */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  // Google STUN servers (public, widely used)
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  
  // Cloudflare STUN (fast, reliable)
  { urls: 'stun:stun.cloudflare.com:3478' },
  
  // DecentChat TURN server (self-hosted on decentchat.app)
  // TODO: Replace TURN_PASSWORD with actual password from Step 1
  {
    urls: 'turn:37.9.175.197:3478',
    username: 'decentchat',
    credential: 'TURN_PASSWORD', // Replace with password from docker setup
  },
  {
    urls: 'turn:37.9.175.197:3478?transport=tcp',
    username: 'decentchat',
    credential: 'TURN_PASSWORD',
  },
  {
    urls: 'turns:37.9.175.197:5349?transport=tcp',
    username: 'decentchat',
    credential: 'TURN_PASSWORD',
  },
  
  // Fallback: Metered TURN (free tier, backup only)
  {
    urls: 'turn:a.relay.metered.ca:80',
    username: 'e8dd65b92af91ac9c6b97e4d',
    credential: '1rW/JmqjQBWuHEVi',
  },
];

interface ActiveConnection {
  conn: DataConnection;
  peerId: string;
  status: 'connecting' | 'connected' | 'failed';
  /** Which signaling server this connection came through */
  signalingServer: string;
}

interface SignalingInstance {
  peer: Peer;
  url: string;
  label: string;
  connected: boolean;
}

export class PeerTransport implements Transport {
  /** All active signaling server connections */
  private signalingInstances: SignalingInstance[] = [];
  /** Deduplicated peer connections (one per remote peer) */
  private connections = new Map<string, ActiveConnection>();
  /** Peers we're currently attempting to connect to (prevent duplicate attempts) */
  private connectingTo = new Set<string>();
  private config: PeerTransportConfig;
  private myPeerId: string | null = null;

  // ── Transport callbacks ───────────────────────────────────────────────────
  public onConnect: ((peerId: string) => void) | null = null;
  public onDisconnect: ((peerId: string) => void) | null = null;
  public onMessage: ((peerId: string, data: unknown) => void) | null = null;
  public onError: ((error: Error) => void) | null = null;

  constructor(config: PeerTransportConfig = {}) {
    this.config = config;
  }

  // ── Transport interface ───────────────────────────────────────────────────

  /**
   * Initialize transport: connect to all signaling servers simultaneously.
   * The same peer ID is registered on every server.
   * Resolves once at least ONE server connects successfully.
   */
  async init(peerId?: string): Promise<string> {
    const servers = this._resolveSignalingServers();

    if (servers.length === 0) {
      // No servers configured — single default connection (PeerJS cloud or localhost)
      return this._initSingleServer(peerId);
    }

    // Connect to all servers in parallel
    const results = await Promise.allSettled(
      servers.map(server => this._initServer(server, peerId))
    );

    // Need at least one success
    const firstSuccess = results.find(r => r.status === 'fulfilled');
    if (!firstSuccess) {
      const errors = results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map(r => r.reason?.message || 'Unknown error');
      throw new Error(`Failed to connect to any signaling server: ${errors.join(', ')}`);
    }

    const assignedId = (firstSuccess as PromiseFulfilledResult<string>).value;
    this.myPeerId = assignedId;

    const connected = results.filter(r => r.status === 'fulfilled').length;
    const total = servers.length;
    console.log(`[DecentChat] Connected to ${connected}/${total} signaling servers as ${assignedId}`);

    return assignedId;
  }

  /**
   * Connect to a remote peer.
   * Tries all signaling servers until one succeeds.
   */
  async connect(peerId: string): Promise<void> {
    if (this.signalingInstances.length === 0) {
      throw new Error('PeerTransport not initialised — call init() first');
    }
    if (this.connections.has(peerId)) return; // Already connected
    if (this.connectingTo.has(peerId)) return; // Already attempting

    this.connectingTo.add(peerId);
    const maxRetries = this.config.maxRetries ?? 3;
    const baseDelay = this.config.retryDelayMs ?? 2000;

    try {
      // Try each signaling server
      for (const instance of this.signalingInstances) {
        if (!instance.connected) continue;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            await this._attemptConnect(instance, peerId);
            return; // Success
          } catch {
            if (attempt < maxRetries) {
              const delay = baseDelay * Math.pow(2, attempt);
              await new Promise(r => setTimeout(r, delay));
              this.connections.delete(peerId);
            }
          }
        }
      }

      throw new Error(`Failed to connect to ${peerId} via any signaling server`);
    } finally {
      this.connectingTo.delete(peerId);
    }
  }

  disconnect(peerId: string): void {
    const active = this.connections.get(peerId);
    if (active) {
      active.conn.close();
      this.connections.delete(peerId);
      this.onDisconnect?.(peerId);
    }
  }

  send(peerId: string, data: unknown): boolean {
    const active = this.connections.get(peerId);
    if (!active || active.status !== 'connected') return false;
    try {
      active.conn.send(data as any);
      return true;
    } catch {
      return false;
    }
  }

  getConnectedPeers(): string[] {
    return Array.from(this.connections.entries())
      .filter(([, c]) => c.status === 'connected')
      .map(([id]) => id);
  }

  destroy(): void {
    this.connections.forEach(({ conn }) => conn.close());
    this.connections.clear();
    this.connectingTo.clear();
    for (const instance of this.signalingInstances) {
      instance.peer.destroy();
    }
    this.signalingInstances = [];
    this.myPeerId = null;
  }

  // ── Public helpers ────────────────────────────────────────────────────────

  getMyPeerId(): string | null {
    return this.myPeerId;
  }

  /** Get status of all signaling servers */
  getSignalingStatus(): { url: string; label: string; connected: boolean }[] {
    return this.signalingInstances.map(i => ({
      url: i.url,
      label: i.label,
      connected: i.connected,
    }));
  }

  /** Number of connected signaling servers */
  getConnectedServerCount(): number {
    return this.signalingInstances.filter(i => i.connected).length;
  }

  /**
   * DEP-002: Add a signaling server discovered via PEX.
   * Connects to the new server and registers the same peer ID.
   * Returns true if connection succeeds, false otherwise.
   */
  async addSignalingServer(serverUrl: string, label?: string): Promise<boolean> {
    if (!this.myPeerId) {
      console.warn('[PeerTransport] Cannot add signaling server before init()');
      return false;
    }

    // Check if already connected to this server
    if (this.signalingInstances.some(i => i.url === serverUrl)) {
      console.log(`[PeerTransport] Already connected to ${serverUrl}`);
      return true;
    }

    try {
      console.log(`[PEX] Connecting to discovered server: ${serverUrl}`);
      await this._initServer({ url: serverUrl, label: label || serverUrl }, this.myPeerId);
      console.log(`[PEX] Successfully connected to ${serverUrl}`);
      return true;
    } catch (err) {
      console.warn(`[PEX] Failed to connect to ${serverUrl}:`, (err as Error).message);
      return false;
    }
  }

  // ── Internal: signaling server management ─────────────────────────────────

  private _resolveSignalingServers(): { url: string; label: string }[] {
    const servers: { url: string; label: string }[] = [];

    // Multi-server config takes precedence
    if (this.config.signalingServers && this.config.signalingServers.length > 0) {
      for (const s of this.config.signalingServers) {
        if (typeof s === 'string') {
          servers.push({ url: s, label: s });
        } else {
          servers.push({ url: s.url, label: s.label || s.url });
        }
      }
      return servers;
    }

    // Legacy single server
    if (this.config.signalingServer) {
      servers.push({ url: this.config.signalingServer, label: this.config.signalingServer });
    }

    return servers;
  }

  private _initSingleServer(peerId?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const configuredPort = Number(
        (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SIGNAL_PORT) || 9000,
      );
      const peerConfig: Record<string, unknown> = {
        debug: this.config.debug ?? 1,
      };

      // Dev: try local PeerJS server
      if (
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
      ) {
        peerConfig.host = 'localhost';
        peerConfig.port = configuredPort;
        peerConfig.path = '/peerjs';
        peerConfig.secure = false;
      }

      // In test/dev on localhost, skip STUN/TURN (host candidates suffice, STUN timeouts break tests)
      // Auto-detect localhost for testing (skip STUN since host candidates suffice and DNS failures block negotiation)
      const isLocalhost = typeof window !== 'undefined' && 
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      const iceServers = isLocalhost ? [] : (this.config.iceServers || DEFAULT_ICE_SERVERS);
      peerConfig.config = { iceServers };

      const peer = peerId ? new Peer(peerId, peerConfig as any) : new Peer(peerConfig as any);

      peer.on('open', (id) => {
        this.myPeerId = id;
        const instance: SignalingInstance = { peer, url: 'default', label: 'default', connected: true };
        this.signalingInstances.push(instance);
        this._setupPeerEvents(instance);
        resolve(id);
      });

      peer.on('error', (error) => {
        this.onError?.(error);
        reject(error);
      });
    });
  }

  private _initServer(server: { url: string; label: string }, peerId?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(server.url);
      // Auto-detect localhost for testing
      const isLocalhost = typeof window !== 'undefined' && 
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      const iceServers = isLocalhost ? [] : (this.config.iceServers || DEFAULT_ICE_SERVERS);

      const peerConfig: any = {
        host: url.hostname,
        port: url.port ? parseInt(url.port, 10) : url.protocol === 'https:' || url.protocol === 'wss:' ? 443 : 80,
        path: url.pathname === '/' ? '/peerjs' : url.pathname,
        secure: url.protocol === 'https:' || url.protocol === 'wss:',
        debug: this.config.debug ?? 1,
        config: { iceServers },
      };

      // Use the same peer ID on all servers (or let first server assign one)
      const id = peerId || this.myPeerId;
      const peer = id ? new Peer(id, peerConfig) : new Peer(peerConfig);

      const timeout = setTimeout(() => {
        peer.destroy();
        reject(new Error(`Signaling server ${server.label} timed out`));
      }, 15000);

      peer.on('open', (assignedId) => {
        clearTimeout(timeout);

        // If this is the first server to connect, set our peer ID
        if (!this.myPeerId) {
          this.myPeerId = assignedId;
        }

        const instance: SignalingInstance = {
          peer,
          url: server.url,
          label: server.label,
          connected: true,
        };
        this.signalingInstances.push(instance);
        this._setupPeerEvents(instance);

        resolve(assignedId);
      });

      peer.on('error', (error) => {
        clearTimeout(timeout);
        this.onError?.(new Error(`[${server.label}] ${error.message || error}`));
        reject(error);
      });
    });
  }

  private _setupPeerEvents(instance: SignalingInstance): void {
    instance.peer.on('connection', (conn) => {
      this._setupConnection(conn, instance.url);
    });

    instance.peer.on('disconnected', () => {
      instance.connected = false;
      console.log(`[DecentChat] Disconnected from signaling: ${instance.label}`);

      // Auto-reconnect
      if (!instance.peer.destroyed) {
        setTimeout(() => {
          if (!instance.peer.destroyed) {
            instance.peer.reconnect();
          }
        }, 3000);
      }
    });

    instance.peer.on('close', () => {
      instance.connected = false;
    });
  }

  // ── Internal: peer connection management ──────────────────────────────────

  private _attemptConnect(instance: SignalingInstance, peerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const conn = instance.peer.connect(peerId, { reliable: true });
      const timeout = setTimeout(() => {
        reject(new Error(`Connection to ${peerId} via ${instance.label} timed out`));
      }, 10000);

      conn.on('open', () => {
        clearTimeout(timeout);
        resolve();
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this._setupConnection(conn, instance.url);
    });
  }

  /**
   * Setup connection with deduplication.
   * If we already have a connection to this peer (from another signaling server),
   * keep the existing one and close the new one.
   */
  private _setupConnection(conn: DataConnection, signalingServer: string): void {
    const { peer: peerId } = conn;

    // ── DEDUPLICATION ──
    const existing = this.connections.get(peerId);
    if (existing && existing.status === 'connected') {
      // Already have a working connection to this peer — close the duplicate
      conn.close();
      return;
    }

    const active: ActiveConnection = { conn, peerId, status: 'connecting', signalingServer };
    this.connections.set(peerId, active);

    const markConnected = () => {
      // Double-check dedup: another connection may have won the race
      const current = this.connections.get(peerId);
      if (current && current !== active && current.status === 'connected') {
        conn.close();
        return;
      }

      active.status = 'connected';
      this.connections.set(peerId, active);
      this.onConnect?.(peerId);
    };

    if (conn.open) {
      markConnected();
    }

    conn.on('open', markConnected);

    conn.on('data', (data) => {
      // Only process data from the active connection for this peer
      const current = this.connections.get(peerId);
      if (current?.conn === conn) {
        this.onMessage?.(peerId, data);
      }
    });

    conn.on('close', () => {
      // Only fire disconnect if this was the active connection
      const current = this.connections.get(peerId);
      if (current?.conn === conn) {
        active.status = 'failed';
        this.connections.delete(peerId);
        this.onDisconnect?.(peerId);
      }
    });

    conn.on('error', (err) => {
      active.status = 'failed';
      this.onError?.(err);
    });
  }
}
