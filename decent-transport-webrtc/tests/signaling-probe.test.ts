/**
 * Tests for the periodic signaling-server reconnect probe added by the
 * "Hermes DecentChat bridge silently zombies on signaling drop" fix
 * (ALE-1109).
 *
 * The bug: in Node, the event-driven `_scheduleSignalingReconnect` chain
 * (kicked off by `peer.on('disconnected')`) can die silently because PeerJS
 * does NOT re-fire `disconnected` after a failed `peer.reconnect()`. The
 * browser path masks this with `window.online` listeners; Node has none.
 *
 * The fix is a periodic safety-net that:
 *   1. Resets the stale retry counter so we don't permanently honour
 *      `SIGNALING_MAX_RETRIES`.
 *   2. Re-arms `_scheduleSignalingReconnect` if no timer is currently armed.
 *   3. Fires an immediate idempotent `peer.reconnect()` kick.
 *
 * These tests poke the private state directly (via `as any` casts) to
 * simulate a stuck SignalingInstance, then call the private probe method
 * and assert recovery actions happened. This avoids needing a real PeerJS
 * server or WebSocket, which is the same approach `peer-reconnect.test.ts`
 * already uses for the per-peer reconnect state machine.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { PeerTransport } from '../src/PeerTransport';

// ---------------------------------------------------------------------------
// Fake PeerJS Peer that records reconnect calls
// ---------------------------------------------------------------------------

interface FakePeer {
  destroyed: boolean;
  disconnected: boolean;
  reconnectCalls: number;
  reconnectShouldThrow: boolean;
  reconnect: () => void;
}

function createFakePeer(): FakePeer {
  const fake: FakePeer = {
    destroyed: false,
    disconnected: true, // simulate the post-drop state
    reconnectCalls: 0,
    reconnectShouldThrow: false,
    reconnect() {
      fake.reconnectCalls += 1;
      if (fake.reconnectShouldThrow) {
        throw new Error('Lost connection to server');
      }
      // Real PeerJS does NOT re-fire `disconnected` after a failed reconnect.
      // We deliberately do not flip `disconnected` back to false so that the
      // probe sees a still-stuck instance on subsequent ticks.
    },
  };
  return fake;
}

interface FakeSignalingInstance {
  peer: FakePeer;
  url: string;
  label: string;
  connected: boolean;
}

function makeStuckInstance(url = 'https://example.peerjs.com/'): FakeSignalingInstance {
  return {
    peer: createFakePeer(),
    url,
    label: url,
    connected: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers to manipulate PeerTransport's private state from tests
// ---------------------------------------------------------------------------

function injectInstances(
  transport: PeerTransport,
  instances: FakeSignalingInstance[],
): void {
  (transport as any).signalingInstances = instances;
}

function callProbe(transport: PeerTransport): void {
  (transport as any)._periodicSignalingProbe();
}

function getTimers(transport: PeerTransport): Map<string, unknown> {
  return (transport as any)._signalingReconnectTimers;
}

function getAttempts(transport: PeerTransport): Map<string, number> {
  return (transport as any)._signalingReconnectAttempts;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PeerTransport periodic signaling probe', () => {
  let transport: PeerTransport;

  beforeEach(() => {
    transport = new PeerTransport({});
  });

  test('does nothing when there are no signaling instances', () => {
    injectInstances(transport, []);
    expect(() => callProbe(transport)).not.toThrow();
  });

  test('skips destroyed peers', () => {
    const instance = makeStuckInstance();
    instance.peer.destroyed = true;
    injectInstances(transport, [instance]);

    callProbe(transport);

    expect(instance.peer.reconnectCalls).toBe(0);
    expect(getTimers(transport).has(instance.url)).toBe(false);
  });

  test('skips already-connected instances', () => {
    const instance = makeStuckInstance();
    instance.connected = true;
    injectInstances(transport, [instance]);

    callProbe(transport);

    expect(instance.peer.reconnectCalls).toBe(0);
    expect(getTimers(transport).has(instance.url)).toBe(false);
  });

  test('immediately calls peer.reconnect() on a stuck instance', () => {
    const instance = makeStuckInstance();
    injectInstances(transport, [instance]);

    callProbe(transport);

    expect(instance.peer.reconnectCalls).toBe(1);
  });

  test('clears stale retry counter so the chain is no longer "given up"', () => {
    const instance = makeStuckInstance();
    injectInstances(transport, [instance]);
    // Simulate the chain having exhausted SIGNALING_MAX_RETRIES.
    getAttempts(transport).set(instance.url, 9999);

    callProbe(transport);

    expect(getAttempts(transport).has(instance.url)).toBe(false);
  });

  test('arms a new reconnect timer when no timer is currently scheduled', () => {
    const instance = makeStuckInstance();
    injectInstances(transport, [instance]);
    expect(getTimers(transport).has(instance.url)).toBe(false);

    callProbe(transport);

    expect(getTimers(transport).has(instance.url)).toBe(true);

    // Cleanup the timer we just armed so it doesn't fire after the test ends
    // and try to call into our fake peer at an unexpected moment.
    const timer = getTimers(transport).get(instance.url);
    if (timer) clearTimeout(timer as ReturnType<typeof setTimeout>);
    getTimers(transport).clear();
  });

  test('does not double-arm if a timer is already scheduled', () => {
    const instance = makeStuckInstance();
    injectInstances(transport, [instance]);
    // Simulate a timer already in flight.
    const sentinel = setTimeout(() => {}, 1_000_000);
    getTimers(transport).set(instance.url, sentinel);

    callProbe(transport);

    expect(getTimers(transport).get(instance.url)).toBe(sentinel);

    clearTimeout(sentinel);
    getTimers(transport).clear();
  });

  test('swallows a thrown peer.reconnect() so the probe loop survives', () => {
    const instance = makeStuckInstance();
    instance.peer.reconnectShouldThrow = true;
    injectInstances(transport, [instance]);

    expect(() => callProbe(transport)).not.toThrow();

    // Cleanup the timer the probe armed.
    const timer = getTimers(transport).get(instance.url);
    if (timer) clearTimeout(timer as ReturnType<typeof setTimeout>);
    getTimers(transport).clear();
  });

  test('handles a mix of connected, stuck, and destroyed instances correctly', () => {
    const stuck = makeStuckInstance('https://stuck.example/');
    const connected = makeStuckInstance('https://up.example/');
    connected.connected = true;
    const destroyed = makeStuckInstance('https://gone.example/');
    destroyed.peer.destroyed = true;
    injectInstances(transport, [stuck, connected, destroyed]);

    callProbe(transport);

    expect(stuck.peer.reconnectCalls).toBe(1);
    expect(connected.peer.reconnectCalls).toBe(0);
    expect(destroyed.peer.reconnectCalls).toBe(0);
    expect(getTimers(transport).has(stuck.url)).toBe(true);
    expect(getTimers(transport).has(connected.url)).toBe(false);
    expect(getTimers(transport).has(destroyed.url)).toBe(false);

    // Cleanup
    for (const t of getTimers(transport).values()) {
      clearTimeout(t as ReturnType<typeof setTimeout>);
    }
    getTimers(transport).clear();
  });
});
