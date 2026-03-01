import { describe, expect, test, beforeEach } from 'bun:test';
import { BotHuddleManager, type BotHuddleCallbacks } from '../src/huddle/BotHuddleManager.ts';

const MY_PEER = 'bot-peer-id';
const PEER_A = 'peer-alice';
const PEER_B = 'peer-bob';
const CHANNEL = 'channel-general';

function makeCallbacks(overrides: Partial<BotHuddleCallbacks> = {}): BotHuddleCallbacks & {
  sent: Array<{ peerId: string; data: object }>;
  broadcasts: object[];
  logs: string[];
} {
  const sent: Array<{ peerId: string; data: object }> = [];
  const broadcasts: object[] = [];
  const logs: string[] = [];
  return {
    sendSignal: (peerId, data) => { sent.push({ peerId, data }); return true; },
    broadcastSignal: (data) => { broadcasts.push(data); },
    getDisplayName: (peerId) => `name-${peerId}`,
    log: {
      info: (s) => logs.push(s),
      warn: (s) => logs.push(`WARN: ${s}`),
      error: (s) => logs.push(`ERROR: ${s}`),
    },
    sent,
    broadcasts,
    logs,
    ...overrides,
  };
}

describe('BotHuddleManager', () => {
  let manager: BotHuddleManager;
  let cb: ReturnType<typeof makeCallbacks>;

  beforeEach(() => {
    cb = makeCallbacks();
    manager = new BotHuddleManager(MY_PEER, cb, { autoJoin: true });
  });

  // ── State transitions ──────────────────────────────────────────────

  describe('state transitions', () => {
    test('starts inactive', () => {
      expect(manager.getState()).toBe('inactive');
      expect(manager.getActiveChannelId()).toBeNull();
      expect(manager.getParticipants()).toEqual([]);
    });

    test('inactive → in-call on huddle-announce (autoJoin)', async () => {
      await manager.handleSignal(PEER_A, {
        type: 'huddle-announce',
        channelId: CHANNEL,
        peerId: PEER_A,
      });

      expect(manager.getState()).toBe('in-call');
      expect(manager.getActiveChannelId()).toBe(CHANNEL);
    });

    test('in-call → inactive when all participants leave', async () => {
      // Join via announce
      await manager.handleSignal(PEER_A, {
        type: 'huddle-announce',
        channelId: CHANNEL,
        peerId: PEER_A,
      });
      expect(manager.getState()).toBe('in-call');

      // Peer leaves
      await manager.handleSignal(PEER_A, {
        type: 'huddle-leave',
        channelId: CHANNEL,
        peerId: PEER_A,
      });

      expect(manager.getState()).toBe('inactive');
      expect(manager.getActiveChannelId()).toBeNull();
      expect(manager.getParticipants()).toEqual([]);
    });

    test('full cycle: inactive → in-call → inactive', async () => {
      expect(manager.getState()).toBe('inactive');

      // Announce triggers auto-join
      await manager.handleSignal(PEER_A, {
        type: 'huddle-announce',
        channelId: CHANNEL,
        peerId: PEER_A,
      });
      expect(manager.getState()).toBe('in-call');

      // Another peer joins
      await manager.handleSignal(PEER_B, {
        type: 'huddle-join',
        channelId: CHANNEL,
        peerId: PEER_B,
      });
      expect(manager.getParticipants()).toHaveLength(2);

      // Both leave
      await manager.handleSignal(PEER_A, {
        type: 'huddle-leave',
        channelId: CHANNEL,
        peerId: PEER_A,
      });
      expect(manager.getState()).toBe('in-call'); // still one participant
      expect(manager.getParticipants()).toHaveLength(1);

      await manager.handleSignal(PEER_B, {
        type: 'huddle-leave',
        channelId: CHANNEL,
        peerId: PEER_B,
      });
      expect(manager.getState()).toBe('inactive');
    });
  });

  // ── Auto-join ──────────────────────────────────────────────────────

  describe('auto-join', () => {
    test('huddle-announce triggers broadcastSignal with huddle-join', async () => {
      await manager.handleSignal(PEER_A, {
        type: 'huddle-announce',
        channelId: CHANNEL,
        peerId: PEER_A,
      });

      expect(cb.broadcasts).toHaveLength(1);
      expect(cb.broadcasts[0]).toEqual({
        type: 'huddle-join',
        channelId: CHANNEL,
        peerId: MY_PEER,
      });
    });

    test('does NOT auto-join when autoJoin is false', async () => {
      const cb2 = makeCallbacks();
      const mgr2 = new BotHuddleManager(MY_PEER, cb2, { autoJoin: false });

      await mgr2.handleSignal(PEER_A, {
        type: 'huddle-announce',
        channelId: CHANNEL,
        peerId: PEER_A,
      });

      expect(cb2.broadcasts).toHaveLength(0);
      expect(mgr2.getState()).toBe('inactive');
      // But announcer is still tracked as participant
      expect(mgr2.getParticipants()).toHaveLength(1);
    });

    test('does NOT auto-join if already in a call', async () => {
      // First announce → auto-join
      await manager.handleSignal(PEER_A, {
        type: 'huddle-announce',
        channelId: CHANNEL,
        peerId: PEER_A,
      });
      expect(cb.broadcasts).toHaveLength(1);

      // Second announce from different peer → no additional join broadcast
      await manager.handleSignal(PEER_B, {
        type: 'huddle-announce',
        channelId: 'other-channel',
        peerId: PEER_B,
      });
      expect(cb.broadcasts).toHaveLength(1); // still just 1
    });
  });

  // ── Participant tracking ───────────────────────────────────────────

  describe('participant tracking', () => {
    test('tracks participants from join signals', async () => {
      manager.join(CHANNEL);

      await manager.handleSignal(PEER_A, {
        type: 'huddle-join',
        channelId: CHANNEL,
        peerId: PEER_A,
      });

      const participants = manager.getParticipants();
      expect(participants).toHaveLength(1);
      expect(participants[0].peerId).toBe(PEER_A);
      expect(participants[0].displayName).toBe(`name-${PEER_A}`);
      expect(participants[0].muted).toBe(false);
    });

    test('huddle-leave cleans up participant', async () => {
      manager.join(CHANNEL);

      await manager.handleSignal(PEER_A, {
        type: 'huddle-join',
        channelId: CHANNEL,
        peerId: PEER_A,
      });
      expect(manager.getParticipants()).toHaveLength(1);

      await manager.handleSignal(PEER_A, {
        type: 'huddle-leave',
        channelId: CHANNEL,
        peerId: PEER_A,
      });
      expect(manager.getParticipants()).toHaveLength(0);
    });

    test('huddle-mute updates mute state', async () => {
      manager.join(CHANNEL);

      await manager.handleSignal(PEER_A, {
        type: 'huddle-join',
        channelId: CHANNEL,
        peerId: PEER_A,
      });

      await manager.handleSignal(PEER_A, {
        type: 'huddle-mute',
        channelId: CHANNEL,
        peerId: PEER_A,
        muted: true,
      });

      const p = manager.getParticipants().find(p => p.peerId === PEER_A);
      expect(p?.muted).toBe(true);

      // Unmute
      await manager.handleSignal(PEER_A, {
        type: 'huddle-mute',
        channelId: CHANNEL,
        peerId: PEER_A,
        muted: false,
      });
      const p2 = manager.getParticipants().find(p => p.peerId === PEER_A);
      expect(p2?.muted).toBe(false);
    });
  });

  // ── Offer/answer/ICE stubs ─────────────────────────────────────────

  describe('WebRTC stubs', () => {
    test('huddle-offer is received and logged', async () => {
      manager.join(CHANNEL);

      await manager.handleSignal(PEER_A, {
        type: 'huddle-offer',
        channelId: CHANNEL,
        sdp: { type: 'offer', sdp: 'v=0...' },
        fromPeerId: PEER_A,
      });

      expect(cb.logs.some(l => l.includes('received offer from') && l.includes(PEER_A))).toBe(true);
    });

    test('huddle-answer is received and logged', async () => {
      manager.join(CHANNEL);

      await manager.handleSignal(PEER_A, {
        type: 'huddle-answer',
        channelId: CHANNEL,
        sdp: { type: 'answer', sdp: 'v=0...' },
        fromPeerId: PEER_A,
      });

      expect(cb.logs.some(l => l.includes('received answer from') && l.includes(PEER_A))).toBe(true);
    });

    test('huddle-ice is received and logged', async () => {
      manager.join(CHANNEL);

      await manager.handleSignal(PEER_A, {
        type: 'huddle-ice',
        channelId: CHANNEL,
        candidate: { candidate: 'candidate:...' },
        fromPeerId: PEER_A,
      });

      // With real WebRTC impl, ICE without a prior offer logs 'no PC found'
      expect(cb.logs.some(l => l.includes('no PC found for ICE from') && l.includes(PEER_A))).toBe(true);
    });
  });

  // ── Manual join/leave ──────────────────────────────────────────────

  describe('manual join/leave', () => {
    test('join() transitions to in-call and broadcasts', () => {
      manager.join(CHANNEL);

      expect(manager.getState()).toBe('in-call');
      expect(manager.getActiveChannelId()).toBe(CHANNEL);
      expect(cb.broadcasts).toHaveLength(1);
      expect(cb.broadcasts[0]).toEqual({
        type: 'huddle-join',
        channelId: CHANNEL,
        peerId: MY_PEER,
      });
    });

    test('leave() transitions to inactive and broadcasts', () => {
      manager.join(CHANNEL);
      cb.broadcasts.length = 0; // reset

      manager.leave();

      expect(manager.getState()).toBe('inactive');
      expect(manager.getActiveChannelId()).toBeNull();
      expect(cb.broadcasts).toHaveLength(1);
      expect(cb.broadcasts[0]).toEqual({
        type: 'huddle-leave',
        channelId: CHANNEL,
        peerId: MY_PEER,
      });
    });

    test('leave() when inactive is a no-op', () => {
      manager.leave();
      expect(cb.broadcasts).toHaveLength(0);
    });
  });
});
