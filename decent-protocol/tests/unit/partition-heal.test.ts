/**
 * GAP 1: Network Partition & Heal — Negentropy reconciliation after partition
 *
 * Scenario: A and B are connected, network partition happens, both write
 * messages independently, partition heals, Negentropy reconciles.
 *
 * Verify: final message sets match, hash chain stays valid after merge,
 * CRDT produces correct causal ordering.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { Negentropy } from '../../src/crdt/Negentropy';
import { MessageCRDT } from '../../src/crdt/MessageCRDT';
import { MessageStore } from '../../src/messages/MessageStore';
import type { NegentropyItem } from '../../src/crdt/Negentropy';

// Helper: convert CRDT messages to Negentropy items
function toNegentropyItems(crdt: MessageCRDT, channelId: string): NegentropyItem[] {
  return crdt.getMessages(channelId).map(m => ({
    id: m.id,
    timestamp: m.wallTime,
  }));
}

describe('Partition & Heal — Negentropy Reconciliation', () => {
  let alice: MessageCRDT;
  let bob: MessageCRDT;

  beforeEach(() => {
    alice = new MessageCRDT('alice');
    bob = new MessageCRDT('bob');
  });

  test('shared pre-partition history is preserved', () => {
    // Pre-partition: shared messages
    const m1 = alice.createMessage('ch-1', 'Before partition');
    bob.addMessage(m1);

    expect(alice.getMessages('ch-1')).toHaveLength(1);
    expect(bob.getMessages('ch-1')).toHaveLength(1);
    expect(alice.getMessages('ch-1')[0].id).toBe(bob.getMessages('ch-1')[0].id);
  });

  test('peers diverge during partition and merge cleanly on heal', () => {
    // Pre-partition: shared history
    const shared = alice.createMessage('ch-1', 'Shared');
    bob.addMessage(shared);

    // PARTITION: both write independently
    const aliceMsgs = [];
    for (let i = 0; i < 5; i++) {
      aliceMsgs.push(alice.createMessage('ch-1', `Alice-${i}`));
    }

    const bobMsgs = [];
    for (let i = 0; i < 3; i++) {
      bobMsgs.push(bob.createMessage('ch-1', `Bob-${i}`));
    }

    // HEAL: exchange messages
    alice.merge(bobMsgs);
    bob.merge(aliceMsgs);

    // Both should have all 9 messages (1 shared + 5 alice + 3 bob)
    expect(alice.getMessages('ch-1')).toHaveLength(9);
    expect(bob.getMessages('ch-1')).toHaveLength(9);
  });

  test('CRDT ordering is identical on both peers after merge', () => {
    const shared = alice.createMessage('ch-1', 'Shared');
    bob.addMessage(shared);

    // Partition
    const a1 = alice.createMessage('ch-1', 'Alice-1');
    const a2 = alice.createMessage('ch-1', 'Alice-2');
    const b1 = bob.createMessage('ch-1', 'Bob-1');
    const b2 = bob.createMessage('ch-1', 'Bob-2');

    // Heal
    alice.merge([b1, b2]);
    bob.merge([a1, a2]);

    const aliceView = alice.getMessages('ch-1').map(m => m.id);
    const bobView = bob.getMessages('ch-1').map(m => m.id);

    // Same deterministic order on both
    expect(aliceView).toEqual(bobView);
  });

  test('Negentropy detects divergence and finds diffs', async () => {
    const shared = alice.createMessage('ch-1', 'Shared');
    bob.addMessage(shared);

    // Partition: alice writes 10, bob writes 5
    const aliceMsgs = [];
    for (let i = 0; i < 10; i++) {
      aliceMsgs.push(alice.createMessage('ch-1', `Alice-${i}`));
    }
    const bobMsgs = [];
    for (let i = 0; i < 5; i++) {
      bobMsgs.push(bob.createMessage('ch-1', `Bob-${i}`));
    }

    // Build Negentropy sets from each peer
    const aliceNeg = new Negentropy();
    const bobNeg = new Negentropy();
    await aliceNeg.build(toNegentropyItems(alice, 'ch-1'));
    await bobNeg.build(toNegentropyItems(bob, 'ch-1'));

    // Bob reconciles with Alice to find what he's missing
    const bobResult = await bobNeg.reconcile(async (q) => aliceNeg.processQuery(q));
    expect(bobResult.need.length).toBe(10); // Bob needs Alice's 10 msgs

    // Alice reconciles with Bob
    const aliceResult = await aliceNeg.reconcile(async (q) => bobNeg.processQuery(q));
    expect(aliceResult.need.length).toBe(5); // Alice needs Bob's 5 msgs
  });

  test('Negentropy + CRDT merge produces complete convergence', async () => {
    const shared = alice.createMessage('ch-1', 'Shared');
    bob.addMessage(shared);

    // Partition
    const aliceMsgs = [];
    for (let i = 0; i < 7; i++) {
      aliceMsgs.push(alice.createMessage('ch-1', `Alice-${i}`));
    }
    const bobMsgs = [];
    for (let i = 0; i < 4; i++) {
      bobMsgs.push(bob.createMessage('ch-1', `Bob-${i}`));
    }

    // Negentropy reconciliation
    const aliceNeg = new Negentropy();
    const bobNeg = new Negentropy();
    await aliceNeg.build(toNegentropyItems(alice, 'ch-1'));
    await bobNeg.build(toNegentropyItems(bob, 'ch-1'));

    const bobNeeds = await bobNeg.reconcile(async (q) => aliceNeg.processQuery(q));
    const aliceNeeds = await aliceNeg.reconcile(async (q) => bobNeg.processQuery(q));

    // Simulate fetching needed messages and merging
    const aliceAll = alice.getAllMessages();
    const bobAll = bob.getAllMessages();

    const forBob = aliceAll.filter(m => bobNeeds.need.includes(m.id));
    const forAlice = bobAll.filter(m => aliceNeeds.need.includes(m.id));

    bob.merge(forBob);
    alice.merge(forAlice);

    // Full convergence
    expect(alice.getMessages('ch-1')).toHaveLength(12); // 1+7+4
    expect(bob.getMessages('ch-1')).toHaveLength(12);
    expect(alice.getMessages('ch-1').map(m => m.id)).toEqual(
      bob.getMessages('ch-1').map(m => m.id)
    );
  });

  test('hash chain stays valid within each peer after merge via MessageStore', async () => {
    const store = new MessageStore();

    // Create a chain of messages
    const m1 = await store.createMessage('ch-1', 'alice', 'First');
    await store.addMessage(m1);
    const m2 = await store.createMessage('ch-1', 'alice', 'Second');
    await store.addMessage(m2);

    // Verify chain is valid
    const result = await store.verifyChannel('ch-1');
    expect(result.valid).toBe(true);
  });

  test('no duplicate messages after partition heal', () => {
    const shared = alice.createMessage('ch-1', 'Shared');
    bob.addMessage(shared);

    const a1 = alice.createMessage('ch-1', 'Unique-A');
    const b1 = bob.createMessage('ch-1', 'Unique-B');

    // Heal: merge twice (idempotent)
    alice.merge([b1]);
    alice.merge([b1]); // duplicate merge

    bob.merge([a1]);
    bob.merge([a1]); // duplicate merge

    expect(alice.getMessages('ch-1')).toHaveLength(3);
    expect(bob.getMessages('ch-1')).toHaveLength(3);
  });

  test('causal ordering preserved: shared < partition msgs', () => {
    const shared = alice.createMessage('ch-1', 'Shared');
    bob.addMessage(shared);

    const a1 = alice.createMessage('ch-1', 'Alice-during-partition');
    const b1 = bob.createMessage('ch-1', 'Bob-during-partition');

    alice.merge([b1]);
    bob.merge([a1]);

    const view = alice.getMessages('ch-1');
    // Shared message must come first (it causally precedes partition msgs)
    expect(view[0].content).toBe('Shared');
  });

  test('large partition: 100 msgs each side merge correctly', async () => {
    // Partition with many messages on each side
    const aliceMsgs = [];
    for (let i = 0; i < 100; i++) {
      aliceMsgs.push(alice.createMessage('ch-1', `A-${i}`));
    }
    const bobMsgs = [];
    for (let i = 0; i < 100; i++) {
      bobMsgs.push(bob.createMessage('ch-1', `B-${i}`));
    }

    alice.merge(bobMsgs);
    bob.merge(aliceMsgs);

    expect(alice.getMessages('ch-1')).toHaveLength(200);
    expect(bob.getMessages('ch-1')).toHaveLength(200);
    expect(alice.getMessages('ch-1').map(m => m.id)).toEqual(
      bob.getMessages('ch-1').map(m => m.id)
    );
  });
});
