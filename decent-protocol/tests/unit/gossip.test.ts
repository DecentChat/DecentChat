/**
 * DEP-008 / T3.2: Gossip Propagation tests
 *
 * Tests the gossip relay state machine — pure in-memory simulation.
 * No real WebRTC or encryption involved.
 */

import { describe, test, expect, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Minimal gossip state machine — mirrors ChatController._gossipRelay() logic
// ---------------------------------------------------------------------------

const GOSSIP_TTL = 2;

interface WorkspaceMember { peerId: string }
interface Workspace { members: WorkspaceMember[] }

interface RelayCall {
  fromPeerId: string;
  targetPeerId: string;
  originalMsgId: string;
  originalSenderId: string;
  hop: number;
  plaintext: string;
  channelId: string;
}

class GossipStateMachine {
  myPeerId = 'alice';
  workspace: Workspace | null = null;
  connectedPeers = new Set<string>();
  /** Peers for which we have an established session (hasSharedSecret) */
  establishedSessions = new Set<string>();

  seenGossipIds = new Map<string, number>();
  relayCalls: RelayCall[] = [];
  droppedIds: string[] = [];

  /**
   * Check dedup and return whether to process the message.
   * Mirrors the dedup check at top of onMessage.
   */
  shouldProcess(gossipOrigId: string | undefined): boolean {
    if (!gossipOrigId) return true; // no gossip metadata — always process
    if (this.seenGossipIds.has(gossipOrigId)) {
      this.droppedIds.push(gossipOrigId);
      return false;
    }
    this.seenGossipIds.set(gossipOrigId, Date.now());
    return true;
  }

  /**
   * Relay a message to connected workspace peers.
   * Mirrors ChatController._gossipRelay().
   */
  relay(
    fromPeerId: string,
    originalMsgId: string,
    originalSenderId: string,
    plaintext: string,
    channelId: string,
    currentHop: number,
  ): number {
    const hop = currentHop + 1;
    if (hop > GOSSIP_TTL) return 0;
    if (!this.workspace) return 0;

    let relayed = 0;
    for (const member of this.workspace.members) {
      const targetPeerId = member.peerId;
      if (targetPeerId === this.myPeerId) continue;
      if (targetPeerId === fromPeerId) continue;
      if (targetPeerId === originalSenderId) continue;
      if (!this.connectedPeers.has(targetPeerId)) continue;
      if (!this.establishedSessions.has(targetPeerId)) continue;

      this.relayCalls.push({ fromPeerId, targetPeerId, originalMsgId, originalSenderId, hop, plaintext, channelId });
      relayed++;
    }
    return relayed;
  }

  /** Cleanup old entries from the seen-set */
  cleanupSeen(olderThanMs = 5 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;
    for (const [id, ts] of this.seenGossipIds) {
      if (ts < cutoff) { this.seenGossipIds.delete(id); removed++; }
    }
    return removed;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DEP-008 Gossip — dedup (shouldProcess)', () => {
  let sm: GossipStateMachine;

  beforeEach(() => { sm = new GossipStateMachine(); });

  test('message without gossip metadata is always processed', () => {
    expect(sm.shouldProcess(undefined)).toBe(true);
    expect(sm.shouldProcess(undefined)).toBe(true);
  });

  test('first occurrence of a gossip ID is processed', () => {
    expect(sm.shouldProcess('msg-001')).toBe(true);
    expect(sm.seenGossipIds.has('msg-001')).toBe(true);
  });

  test('second occurrence of same gossip ID is dropped', () => {
    sm.shouldProcess('msg-001');
    expect(sm.shouldProcess('msg-001')).toBe(false);
    expect(sm.droppedIds).toContain('msg-001');
  });

  test('different IDs are processed independently', () => {
    expect(sm.shouldProcess('msg-001')).toBe(true);
    expect(sm.shouldProcess('msg-002')).toBe(true);
    expect(sm.shouldProcess('msg-003')).toBe(true);
    expect(sm.seenGossipIds.size).toBe(3);
  });

  test('drops do not add to seen-set again', () => {
    sm.shouldProcess('msg-001');           // seen
    sm.shouldProcess('msg-001');           // dropped
    expect(sm.seenGossipIds.size).toBe(1); // still 1 entry
  });
});

describe('DEP-008 Gossip — relay()', () => {
  let sm: GossipStateMachine;

  beforeEach(() => {
    sm = new GossipStateMachine();
    sm.myPeerId = 'alice';
    sm.workspace = {
      members: [
        { peerId: 'alice' },
        { peerId: 'bob' },
        { peerId: 'carol' },
        { peerId: 'dave' },
      ],
    };
    sm.connectedPeers.add('bob');
    sm.connectedPeers.add('carol');
    sm.connectedPeers.add('dave');
    sm.establishedSessions.add('bob');
    sm.establishedSessions.add('carol');
    sm.establishedSessions.add('dave');
  });

  test('relays to connected workspace peers except source and self', () => {
    const count = sm.relay('bob', 'msg-1', 'bob', 'hello', 'ch-1', 0);
    // Should relay to carol and dave (not self=alice, not source=bob, not originalSender=bob)
    expect(count).toBe(2);
    expect(sm.relayCalls.map(r => r.targetPeerId).sort()).toEqual(['carol', 'dave']);
  });

  test('skips self', () => {
    sm.relay('bob', 'msg-1', 'bob', 'hello', 'ch-1', 0);
    expect(sm.relayCalls.map(r => r.targetPeerId)).not.toContain('alice');
  });

  test('skips relay source (fromPeerId)', () => {
    sm.relay('carol', 'msg-1', 'bob', 'hello', 'ch-1', 0);
    expect(sm.relayCalls.map(r => r.targetPeerId)).not.toContain('carol');
  });

  test('skips original sender', () => {
    // originalSender = dave, relay from bob
    sm.relay('bob', 'msg-1', 'dave', 'hello', 'ch-1', 0);
    expect(sm.relayCalls.map(r => r.targetPeerId)).not.toContain('dave');
  });

  test('skips peers not in connectedPeers', () => {
    sm.connectedPeers.delete('carol');
    sm.relay('bob', 'msg-1', 'bob', 'hello', 'ch-1', 0);
    expect(sm.relayCalls.map(r => r.targetPeerId)).not.toContain('carol');
    expect(sm.relayCalls.map(r => r.targetPeerId)).toContain('dave');
  });

  test('skips peers without established session', () => {
    sm.establishedSessions.delete('dave');
    sm.relay('bob', 'msg-1', 'bob', 'hello', 'ch-1', 0);
    expect(sm.relayCalls.map(r => r.targetPeerId)).not.toContain('dave');
  });

  test('relay envelope carries correct hop count', () => {
    sm.relay('bob', 'msg-1', 'bob', 'hello', 'ch-1', 0);
    for (const call of sm.relayCalls) {
      expect(call.hop).toBe(1);
    }
  });

  test('hop count increments each relay', () => {
    sm.relay('bob', 'msg-1', 'bob', 'hello', 'ch-1', 1); // hop 1 → 2
    for (const call of sm.relayCalls) {
      expect(call.hop).toBe(2);
    }
  });

  test('relay envelope carries originalMsgId and originalSenderId', () => {
    sm.relay('bob', 'msg-xyz', 'eve', 'hello', 'ch-1', 0);
    for (const call of sm.relayCalls) {
      expect(call.originalMsgId).toBe('msg-xyz');
      expect(call.originalSenderId).toBe('eve');
    }
  });

  test('relay carries correct channelId', () => {
    sm.relay('bob', 'msg-1', 'bob', 'hello', 'ch-42', 0);
    for (const call of sm.relayCalls) {
      expect(call.channelId).toBe('ch-42');
    }
  });

  // ── TTL enforcement ───────────────────────────────────────────────────────

  test('does not relay when at TTL limit', () => {
    const count = sm.relay('bob', 'msg-1', 'bob', 'hello', 'ch-1', GOSSIP_TTL);
    expect(count).toBe(0);
    expect(sm.relayCalls).toHaveLength(0);
  });

  test('relays when one below TTL', () => {
    const count = sm.relay('bob', 'msg-1', 'bob', 'hello', 'ch-1', GOSSIP_TTL - 1);
    expect(count).toBeGreaterThan(0);
  });

  // ── No workspace ─────────────────────────────────────────────────────────

  test('does nothing when workspace is null', () => {
    sm.workspace = null;
    const count = sm.relay('bob', 'msg-1', 'bob', 'hello', 'ch-1', 0);
    expect(count).toBe(0);
  });

  // ── Full mesh (no relay needed) ───────────────────────────────────────────

  test('full mesh: relays to non-source peers (CRDT dedup handles it on arrival)', () => {
    // In a full mesh, CRDT dedup removes any duplicate delivery
    sm.relay('bob', 'msg-1', 'bob', 'hello', 'ch-1', 0);
    expect(sm.relayCalls.length).toBeGreaterThan(0);
  });

  // ── Plaintext preservation ────────────────────────────────────────────────

  test('relay carries original plaintext', () => {
    const text = 'this is the original message';
    sm.relay('bob', 'msg-1', 'bob', text, 'ch-1', 0);
    for (const call of sm.relayCalls) {
      expect(call.plaintext).toBe(text);
    }
  });
});

describe('DEP-008 Gossip — seen-set cleanup', () => {
  let sm: GossipStateMachine;

  beforeEach(() => { sm = new GossipStateMachine(); });

  test('cleanup removes entries older than cutoff', () => {
    const pastTime = Date.now() - 10 * 60 * 1000; // 10 min ago
    sm.seenGossipIds.set('old-msg', pastTime);
    sm.seenGossipIds.set('new-msg', Date.now());

    const removed = sm.cleanupSeen(5 * 60 * 1000); // 5 min cutoff
    expect(removed).toBe(1);
    expect(sm.seenGossipIds.has('old-msg')).toBe(false);
    expect(sm.seenGossipIds.has('new-msg')).toBe(true);
  });

  test('cleanup does not remove recent entries', () => {
    sm.seenGossipIds.set('msg-1', Date.now());
    sm.seenGossipIds.set('msg-2', Date.now());

    const removed = sm.cleanupSeen(5 * 60 * 1000);
    expect(removed).toBe(0);
    expect(sm.seenGossipIds.size).toBe(2);
  });

  test('cleanup on empty set is safe', () => {
    expect(sm.cleanupSeen()).toBe(0);
  });
});

describe('DEP-008 Gossip — dedup both orderings (fix: early-check only, no early-set)', () => {
  /**
   * These tests verify the restructured dedup logic:
   *   - Early check: if _originalMessageId in seen → drop (no set)
   *   - Post-decryption check: if msg.id in seen → drop (no set)
   *   - On success: set seen[msg.id] (uniform, covers both direct and relayed)
   *
   * The critical invariant: seen-set is ONLY written after successful processing,
   * so a gossip copy with _originalMessageId = "X" never blocks itself from processing.
   */

  function makeDedupSm() {
    const seen = new Map<string, number>();
    const processed: string[] = [];

    function earlyCheck(originalMessageId: string | undefined): boolean {
      if (!originalMessageId) return false; // no early check for direct messages
      return seen.has(originalMessageId);   // true = drop
    }

    function postDecryptionCheck(msgId: string): boolean {
      return seen.has(msgId); // true = drop
    }

    function onSuccess(msgId: string) {
      seen.set(msgId, Date.now());
      processed.push(msgId);
    }

    return { seen, processed, earlyCheck, postDecryptionCheck, onSuccess };
  }

  test('direct-first: direct sets seen-set, gossip dropped by early check', () => {
    const sm = makeDedupSm();

    // Direct arrives (no _originalMessageId), msg.id = "orig-123"
    expect(sm.earlyCheck(undefined)).toBe(false);          // no early check
    expect(sm.postDecryptionCheck('orig-123')).toBe(false); // not in seen
    sm.onSuccess('orig-123');                               // seeds seen-set

    // Gossip arrives (_originalMessageId = "orig-123")
    expect(sm.earlyCheck('orig-123')).toBe(true);           // ← DROPPED ✓
    expect(sm.processed).toHaveLength(1);
  });

  test('gossip-first: gossip processes, direct dropped by post-decryption check', () => {
    const sm = makeDedupSm();

    // Gossip arrives (_originalMessageId = "orig-123"), msg.id = "orig-123" (with messageId in relay)
    expect(sm.earlyCheck('orig-123')).toBe(false);          // not in seen yet
    expect(sm.postDecryptionCheck('orig-123')).toBe(false); // not in seen
    sm.onSuccess('orig-123');                               // seeds seen-set

    // Direct arrives (no _originalMessageId), msg.id = "orig-123"
    expect(sm.earlyCheck(undefined)).toBe(false);           // no early check
    expect(sm.postDecryptionCheck('orig-123')).toBe(true);  // ← DROPPED ✓
    expect(sm.processed).toHaveLength(1);
  });

  test('gossip early check does NOT block the gossip copy itself', () => {
    const sm = makeDedupSm();

    // Gossip arrives — early check should NOT add to seen (only checks)
    sm.earlyCheck('orig-123'); // check only — returns false, does NOT set

    // Post-decryption: msg.id = "orig-123" → should NOT be in seen yet
    expect(sm.postDecryptionCheck('orig-123')).toBe(false); // not blocked ✓
    sm.onSuccess('orig-123');
    expect(sm.processed).toHaveLength(1);
  });

  test('two different messages are both processed independently', () => {
    const sm = makeDedupSm();

    sm.earlyCheck(undefined);
    sm.postDecryptionCheck('msg-A');
    sm.onSuccess('msg-A');

    sm.earlyCheck(undefined);
    sm.postDecryptionCheck('msg-B');
    sm.onSuccess('msg-B');

    expect(sm.processed).toEqual(['msg-A', 'msg-B']);
  });
});

describe('DEP-008 Gossip — GOSSIP_TTL constant', () => {
  test('GOSSIP_TTL is 2', () => {
    expect(GOSSIP_TTL).toBe(2);
  });

  test('max relay depth is TTL (original=0, relay1=1, relay2=2, no relay3)', () => {
    const sm = new GossipStateMachine();
    sm.workspace = { members: [{ peerId: 'alice' }, { peerId: 'bob' }] };
    sm.connectedPeers.add('bob');
    sm.establishedSessions.add('bob');

    // hop=TTL-1 → still relays
    expect(sm.relay('x', 'id', 'x', 'hi', 'ch', GOSSIP_TTL - 1)).toBeGreaterThan(0);

    // hop=TTL → no relay
    expect(sm.relay('x', 'id', 'x', 'hi', 'ch', GOSSIP_TTL)).toBe(0);
  });
});
