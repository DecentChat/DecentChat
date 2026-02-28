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

// Use named import for Node.js/jiti CJS interop compatibility
// (default import `import Peer from 'peerjs'` breaks under jiti's ESM transform)
import { Peer } from 'peerjs';
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
  /**
   * ICE/STUN/TURN servers for NAT traversal.
   * When provided, used as-is (overrides STUN + TURN defaults).
   * In production, pass your own TURN credentials here.
   */
  iceServers?: RTCIceServer[];
  /**
   * Whether to include TURN servers for NAT traversal (default: true in production).
   * Set to false in tests or when providing your own iceServers.
   * Automatically false on localhost.
   */
  useTurn?: boolean;
  /**
   * Custom TURN servers — overrides DEFAULT_TURN_SERVERS when provided.
   * 
   * Recommended options:
   *   - Cloudflare: https://developers.cloudflare.com/calls/turn/
   *   - Metered free tier: https://www.metered.ca/tools/openrelay/
   *   - Self-hosted coturn: https://github.com/coturn/coturn
   */
  turnServers?: RTCIceServer[];
  /** PeerJS debug level: 0 = none, 1 = warnings, 2 = all (default: 1) */
  debug?: 0 | 1 | 2 | 3;
  /** Max connection retries per server (default: 3) */
  maxRetries?: number;
  /** Retry delay in ms (default: 2000, doubles each retry) */
  retryDelayMs?: number;
}

export interface NormalizedPeerJsServer {
  host: string;
  port: number;
  path: string;
  secure: boolean;
}

/**
 * Default STUN servers for NAT traversal.
 */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  // Two Google STUN servers as a single entry (browser treats as fallbacks, not parallel)
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

/**
 * Open relay TURN servers — free, no auth required, rate-limited.
 * 
 * ⚠️  For DEVELOPMENT only. In production, provide your own TURN credentials:
 *   - Cloudflare free tier: https://developers.cloudflare.com/calls/turn/
 *   - Metered.ca:           https://www.metered.ca/tools/openrelay/
 *   - Self-hosted coturn:   https://github.com/coturn/coturn
 *
 * Pass your credentials via PeerTransportConfig.turnServers.
 */
export const DEFAULT_TURN_SERVERS: RTCIceServer[] = [
  {
    // Two URLs in one entry = browser picks fastest, not parallel probe
    urls: ['turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

/**
 * Combined STUN + TURN for maximum NAT traversal reliability.
 * Peers behind symmetric NAT (corporate networks, some mobile) can only
 * connect via TURN — STUN alone will fail.
 *
 * Usage: pass to PeerTransportConfig.iceServers or set config.useTurn = true.
 */
export const ICE_SERVERS_WITH_TURN: RTCIceServer[] = [
  ...DEFAULT_ICE_SERVERS,
  ...DEFAULT_TURN_SERVERS,
];

/**
 * Normalize a signaling server URL into PeerJS constructor fields.
 * Default ports are stripped by URL parsing, then reapplied as numeric defaults.
 */
export function normalizePeerJsServer(serverUrl: string): NormalizedPeerJsServer {
  const url = new URL(serverUrl);
  const secure = url.protocol === 'https:' || url.protocol === 'wss:';
  return {
    host: url.hostname,
    port: url.port ? parseInt(url.port, 10) : secure ? 443 : 80,
    path: url.pathname || '/',
    secure,
  };
}

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

  // ── Auto-reconnect state ────────────────────────────────────────────────
  private _autoReconnectEnabled = true;
  private _manuallyDisconnected = new Set<string>();
  private _reconnectAttempts = new Map<string, number>();
  private _reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly _reconnectDelays = [5000, 15000, 30000, 60000, 120000];

  // ── DEP-004: Heartbeat state ────────────────────────────────────────────
  private static readonly PING_INTERVAL_MS = 30_000;
  private static readonly PONG_TIMEOUT_MS = 20_000;
  private static readonly HEARTBEAT_FAIL_THRESHOLD = 2;
  private static readonly RECOVERY_COOLDOWN_MS = 30_000;
  private _pingTimers = new Map<string, ReturnType<typeof setInterval>>();
  private _pongTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private _pendingPing = new Map<string, number>();
  private _missedPongs = new Map<string, number>();
  private _lastRecoveryAt = new Map<string, number>();
  private _heartbeatEnabled = true;
  private _networkListenersSetup = false;
  private _networkListenersCleanup: (() => void) | null = null;
  private _managedTimeouts = new Set<ReturnType<typeof setTimeout>>();
  private _destroyed = false;

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
    if (this._destroyed) {
      throw new Error('PeerTransport has been destroyed');
    }
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

    this._setupNetworkListeners();
    return assignedId;
  }

  /**
   * Connect to a remote peer.
   * Tries all signaling servers until one succeeds.
   */
  /**
   * Wait up to `timeoutMs` for at least one signaling instance to (re)connect.
   * Resolves immediately if any instance is already connected.
   */
  private _waitForAnySignalingReconnect(timeoutMs = 6000): Promise<void> {
    if (this.signalingInstances.some(i => i.connected)) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for signaling server reconnect'));
      }, timeoutMs);

      // Poll every 250 ms — PeerJS emits 'open' on reconnect, but we watch state directly
      const poll = setInterval(() => {
        if (this.signalingInstances.some(i => i.connected)) {
          cleanup();
          resolve();
        }
      }, 250);

      function cleanup() { clearTimeout(deadline); clearInterval(poll); }
    });
  }

  async connect(peerId: string): Promise<void> {
    this._manuallyDisconnected.delete(peerId);

    if (this.signalingInstances.length === 0) {
      throw new Error('PeerTransport not initialised — call init() first');
    }
    if (this.connections.has(peerId)) return; // Already connected
    if (this.connectingTo.has(peerId)) return; // Already attempting

    this.connectingTo.add(peerId);
    const maxRetries = this.config.maxRetries ?? 3;
    const baseDelay = this.config.retryDelayMs ?? 2000;

    try {
      // If all signaling servers are currently disconnected, wait briefly for
      // the auto-reconnect to fire (3 s in _setupPeerEvents) before giving up.
      if (!this.signalingInstances.some(i => i.connected)) {
        await this._waitForAnySignalingReconnect(8000).catch(() => {
          throw new Error('Signaling server temporarily unavailable — please try again in a moment');
        });
      }

      // Try each signaling server
      for (const instance of this.signalingInstances) {
        if (!instance.connected) continue;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            await this._attemptConnect(instance, peerId);
            return; // Success
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);

            // PeerJS race: peer became disconnected between our check and the actual call.
            // Wait for reconnect and then retry this instance once more.
            if (msg.includes('disconnecting from server') || msg.includes('disconnected from server')) {
              await this._waitForAnySignalingReconnect(6000).catch(() => null);
              this.connections.delete(peerId);
              // Retry this attempt once
              try {
                await this._attemptConnect(instance, peerId);
                return;
              } catch {
                // Fall through to next attempt / server
              }
            }

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
    this._manuallyDisconnected.add(peerId);
    this._cancelReconnect(peerId);
    this._stopHeartbeat(peerId);

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

    const markDisconnected = () => {
      const current = this.connections.get(peerId);
      if (current?.conn !== active.conn) return;
      this._stopHeartbeat(peerId);
      current.status = 'failed';
      this.connections.delete(peerId);
      this.onDisconnect?.(peerId);
      this._scheduleReconnect(peerId);
    };

    if (!active.conn.open) {
      markDisconnected();
      return false;
    }

    try {
      active.conn.send(data as any);
      return true;
    } catch (err) {
      markDisconnected();

      const message = err instanceof Error ? err.message : String(err ?? '');
      // Ignore this noisy PeerJS race — ChatController already treats send=false as expected.
      if (!message.includes('Connection is not open') &&
          !message.includes('listen for the `open` event before sending')) {
        this.onError?.(err instanceof Error ? err : new Error(message));
      }

      return false;
    }
  }

  getConnectedPeers(): string[] {
    return Array.from(this.connections.entries())
      .filter(([, c]) => c.status === 'connected')
      .map(([id]) => id);
  }

  /**
   * Returns true if connect() is currently in-flight OR an auto-reconnect
   * timer is pending for this peer. Lets maintenance routines avoid
   * double-scheduling without relying on app-level state.
   */
  isConnectingToPeer(peerId: string): boolean {
    return this.connectingTo.has(peerId) || this._reconnectTimers.has(peerId);
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;

    this._managedTimeouts.forEach(t => clearTimeout(t));
    this._managedTimeouts.clear();

    this._reconnectTimers.forEach(t => clearTimeout(t));
    this._reconnectTimers.clear();
    this._reconnectAttempts.clear();
    this._manuallyDisconnected.clear();

    // DEP-004: Clean up heartbeat timers
    this._pingTimers.forEach(t => clearInterval(t));
    this._pingTimers.clear();
    this._pongTimeouts.forEach(t => clearTimeout(t));
    this._pongTimeouts.clear();
    this._pendingPing.clear();
    this._missedPongs.clear();
    this._lastRecoveryAt.clear();

    if (this._networkListenersCleanup) {
      this._networkListenersCleanup();
      this._networkListenersCleanup = null;
    }
    this._networkListenersSetup = false;

    this.connections.forEach(({ conn }) => conn.close());
    this.connections.clear();
    this.connectingTo.clear();
    for (const instance of this.signalingInstances) {
      try {
        if (!instance.peer.destroyed && typeof (instance.peer as any).disconnect === 'function') {
          (instance.peer as any).disconnect();
        }
      } catch {
        // Ignore disconnect errors during teardown.
      }
      try {
        if (!instance.peer.destroyed) {
          instance.peer.destroy();
        }
      } catch {
        // Ignore destroy errors during teardown.
      }
      instance.connected = false;
    }
    this.signalingInstances = [];
    this.myPeerId = null;
  }

  // ── Auto-reconnect ───────────────────────────────────────────────────────

  setAutoReconnect(enabled: boolean): void {
    this._autoReconnectEnabled = enabled;
  }

  private _cancelReconnect(peerId: string): void {
    const timer = this._reconnectTimers.get(peerId);
    if (timer) clearTimeout(timer);
    this._reconnectTimers.delete(peerId);
    this._reconnectAttempts.delete(peerId);
  }

  private _scheduleReconnect(peerId: string): void {
    if (!this._autoReconnectEnabled) return;
    if (this._manuallyDisconnected.has(peerId)) return;
    if (this._reconnectTimers.has(peerId)) return; // already scheduled

    const attempt = this._reconnectAttempts.get(peerId) ?? 0;
    // After exhausting the back-off table, keep retrying at the longest
    // delay (120 s) indefinitely — connectivity can return at any time.
    const delay = this._reconnectDelays[Math.min(attempt, this._reconnectDelays.length - 1)];
    const timer = setTimeout(async () => {
      this._reconnectTimers.delete(peerId);

      if (this._manuallyDisconnected.has(peerId)) return;
      if (this.connections.has(peerId)) return; // already reconnected

      this._reconnectAttempts.set(peerId, attempt + 1);
      try {
        await this.connect(peerId);
        // Success — clear attempt counter
        this._reconnectAttempts.delete(peerId);
      } catch {
        // Failed — schedule next attempt
        this._scheduleReconnect(peerId);
      }
    }, delay);

    this._reconnectTimers.set(peerId, timer);
  }

  // ── DEP-004: Heartbeat ──────────────────────────────────────────────────

  /** Enable or disable heartbeat (useful for testing) */
  setHeartbeatEnabled(enabled: boolean): void {
    this._heartbeatEnabled = enabled;
    if (!enabled) {
      // Stop all active heartbeats
      for (const peerId of this._pingTimers.keys()) {
        this._stopHeartbeat(peerId);
      }
    } else {
      // Start heartbeats for all connected peers
      for (const [peerId, active] of this.connections) {
        if (active.status === 'connected') {
          this._startHeartbeat(peerId);
        }
      }
    }
  }

  private _startHeartbeat(peerId: string): void {
    if (!this._heartbeatEnabled) return;
    if (this._pingTimers.has(peerId)) return; // Already running

    const interval = setInterval(() => {
      this._sendPing(peerId);
    }, PeerTransport.PING_INTERVAL_MS);

    this._pingTimers.set(peerId, interval);
  }

  private _stopHeartbeat(peerId: string): void {
    const interval = this._pingTimers.get(peerId);
    if (interval) clearInterval(interval);
    this._pingTimers.delete(peerId);

    const timeout = this._pongTimeouts.get(peerId);
    if (timeout) clearTimeout(timeout);
    this._pongTimeouts.delete(peerId);

    this._pendingPing.delete(peerId);
    this._missedPongs.delete(peerId);
    this._lastRecoveryAt.delete(peerId);
  }

  private _sendPing(peerId: string): void {
    const ts = Date.now();
    const sent = this.send(peerId, { type: 'heartbeat:ping', ts });
    if (!sent) return;

    this._pendingPing.set(peerId, ts);

    // Set pong timeout
    const existing = this._pongTimeouts.get(peerId);
    if (existing) clearTimeout(existing);

    const timeout = setTimeout(() => {
      this._pongTimeouts.delete(peerId);
      this._onPingTimeout(peerId);
    }, PeerTransport.PONG_TIMEOUT_MS);

    this._pongTimeouts.set(peerId, timeout);
  }

  private _handlePong(peerId: string, ts: number): void {
    const pending = this._pendingPing.get(peerId);
    if (pending !== ts) return; // Stale pong

    this._pendingPing.delete(peerId);
    this._missedPongs.set(peerId, 0);
    const timeout = this._pongTimeouts.get(peerId);
    if (timeout) clearTimeout(timeout);
    this._pongTimeouts.delete(peerId);
  }

  private _onPingTimeout(peerId: string): void {
    const missed = (this._missedPongs.get(peerId) ?? 0) + 1;
    this._missedPongs.set(peerId, missed);

    if (missed < PeerTransport.HEARTBEAT_FAIL_THRESHOLD) {
      console.warn(`[Heartbeat] Peer ${peerId.slice(0, 8)} missed pong (${missed}/${PeerTransport.HEARTBEAT_FAIL_THRESHOLD})`);
      return;
    }

    const now = Date.now();
    const lastRecovery = this._lastRecoveryAt.get(peerId) ?? 0;
    if (now - lastRecovery < PeerTransport.RECOVERY_COOLDOWN_MS) {
      return;
    }
    this._lastRecoveryAt.set(peerId, now);

    console.warn(`[Heartbeat] Peer ${peerId.slice(0, 8)} unresponsive — attempting recovery`);
    const active = this.connections.get(peerId);
    if (!active) return;

    // Try ICE restart first
    try {
      const pc = (active.conn as any).peerConnection as RTCPeerConnection | undefined;
      if (pc && typeof pc.restartIce === 'function') {
        console.log(`[Heartbeat] Triggering ICE restart for ${peerId.slice(0, 8)}`);
        pc.restartIce();
        return;
      }
    } catch {
      // restartIce not available — fall through to close
    }

    // Fallback: close connection (triggers auto-reconnect via _scheduleReconnect)
    console.log(`[Heartbeat] Closing dead connection to ${peerId.slice(0, 8)}`);
    active.conn.close();
  }

  /** DEP-004: Setup browser network event listeners (called once from init) */
  private _setupNetworkListeners(): void {
    if (this._networkListenersSetup) return;
    if (typeof window === 'undefined') return;
    this._networkListenersSetup = true;

    const onOnline = () => {
      console.log('[Network] Browser went online — pinging all peers');
      // Immediately ping all connected peers
      for (const [peerId, active] of this.connections) {
        if (active.status === 'connected' && this._heartbeatEnabled) {
          this._sendPing(peerId);
        }
      }
      // T1.5: Probe signaling servers
      this._probeSignalingServers();
    };

    const onOffline = () => {
      console.log('[Network] Browser went offline');
    };

    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        console.log('[Network] Tab became visible — pinging all peers');
        for (const [peerId, active] of this.connections) {
          if (active.status === 'connected' && this._heartbeatEnabled) {
            this._sendPing(peerId);
          }
        }
      }
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    this._networkListenersCleanup = () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
  }

  /** T1.5: Try to reconnect disconnected signaling servers */
  private _probeSignalingServers(): void {
    for (const instance of this.signalingInstances) {
      if (!instance.connected && !instance.peer.destroyed) {
        console.log(`[Network] Probing signaling server: ${instance.label}`);
        try {
          instance.peer.reconnect();
        } catch {
          // Ignore — server may be truly down
        }
      }
    }
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

  // ── Internal: ICE server resolution ──────────────────────────────────────

  /**
   * Build the ICE server list based on config and environment.
   *
   * Priority order:
   *   1. config.iceServers — full override (caller manages everything)
   *   2. localhost → empty [] (host candidates suffice, STUN/TURN timeouts break tests)
   *   3. config.useTurn === false → STUN only (DEFAULT_ICE_SERVERS)
   *   4. config.turnServers → STUN + custom TURN servers
   *   5. default → STUN + DEFAULT_TURN_SERVERS (open relay)
   */
  private _resolveIceServers(isLocalhost: boolean): RTCIceServer[] {
    // Explicit override takes full priority
    if (this.config.iceServers) return this.config.iceServers;

    // Localhost: skip all NAT traversal (host candidates work, STUN causes timeouts in tests)
    if (isLocalhost) return [];

    // Caller explicitly disabled TURN
    if (this.config.useTurn === false) return DEFAULT_ICE_SERVERS;

    // Use caller-provided TURN servers
    if (this.config.turnServers && this.config.turnServers.length > 0) {
      return [...DEFAULT_ICE_SERVERS, ...this.config.turnServers];
    }

    // Default: STUN + open relay TURN for maximum NAT traversal
    return ICE_SERVERS_WITH_TURN;
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

  /**
   * Peer factory seam for tests. Production uses real PeerJS constructor.
   */
  protected _createPeer(peerId: string | null | undefined, peerConfig: Record<string, unknown>): Peer {
    return peerId ? new Peer(peerId, peerConfig as any) : new Peer(peerConfig as any);
  }

  private _initSingleServer(peerId?: string, attempt = 0): Promise<string> {
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
      const isLocalhost = typeof window !== 'undefined' && 
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      peerConfig.config = { iceServers: this._resolveIceServers(isLocalhost) };

      const peer = this._createPeer(peerId, peerConfig);

      // Named init handler so we can remove it once 'open' fires.
      // Without this, the handler persists and calls peer.destroy() on any
      // post-init error (e.g. peer-unavailable when a member goes offline).
      const initErrHandler = (error: any) => {
        peer.destroy();
        if (error.type === 'unavailable-id' && attempt < 3) {
          // Transient: previous WebSocket session still alive on the server — retry.
          const delay = (attempt + 1) * 3000;
          console.warn(`[PeerTransport] Peer ID temporarily taken, retrying in ${delay / 1000}s (attempt ${attempt + 1}/3)...`);
          this._setManagedTimeout(() => {
            this._initSingleServer(peerId, attempt + 1).then(resolve).catch(reject);
          }, delay);
        } else {
          if (error.type !== 'unavailable-id') this.onError?.(error);
          reject(error);
        }
      };
      peer.on('error', initErrHandler);

      peer.on('open', (id) => {
        peer.off('error', initErrHandler); // Remove init handler — post-init errors go to _setupPeerEvents
        this.myPeerId = id;
        const instance: SignalingInstance = { peer, url: 'default', label: 'default', connected: true };
        this.signalingInstances.push(instance);
        this._setupPeerEvents(instance);
        this._setupNetworkListeners();
        resolve(id);
      });
    });
  }

  private _initServer(server: { url: string; label: string }, peerId?: string, attempt = 0): Promise<string> {
    return new Promise((resolve, reject) => {
      const normalized = normalizePeerJsServer(server.url);
      const isLocalhost = typeof window !== 'undefined' && 
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

      const peerConfig: any = {
        host: normalized.host,
        port: normalized.port,
        path: normalized.path,  // PeerJS appends /peerjs internally; pass as-is
        secure: normalized.secure,
        debug: this.config.debug ?? 1,
        config: { iceServers: this._resolveIceServers(isLocalhost) },
      };

      // Use the same peer ID on all servers (or let first server assign one)
      const id = peerId || this.myPeerId;
      const peer = this._createPeer(id, peerConfig);

      const timeout = setTimeout(() => {
        peer.destroy();
        reject(new Error(`Signaling server ${server.label} timed out`));
      }, 15000);

      // Init-time error handler — must be removed once 'open' fires so it
      // doesn't interfere with post-init peer-unavailable / network errors.
      const initErrHandler = (error: any) => {
        clearTimeout(timeout);
        peer.destroy();
        if (error.type === 'unavailable-id' && attempt < 3) {
          const delay = (attempt + 1) * 3000;
          console.warn(`[PeerTransport] [${server.label}] Peer ID temporarily taken, retrying in ${delay / 1000}s (attempt ${attempt + 1}/3)...`);
          this._setManagedTimeout(() => {
            this._initServer(server, peerId, attempt + 1).then(resolve).catch(reject);
          }, delay);
        } else {
          if (error.type !== 'unavailable-id') {
            this.onError?.(new Error(`[${server.label}] ${error.message || error}`));
          }
          reject(error);
        }
      };
      peer.on('error', initErrHandler);

      peer.on('open', (assignedId) => {
        clearTimeout(timeout);
        // Remove the init error handler — post-init errors go to _setupPeerEvents
        peer.off('error', initErrHandler);

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
    });
  }

  private _setupPeerEvents(instance: SignalingInstance): void {
    instance.peer.on('connection', (conn) => {
      this._setupConnection(conn, instance.url);
    });

    // Signaling server (re)connected — flip connected flag back on.
    // This fires both on initial connect AND after peer.reconnect() succeeds.
    instance.peer.on('open', () => {
      instance.connected = true;
      console.log(`[DecentChat] Connected to signaling: ${instance.label}`);
    });

    instance.peer.on('disconnected', () => {
      instance.connected = false;
      console.log(`[DecentChat] Disconnected from signaling: ${instance.label}`);

      // Auto-reconnect
      if (!instance.peer.destroyed) {
        this._setManagedTimeout(() => {
          if (!instance.peer.destroyed) {
            instance.peer.reconnect();
          }
        }, 3000);
      }
    });

    instance.peer.on('close', () => {
      instance.connected = false;
    });

    // Post-init error handler: report but NEVER destroy the peer.
    // peer-unavailable = a specific peer we tried to reach is gone (phone locked, etc.)
    // This is a per-connection issue, not a signaling server failure.
    instance.peer.on('error', (error: any) => {
      this.onError?.(new Error(`[${instance.label}] ${error.message || error}`));
      // peer-unavailable can silently flip peer.disconnected=true without emitting
      // the 'disconnected' event, bypassing the auto-reconnect in that handler.
      // Explicitly reconnect if that happened.
      if (instance.peer.disconnected && !instance.peer.destroyed) {
        this._setManagedTimeout(() => {
          if (instance.peer.disconnected && !instance.peer.destroyed) {
            instance.peer.reconnect();
          }
        }, 1000);
      }
    });
  }

  // ── Internal: peer connection management ──────────────────────────────────

  private _attemptConnect(instance: SignalingInstance, peerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const conn = instance.peer.connect(peerId, { reliable: true });
      const timeout = setTimeout(() => {
        // Timed out handshaking this DataConnection — close to avoid stale half-open state.
        conn.close();
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
      this._startHeartbeat(peerId);
      this.onConnect?.(peerId);
    };

    if (conn.open) {
      markConnected();
    }

    conn.on('open', markConnected);

    conn.on('data', (data) => {
      // Only process data from the active connection for this peer
      const current = this.connections.get(peerId);
      if (current?.conn !== conn) return;

      // Any inbound payload means the peer is alive.
      this._missedPongs.set(peerId, 0);

      // DEP-004: Intercept heartbeat messages (transport-internal)
      const msg = data as any;
      if (msg?.type === 'heartbeat:ping') {
        // Reply with pong
        this.send(peerId, { type: 'heartbeat:pong', ts: msg.ts });
        return;
      }
      if (msg?.type === 'heartbeat:pong') {
        this._handlePong(peerId, msg.ts);
        return;
      }

      this.onMessage?.(peerId, data);
    });

    conn.on('close', () => {
      // Only fire disconnect if this was the active connection
      const current = this.connections.get(peerId);
      if (current?.conn === conn) {
        this._stopHeartbeat(peerId);
        active.status = 'failed';
        this.connections.delete(peerId);
        this.onDisconnect?.(peerId);
        this._scheduleReconnect(peerId);
      }
    });

    conn.on('error', (err) => {
      // Error does not always guarantee a subsequent 'close' event in all browsers.
      // Clean up active mapping here so future connect attempts are not blocked by stale entries.
      const current = this.connections.get(peerId);
      if (current?.conn === conn) {
        const wasConnected = current.status === 'connected';
        this._stopHeartbeat(peerId);
        current.status = 'failed';
        this.connections.delete(peerId);
        if (wasConnected) {
          this.onDisconnect?.(peerId);
        }
        this._scheduleReconnect(peerId);
      }

      this.onError?.(err);
    });
  }

  private _setManagedTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this._managedTimeouts.delete(timer);
      if (this._destroyed) return;
      callback();
    }, delayMs);
    this._managedTimeouts.add(timer);
    return timer;
  }
}
