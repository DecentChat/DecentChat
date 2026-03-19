/**
 * PersistentStore + OfflineQueue tests
 * Uses fake-indexeddb for Node/Bun environment
 */

import '../setup';
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { PersistentStore } from '../../src/storage/PersistentStore';
import { OfflineQueue } from '../../src/messages/OfflineQueue';

// fake-indexeddb is loaded via test setup

describe('PersistentStore', () => {
  let store: PersistentStore;

  beforeEach(async () => {
    store = new PersistentStore({ dbName: `test-${Date.now()}-${Math.random()}` });
    await store.init();
  });

  afterEach(async () => {
    await store.close();
  });

  // === Workspaces ===

  test('saves and retrieves workspace', async () => {
    const ws = { id: 'ws-1', name: 'Test Team', members: [] };
    await store.saveWorkspace(ws);

    const retrieved = await store.getWorkspace('ws-1');
    expect(retrieved).toBeDefined();
    expect(retrieved.name).toBe('Test Team');
  });

  test('lists all workspaces', async () => {
    await store.saveWorkspace({ id: 'ws-1', name: 'Team 1' });
    await store.saveWorkspace({ id: 'ws-2', name: 'Team 2' });

    const all = await store.getAllWorkspaces();
    expect(all).toHaveLength(2);
  });

  test('deletes workspace', async () => {
    await store.saveWorkspace({ id: 'ws-1', name: 'Delete me' });
    await store.deleteWorkspace('ws-1');

    const result = await store.getWorkspace('ws-1');
    expect(result).toBeUndefined();
  });

  test('updates workspace (upsert)', async () => {
    await store.saveWorkspace({ id: 'ws-1', name: 'Original' });
    await store.saveWorkspace({ id: 'ws-1', name: 'Updated' });

    const result = await store.getWorkspace('ws-1');
    expect(result.name).toBe('Updated');
  });

  // === Messages ===

  test('saves and retrieves messages by channel', async () => {
    await store.saveMessage({ id: 'msg-1', channelId: 'ch-1', content: 'Hello', timestamp: 1000 });
    await store.saveMessage({ id: 'msg-2', channelId: 'ch-1', content: 'World', timestamp: 2000 });
    await store.saveMessage({ id: 'msg-3', channelId: 'ch-2', content: 'Other', timestamp: 1500 });

    const ch1 = await store.getChannelMessages('ch-1');
    expect(ch1).toHaveLength(2);
    expect(ch1[0].content).toBe('Hello');
    expect(ch1[1].content).toBe('World');

    const ch2 = await store.getChannelMessages('ch-2');
    expect(ch2).toHaveLength(1);
  });

  test('saves batch of messages', async () => {
    const messages = Array.from({ length: 50 }, (_, i) => ({
      id: `msg-${i}`,
      channelId: 'ch-1',
      content: `Message ${i}`,
      timestamp: 1000 + i,
    }));

    await store.saveMessages(messages);

    const count = await store.getMessageCount('ch-1');
    expect(count).toBe(50);
  });

  test('messages ordered by timestamp', async () => {
    await store.saveMessage({ id: 'msg-3', channelId: 'ch-1', content: 'Third', timestamp: 3000 });
    await store.saveMessage({ id: 'msg-1', channelId: 'ch-1', content: 'First', timestamp: 1000 });
    await store.saveMessage({ id: 'msg-2', channelId: 'ch-1', content: 'Second', timestamp: 2000 });

    const messages = await store.getChannelMessages('ch-1');
    expect(messages[0].content).toBe('First');
    expect(messages[1].content).toBe('Second');
    expect(messages[2].content).toBe('Third');
  });

  test('remaps persisted channel messages to a new channel ID', async () => {
    await store.saveMessage({ id: 'msg-1', channelId: 'old-ch', content: 'First', timestamp: 1000 });
    await store.saveMessage({ id: 'msg-2', channelId: 'old-ch', content: 'Second', timestamp: 2000 });
    await store.saveMessage({ id: 'msg-3', channelId: 'other-ch', content: 'Other', timestamp: 1500 });

    await store.remapChannelMessages('old-ch', 'new-ch');

    const oldMessages = await store.getChannelMessages('old-ch');
    const newMessages = await store.getChannelMessages('new-ch');
    const otherMessages = await store.getChannelMessages('other-ch');

    expect(oldMessages).toHaveLength(0);
    expect(newMessages).toHaveLength(2);
    expect(newMessages[0].id).toBe('msg-1');
    expect(newMessages[1].id).toBe('msg-2');
    expect(otherMessages).toHaveLength(1);
  });

  // === Identity ===

  test('saves and retrieves identity data', async () => {
    await store.saveIdentity('myIdentity', { displayName: 'Alice', publicKey: 'abc123' });
    const result = await store.getIdentity('myIdentity');
    expect(result.displayName).toBe('Alice');
  });

  test('returns undefined for missing identity', async () => {
    const result = await store.getIdentity('nonexistent');
    expect(result).toBeUndefined();
  });

  // === Peers ===

  test('saves and retrieves peer', async () => {
    await store.savePeer({ peerId: 'bob', publicKey: 'bob-key', lastSeen: Date.now(), alias: 'Bob' });
    const peer = await store.getPeer('bob');
    expect(peer).toBeDefined();
    expect(peer.alias).toBe('Bob');
  });

  test('lists all peers', async () => {
    await store.savePeer({ peerId: 'bob', publicKey: 'k1', lastSeen: 1000 });
    await store.savePeer({ peerId: 'charlie', publicKey: 'k2', lastSeen: 2000 });

    const peers = await store.getAllPeers();
    expect(peers).toHaveLength(2);
  });

  // === Offline Outbox ===

  test('enqueues and retrieves messages', async () => {
    await store.enqueueMessage('bob', { type: 'chat', content: 'Hello' });
    await store.enqueueMessage('bob', { type: 'chat', content: 'World' });

    const queued = await store.getQueuedMessages('bob');
    expect(queued).toHaveLength(2);
    expect(queued[0].data.content).toBe('Hello');
  });

  test('dequeues single message', async () => {
    await store.enqueueMessage('bob', { content: 'msg1' });
    await store.enqueueMessage('bob', { content: 'msg2' });

    const queued = await store.getQueuedMessages('bob');
    await store.dequeueMessage(queued[0].id);

    const remaining = await store.getQueuedMessages('bob');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].data.content).toBe('msg2');
  });

  test('dequeues all for peer (flush)', async () => {
    await store.enqueueMessage('bob', { content: 'a' });
    await store.enqueueMessage('bob', { content: 'b' });
    await store.enqueueMessage('charlie', { content: 'c' });

    const flushed = await store.dequeueAllForPeer('bob');
    expect(flushed).toHaveLength(2);

    const bobRemaining = await store.getQueuedMessages('bob');
    expect(bobRemaining).toHaveLength(0);

    // Charlie's messages unaffected
    const charlieQ = await store.getQueuedMessages('charlie');
    expect(charlieQ).toHaveLength(1);
  });


  test('persists custody metadata alongside queued messages', async () => {
    await store.enqueueMessage('bob', { content: 'opaque' }, {
      envelopeId: 'env-1',
      opId: 'op-1',
      workspaceId: 'ws-1',
      domain: 'channel-message',
      replicationClass: 'critical',
    });

    const queued = await store.getQueuedMessages('bob');
    expect(queued).toHaveLength(1);
    expect(queued[0].envelopeId).toBe('env-1');
    expect(queued[0].opId).toBe('op-1');
    expect(queued[0].replicationClass).toBe('critical');
  });


  test('saves and retrieves delivery receipts', async () => {
    await store.saveDeliveryReceipt({
      receiptId: 'r-1',
      kind: 'delivered',
      opId: 'op-1',
      recipientPeerId: 'bob',
      timestamp: 100,
    });
    await store.saveDeliveryReceipt({
      receiptId: 'r-2',
      kind: 'acknowledged',
      opId: 'op-2',
      recipientPeerId: 'bob',
      timestamp: 200,
    });
    await store.saveDeliveryReceipt({
      receiptId: 'r-3',
      kind: 'delivered',
      opId: 'op-3',
      recipientPeerId: 'charlie',
      timestamp: 150,
    });

    const bobReceipts = await store.getDeliveryReceipts('bob');
    expect(bobReceipts).toHaveLength(2);
    expect(bobReceipts[0].receiptId).toBe('r-1');
    expect(bobReceipts[1].receiptId).toBe('r-2');

    const charlieReceipts = await store.getDeliveryReceipts('charlie');
    expect(charlieReceipts).toHaveLength(1);
    expect(charlieReceipts[0].receiptId).toBe('r-3');
  });

  test('dedupes delivery receipts by recipient + receiptId', async () => {
    await store.saveDeliveryReceipt({
      receiptId: 'r-1',
      kind: 'delivered',
      opId: 'op-1',
      recipientPeerId: 'bob',
      timestamp: 100,
    });
    await store.saveDeliveryReceipt({
      receiptId: 'r-1',
      kind: 'acknowledged',
      opId: 'op-1',
      recipientPeerId: 'bob',
      timestamp: 999,
    });

    const bobReceipts = await store.getDeliveryReceipts('bob');
    expect(bobReceipts).toHaveLength(1);
    expect(bobReceipts[0].timestamp).toBe(999);
    expect(bobReceipts[0].kind).toBe('acknowledged');
  });

  // === Settings ===

  test('saves and retrieves settings', async () => {
    await store.saveSetting('theme', 'dark');
    const theme = await store.getSetting('theme');
    expect(theme).toBe('dark');
  });

  // === Clear ===

  test('clears all data', async () => {
    await store.saveWorkspace({ id: 'ws-1', name: 'Team' });
    await store.saveMessage({ id: 'msg-1', channelId: 'ch-1', content: 'Hi', timestamp: 1000 });
    await store.savePeer({ peerId: 'bob', publicKey: 'k', lastSeen: 1000 });

    await store.clearAll();

    expect(await store.getAllWorkspaces()).toHaveLength(0);
    expect(await store.getChannelMessages('ch-1')).toHaveLength(0);
    expect(await store.getAllPeers()).toHaveLength(0);
  });
});

// === Persistence Across "Restarts" ===

describe('PersistentStore - Survives Restart', () => {
  test('data persists across close/reopen', async () => {
    const dbName = `persist-test-${Date.now()}`;

    // Session 1: save data
    const store1 = new PersistentStore({ dbName });
    await store1.init();
    await store1.saveWorkspace({ id: 'ws-1', name: 'Persisted Team' });
    await store1.saveMessage({ id: 'msg-1', channelId: 'ch-1', content: 'Persisted msg', timestamp: 1000 });
    await store1.saveIdentity('myId', { name: 'Alice' });
    await store1.close();

    // Session 2: reopen and verify
    const store2 = new PersistentStore({ dbName });
    await store2.init();

    const ws = await store2.getWorkspace('ws-1');
    expect(ws).toBeDefined();
    expect(ws.name).toBe('Persisted Team');

    const msgs = await store2.getChannelMessages('ch-1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('Persisted msg');

    const id = await store2.getIdentity('myId');
    expect(id.name).toBe('Alice');

    await store2.close();
  });


  test('delivery receipts persist across close/reopen', async () => {
    const dbName = `receipt-persist-test-${Date.now()}`;

    const store1 = new PersistentStore({ dbName });
    await store1.init();
    await store1.saveDeliveryReceipt({
      receiptId: 'r-1',
      kind: 'delivered',
      opId: 'op-1',
      recipientPeerId: 'bob',
      timestamp: 123,
    });
    await store1.close();

    const store2 = new PersistentStore({ dbName });
    await store2.init();
    const receipts = await store2.getDeliveryReceipts('bob');
    expect(receipts).toHaveLength(1);
    expect(receipts[0].receiptId).toBe('r-1');
    expect(receipts[0].timestamp).toBe(123);
    await store2.close();
  });


  test('manifest store state persists across close/reopen', async () => {
    const dbName = `manifest-persist-test-${Date.now()}`;

    const state = {
      schemaVersion: 1,
      workspaces: [
        {
          workspaceId: 'ws-1',
          versions: [
            {
              domain: 'membership' as const,
              workspaceId: 'ws-1',
              version: 2,
              itemCount: 3,
              lastUpdatedAt: 123,
              lastUpdatedBy: 'peer-a',
            },
          ],
          deltas: [],
          snapshots: [],
        },
      ],
    };

    const store1 = new PersistentStore({ dbName });
    await store1.init();
    await store1.saveManifestStoreState(state as any);
    await store1.close();

    const store2 = new PersistentStore({ dbName });
    await store2.init();
    const loaded = await store2.getManifestStoreState();
    expect(loaded).toEqual(state);

    await store2.clearManifestStoreState();
    const cleared = await store2.getManifestStoreState();
    expect(cleared).toBeUndefined();

    await store2.close();
  });

  test('per-workspace manifest records persist across close/reopen', async () => {
    const dbName = `manifest-record-persist-test-${Date.now()}`;
    const workspaceState = {
      workspaceId: 'ws-1',
      versions: [
        {
          domain: 'membership' as const,
          workspaceId: 'ws-1',
          version: 2,
          itemCount: 3,
          lastUpdatedAt: 123,
          lastUpdatedBy: 'peer-a',
        },
      ],
      deltas: [],
      snapshots: [],
    };

    const store1 = new PersistentStore({ dbName });
    await store1.init();
    await store1.saveManifest('ws-1', workspaceState as any);
    await store1.close();

    const store2 = new PersistentStore({ dbName });
    await store2.init();

    const loaded = await store2.getManifest('ws-1');
    expect(loaded).toEqual(workspaceState);

    await store2.deleteManifest('ws-1');
    const cleared = await store2.getManifest('ws-1');
    expect(cleared).toBeUndefined();

    await store2.close();
  });
});

// === OfflineQueue ===

describe('OfflineQueue', () => {
  let queue: OfflineQueue;

  beforeEach(() => {
    queue = new OfflineQueue();
  });

  test('enqueues message for offline peer', async () => {
    await queue.enqueue('bob', { type: 'chat', content: 'Hello Bob' });
    expect(queue.getQueuedCount('bob')).toBe(1);
    expect(queue.getTotalQueued()).toBe(1);
  });

  test('queues multiple messages per peer', async () => {
    await queue.enqueue('bob', { content: 'msg1' });
    await queue.enqueue('bob', { content: 'msg2' });
    await queue.enqueue('bob', { content: 'msg3' });

    expect(queue.getQueuedCount('bob')).toBe(3);
  });

  test('queues messages for multiple peers', async () => {
    await queue.enqueue('bob', { content: 'for bob' });
    await queue.enqueue('charlie', { content: 'for charlie' });

    expect(queue.getPeersWithQueue()).toHaveLength(2);
    expect(queue.getTotalQueued()).toBe(2);
  });

  test('flushes all messages for a peer', async () => {
    await queue.enqueue('bob', { content: 'msg1' });
    await queue.enqueue('bob', { content: 'msg2' });

    const flushed = await queue.flush('bob');
    expect(flushed).toHaveLength(2);
    expect(flushed[0].content).toBe('msg1');
    expect(flushed[1].content).toBe('msg2');

    // Queue should be empty after flush
    expect(queue.getQueuedCount('bob')).toBe(0);
  });

  test('flush does not affect other peers', async () => {
    await queue.enqueue('bob', { content: 'for bob' });
    await queue.enqueue('charlie', { content: 'for charlie' });

    await queue.flush('bob');

    expect(queue.getQueuedCount('bob')).toBe(0);
    expect(queue.getQueuedCount('charlie')).toBe(1);
  });

  test('flush returns empty for peer with no queue', async () => {
    const flushed = await queue.flush('nobody');
    expect(flushed).toHaveLength(0);
  });

  test('expires old messages', async () => {
    const queue = new OfflineQueue({ maxAgeMs: 100 }); // 100ms expiry

    await queue.enqueue('bob', { content: 'will expire' });

    // Wait for expiry
    await new Promise(r => setTimeout(r, 150));

    const queued = await queue.getQueued('bob');
    expect(queued).toHaveLength(0);

    const flushed = await queue.flush('bob');
    expect(flushed).toHaveLength(0);
  });

  test('clears all queues', async () => {
    await queue.enqueue('bob', { content: 'msg' });
    await queue.enqueue('charlie', { content: 'msg' });

    queue.clear();

    expect(queue.getTotalQueued()).toBe(0);
  });

  test('integrates with PersistentStore', async () => {
    const store = new PersistentStore({ dbName: `queue-test-${Date.now()}` });
    await store.init();

    const queue = new OfflineQueue();
    queue.setPersistence(
      (peerId, data, meta) => store.enqueueMessage(peerId, data, meta),
      (peerId) => store.getQueuedMessages(peerId),
      (id) => store.dequeueMessage(id),
      (peerId) => store.dequeueAllForPeer(peerId),
    );

    // Enqueue
    await queue.enqueue('bob', { content: 'persisted msg' });

    // Verify in store
    const stored = await store.getQueuedMessages('bob');
    expect(stored).toHaveLength(1);
    expect(stored[0].data.content).toBe('persisted msg');

    await store.close();
  });
});

// === Full Flow: Send → Queue → Reconnect → Deliver ===

describe('Offline Queue - Full Flow', () => {
  test('simulates: send while offline → queue → peer reconnects → flush → deliver', async () => {
    const queue = new OfflineQueue();
    const delivered: any[] = [];

    // Simulate sending function
    const sendToPeer = (peerId: string, data: any) => {
      delivered.push({ peerId, data });
    };

    // Alice tries to send to Bob (offline)
    const isOnline = false;
    const message1 = { channelId: 'ch-1', content: 'Hey Bob!' };
    const message2 = { channelId: 'ch-1', content: 'Are you there?' };

    if (!isOnline) {
      await queue.enqueue('bob', message1);
      await queue.enqueue('bob', message2);
    }

    expect(delivered).toHaveLength(0); // Nothing sent yet
    expect(queue.getQueuedCount('bob')).toBe(2);

    // Bob comes online!
    const pending = await queue.flush('bob');
    for (const msg of pending) {
      sendToPeer('bob', msg);
    }

    // Messages delivered
    expect(delivered).toHaveLength(2);
    expect(delivered[0].data.content).toBe('Hey Bob!');
    expect(delivered[1].data.content).toBe('Are you there?');

    // Queue is empty
    expect(queue.getQueuedCount('bob')).toBe(0);
  });
});

describe('PersistentStore pre-key persistence', () => {
  test('saves and restores peer bundles + local pre-key state', async () => {
    const store = new PersistentStore({ dbName: `prekey-persistence-${Date.now()}` });
    await store.init();

    const now = Date.now();
    const bundle = {
      version: 1 as const,
      peerId: 'peer-b',
      generatedAt: now,
      signingPublicKey: 'signing-pub',
      signedPreKey: {
        keyId: 99,
        publicKey: 'signed-pre-key',
        signature: 'signed-pre-key-signature',
        createdAt: now,
        expiresAt: now + 60_000,
      },
      oneTimePreKeys: [
        { keyId: 1, publicKey: 'otpk-1', createdAt: now },
        { keyId: 2, publicKey: 'otpk-2', createdAt: now },
      ],
    };

    await store.savePreKeyBundle('peer-b', bundle);
    expect(await store.getPreKeyBundle('peer-b')).toEqual(bundle);

    const localState = {
      version: 1 as const,
      generatedAt: now,
      signedPreKey: {
        keyId: 99,
        publicKey: 'signed-pre-key',
        privateKey: 'signed-pre-key-private',
        signature: 'signed-pre-key-signature',
        createdAt: now,
        expiresAt: now + 60_000,
      },
      oneTimePreKeys: [
        { keyId: 1, publicKey: 'otpk-1', privateKey: 'otpk-1-priv', createdAt: now },
      ],
      nextOneTimePreKeyId: 3,
    };

    await store.saveLocalPreKeyState('peer-a', localState);
    expect(await store.getLocalPreKeyState('peer-a')).toEqual(localState);

    await store.deletePreKeyBundle('peer-b');
    expect(await store.getPreKeyBundle('peer-b')).toBeUndefined();

    await store.deleteLocalPreKeyState('peer-a');
    expect(await store.getLocalPreKeyState('peer-a')).toBeUndefined();

    await store.close();
  });


  test('prunes expired bundles and stale one-time pre-keys', async () => {
    const store = new PersistentStore({ dbName: `prekey-prune-${Date.now()}` });
    await store.init();

    const now = Date.now();

    await store.savePreKeyBundle('peer-expired', {
      version: 1 as const,
      peerId: 'peer-expired',
      generatedAt: now - 1_000,
      signingPublicKey: 'signing-expired',
      signedPreKey: {
        keyId: 1,
        publicKey: 'signed-expired',
        signature: 'sig-expired',
        createdAt: now - 120_000,
        expiresAt: now - 60_000,
      },
      oneTimePreKeys: [
        { keyId: 1, publicKey: 'expired-otk', createdAt: now - 120_000 },
      ],
    });

    await store.savePreKeyBundle('peer-fresh', {
      version: 1 as const,
      peerId: 'peer-fresh',
      generatedAt: now - 1_000,
      signingPublicKey: 'signing-fresh',
      signedPreKey: {
        keyId: 5,
        publicKey: 'signed-fresh',
        signature: 'sig-fresh',
        createdAt: now - 10_000,
        expiresAt: now + 120_000,
      },
      oneTimePreKeys: [
        { keyId: 4, publicKey: 'fresh-4', createdAt: now - 1_000 },
        { keyId: 2, publicKey: 'stale-2', createdAt: now - 90_000 },
        { keyId: 4, publicKey: 'duplicate-4', createdAt: now - 500 },
        { keyId: 3, publicKey: 'fresh-3', createdAt: now - 2_000 },
      ],
    });

    const pruned = await store.prunePreKeyBundles({
      now,
      maxBundleAgeMs: 10_000,
      maxOneTimePreKeyAgeMs: 30_000,
    });

    expect(pruned.deleted).toBe(1);
    expect(pruned.updated).toBe(1);
    expect(await store.getPreKeyBundle('peer-expired')).toBeUndefined();

    const fresh = await store.getPreKeyBundle('peer-fresh');
    expect(fresh?.oneTimePreKeys.map((entry) => entry.keyId)).toEqual([3, 4]);

    await store.close();
  });
});
