/**
 * Connecting state transitions tests
 *
 * Minimal in-memory simulation (no real WebRTC) verifying that
 * connectingPeers is populated/cleared correctly during the
 * connect → handshake → ready lifecycle.
 *
 * Same pattern as the SimPeer approach in three-peer-join.test.ts.
 */

import { describe, test, expect, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// In-memory connection state machine
// ---------------------------------------------------------------------------

interface ConnectingState {
  /** Peers we are actively connecting to (not yet handshake-complete) */
  connectingPeers: Set<string>;
  /** Peers with completed handshake (fully ready) */
  connectedPeers: Set<string>;
  /** Max retries before giving up on a peer */
  maxRetries: number;
  /** Track retry counts per peer */
  retryCounts: Map<string, number>;
}

function createState(maxRetries = 3): ConnectingState {
  return {
    connectingPeers: new Set(),
    connectedPeers: new Set(),
    maxRetries,
    retryCounts: new Map(),
  };
}

/** Simulate initiating a connection to a peer */
function connect(state: ConnectingState, peerId: string): boolean {
  // Don't add if already connected
  if (state.connectedPeers.has(peerId)) return false;
  // Don't add if already connecting
  if (state.connectingPeers.has(peerId)) return false;

  state.connectingPeers.add(peerId);
  state.retryCounts.set(peerId, 0);
  return true;
}

/** Simulate handshake completing successfully */
function handshakeComplete(state: ConnectingState, peerId: string): void {
  state.connectingPeers.delete(peerId);
  state.connectedPeers.add(peerId);
  state.retryCounts.delete(peerId);
}

/** Simulate a connection attempt failing — retries or gives up */
function connectionFailed(state: ConnectingState, peerId: string): boolean {
  const retries = (state.retryCounts.get(peerId) ?? 0) + 1;
  state.retryCounts.set(peerId, retries);

  if (retries >= state.maxRetries) {
    // Max retries exhausted — give up
    state.connectingPeers.delete(peerId);
    state.retryCounts.delete(peerId);
    return false; // gave up
  }
  return true; // will retry
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Connecting state transitions', () => {
  let state: ConnectingState;

  beforeEach(() => {
    state = createState(3);
  });

  // 3a
  test('connectingPeers is populated when connect() fires, cleared on handshake complete', () => {
    connect(state, 'alice');

    expect(state.connectingPeers.has('alice')).toBe(true);
    expect(state.connectedPeers.has('alice')).toBe(false);

    handshakeComplete(state, 'alice');

    expect(state.connectingPeers.has('alice')).toBe(false);
    expect(state.connectedPeers.has('alice')).toBe(true);
  });

  // 3b
  test('connectingPeers is cleared on max-retry exhaustion', () => {
    connect(state, 'bob');
    expect(state.connectingPeers.has('bob')).toBe(true);

    // Fail 3 times (maxRetries = 3)
    connectionFailed(state, 'bob'); // retry 1
    expect(state.connectingPeers.has('bob')).toBe(true);

    connectionFailed(state, 'bob'); // retry 2
    expect(state.connectingPeers.has('bob')).toBe(true);

    const willRetry = connectionFailed(state, 'bob'); // retry 3 — exhausted
    expect(willRetry).toBe(false);
    expect(state.connectingPeers.has('bob')).toBe(false);
    expect(state.connectedPeers.has('bob')).toBe(false); // never connected
  });

  // 3c
  test('peer already in connectedPeers is not added to connectingPeers', () => {
    // Manually mark alice as already connected
    state.connectedPeers.add('alice');

    const added = connect(state, 'alice');
    expect(added).toBe(false);
    expect(state.connectingPeers.has('alice')).toBe(false);
    expect(state.connectedPeers.has('alice')).toBe(true);
  });

  // Additional: multiple peers in different states
  test('multiple peers tracked independently', () => {
    connect(state, 'alice');
    connect(state, 'bob');
    connect(state, 'charlie');

    expect(state.connectingPeers.size).toBe(3);

    handshakeComplete(state, 'alice');
    connectionFailed(state, 'bob');
    connectionFailed(state, 'bob');
    connectionFailed(state, 'bob'); // exhausted

    expect(state.connectingPeers.has('alice')).toBe(false);
    expect(state.connectedPeers.has('alice')).toBe(true);

    expect(state.connectingPeers.has('bob')).toBe(false);
    expect(state.connectedPeers.has('bob')).toBe(false);

    expect(state.connectingPeers.has('charlie')).toBe(true); // still connecting
  });

  // Duplicate connect calls are no-ops
  test('duplicate connect() call is a no-op', () => {
    connect(state, 'alice');
    const second = connect(state, 'alice');

    expect(second).toBe(false);
    expect(state.connectingPeers.size).toBe(1);
  });
});
