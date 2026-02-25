import { describe, test, expect } from 'bun:test';
import { Negentropy } from '../../src/crdt/Negentropy';

// Pure protocol-level sync performance tests — no browser, no WebSocket, no IndexedDB

describe('Sync Performance', () => {
  test('Negentropy reconcile: 1000 items vs 0 items — measures excess discovery time', async () => {
    const alice = new Negentropy();
    const bob = new Negentropy();

    const items = Array.from({ length: 1000 }, (_, i) => ({
      id: `msg-${i.toString().padStart(5, '0')}`,
      timestamp: 1000000 + i,
    }));

    await alice.build(items);
    await bob.build([]);

    const start = performance.now();
    let rounds = 0;
    const result = await alice.reconcile(async (query) => {
      rounds++;
      return bob.processQuery(query);
    });
    const elapsed = performance.now() - start;

    console.log(`[PERF] 1000 vs 0: rounds=${rounds}, need=${result.need.length}, excess=${result.excess.length}, time=${elapsed.toFixed(1)}ms`);

    expect(result.excess.length).toBe(1000);
    expect(result.need.length).toBe(0);
    expect(rounds).toBeLessThanOrEqual(3); // Should complete in 1-2 rounds
    expect(elapsed).toBeLessThan(100); // Must be < 100ms
  });

  test('Negentropy reconcile: 1000 vs 500 overlap — measures diff discovery time', async () => {
    const alice = new Negentropy();
    const bob = new Negentropy();

    const allItems = Array.from({ length: 1000 }, (_, i) => ({
      id: `msg-${i.toString().padStart(5, '0')}`,
      timestamp: 1000000 + i,
    }));
    const bobItems = allItems.slice(0, 500); // Bob has first 500

    await alice.build(allItems);
    await bob.build(bobItems);

    const start = performance.now();
    let rounds = 0;
    const result = await alice.reconcile(async (query) => {
      rounds++;
      return bob.processQuery(query);
    });
    const elapsed = performance.now() - start;

    console.log(`[PERF] 1000 vs 500: rounds=${rounds}, need=${result.need.length}, excess=${result.excess.length}, time=${elapsed.toFixed(1)}ms`);

    expect(result.excess.length).toBe(500); // Alice has 500 that Bob doesn't
    expect(result.need.length).toBe(0);
    expect(elapsed).toBeLessThan(200);
  });

  test('Negentropy reconcile: 10000 vs 0 — measures scale', async () => {
    const alice = new Negentropy();
    const bob = new Negentropy();

    const items = Array.from({ length: 10000 }, (_, i) => ({
      id: `msg-${i.toString().padStart(6, '0')}`,
      timestamp: 1000000 + i,
    }));

    await alice.build(items);
    await bob.build([]);

    const start = performance.now();
    let rounds = 0;
    const result = await alice.reconcile(async (query) => {
      rounds++;
      return bob.processQuery(query);
    });
    const elapsed = performance.now() - start;

    console.log(`[PERF] 10000 vs 0: rounds=${rounds}, need=${result.need.length}, excess=${result.excess.length}, time=${elapsed.toFixed(1)}ms`);

    expect(result.excess.length).toBe(10000);
    expect(elapsed).toBeLessThan(1000);
  });

  test('forceAdd bulk insertion: 1000 messages into MessageStore', async () => {
    const { MessageStore } = await import('../../src/messages/MessageStore');
    const store = new MessageStore();
    const channelId = 'ch-1';

    const messages = Array.from({ length: 1000 }, (_, i) => ({
      id: `msg-${i.toString().padStart(5, '0')}`,
      channelId,
      senderId: 'alice',
      timestamp: 1000000 + i,
      content: `Message ${i}`,
      type: 'text' as const,
      prevHash: '0'.repeat(64),
      status: 'delivered' as const,
    }));

    const start = performance.now();
    for (const msg of messages) {
      store.forceAdd(msg);
    }
    const elapsed = performance.now() - start;

    console.log(`[PERF] forceAdd 1000 msgs: ${elapsed.toFixed(1)}ms (${(elapsed / 1000).toFixed(3)}ms/msg)`);

    expect(store.getMessages(channelId).length).toBe(1000);
    expect(elapsed).toBeLessThan(100); // 1000 inserts should be < 100ms
  });

  test('forceAdd bulk insertion: 10000 messages into MessageStore', async () => {
    const { MessageStore } = await import('../../src/messages/MessageStore');
    const store = new MessageStore();
    const channelId = 'ch-1';

    const messages = Array.from({ length: 10000 }, (_, i) => ({
      id: `msg-${i.toString().padStart(6, '0')}`,
      channelId,
      senderId: 'alice',
      timestamp: 1000000 + i,
      content: `Message ${i}`,
      type: 'text' as const,
      prevHash: '0'.repeat(64),
      status: 'delivered' as const,
    }));

    const start = performance.now();
    for (const msg of messages) {
      store.forceAdd(msg);
    }
    const elapsed = performance.now() - start;

    console.log(`[PERF] forceAdd 10000 msgs: ${elapsed.toFixed(1)}ms (${(elapsed / 10000).toFixed(3)}ms/msg)`);

    expect(store.getMessages(channelId).length).toBe(10000);
    expect(elapsed).toBeLessThan(500);
  });

  test('Full sync pipeline: 1000 messages — Negentropy + forceAdd + CRDT', async () => {
    const { MessageStore } = await import('../../src/messages/MessageStore');
    const { MessageCRDT } = await import('../../src/crdt/MessageCRDT');

    // Alice side: store with 1000 messages
    const aliceStore = new MessageStore();
    const aliceCrdt = new MessageCRDT('alice-peer');
    const channelId = 'ch-1';

    const messages = Array.from({ length: 1000 }, (_, i) => ({
      id: `msg-${i.toString().padStart(5, '0')}`,
      channelId,
      senderId: 'alice',
      timestamp: 1000000 + i,
      content: `Message content ${i}`,
      type: 'text' as const,
      prevHash: '0'.repeat(64),
      status: 'delivered' as const,
    }));

    for (const msg of messages) {
      aliceStore.forceAdd(msg);
      try {
        aliceCrdt.addMessage({
          id: msg.id,
          channelId: msg.channelId,
          senderId: msg.senderId,
          content: msg.content,
          type: msg.type,
          vectorClock: {},
          wallTime: msg.timestamp,
          prevHash: msg.prevHash,
        });
      } catch {}
    }

    // Bob side: empty
    const bobStore = new MessageStore();
    const bobCrdt = new MessageCRDT('bob-peer');

    // Step 1: Negentropy reconcile
    const aliceNeg = new Negentropy();
    const bobNeg = new Negentropy();

    const aliceItems = aliceStore.getMessages(channelId).map(m => ({ id: m.id, timestamp: m.timestamp }));
    const bobItems = bobStore.getMessages(channelId).map(m => ({ id: m.id, timestamp: m.timestamp }));

    await aliceNeg.build(aliceItems);
    await bobNeg.build(bobItems);

    const startReconcile = performance.now();
    let rounds = 0;
    const result = await aliceNeg.reconcile(async (query) => {
      rounds++;
      return bobNeg.processQuery(query);
    });
    const reconcileMs = performance.now() - startReconcile;

    // Step 2: Alice gathers excess messages
    const startGather = performance.now();
    const excessSet = new Set(result.excess);
    const pushMessages = aliceStore.getMessages(channelId).filter(m => excessSet.has(m.id));
    const gatherMs = performance.now() - startGather;

    // Step 3: Bob receives and inserts (forceAdd + CRDT)
    const startInsert = performance.now();
    for (const msg of pushMessages) {
      bobStore.forceAdd(msg);
      try {
        bobCrdt.addMessage({
          id: msg.id,
          channelId: msg.channelId,
          senderId: msg.senderId,
          content: msg.content,
          type: msg.type,
          vectorClock: {},
          wallTime: msg.timestamp,
          prevHash: msg.prevHash,
        });
      } catch {}
    }
    const insertMs = performance.now() - startInsert;

    const totalMs = reconcileMs + gatherMs + insertMs;

    console.log(`[PERF] Full pipeline 1000 msgs:`);
    console.log(`  Negentropy reconcile: ${reconcileMs.toFixed(1)}ms (${rounds} rounds)`);
    console.log(`  Gather excess:        ${gatherMs.toFixed(1)}ms`);
    console.log(`  forceAdd + CRDT:      ${insertMs.toFixed(1)}ms`);
    console.log(`  TOTAL:                ${totalMs.toFixed(1)}ms`);
    console.log(`  Throughput:           ${Math.round(1000 / (totalMs / 1000))} msg/s`);

    expect(bobStore.getMessages(channelId).length).toBe(1000);
    expect(totalMs).toBeLessThan(500); // Entire pipeline < 500ms
  });
});

describe('bulkAdd Performance', () => {
  test('bulkAdd 1000 messages', async () => {
    const { MessageStore } = await import('../../src/messages/MessageStore');
    const store = new MessageStore();
    const msgs = Array.from({ length: 1000 }, (_, i) => ({
      id: `msg-${i.toString().padStart(5, '0')}`,
      channelId: 'ch-1',
      senderId: 'alice',
      timestamp: 1000000 + i,
      content: `Message ${i}`,
      type: 'text' as const,
      prevHash: '0'.repeat(64),
      status: 'delivered' as const,
    }));
    const start = performance.now();
    const added = store.bulkAdd(msgs);
    const elapsed = performance.now() - start;
    console.log(`[PERF] bulkAdd 1000: ${elapsed.toFixed(1)}ms, added=${added}`);
    expect(added).toBe(1000);
    expect(store.getMessages('ch-1').length).toBe(1000);
    expect(elapsed).toBeLessThan(50);
  });

  test('bulkAdd 10000 messages', async () => {
    const { MessageStore } = await import('../../src/messages/MessageStore');
    const store = new MessageStore();
    const msgs = Array.from({ length: 10000 }, (_, i) => ({
      id: `msg-${i.toString().padStart(6, '0')}`,
      channelId: 'ch-1',
      senderId: 'alice',
      timestamp: 1000000 + i,
      content: `Message ${i}`,
      type: 'text' as const,
      prevHash: '0'.repeat(64),
      status: 'delivered' as const,
    }));
    const start = performance.now();
    const added = store.bulkAdd(msgs);
    const elapsed = performance.now() - start;
    console.log(`[PERF] bulkAdd 10000: ${elapsed.toFixed(1)}ms, added=${added}`);
    expect(added).toBe(10000);
    expect(elapsed).toBeLessThan(100);
  });
});
