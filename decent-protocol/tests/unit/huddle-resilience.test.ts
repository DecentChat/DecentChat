/**
 * GAP 10: Huddle Resilience — Voice calling edge cases
 *
 * Scenarios: peer drops mid-huddle, mic permission denied after success,
 * rejoin immediately, 3-peer one leaves.
 *
 * Uses mocks/stubs for browser getUserMedia.
 */

import { describe, test, expect, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// In-memory Huddle state machine (mirrors HuddleController logic)
// No real WebRTC — pure state machine test
// ---------------------------------------------------------------------------

type HuddleState = 'idle' | 'joining' | 'active' | 'reconnecting' | 'error';

interface HuddlePeer {
  peerId: string;
  muted: boolean;
  hasStream: boolean;
}

class HuddleStateMachine {
  state: HuddleState = 'idle';
  localPeerId: string;
  channelId: string | null = null;
  peers = new Map<string, HuddlePeer>();
  localMuted = false;
  localStreamActive = false;
  errors: string[] = [];
  events: string[] = [];

  /** Mock getUserMedia */
  getUserMediaMock: (() => Promise<{ active: boolean }>) | null = null;

  constructor(localPeerId: string) {
    this.localPeerId = localPeerId;
  }

  async join(channelId: string): Promise<boolean> {
    if (this.state === 'active' && this.channelId === channelId) {
      return true; // Already in this huddle
    }

    this.state = 'joining';
    this.channelId = channelId;
    this.events.push('joining');

    try {
      const stream = await this.acquireMedia();
      if (!stream) {
        this.state = 'error';
        this.errors.push('mic-denied');
        this.events.push('error:mic-denied');
        return false;
      }

      this.localStreamActive = true;
      this.state = 'active';
      this.events.push('active');
      return true;
    } catch (e: any) {
      this.state = 'error';
      this.errors.push(e.message || 'unknown');
      this.events.push(`error:${e.message}`);
      return false;
    }
  }

  private async acquireMedia(): Promise<{ active: boolean } | null> {
    if (this.getUserMediaMock) {
      try {
        return await this.getUserMediaMock();
      } catch {
        return null;
      }
    }
    return { active: true }; // Default: success
  }

  addPeer(peerId: string): void {
    if (this.state !== 'active') return;
    this.peers.set(peerId, { peerId, muted: false, hasStream: true });
    this.events.push(`peer-joined:${peerId}`);
  }

  removePeer(peerId: string): void {
    this.peers.delete(peerId);
    this.events.push(`peer-left:${peerId}`);

    // If we're the only one left, huddle ends
    if (this.state === 'active' && this.peers.size === 0) {
      this.events.push('huddle-empty');
    }
  }

  handlePeerDrop(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.hasStream = false;
      this.events.push(`peer-dropped:${peerId}`);
    }
  }

  handlePeerReconnect(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.hasStream = true;
      this.events.push(`peer-reconnected:${peerId}`);
    } else {
      this.addPeer(peerId);
    }
  }

  async handleLocalStreamLost(): Promise<void> {
    this.localStreamActive = false;
    this.state = 'reconnecting';
    this.events.push('stream-lost');

    // Try to re-acquire
    try {
      const stream = await this.acquireMedia();
      if (stream) {
        this.localStreamActive = true;
        this.state = 'active';
        this.events.push('stream-restored');
      } else {
        this.state = 'error';
        this.errors.push('re-acquire-failed');
        this.events.push('error:re-acquire-failed');
      }
    } catch {
      this.state = 'error';
      this.errors.push('re-acquire-failed');
      this.events.push('error:re-acquire-failed');
    }
  }

  leave(): void {
    this.state = 'idle';
    this.localStreamActive = false;
    this.peers.clear();
    this.channelId = null;
    this.events.push('left');
  }

  get activePeerCount(): number {
    return this.peers.size;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Huddle Resilience — Peer drops mid-huddle', () => {
  let huddle: HuddleStateMachine;

  beforeEach(() => {
    huddle = new HuddleStateMachine('local-peer');
  });

  test('peer drop is detected and recorded', async () => {
    await huddle.join('huddle-1');
    huddle.addPeer('peer-a');
    huddle.addPeer('peer-b');

    expect(huddle.activePeerCount).toBe(2);

    // peer-a drops
    huddle.handlePeerDrop('peer-a');

    const peerA = huddle.peers.get('peer-a');
    expect(peerA).toBeDefined();
    expect(peerA!.hasStream).toBe(false);
    expect(huddle.events).toContain('peer-dropped:peer-a');
  });

  test('dropped peer can reconnect', async () => {
    await huddle.join('huddle-1');
    huddle.addPeer('peer-a');

    huddle.handlePeerDrop('peer-a');
    expect(huddle.peers.get('peer-a')!.hasStream).toBe(false);

    huddle.handlePeerReconnect('peer-a');
    expect(huddle.peers.get('peer-a')!.hasStream).toBe(true);
    expect(huddle.events).toContain('peer-reconnected:peer-a');
  });

  test('huddle continues with remaining peers after one drops', async () => {
    await huddle.join('huddle-1');
    huddle.addPeer('peer-a');
    huddle.addPeer('peer-b');

    huddle.removePeer('peer-a');

    expect(huddle.state).toBe('active');
    expect(huddle.activePeerCount).toBe(1);
    expect(huddle.peers.has('peer-a')).toBe(false);
    expect(huddle.peers.has('peer-b')).toBe(true);
  });
});

describe('Huddle Resilience — Mic permission denied after success', () => {
  test('mic denied on join prevents huddle start', async () => {
    const huddle = new HuddleStateMachine('local-peer');
    huddle.getUserMediaMock = async () => { throw new Error('NotAllowedError'); };

    const joined = await huddle.join('huddle-1');

    expect(joined).toBe(false);
    expect(huddle.state).toBe('error');
    expect(huddle.errors).toContain('mic-denied');
  });

  test('stream lost mid-huddle triggers reconnect attempt', async () => {
    const huddle = new HuddleStateMachine('local-peer');
    let callCount = 0;
    huddle.getUserMediaMock = async () => {
      callCount++;
      return { active: true };
    };

    await huddle.join('huddle-1');
    expect(huddle.state).toBe('active');

    // Stream lost
    await huddle.handleLocalStreamLost();

    expect(huddle.state).toBe('active');
    expect(huddle.events).toContain('stream-lost');
    expect(huddle.events).toContain('stream-restored');
    expect(callCount).toBe(2); // initial + re-acquire
  });

  test('stream lost with denied re-acquire goes to error state', async () => {
    const huddle = new HuddleStateMachine('local-peer');
    let callCount = 0;
    huddle.getUserMediaMock = async () => {
      callCount++;
      if (callCount > 1) throw new Error('NotAllowedError');
      return { active: true };
    };

    await huddle.join('huddle-1');
    expect(huddle.state).toBe('active');

    await huddle.handleLocalStreamLost();

    expect(huddle.state).toBe('error');
    expect(huddle.errors).toContain('re-acquire-failed');
  });
});

describe('Huddle Resilience — Rejoin immediately', () => {
  test('rejoin same huddle is idempotent', async () => {
    const huddle = new HuddleStateMachine('local-peer');
    await huddle.join('huddle-1');
    expect(huddle.state).toBe('active');

    // Rejoin same huddle
    const result = await huddle.join('huddle-1');
    expect(result).toBe(true);
    expect(huddle.state).toBe('active');
  });

  test('leave and immediately rejoin works', async () => {
    const huddle = new HuddleStateMachine('local-peer');
    await huddle.join('huddle-1');
    huddle.addPeer('peer-a');

    huddle.leave();
    expect(huddle.state).toBe('idle');
    expect(huddle.activePeerCount).toBe(0);

    await huddle.join('huddle-1');
    expect(huddle.state).toBe('active');
  });

  test('rapid leave/join cycles do not corrupt state', async () => {
    const huddle = new HuddleStateMachine('local-peer');

    for (let i = 0; i < 5; i++) {
      await huddle.join('huddle-1');
      huddle.addPeer(`peer-${i}`);
      huddle.leave();
    }

    expect(huddle.state).toBe('idle');
    expect(huddle.activePeerCount).toBe(0);
    expect(huddle.channelId).toBeNull();
  });
});

describe('Huddle Resilience — 3-peer, one leaves', () => {
  test('3-peer huddle: one leaves, other two continue', async () => {
    const huddle = new HuddleStateMachine('local-peer');
    await huddle.join('huddle-1');
    huddle.addPeer('peer-a');
    huddle.addPeer('peer-b');

    expect(huddle.activePeerCount).toBe(2);

    // peer-a leaves
    huddle.removePeer('peer-a');

    expect(huddle.state).toBe('active');
    expect(huddle.activePeerCount).toBe(1);
    expect(huddle.peers.has('peer-b')).toBe(true);
  });

  test('3-peer huddle: all remote peers leave, local notified', async () => {
    const huddle = new HuddleStateMachine('local-peer');
    await huddle.join('huddle-1');
    huddle.addPeer('peer-a');
    huddle.addPeer('peer-b');

    huddle.removePeer('peer-a');
    huddle.removePeer('peer-b');

    expect(huddle.activePeerCount).toBe(0);
    expect(huddle.events).toContain('huddle-empty');
  });

  test('peer removed from huddle cannot send events', async () => {
    const huddle = new HuddleStateMachine('local-peer');
    await huddle.join('huddle-1');
    huddle.addPeer('peer-a');

    huddle.removePeer('peer-a');

    // Dropping a non-existent peer is a no-op
    huddle.handlePeerDrop('peer-a');
    expect(huddle.peers.has('peer-a')).toBe(false);
  });

  test('peer drop then rejoin in 3-peer huddle', async () => {
    const huddle = new HuddleStateMachine('local-peer');
    await huddle.join('huddle-1');
    huddle.addPeer('peer-a');
    huddle.addPeer('peer-b');

    // peer-a drops
    huddle.handlePeerDrop('peer-a');
    expect(huddle.peers.get('peer-a')!.hasStream).toBe(false);

    // peer-a reconnects
    huddle.handlePeerReconnect('peer-a');
    expect(huddle.peers.get('peer-a')!.hasStream).toBe(true);

    // All three still in huddle
    expect(huddle.activePeerCount).toBe(2);
    expect(huddle.state).toBe('active');
  });
});
