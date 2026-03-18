import '../setup';
import { describe, expect, test } from 'bun:test';
import { CustodyStore } from '../../src/messages/CustodyStore';
import { OfflineQueue } from '../../src/messages/OfflineQueue';
import { PersistentStore } from '../../src/storage/PersistentStore';

describe('CustodyStore', () => {
  test('stores one custody envelope per recipient', async () => {
    const store = new CustodyStore();

    const envelope = await store.storeEnvelope({
      envelopeId: 'env-1',
      opId: 'op-1',
      recipientPeerIds: ['peer-a', 'peer-b', 'peer-a'],
      workspaceId: 'ws-1',
      channelId: 'ch-1',
      ciphertext: { payload: 'opaque' },
      domain: 'channel-message',
      replicationClass: 'critical',
    });

    expect(envelope.recipientPeerIds).toEqual(['peer-a', 'peer-b']);

    const a = await store.listAllForRecipient('peer-a');
    const b = await store.listAllForRecipient('peer-b');
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].envelopeId).toBe('env-1');
    expect(b[0].envelopeId).toBe('env-1');
  });

  test('applyReceipt removes queued envelope and records receipt', async () => {
    const store = new CustodyStore();

    await store.storeEnvelope({
      envelopeId: 'env-ack',
      opId: 'op-ack',
      recipientPeerIds: ['peer-a'],
      workspaceId: 'ws-1',
      ciphertext: { payload: 'opaque' },
    });

    const applied = await store.applyReceipt('peer-a', {
      receiptId: 'r-ack',
      kind: 'acknowledged',
      opId: 'op-ack',
      envelopeId: 'env-ack',
      recipientPeerId: 'peer-a',
      timestamp: Date.now(),
    });

    expect(applied).toBe(true);
    expect(await store.listAllForRecipient('peer-a')).toHaveLength(0);

    const receipts = await store.getReceipts('peer-a');
    expect(receipts).toHaveLength(1);
    expect(receipts[0].receiptId).toBe('r-ack');
  });

  test('buildSyncSummary combines queue state and receipts', async () => {
    const queue = new OfflineQueue({ retryDelayMs: 1_000, maxAgeMs: 60_000, maxRetries: 3 });
    const store = new CustodyStore(queue);

    await queue.enqueue('peer-a', { envelopeId: 'env-now' }, {
      envelopeId: 'env-now',
      opId: 'op-now',
      domain: 'channel-message',
      replicationClass: 'critical',
      createdAt: Date.now() - 1_000,
      deliveryState: 'stored',
    });

    await queue.enqueue('peer-a', { envelopeId: 'env-backoff' }, {
      envelopeId: 'env-backoff',
      opId: 'op-backoff',
      domain: 'receipt',
      replicationClass: 'standard',
      attempts: 1,
      lastAttempt: Date.now(),
      createdAt: Date.now(),
      deliveryState: 'stored',
    });

    const ts = Date.now();
    await store.recordReceipt({
      receiptId: 'r-delivered',
      kind: 'delivered',
      opId: 'op-now',
      envelopeId: 'env-now',
      recipientPeerId: 'peer-a',
      timestamp: ts,
    });

    const summary = await store.buildSyncSummary('peer-a');
    expect(summary.totalEnvelopes).toBe(2);
    expect(summary.deliverableCount).toBe(1);
    expect(summary.backingOffCount).toBe(1);
    expect(summary.byDomain['channel-message']).toBe(1);
    expect(summary.byDomain.receipt).toBe(1);
    expect(summary.byReplicationClass.critical).toBe(1);
    expect(summary.byReplicationClass.standard).toBe(1);
    expect(summary.lastReceiptAt).toBe(ts);
  });

  test('applyReceipt normalizes mismatched recipientPeerId to method recipient', async () => {
    const store = new CustodyStore();

    await store.storeEnvelope({
      envelopeId: 'env-mismatch',
      opId: 'op-mismatch',
      recipientPeerIds: ['peer-a'],
      workspaceId: 'ws-1',
      ciphertext: { payload: 'opaque' },
    });

    const applied = await store.applyReceipt('peer-a', {
      receiptId: 'r-mismatch',
      kind: 'acknowledged',
      opId: 'op-mismatch',
      envelopeId: 'env-mismatch',
      recipientPeerId: 'peer-b',
      timestamp: 500,
    });

    expect(applied).toBe(true);
    const aReceipts = await store.getReceipts('peer-a');
    expect(aReceipts).toHaveLength(1);
    expect(aReceipts[0].recipientPeerId).toBe('peer-a');
    expect((aReceipts[0].metadata as any)?.originalRecipientPeerId).toBe('peer-b');
    expect(await store.getReceipts('peer-b')).toHaveLength(0);
  });

  test('recordReceipt is idempotent by receiptId per recipient', async () => {
    const store = new CustodyStore();

    await store.recordReceipt({
      receiptId: 'r-dedupe',
      kind: 'delivered',
      opId: 'op-1',
      recipientPeerId: 'peer-a',
      timestamp: 100,
    });

    await store.recordReceipt({
      receiptId: 'r-dedupe',
      kind: 'delivered',
      opId: 'op-1',
      recipientPeerId: 'peer-a',
      timestamp: 101,
    });

    const receipts = await store.getReceipts('peer-a');
    expect(receipts).toHaveLength(1);
    expect(receipts[0].timestamp).toBe(100);
  });


  test('receipts persist via PersistentStore across CustodyStore instances', async () => {
    const dbName = `custody-receipts-${Date.now()}`;

    const persistent1 = new PersistentStore({ dbName });
    await persistent1.init();
    const store1 = new CustodyStore(new OfflineQueue());
    store1.setReceiptPersistence(
      (receipt) => persistent1.saveDeliveryReceipt(receipt),
      (recipientPeerId) => persistent1.getDeliveryReceipts(recipientPeerId),
    );

    await store1.recordReceipt({
      receiptId: 'r-persist',
      kind: 'delivered',
      opId: 'op-persist',
      recipientPeerId: 'peer-a',
      timestamp: 700,
    });
    await persistent1.close();

    const persistent2 = new PersistentStore({ dbName });
    await persistent2.init();
    const store2 = new CustodyStore(new OfflineQueue());
    store2.setReceiptPersistence(
      (receipt) => persistent2.saveDeliveryReceipt(receipt),
      (recipientPeerId) => persistent2.getDeliveryReceipts(recipientPeerId),
    );

    const receipts = await store2.getReceipts('peer-a');
    expect(receipts).toHaveLength(1);
    expect(receipts[0].receiptId).toBe('r-persist');
    expect(receipts[0].timestamp).toBe(700);
    await persistent2.close();
  });

});
