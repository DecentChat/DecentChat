/**
 * GAP 5: Negentropy Race — Simultaneous reconciliation
 *
 * Scenario: A and B both initiate Negentropy reconciliation to each other
 * simultaneously.
 *
 * Verify: no double-processing of diffs, no corrupt state, final message
 * sets are identical.
 */

import { describe, test, expect } from 'bun:test';
import { Negentropy } from '../../src/crdt/Negentropy';
import { MessageCRDT } from '../../src/crdt/MessageCRDT';
import type { NegentropyItem } from '../../src/crdt/Negentropy';

function toItems(crdt: MessageCRDT, channelId: string): NegentropyItem[] {
  return crdt.getMessages(channelId).map(m => ({
    id: m.id,
    timestamp: m.wallTime,
  }));
}

function createItems(count: number, prefix: string, startTime = 1000): NegentropyItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    timestamp: startTime + i * 1000,
  }));
}

describe('Negentropy Race — Simultaneous Reconciliation', () => {
  test('both peers initiate reconciliation simultaneously — no crash', async () => {
    const aliceItems = [
      ...createItems(50, 'shared', 1000),
      ...createItems(10, 'alice-only', 100000),
    ];
    const bobItems = [
      ...createItems(50, 'shared', 1000),
      ...createItems(8, 'bob-only', 200000),
    ];

    const aliceNeg = new Negentropy();
    const bobNeg = new Negentropy();
    await aliceNeg.build(aliceItems);
    await bobNeg.build(bobItems);

    // Both initiate reconciliation concurrently
    const [aliceResult, bobResult] = await Promise.all([
      aliceNeg.reconcile(async (q) => bobNeg.processQuery(q)),
      bobNeg.reconcile(async (q) => aliceNeg.processQuery(q)),
    ]);

    // Alice needs Bob's unique items
    expect(aliceResult.need.length).toBe(8);
    // Bob needs Alice's unique items
    expect(bobResult.need.length).toBe(10);
  });

  test('no double-processing: diff sets are disjoint', async () => {
    const shared = createItems(100, 'shared');
    const aliceExtra = createItems(20, 'alice-extra', 200000);
    const bobExtra = createItems(15, 'bob-extra', 300000);

    const aliceNeg = new Negentropy();
    const bobNeg = new Negentropy();
    await aliceNeg.build([...shared, ...aliceExtra]);
    await bobNeg.build([...shared, ...bobExtra]);

    const [aliceResult, bobResult] = await Promise.all([
      aliceNeg.reconcile(async (q) => bobNeg.processQuery(q)),
      bobNeg.reconcile(async (q) => aliceNeg.processQuery(q)),
    ]);

    // Alice needs Bob's extras
    const aliceNeedSet = new Set(aliceResult.need);
    // Bob needs Alice's extras
    const bobNeedSet = new Set(bobResult.need);

    // Diff sets should be disjoint (no overlap)
    for (const id of aliceNeedSet) {
      expect(bobNeedSet.has(id)).toBe(false);
    }
    for (const id of bobNeedSet) {
      expect(aliceNeedSet.has(id)).toBe(false);
    }
  });

  test('after exchanging diffs, both sides converge', async () => {
    const alice = new MessageCRDT('alice');
    const bob = new MessageCRDT('bob');

    // Shared history
    const shared = alice.createMessage('ch-1', 'Shared');
    bob.addMessage(shared);

    // Diverge
    for (let i = 0; i < 5; i++) alice.createMessage('ch-1', `A-${i}`);
    for (let i = 0; i < 3; i++) bob.createMessage('ch-1', `B-${i}`);

    // Build Negentropy instances
    const aliceNeg = new Negentropy();
    const bobNeg = new Negentropy();
    await aliceNeg.build(toItems(alice, 'ch-1'));
    await bobNeg.build(toItems(bob, 'ch-1'));

    // Simultaneous reconciliation
    const [aliceResult, bobResult] = await Promise.all([
      aliceNeg.reconcile(async (q) => bobNeg.processQuery(q)),
      bobNeg.reconcile(async (q) => aliceNeg.processQuery(q)),
    ]);

    // Exchange needed messages via CRDT
    const aliceAll = alice.getAllMessages();
    const bobAll = bob.getAllMessages();

    alice.merge(bobAll.filter(m => aliceResult.need.includes(m.id)));
    bob.merge(aliceAll.filter(m => bobResult.need.includes(m.id)));

    // Convergence
    expect(alice.getMessages('ch-1')).toHaveLength(9); // 1+5+3
    expect(bob.getMessages('ch-1')).toHaveLength(9);
    expect(alice.getMessages('ch-1').map(m => m.id)).toEqual(
      bob.getMessages('ch-1').map(m => m.id)
    );
  });

  test('state is not corrupted after concurrent processQuery calls', async () => {
    const items = createItems(200, 'shared');
    const aliceExtra = createItems(30, 'alice', 500000);
    const bobExtra = createItems(25, 'bob', 600000);

    const aliceNeg = new Negentropy();
    const bobNeg = new Negentropy();
    await aliceNeg.build([...items, ...aliceExtra]);
    await bobNeg.build([...items, ...bobExtra]);

    // Multiple concurrent queries
    const queries = await Promise.all([
      aliceNeg.createQuery(),
      bobNeg.createQuery(),
    ]);

    // Both process each other's queries
    const [aliceProcessed, bobProcessed] = await Promise.all([
      aliceNeg.processQuery(queries[1]),
      bobNeg.processQuery(queries[0]),
    ]);

    // Neither should crash, both should produce valid responses
    expect(aliceProcessed).toBeDefined();
    expect(bobProcessed).toBeDefined();

    // Internal state should remain consistent
    expect(aliceNeg.size()).toBe(230);
    expect(bobNeg.size()).toBe(225);
  });

  test('repeated simultaneous reconciliation yields same results', async () => {
    const shared = createItems(50, 'shared');
    const aliceExtra = createItems(10, 'alice', 100000);
    const bobExtra = createItems(7, 'bob', 200000);

    const aliceNeg = new Negentropy();
    const bobNeg = new Negentropy();
    await aliceNeg.build([...shared, ...aliceExtra]);
    await bobNeg.build([...shared, ...bobExtra]);

    // First round
    const [r1a, r1b] = await Promise.all([
      aliceNeg.reconcile(async (q) => bobNeg.processQuery(q)),
      bobNeg.reconcile(async (q) => aliceNeg.processQuery(q)),
    ]);

    // Second round (no changes to underlying data)
    const [r2a, r2b] = await Promise.all([
      aliceNeg.reconcile(async (q) => bobNeg.processQuery(q)),
      bobNeg.reconcile(async (q) => aliceNeg.processQuery(q)),
    ]);

    // Same diff results both times (idempotent)
    expect(new Set(r1a.need)).toEqual(new Set(r2a.need));
    expect(new Set(r1b.need)).toEqual(new Set(r2b.need));
  });

  test('three peers reconcile pairwise simultaneously', async () => {
    const shared = createItems(30, 'shared');
    const aExtra = createItems(5, 'a-extra', 100000);
    const bExtra = createItems(4, 'b-extra', 200000);
    const cExtra = createItems(3, 'c-extra', 300000);

    const aNeg = new Negentropy();
    const bNeg = new Negentropy();
    const cNeg = new Negentropy();
    await aNeg.build([...shared, ...aExtra]);
    await bNeg.build([...shared, ...bExtra]);
    await cNeg.build([...shared, ...cExtra]);

    // All pairs reconcile simultaneously
    const [abResult, baResult, acResult, caResult, bcResult, cbResult] = await Promise.all([
      aNeg.reconcile(async (q) => bNeg.processQuery(q)),
      bNeg.reconcile(async (q) => aNeg.processQuery(q)),
      aNeg.reconcile(async (q) => cNeg.processQuery(q)),
      cNeg.reconcile(async (q) => aNeg.processQuery(q)),
      bNeg.reconcile(async (q) => cNeg.processQuery(q)),
      cNeg.reconcile(async (q) => bNeg.processQuery(q)),
    ]);

    // A needs B's extras and C's extras
    expect(abResult.need.length).toBe(4);
    expect(acResult.need.length).toBe(3);

    // No crashes, all results valid
    expect(baResult.need.length).toBe(5);
    expect(caResult.need.length).toBe(5);
    expect(bcResult.need.length).toBe(3);
    expect(cbResult.need.length).toBe(4);
  });
});
