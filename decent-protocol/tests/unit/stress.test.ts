/**
 * Stress & Edge Case Tests for decent-protocol
 *
 * Covers: hash chain integrity at scale, CRDT convergence proofs,
 * vector clock precision, offline queue isolation,
 * persistent store batch ops, and concurrent CRDT merge scenarios.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { HashChain, GENESIS_HASH } from '../../src/crypto/HashChain';
import type { HashableMessage } from '../../src/crypto/HashChain';
import { VectorClock } from '../../src/crdt/VectorClock';
import { MessageCRDT } from '../../src/crdt/MessageCRDT';
import type { CRDTMessage } from '../../src/crdt/MessageCRDT';
import { OfflineQueue } from '../../src/messages/OfflineQueue';
import { PersistentStore } from '../../src/storage/PersistentStore';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a valid hash-chain of `count` messages, returning the array. */
async function buildChain(count: number): Promise<HashableMessage[]> {
  const chain = new HashChain();
  const messages: HashableMessage[] = [];

  for (let i = 0; i < count; i++) {
    const prevHash = i === 0 ? GENESIS_HASH : await chain.hashMessage(messages[i - 1]);
    messages.push({
      id: `msg-${i}`,
      channelId: 'stress-ch',
      senderId: `peer-${i % 10}`,
      timestamp: 1_000_000 + i,
      content: `Message #${i}`,
      type: 'text',
      prevHash,
    });
  }
  return messages;
}

// ─── 1. Hash Chain Stress ────────────────────────────────────────────────────

describe('Hash Chain Stress', () => {
  test('builds a 500-message chain and verifies it completely', async () => {
    const chain = new HashChain();
    const messages = await buildChain(500);

    const result = await chain.verifyFullChain(messages);

    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeUndefined();
  }, 30_000);

  test('detects tampering at message #250 in a 500-message chain', async () => {
    const chain = new HashChain();
    const messages = await buildChain(500);

    // Tamper with message #250 — change content without recomputing chain
    messages[250] = {
      ...messages[250],
      content: 'TAMPERED CONTENT',
    };

    const result = await chain.verifyFullChain(messages);

    expect(result.valid).toBe(false);
    // Chain breaks at 251 (the message that references the tampered one)
    expect(result.brokenAt).toBe(251);
    expect(result.reason).toBeDefined();
  }, 30_000);

  test('detects tampering of prevHash field directly', async () => {
    const chain = new HashChain();
    const messages = await buildChain(10);

    // Directly corrupt the prevHash of message #5
    messages[5] = { ...messages[5], prevHash: 'deadbeef00000000' };

    const result = await chain.verifyFullChain(messages);

    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(5);
  }, 10_000);
});

// ─── 2. CRDT Large Scale ─────────────────────────────────────────────────────

describe('CRDT Large Scale', () => {
  test('50 peers × 20 messages = 1000 messages merged with no duplicates', () => {
    const PEERS = 50;
    const MSGS_PER_PEER = 20;

    // Each peer creates their own messages
    const allMessages: CRDTMessage[] = [];
    for (let p = 0; p < PEERS; p++) {
      const peer = new MessageCRDT(`peer-${p}`);
      for (let m = 0; m < MSGS_PER_PEER; m++) {
        allMessages.push(peer.createMessage('ch-stress', `P${p} M${m}`));
      }
    }

    // Merge all into a single aggregator CRDT
    const aggregator = new MessageCRDT('aggregator');
    aggregator.merge(allMessages);

    // Count and uniqueness
    expect(aggregator.size).toBe(PEERS * MSGS_PER_PEER);

    const ids = aggregator.getAllMessages().map(m => m.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(PEERS * MSGS_PER_PEER);
  });

  test('causal ordering holds after large-scale merge', () => {
    // Alice sends 5 messages in sequence (each causally after the previous)
    const alice = new MessageCRDT('alice');
    const aliceMsgs: CRDTMessage[] = [];
    for (let i = 0; i < 5; i++) {
      aliceMsgs.push(alice.createMessage('ch-stress', `Alice sequential ${i}`));
    }

    // Bob receives and merges them
    const bob = new MessageCRDT('bob');
    // Intentionally merge in reverse order to test causal sorting
    bob.merge([...aliceMsgs].reverse());

    const bobView = bob.getMessages('ch-stress');
    expect(bobView).toHaveLength(5);

    // Causal order should be preserved (earlier clocks first)
    for (let i = 0; i < 4; i++) {
      const clockA = VectorClock.fromJSON(bobView[i].vectorClock);
      const clockB = VectorClock.fromJSON(bobView[i + 1].vectorClock);
      expect(clockA.compare(clockB)).toBe('before');
    }
  });
});

// ─── 3. CRDT Convergence Proof ───────────────────────────────────────────────

describe('CRDT Convergence Proof', () => {
  test('all 6 merge orderings of 3 CRDTs produce identical final state', () => {
    // Three peers each create distinct messages
    const peerA = new MessageCRDT('peerA');
    const peerB = new MessageCRDT('peerB');
    const peerC = new MessageCRDT('peerC');

    const msgsA = [
      peerA.createMessage('ch-1', 'A1'),
      peerA.createMessage('ch-1', 'A2'),
      peerA.createMessage('ch-1', 'A3'),
    ];
    const msgsB = [
      peerB.createMessage('ch-1', 'B1'),
      peerB.createMessage('ch-1', 'B2'),
    ];
    const msgsC = [
      peerC.createMessage('ch-1', 'C1'),
      peerC.createMessage('ch-1', 'C2'),
      peerC.createMessage('ch-1', 'C3'),
      peerC.createMessage('ch-1', 'C4'),
    ];

    // All 6 permutations of merge order
    const orderings = [
      [msgsA, msgsB, msgsC],
      [msgsA, msgsC, msgsB],
      [msgsB, msgsA, msgsC],
      [msgsB, msgsC, msgsA],
      [msgsC, msgsA, msgsB],
      [msgsC, msgsB, msgsA],
    ] as const;

    const results: string[][] = [];

    for (const [first, second, third] of orderings) {
      const crdt = new MessageCRDT(`observer-${results.length}`);
      crdt.merge(first as CRDTMessage[]);
      crdt.merge(second as CRDTMessage[]);
      crdt.merge(third as CRDTMessage[]);

      const ids = crdt.getMessages('ch-1').map(m => m.id);
      results.push(ids);
    }

    // All 6 orderings must produce the same sorted ID sequence
    const reference = results[0];
    expect(reference).toHaveLength(9); // 3+2+4

    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toEqual(reference);
    }
  });

  test('idempotency holds at scale: merging same set twice changes nothing', () => {
    const peer = new MessageCRDT('peer');
    const msgs: CRDTMessage[] = [];
    for (let i = 0; i < 100; i++) {
      msgs.push(peer.createMessage('ch-1', `Msg ${i}`));
    }

    const crdt = new MessageCRDT('crdt');
    crdt.merge(msgs);
    const afterFirst = crdt.size;

    crdt.merge(msgs); // Merge again — idempotency
    const afterSecond = crdt.size;

    expect(afterFirst).toBe(100);
    expect(afterSecond).toBe(100); // No duplicates added
  });
});

// ─── 4. VectorClock with Many Peers ─────────────────────────────────────────

describe('VectorClock Many Peers', () => {
  test('100 peers each at counter 10000 — merge and verify no overflow', () => {
    const PEERS = 100;
    const COUNTER = 10_000;

    // Create 100 individual clocks, each with one peer's counter set
    const clocks: VectorClock[] = Array.from({ length: PEERS }, (_, i) => {
      const initial: Record<string, number> = {};
      initial[`peer-${i}`] = COUNTER;
      return new VectorClock(initial);
    });

    // Merge all into one
    let merged = new VectorClock();
    for (const vc of clocks) {
      merged = merged.merge(vc);
    }

    // Every peer should have exactly COUNTER
    for (let i = 0; i < PEERS; i++) {
      const val = merged.get(`peer-${i}`);
      expect(val).toBe(COUNTER);
    }

    // Total peers tracked
    expect(merged.size).toBe(PEERS);
  });

  test('merged clock correctly identifies concurrent clocks at scale', () => {
    // Clock A has 50 peers advanced beyond Clock B
    const initA: Record<string, number> = {};
    const initB: Record<string, number> = {};

    for (let i = 0; i < 100; i++) {
      initA[`peer-${i}`] = i < 50 ? 10_001 : 10_000; // A is ahead for first 50
      initB[`peer-${i}`] = i >= 50 ? 10_001 : 10_000; // B is ahead for last 50
    }

    const clockA = new VectorClock(initA);
    const clockB = new VectorClock(initB);

    // Neither is strictly before the other → concurrent
    expect(clockA.compare(clockB)).toBe('concurrent');
  });

  test('very large counter values — no JS integer precision loss', () => {
    // JS safe integer max is 2^53 − 1 = 9007199254740991
    // Use a large but safe value
    const LARGE = 9_007_199_254_740_000; // Well below MAX_SAFE_INTEGER

    const vcA = new VectorClock({ p: LARGE });
    const vcB = new VectorClock({ p: LARGE + 100 });

    const merged = vcA.merge(vcB);
    expect(merged.get('p')).toBe(LARGE + 100);
    expect(Number.isSafeInteger(merged.get('p'))).toBe(true);

    expect(vcA.compare(vcB)).toBe('before');
    expect(vcB.compare(vcA)).toBe('after');
  });
});

// ─── 5. Offline Queue Stress ─────────────────────────────────────────────────

describe('Offline Queue Stress', () => {
  test('500 messages across 10 peers — flush one at a time with isolation', async () => {
    const PEERS = 10;
    const MSGS_PER_PEER = 50; // 10 × 50 = 500 total

    const queue = new OfflineQueue();

    // Enqueue 50 messages for each of 10 peers
    for (let p = 0; p < PEERS; p++) {
      for (let m = 0; m < MSGS_PER_PEER; m++) {
        await queue.enqueue(`peer-${p}`, {
          seq: m,
          content: `Peer ${p}, message ${m}`,
          peerId: p,
        });
      }
    }

    expect(queue.getTotalQueued()).toBe(PEERS * MSGS_PER_PEER);
    expect(queue.getPeersWithQueue()).toHaveLength(PEERS);

    // Flush one peer at a time and verify isolation
    for (let p = 0; p < PEERS; p++) {
      const peerId = `peer-${p}`;
      const flushed = await queue.flush(peerId);

      // Correct count flushed
      expect(flushed).toHaveLength(MSGS_PER_PEER);

      // All messages belong to this peer
      for (const msg of flushed) {
        expect(msg.peerId).toBe(p);
      }

      // Queue for this peer is now empty
      expect(queue.getQueuedCount(peerId)).toBe(0);

      // Other peers' queues are unaffected
      const remaining = PEERS - p - 1;
      expect(queue.getPeersWithQueue()).toHaveLength(remaining);
      expect(queue.getTotalQueued()).toBe(remaining * MSGS_PER_PEER);
    }

    // All queues drained
    expect(queue.getTotalQueued()).toBe(0);
  });

  test('flush returns messages in enqueue order', async () => {
    const queue = new OfflineQueue();
    const COUNT = 100;

    for (let i = 0; i < COUNT; i++) {
      await queue.enqueue('bob', { seq: i });
    }

    const flushed = await queue.flush('bob');
    expect(flushed).toHaveLength(COUNT);

    for (let i = 0; i < COUNT; i++) {
      expect(flushed[i].seq).toBe(i);
    }
  });

  test('queuing for 1 peer does not affect independent peer counts', async () => {
    const queue = new OfflineQueue();

    await queue.enqueue('peer-A', { x: 1 });
    await queue.enqueue('peer-A', { x: 2 });
    await queue.enqueue('peer-B', { x: 3 });

    expect(queue.getQueuedCount('peer-A')).toBe(2);
    expect(queue.getQueuedCount('peer-B')).toBe(1);
    expect(queue.getQueuedCount('peer-C')).toBe(0); // Never queued

    await queue.flush('peer-A');

    expect(queue.getQueuedCount('peer-A')).toBe(0);
    expect(queue.getQueuedCount('peer-B')).toBe(1); // Unchanged
  });
});

// ─── 7. PersistentStore Batch Write ─────────────────────────────────────────

describe('PersistentStore Batch Write', () => {
  let store: PersistentStore;

  beforeEach(async () => {
    store = new PersistentStore({ dbName: `stress-test-${Date.now()}-${Math.random()}` });
    await store.init();
  });

  afterEach(async () => {
    await store.close();
  });

  test('saves 1000 messages in one batch and reads them back in order', async () => {
    const COUNT = 1000;
    const CHANNEL = 'stress-channel';

    const messages = Array.from({ length: COUNT }, (_, i) => ({
      id: `batch-msg-${i.toString().padStart(6, '0')}`,
      channelId: CHANNEL,
      content: `Batch message ${i}`,
      timestamp: 1_000_000 + i, // Strictly increasing timestamps
      senderId: `peer-${i % 10}`,
    }));

    // Write all 1000 in a single batch call
    await store.saveMessages(messages);

    // Verify count
    const count = await store.getMessageCount(CHANNEL);
    expect(count).toBe(COUNT);

    // Read them back
    const retrieved = await store.getChannelMessages(CHANNEL);
    expect(retrieved).toHaveLength(COUNT);

    // Verify order (sorted by timestamp ascending)
    for (let i = 0; i < COUNT; i++) {
      expect(retrieved[i].id).toBe(`batch-msg-${i.toString().padStart(6, '0')}`);
      expect(retrieved[i].content).toBe(`Batch message ${i}`);
      expect(retrieved[i].timestamp).toBe(1_000_000 + i);
    }
  }, 30_000);

  test('batch write across multiple channels maintains isolation', async () => {
    const CHANNELS = 5;
    const MSGS_PER_CHANNEL = 100;

    const allMessages = [];
    for (let c = 0; c < CHANNELS; c++) {
      for (let m = 0; m < MSGS_PER_CHANNEL; m++) {
        allMessages.push({
          id: `ch${c}-msg-${m}`,
          channelId: `channel-${c}`,
          content: `Ch ${c} Msg ${m}`,
          timestamp: 1_000_000 + m,
          senderId: 'sender',
        });
      }
    }

    await store.saveMessages(allMessages);

    for (let c = 0; c < CHANNELS; c++) {
      const msgs = await store.getChannelMessages(`channel-${c}`);
      expect(msgs).toHaveLength(MSGS_PER_CHANNEL);

      // All messages belong to the right channel
      for (const msg of msgs) {
        expect(msg.channelId).toBe(`channel-${c}`);
      }
    }
  }, 30_000);

  test('upsert semantics: saving same ID twice keeps latest version', async () => {
    await store.saveMessage({ id: 'dup-1', channelId: 'ch-1', content: 'Original', timestamp: 1000 });
    await store.saveMessage({ id: 'dup-1', channelId: 'ch-1', content: 'Updated', timestamp: 2000 });

    const msgs = await store.getChannelMessages('ch-1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('Updated');
  });
});

// ─── 8. Concurrent CRDT Operations ──────────────────────────────────────────

describe('Concurrent CRDT Operations', () => {
  test('3 peers go offline simultaneously, create 10 messages each, then merge pairwise', () => {
    // All peers start with shared state
    const peerA = new MessageCRDT('alice');
    const peerB = new MessageCRDT('bob');
    const peerC = new MessageCRDT('charlie');

    // Shared history before going offline
    const shared = peerA.createMessage('ch-1', 'Shared before offline');
    peerB.merge([shared]);
    peerC.merge([shared]);

    // === All go offline simultaneously ===

    // Alice creates 10 messages offline
    const aliceOffline: CRDTMessage[] = [];
    for (let i = 0; i < 10; i++) {
      aliceOffline.push(peerA.createMessage('ch-1', `Alice offline ${i}`));
    }

    // Bob creates 10 messages offline
    const bobOffline: CRDTMessage[] = [];
    for (let i = 0; i < 10; i++) {
      bobOffline.push(peerB.createMessage('ch-1', `Bob offline ${i}`));
    }

    // Charlie creates 10 messages offline
    const charlieOffline: CRDTMessage[] = [];
    for (let i = 0; i < 10; i++) {
      charlieOffline.push(peerC.createMessage('ch-1', `Charlie offline ${i}`));
    }

    // === All reconnect and merge pairwise ===
    peerA.merge(bobOffline);
    peerA.merge(charlieOffline);

    peerB.merge(aliceOffline);
    peerB.merge(charlieOffline);

    peerC.merge(aliceOffline);
    peerC.merge(bobOffline);

    // Each peer should have: 1 shared + 30 offline = 31 total
    expect(peerA.size).toBe(31);
    expect(peerB.size).toBe(31);
    expect(peerC.size).toBe(31);

    // All peers must see identical message order (convergence)
    const viewA = peerA.getMessages('ch-1').map(m => m.id);
    const viewB = peerB.getMessages('ch-1').map(m => m.id);
    const viewC = peerC.getMessages('ch-1').map(m => m.id);

    expect(viewA).toEqual(viewB);
    expect(viewB).toEqual(viewC);

    // The shared message must always appear first (causal ordering)
    expect(viewA[0]).toBe(shared.id);
  });

  test('convergence holds even when peers have wildly different merge sequences', () => {
    const peers = Array.from({ length: 5 }, (_, i) => new MessageCRDT(`peer-${i}`));

    // Each peer creates 5 messages independently (no coordination)
    const allMessages: CRDTMessage[] = [];
    for (const peer of peers) {
      for (let m = 0; m < 5; m++) {
        allMessages.push(peer.createMessage('ch-1', `${peer['peerId']} msg ${m}`));
      }
    }

    // Simulate each peer merging in a different random-ish order
    // We'll use different subsets to simulate partial connectivity
    const observers = [
      new MessageCRDT('obs-1'),
      new MessageCRDT('obs-2'),
      new MessageCRDT('obs-3'),
    ];

    // Each observer receives messages but in different orderings
    observers[0].merge(allMessages);
    observers[1].merge([...allMessages].reverse());
    observers[2].merge(allMessages.slice(10)); // partial first
    observers[2].merge(allMessages.slice(0, 10)); // then the rest

    const views = observers.map(o =>
      o.getMessages('ch-1').map(m => m.id)
    );

    // All 3 views must be identical
    expect(views[0]).toHaveLength(25);
    expect(views[1]).toEqual(views[0]);
    expect(views[2]).toEqual(views[0]);
  });

  test('no message loss or duplication after N-way merge', () => {
    const N = 8;
    const MSGS = 5;

    // N peers each create MSGS messages
    const allMsgs: CRDTMessage[] = [];
    const peerIds: string[] = [];

    for (let p = 0; p < N; p++) {
      const peer = new MessageCRDT(`peer-${p}`);
      peerIds.push(`peer-${p}`);
      for (let m = 0; m < MSGS; m++) {
        allMsgs.push(peer.createMessage('ch-1', `P${p}M${m}`));
      }
    }

    // Merge everything into an aggregator
    const aggregator = new MessageCRDT('agg');
    aggregator.merge(allMsgs);

    expect(aggregator.size).toBe(N * MSGS);

    // Verify no duplicates by ID
    const ids = aggregator.getAllMessages().map(m => m.id);
    expect(new Set(ids).size).toBe(N * MSGS);

    // Verify each peer's messages are present
    for (let p = 0; p < N; p++) {
      const peerMsgs = aggregator.getAllMessages().filter(m => m.senderId === `peer-${p}`);
      expect(peerMsgs).toHaveLength(MSGS);
    }
  });
});
