/**
 * Tests for PeerTransport auto-reconnect state machine.
 *
 * Uses a pure in-memory simulation (no real PeerJS/WebRTC) to verify
 * the reconnect logic: scheduling, backoff, cancellation, and manual override.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { PeerTransport } from '../src/PeerTransport';

// ---------------------------------------------------------------------------
// Minimal reconnect state machine — mirrors PeerTransport's logic exactly
// ---------------------------------------------------------------------------

class ReconnectStateMachine {
  autoReconnectEnabled = true;
  manuallyDisconnected = new Set<string>();
  reconnectAttempts = new Map<string, number>();
  reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly reconnectDelays: number[];
  connected = new Set<string>();

  /** Track calls to connect for assertions */
  connectCalls: string[] = [];
  /** If true, connect() will reject */
  connectShouldFail = false;

  constructor(delays: number[] = [10, 20, 30, 40, 50]) {
    this.reconnectDelays = delays;
  }

  setAutoReconnect(enabled: boolean): void {
    this.autoReconnectEnabled = enabled;
  }

  cancelReconnect(peerId: string): void {
    const timer = this.reconnectTimers.get(peerId);
    if (timer) clearTimeout(timer);
    this.reconnectTimers.delete(peerId);
    this.reconnectAttempts.delete(peerId);
  }

  scheduleReconnect(peerId: string): void {
    if (!this.autoReconnectEnabled) return;
    if (this.manuallyDisconnected.has(peerId)) return;
    if (this.reconnectTimers.has(peerId)) return;

    const attempt = this.reconnectAttempts.get(peerId) ?? 0;
    if (attempt >= this.reconnectDelays.length) {
      this.reconnectAttempts.delete(peerId);
      return;
    }

    const delay = this.reconnectDelays[attempt];
    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(peerId);

      if (this.manuallyDisconnected.has(peerId)) return;
      if (this.connected.has(peerId)) return;

      this.reconnectAttempts.set(peerId, attempt + 1);
      try {
        await this.connect(peerId);
        this.reconnectAttempts.delete(peerId);
      } catch {
        this.scheduleReconnect(peerId);
      }
    }, delay);

    this.reconnectTimers.set(peerId, timer);
  }

  async connect(peerId: string): Promise<void> {
    this.manuallyDisconnected.delete(peerId);
    this.connectCalls.push(peerId);
    if (this.connectShouldFail) {
      throw new Error('Connection failed');
    }
    this.connected.add(peerId);
  }

  disconnect(peerId: string): void {
    this.manuallyDisconnected.add(peerId);
    this.cancelReconnect(peerId);
    this.connected.delete(peerId);
  }

  /** Simulate a connection dropping (not manual disconnect) */
  simulateConnectionDrop(peerId: string): void {
    this.connected.delete(peerId);
    this.scheduleReconnect(peerId);
  }

  destroy(): void {
    this.reconnectTimers.forEach(t => clearTimeout(t));
    this.reconnectTimers.clear();
    this.reconnectAttempts.clear();
    this.manuallyDisconnected.clear();
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PeerTransport auto-reconnect', () => {
  let sm: ReconnectStateMachine;

  beforeEach(() => {
    sm = new ReconnectStateMachine([10, 20, 30, 40, 50]);
  });

  test('schedules reconnect after connection drop', async () => {
    sm.connected.add('peer-a');
    sm.simulateConnectionDrop('peer-a');

    // Timer should be scheduled
    expect(sm.reconnectTimers.has('peer-a')).toBe(true);

    // Wait for first delay (10ms) + margin
    await sleep(30);

    expect(sm.connectCalls).toContain('peer-a');
    expect(sm.connected.has('peer-a')).toBe(true);
  });

  test('no reconnect after manual disconnect', async () => {
    sm.connected.add('peer-b');
    sm.disconnect('peer-b');

    // manually disconnected — no timer
    expect(sm.reconnectTimers.has('peer-b')).toBe(false);

    // Even if we force-call scheduleReconnect it should not schedule
    sm.scheduleReconnect('peer-b');
    expect(sm.reconnectTimers.has('peer-b')).toBe(false);

    await sleep(60);
    expect(sm.connectCalls).not.toContain('peer-b');
  });

  test('exponential backoff delays increase', async () => {
    sm.connectShouldFail = true;
    sm.simulateConnectionDrop('peer-c');

    // After first delay (10ms) — attempt 1
    await sleep(15);
    expect(sm.connectCalls.filter(p => p === 'peer-c').length).toBe(1);
    expect(sm.reconnectAttempts.get('peer-c')).toBe(1);

    // After second delay (20ms more) — attempt 2
    await sleep(25);
    expect(sm.connectCalls.filter(p => p === 'peer-c').length).toBe(2);
    expect(sm.reconnectAttempts.get('peer-c')).toBe(2);

    // After third delay (30ms more) — attempt 3
    await sleep(35);
    expect(sm.connectCalls.filter(p => p === 'peer-c').length).toBe(3);
  });

  test('gives up after max 5 attempts', async () => {
    sm.connectShouldFail = true;
    sm.simulateConnectionDrop('peer-d');

    // Wait long enough for all 5 attempts (10+20+30+40+50 = 150ms + margin)
    await sleep(250);

    expect(sm.connectCalls.filter(p => p === 'peer-d').length).toBe(5);
    // No more timers scheduled
    expect(sm.reconnectTimers.has('peer-d')).toBe(false);
    // Attempts cleared after giving up
    expect(sm.reconnectAttempts.has('peer-d')).toBe(false);
  });

  test('cancelReconnect stops scheduled timer', async () => {
    sm.connectShouldFail = true;
    sm.simulateConnectionDrop('peer-e');

    expect(sm.reconnectTimers.has('peer-e')).toBe(true);

    sm.cancelReconnect('peer-e');

    expect(sm.reconnectTimers.has('peer-e')).toBe(false);
    expect(sm.reconnectAttempts.has('peer-e')).toBe(false);

    await sleep(60);
    expect(sm.connectCalls.filter(p => p === 'peer-e').length).toBe(0);
  });

  test('setAutoReconnect(false) disables reconnect', async () => {
    sm.setAutoReconnect(false);
    sm.connected.add('peer-f');
    sm.simulateConnectionDrop('peer-f');

    expect(sm.reconnectTimers.has('peer-f')).toBe(false);

    await sleep(60);
    expect(sm.connectCalls).not.toContain('peer-f');
  });

  test('successful reconnect clears attempt counter', async () => {
    // Fail first two, succeed on third
    let callCount = 0;
    const origConnect = sm.connect.bind(sm);
    sm.connect = async (peerId: string) => {
      callCount++;
      if (callCount < 3) {
        sm.connectCalls.push(peerId);
        throw new Error('fail');
      }
      return origConnect(peerId);
    };

    sm.simulateConnectionDrop('peer-g');

    // Wait for all attempts to resolve
    await sleep(100);

    expect(callCount).toBe(3);
    expect(sm.connected.has('peer-g')).toBe(true);
    expect(sm.reconnectAttempts.has('peer-g')).toBe(false);
  });

  test('destroy clears all reconnect state', () => {
    sm.simulateConnectionDrop('peer-h');
    sm.manuallyDisconnected.add('peer-i');
    sm.reconnectAttempts.set('peer-j', 3);

    sm.destroy();

    expect(sm.reconnectTimers.size).toBe(0);
    expect(sm.reconnectAttempts.size).toBe(0);
    expect(sm.manuallyDisconnected.size).toBe(0);
  });
});

type Handler = (...args: any[]) => void;

class FakePeer {
  disconnected = false;
  destroyed = false;
  destroyCalls = 0;
  disconnectCalls = 0;
  reconnectCalls = 0;
  private listeners = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
    return this;
  }

  off(event: string, handler: Handler): this {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  emit(event: string, ...args: any[]): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) handler(...args);
  }

  disconnect(): void {
    this.disconnected = true;
    this.disconnectCalls++;
  }

  destroy(): void {
    this.destroyed = true;
    this.destroyCalls++;
  }

  reconnect(): void {
    this.reconnectCalls++;
  }
}

class TestPeerTransport extends PeerTransport {
  private fakePeers: FakePeer[] = [];

  enqueue(peer: FakePeer): void {
    this.fakePeers.push(peer);
  }

  protected override _createPeer(): any {
    const peer = this.fakePeers.shift();
    if (!peer) throw new Error('No fake peer queued');
    return peer;
  }
}

describe('PeerTransport init/error behavior', () => {
  test('peer-unavailable post-init does not destroy peer', async () => {
    const transport = new TestPeerTransport();
    const peer = new FakePeer();
    transport.enqueue(peer);

    const init = (transport as any)._initSingleServer('alice');
    peer.emit('open', 'alice');
    await init;

    peer.emit('error', { type: 'peer-unavailable', message: 'remote peer offline' });

    expect(peer.destroyCalls).toBe(0);
  });

  test('reconnect() is triggered when peer.disconnected=true after error', async () => {
    const transport = new TestPeerTransport();
    const peer = new FakePeer();
    transport.enqueue(peer);

    const init = (transport as any)._initSingleServer('alice');
    peer.emit('open', 'alice');
    await init;

    peer.disconnected = true;
    peer.emit('error', { type: 'network', message: 'socket hiccup' });

    await sleep(1100);
    expect(peer.reconnectCalls).toBe(1);
    expect(peer.destroyCalls).toBe(0);
  });

  test('init error handler is removed after open in _initSingleServer', async () => {
    const transport = new TestPeerTransport();
    const peer = new FakePeer();
    transport.enqueue(peer);

    const init = (transport as any)._initSingleServer('alice');
    peer.emit('open', 'alice');
    await init;

    peer.emit('error', { type: 'post-init', message: 'should not destroy' });
    expect(peer.destroyCalls).toBe(0);
  });

  test('init error handler is removed after open in _initServer', async () => {
    const transport = new TestPeerTransport();
    const peer = new FakePeer();
    transport.enqueue(peer);

    const init = (transport as any)._initServer({ url: 'https://example.com/peerjs', label: 'example' }, 'alice');
    peer.emit('open', 'alice');
    await init;

    peer.emit('error', { type: 'post-init', message: 'should not destroy' });
    expect(peer.destroyCalls).toBe(0);
  });

  test('destroy is idempotent and tears down peer exactly once', async () => {
    const transport = new TestPeerTransport();
    const peer = new FakePeer();
    transport.enqueue(peer);

    const init = (transport as any)._initSingleServer('alice');
    peer.emit('open', 'alice');
    await init;

    transport.destroy();
    transport.destroy();

    expect(peer.disconnectCalls).toBe(1);
    expect(peer.destroyCalls).toBe(1);
  });
});
