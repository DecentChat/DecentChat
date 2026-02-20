/**
 * DEP-004: Application Heartbeat Protocol tests
 *
 * Tests the heartbeat state machine (ping/pong, dead-peer detection, timer management)
 * using a pure in-memory simulation — no real PeerJS/WebRTC involved.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

// ---------------------------------------------------------------------------
// In-memory heartbeat state machine — mirrors PeerTransport's heartbeat logic
// ---------------------------------------------------------------------------

interface ActiveConn {
  status: 'connected' | 'failed';
  /** Controls whether peerConnection.restartIce() is available */
  supportsIceRestart?: boolean;
  iceRestartCalled?: boolean;
  closeCalled?: boolean;
}

class HeartbeatStateMachine {
  static readonly PING_INTERVAL_MS = 30;   // 30ms in test (real: 30_000)
  static readonly PONG_TIMEOUT_MS = 10;    // 10ms in test (real: 10_000)

  heartbeatEnabled = true;

  pingTimers = new Map<string, ReturnType<typeof setInterval>>();
  pongTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  pendingPing = new Map<string, number>();

  connections = new Map<string, ActiveConn>();

  /** Messages sent by the transport */
  sentMessages: { peerId: string; data: unknown }[] = [];

  /** Peers whose connection was closed after timeout */
  closedConnections: string[] = [];

  /** Peers for which ICE restart was triggered */
  iceRestartedPeers: string[] = [];

  /** Peers scheduled for reconnect after dead-peer detection */
  reconnectScheduled: string[] = [];

  // ── Internal helpers (same logic as PeerTransport) ─────────────────────

  send(peerId: string, data: unknown): boolean {
    const conn = this.connections.get(peerId);
    if (!conn || conn.status !== 'connected') return false;
    this.sentMessages.push({ peerId, data });
    return true;
  }

  startHeartbeat(peerId: string): void {
    if (!this.heartbeatEnabled) return;
    if (this.pingTimers.has(peerId)) return;

    const interval = setInterval(() => {
      this.sendPing(peerId);
    }, HeartbeatStateMachine.PING_INTERVAL_MS);
    this.pingTimers.set(peerId, interval);
  }

  stopHeartbeat(peerId: string): void {
    const interval = this.pingTimers.get(peerId);
    if (interval) clearInterval(interval);
    this.pingTimers.delete(peerId);

    const timeout = this.pongTimeouts.get(peerId);
    if (timeout) clearTimeout(timeout);
    this.pongTimeouts.delete(peerId);

    this.pendingPing.delete(peerId);
  }

  sendPing(peerId: string): void {
    const ts = Date.now();
    const sent = this.send(peerId, { type: 'heartbeat:ping', ts });
    if (!sent) return;

    this.pendingPing.set(peerId, ts);

    const existing = this.pongTimeouts.get(peerId);
    if (existing) clearTimeout(existing);

    const timeout = setTimeout(() => {
      this.pongTimeouts.delete(peerId);
      this.onPingTimeout(peerId);
    }, HeartbeatStateMachine.PONG_TIMEOUT_MS);

    this.pongTimeouts.set(peerId, timeout);
  }

  handlePong(peerId: string, ts: number): void {
    const pending = this.pendingPing.get(peerId);
    if (pending !== ts) return; // stale — ignore

    this.pendingPing.delete(peerId);
    const timeout = this.pongTimeouts.get(peerId);
    if (timeout) clearTimeout(timeout);
    this.pongTimeouts.delete(peerId);
  }

  onPingTimeout(peerId: string): void {
    const conn = this.connections.get(peerId);
    if (!conn) return;

    if (conn.supportsIceRestart) {
      conn.iceRestartCalled = true;
      this.iceRestartedPeers.push(peerId);
      return; // ICE restart triggered — no close
    }

    // Fallback: close (triggers auto-reconnect in real transport)
    conn.closeCalled = true;
    conn.status = 'failed';
    this.closedConnections.push(peerId);
    this.reconnectScheduled.push(peerId);
  }

  setHeartbeatEnabled(enabled: boolean): void {
    this.heartbeatEnabled = enabled;
    if (!enabled) {
      for (const peerId of this.pingTimers.keys()) {
        this.stopHeartbeat(peerId);
      }
    } else {
      for (const [peerId, conn] of this.connections) {
        if (conn.status === 'connected') this.startHeartbeat(peerId);
      }
    }
  }

  /** Simulate a peer connecting */
  simulateConnect(peerId: string, opts: Partial<ActiveConn> = {}): void {
    this.connections.set(peerId, { status: 'connected', ...opts });
    this.startHeartbeat(peerId);
  }

  /** Simulate a peer disconnecting cleanly */
  simulateDisconnect(peerId: string): void {
    this.stopHeartbeat(peerId);
    this.connections.delete(peerId);
  }

  destroy(): void {
    this.pingTimers.forEach(t => clearInterval(t));
    this.pingTimers.clear();
    this.pongTimeouts.forEach(t => clearTimeout(t));
    this.pongTimeouts.clear();
    this.pendingPing.clear();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DEP-004 Application Heartbeat', () => {
  let hb: HeartbeatStateMachine;

  beforeEach(() => {
    hb = new HeartbeatStateMachine();
  });

  afterEach(() => {
    hb.destroy();
  });

  // ── Ping scheduling ────────────────────────────────────────────────────

  test('ping is sent after interval elapses', async () => {
    hb.simulateConnect('peer-a');

    await sleep(HeartbeatStateMachine.PING_INTERVAL_MS + 5);

    const pings = hb.sentMessages.filter(m => m.peerId === 'peer-a' && (m.data as any).type === 'heartbeat:ping');
    expect(pings.length).toBeGreaterThanOrEqual(1);
  });

  test('ping message contains timestamp', async () => {
    hb.simulateConnect('peer-a');

    await sleep(HeartbeatStateMachine.PING_INTERVAL_MS + 5);

    const ping = hb.sentMessages.find(m => (m.data as any).type === 'heartbeat:ping');
    expect(ping).toBeDefined();
    expect(typeof (ping!.data as any).ts).toBe('number');
    expect((ping!.data as any).ts).toBeGreaterThan(0);
  });

  test('no ping sent before interval', async () => {
    hb.simulateConnect('peer-a');
    // Don't wait for the interval
    const pings = hb.sentMessages.filter(m => (m.data as any).type === 'heartbeat:ping');
    expect(pings.length).toBe(0);
  });

  test('multiple peers each get independent ping timers', async () => {
    hb.simulateConnect('peer-a');
    hb.simulateConnect('peer-b');
    hb.simulateConnect('peer-c');

    await sleep(HeartbeatStateMachine.PING_INTERVAL_MS + 5);

    const pinged = new Set(hb.sentMessages.filter(m => (m.data as any).type === 'heartbeat:ping').map(m => m.peerId));
    expect(pinged.has('peer-a')).toBe(true);
    expect(pinged.has('peer-b')).toBe(true);
    expect(pinged.has('peer-c')).toBe(true);

    expect(hb.pingTimers.size).toBe(3);
  });

  // ── Pong handling ──────────────────────────────────────────────────────

  test('pong received clears pong timeout', async () => {
    hb.simulateConnect('peer-a');

    // Manually trigger a ping
    hb.sendPing('peer-a');
    const sentPing = hb.sentMessages.find(m => (m.data as any).type === 'heartbeat:ping')!;
    const ts = (sentPing.data as any).ts;

    expect(hb.pongTimeouts.has('peer-a')).toBe(true);

    hb.handlePong('peer-a', ts);

    expect(hb.pongTimeouts.has('peer-a')).toBe(false);
    expect(hb.pendingPing.has('peer-a')).toBe(false);
  });

  test('stale pong is ignored (wrong timestamp)', async () => {
    hb.simulateConnect('peer-a');

    hb.sendPing('peer-a');
    expect(hb.pongTimeouts.has('peer-a')).toBe(true);

    // Send pong with wrong ts
    hb.handlePong('peer-a', 0);

    // Timeout should still be active (stale pong ignored)
    expect(hb.pongTimeouts.has('peer-a')).toBe(true);
    expect(hb.pendingPing.has('peer-a')).toBe(true);
  });

  test('pong from unknown peer is safely ignored', () => {
    // No peers connected
    expect(() => hb.handlePong('ghost-peer', Date.now())).not.toThrow();
  });

  // ── Dead-peer detection ────────────────────────────────────────────────

  test('no pong within timeout triggers reconnect (fallback path)', async () => {
    hb.simulateConnect('peer-a'); // no ICE restart support

    hb.sendPing('peer-a');

    // Wait for pong timeout to fire
    await sleep(HeartbeatStateMachine.PONG_TIMEOUT_MS + 5);

    expect(hb.closedConnections).toContain('peer-a');
    expect(hb.reconnectScheduled).toContain('peer-a');
  });

  test('no pong triggers ICE restart when supported', async () => {
    hb.simulateConnect('peer-a', { supportsIceRestart: true });

    hb.sendPing('peer-a');

    await sleep(HeartbeatStateMachine.PONG_TIMEOUT_MS + 5);

    expect(hb.iceRestartedPeers).toContain('peer-a');
    // Connection NOT closed when ICE restart is available
    expect(hb.closedConnections).not.toContain('peer-a');
  });

  test('timeout does nothing if peer already disconnected', async () => {
    hb.simulateConnect('peer-a');
    hb.sendPing('peer-a');

    // Disconnect before timeout fires
    hb.simulateDisconnect('peer-a');

    await sleep(HeartbeatStateMachine.PONG_TIMEOUT_MS + 5);

    // Nothing should have been added (peer gone from connections map)
    expect(hb.closedConnections).not.toContain('peer-a');
    expect(hb.iceRestartedPeers).not.toContain('peer-a');
  });

  // ── Stop / cleanup ─────────────────────────────────────────────────────

  test('stopHeartbeat clears interval and timeout', () => {
    hb.simulateConnect('peer-a');
    hb.sendPing('peer-a'); // creates pong timeout

    expect(hb.pingTimers.has('peer-a')).toBe(true);
    expect(hb.pongTimeouts.has('peer-a')).toBe(true);

    hb.stopHeartbeat('peer-a');

    expect(hb.pingTimers.has('peer-a')).toBe(false);
    expect(hb.pongTimeouts.has('peer-a')).toBe(false);
    expect(hb.pendingPing.has('peer-a')).toBe(false);
  });

  test('disconnect stops heartbeat', () => {
    hb.simulateConnect('peer-a');
    expect(hb.pingTimers.has('peer-a')).toBe(true);

    hb.simulateDisconnect('peer-a');
    expect(hb.pingTimers.has('peer-a')).toBe(false);
  });

  test('starting heartbeat twice for same peer is idempotent', () => {
    hb.simulateConnect('peer-a');
    const timersAfterFirst = hb.pingTimers.size;

    hb.startHeartbeat('peer-a'); // second call — should be no-op

    expect(hb.pingTimers.size).toBe(timersAfterFirst);
  });

  // ── setHeartbeatEnabled ────────────────────────────────────────────────

  test('setHeartbeatEnabled(false) stops all heartbeats', () => {
    hb.simulateConnect('peer-a');
    hb.simulateConnect('peer-b');

    expect(hb.pingTimers.size).toBe(2);

    hb.setHeartbeatEnabled(false);

    expect(hb.pingTimers.size).toBe(0);
  });

  test('setHeartbeatEnabled(false) prevents new pings', async () => {
    hb.simulateConnect('peer-a');
    hb.setHeartbeatEnabled(false);

    await sleep(HeartbeatStateMachine.PING_INTERVAL_MS + 5);

    const pings = hb.sentMessages.filter(m => (m.data as any).type === 'heartbeat:ping');
    expect(pings.length).toBe(0);
  });

  test('setHeartbeatEnabled(true) restarts heartbeats for connected peers', () => {
    hb.setHeartbeatEnabled(false);
    hb.simulateConnect('peer-a');

    // With disabled hb, startHeartbeat inside simulateConnect was a no-op
    expect(hb.pingTimers.size).toBe(0);

    hb.setHeartbeatEnabled(true);

    expect(hb.pingTimers.has('peer-a')).toBe(true);
  });

  // ── Ping not sent to disconnected peers ───────────────────────────────

  test('ping not sent if peer not in connected state', () => {
    hb.connections.set('peer-a', { status: 'failed' });

    hb.sendPing('peer-a');

    const pings = hb.sentMessages.filter(m => (m.data as any).type === 'heartbeat:ping');
    expect(pings.length).toBe(0);
    // No pong timeout either (ping wasn't sent)
    expect(hb.pongTimeouts.has('peer-a')).toBe(false);
  });

  // ── destroy ───────────────────────────────────────────────────────────

  test('destroy clears all heartbeat state', () => {
    hb.simulateConnect('peer-a');
    hb.simulateConnect('peer-b');
    hb.sendPing('peer-a');

    hb.destroy();

    expect(hb.pingTimers.size).toBe(0);
    expect(hb.pongTimeouts.size).toBe(0);
    expect(hb.pendingPing.size).toBe(0);
  });

  // ── Rapid reconnect scenario ───────────────────────────────────────────

  test('after reconnect, new heartbeat starts for re-connected peer', async () => {
    hb.simulateConnect('peer-a');

    // Simulate drop + reconnect
    hb.simulateDisconnect('peer-a');
    hb.simulateConnect('peer-a');

    await sleep(HeartbeatStateMachine.PING_INTERVAL_MS + 5);

    const pings = hb.sentMessages.filter(m => m.peerId === 'peer-a' && (m.data as any).type === 'heartbeat:ping');
    expect(pings.length).toBeGreaterThanOrEqual(1);
  });
});
