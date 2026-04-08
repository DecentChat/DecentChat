/**
 * Tests for the bridge-side signaling-state tracking added by the
 * "Hermes DecentChat bridge silently zombies on signaling drop" fix
 * (ALE-1109).
 *
 * The bridge previously set `connected = true` once at start() and never
 * touched it again, so `isConnected()` (and the `/health` endpoint) would
 * lie indefinitely after a signaling drop. The fix subscribes to the
 * underlying PeerTransport's `onSignalingStateChange` callback and mirrors
 * the live state.
 *
 * These tests poke `DecentHermesPeer`'s private fields directly via cast
 * to simulate a started bridge without needing real PeerJS / crypto / disk
 * setup. The actual end-to-end wire-up is exercised by the bridge HTTP
 * tests in `bridge-http.test.ts` and the integration suite.
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import { DecentHermesPeer } from '../src/peer.js';

const VALID_SEED =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function makeBridge(): DecentHermesPeer {
  return new DecentHermesPeer({ seedPhrase: VALID_SEED });
}

/** Force the bridge into "started" state without doing real I/O. */
function fakeStarted(bridge: DecentHermesPeer): void {
  (bridge as any).connected = true;
  // Make `peer` truthy so isConnected()'s `!this.peer` short-circuit doesn't
  // fire. Any non-null sentinel works since we never call methods on it.
  (bridge as any).peer = {};
}

function callHandler(
  bridge: DecentHermesPeer,
  status: Array<{ url: string; label: string; connected: boolean }>,
): void {
  (bridge as any).handleSignalingStateChange(status);
}

describe('DecentHermesPeer signaling-state tracking', () => {
  let bridge: DecentHermesPeer;

  beforeEach(() => {
    bridge = makeBridge();
  });

  test('isConnected() returns false before start()', () => {
    expect(bridge.isConnected()).toBe(false);
  });

  test('isConnected() returns true immediately after start (pre-state grace)', () => {
    fakeStarted(bridge);
    expect(bridge.isConnected()).toBe(true);
  });

  test('after first state event with no servers connected, isConnected() flips to false', () => {
    fakeStarted(bridge);
    callHandler(bridge, [
      { url: 'https://0.peerjs.com/', label: '0.peerjs.com', connected: false },
    ]);
    expect(bridge.isConnected()).toBe(false);
  });

  test('after first state event with one server connected, isConnected() stays true', () => {
    fakeStarted(bridge);
    callHandler(bridge, [
      { url: 'https://0.peerjs.com/', label: '0.peerjs.com', connected: true },
    ]);
    expect(bridge.isConnected()).toBe(true);
  });

  test('multi-server: isConnected() is true if ANY server is up', () => {
    fakeStarted(bridge);
    callHandler(bridge, [
      { url: 'https://0.peerjs.com/', label: 'public', connected: false },
      { url: 'https://local/', label: 'local', connected: true },
    ]);
    expect(bridge.isConnected()).toBe(true);
  });

  test('all-servers-down → all-back-up flips isConnected back to true', () => {
    fakeStarted(bridge);
    callHandler(bridge, [
      { url: 'https://a/', label: 'a', connected: false },
      { url: 'https://b/', label: 'b', connected: false },
    ]);
    expect(bridge.isConnected()).toBe(false);

    callHandler(bridge, [
      { url: 'https://a/', label: 'a', connected: true },
      { url: 'https://b/', label: 'b', connected: false },
    ]);
    expect(bridge.isConnected()).toBe(true);
  });

  test('getSignalingState() reports downForMs after a drop', async () => {
    fakeStarted(bridge);
    callHandler(bridge, [{ url: 'x', label: 'x', connected: false }]);
    // Wait a tick so downForMs is non-zero.
    await new Promise((r) => setTimeout(r, 5));
    const state = bridge.getSignalingState();
    expect(state.hasState).toBe(true);
    expect(state.anyConnected).toBe(false);
    expect(state.downForMs).not.toBeNull();
    expect((state.downForMs ?? 0) >= 0).toBe(true);
  });

  test('getSignalingState() reports downForMs null while connected', () => {
    fakeStarted(bridge);
    callHandler(bridge, [{ url: 'x', label: 'x', connected: true }]);
    const state = bridge.getSignalingState();
    expect(state.hasState).toBe(true);
    expect(state.anyConnected).toBe(true);
    expect(state.downForMs).toBeNull();
  });

  test('recovery clears downForMs and the SOS log throttle', () => {
    fakeStarted(bridge);
    callHandler(bridge, [{ url: 'x', label: 'x', connected: false }]);
    // Mark the SOS log throttle as if it just fired.
    (bridge as any).signalingStuckLastLogAt = Date.now();
    expect((bridge as any).signalingDownSince).not.toBeNull();

    callHandler(bridge, [{ url: 'x', label: 'x', connected: true }]);

    expect((bridge as any).signalingDownSince).toBeNull();
    expect((bridge as any).signalingStuckLastLogAt).toBe(0);
  });

  test('handler is idempotent: repeated all-down events do not reset downForMs', async () => {
    fakeStarted(bridge);
    callHandler(bridge, [{ url: 'x', label: 'x', connected: false }]);
    const firstDownAt = (bridge as any).signalingDownSince as number;
    await new Promise((r) => setTimeout(r, 5));
    callHandler(bridge, [{ url: 'x', label: 'x', connected: false }]);
    expect((bridge as any).signalingDownSince).toBe(firstDownAt);
  });
});
