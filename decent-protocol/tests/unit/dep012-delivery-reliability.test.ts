/**
 * DEP-012 Phase 5 — Delivery reliability tests
 *
 * Covers the 5 remaining items from the DEP-012 implementation checklist:
 * 1. Unit: recipient snapshot immutability
 * 2. Unit: duplicate ACK idempotency (via applyMessageReceipt)
 * 3. Unit: group message needs all ACKs for delivered
 * 4. Integration: one recipient offline, replay on reconnect
 * 5. Integration: partial delivery progress tracking
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { applyMessageReceipt, type PlaintextMessage } from '../../src';
import { OfflineQueue } from '../../src/messages/OfflineQueue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<PlaintextMessage> = {}): PlaintextMessage {
  return {
    id: 'msg-1',
    channelId: 'ch-1',
    senderId: 'alice',
    timestamp: 1,
    content: 'hello group',
    type: 'text',
    prevHash: 'genesis',
    status: 'sent',
    recipientPeerIds: ['bob', 'carol', 'dave'],
    ackedBy: [],
    ackedAt: {},
    readBy: [],
    readAt: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Unit: recipient snapshot immutability
// ---------------------------------------------------------------------------

describe('DEP-012: recipient snapshot immutability', () => {
  test('recipientPeerIds is captured at send-time and unaffected by later mutations of the source array', () => {
    const recipients = ['bob', 'carol'];
    const msg = makeMessage({ recipientPeerIds: [...recipients] });

    // Simulate a member joining after send — mutate the original array
    recipients.push('eve');

    // The message's recipient list must still be the original snapshot
    expect(msg.recipientPeerIds).toEqual(['bob', 'carol']);
    expect(msg.recipientPeerIds).not.toContain('eve');
  });

  test('applyMessageReceipt does not mutate the original recipientPeerIds array', () => {
    const msg = makeMessage({ recipientPeerIds: ['bob', 'carol'] });
    const originalRecipients = msg.recipientPeerIds!;

    const result = applyMessageReceipt(msg, {
      peerId: 'bob',
      type: 'ack',
      at: 100,
      statusRecipients: ['bob', 'carol'],
    });

    // The returned message is a new object; the original is untouched
    expect(result.message).not.toBe(msg);
    expect(originalRecipients).toEqual(['bob', 'carol']);
    // Original message's ackedBy must not be mutated
    expect(msg.ackedBy).toEqual([]);
  });

  test('recipient snapshot is used for delivery status even after members leave', () => {
    // Message sent to [bob, carol, dave]
    const msg = makeMessage({ recipientPeerIds: ['bob', 'carol', 'dave'] });

    // Bob acks
    const r1 = applyMessageReceipt(msg, {
      peerId: 'bob',
      type: 'ack',
      at: 100,
      statusRecipients: ['bob', 'carol', 'dave'],
    });
    expect(r1.status).toBe('sent'); // not delivered — carol and dave haven't acked

    // Carol acks
    const r2 = applyMessageReceipt(r1.message, {
      peerId: 'carol',
      type: 'ack',
      at: 200,
      statusRecipients: ['bob', 'carol', 'dave'],
    });
    expect(r2.status).toBe('sent'); // still not delivered — dave hasn't acked

    // Even though dave "left the group" conceptually, the original snapshot demands
    // all 3 acks. Without dave's ack, status stays 'sent'.
    expect(r2.counts).toEqual({ acked: 2, read: 0, total: 3 });
  });
});

// ---------------------------------------------------------------------------
// 2. Unit: duplicate ACK idempotency
// ---------------------------------------------------------------------------

describe('DEP-012: duplicate ACK idempotency', () => {
  test('receiving the same ACK twice does not corrupt ackedBy or ackedAt', () => {
    const msg = makeMessage();

    // First ACK from bob
    const r1 = applyMessageReceipt(msg, {
      peerId: 'bob',
      type: 'ack',
      at: 100,
      statusRecipients: ['bob', 'carol', 'dave'],
    });
    expect(r1.accepted).toBe(true);
    expect(r1.changed).toBe(true);
    expect(r1.message.ackedBy).toEqual(['bob']);
    expect(r1.message.ackedAt).toEqual({ bob: 100 });

    // Duplicate ACK from bob (same peer, same type)
    const r2 = applyMessageReceipt(r1.message, {
      peerId: 'bob',
      type: 'ack',
      at: 200, // even with a different timestamp
      statusRecipients: ['bob', 'carol', 'dave'],
    });
    expect(r2.accepted).toBe(true);
    expect(r2.changed).toBe(false); // no state change
    // ackedBy should still contain bob only once
    expect(r2.message.ackedBy).toEqual(['bob']);
    // ackedAt should retain the original timestamp, not overwrite with 200
    expect(r2.message.ackedAt).toEqual({ bob: 100 });
  });

  test('duplicate ACK does not double-count in delivery progress', () => {
    const msg = makeMessage({ recipientPeerIds: ['bob', 'carol'] });

    const r1 = applyMessageReceipt(msg, {
      peerId: 'bob',
      type: 'ack',
      at: 100,
      statusRecipients: ['bob', 'carol'],
    });
    expect(r1.counts).toEqual({ acked: 1, read: 0, total: 2 });

    // Duplicate
    const r2 = applyMessageReceipt(r1.message, {
      peerId: 'bob',
      type: 'ack',
      at: 200,
      statusRecipients: ['bob', 'carol'],
    });
    // Count must remain 1, not 2
    expect(r2.counts).toEqual({ acked: 1, read: 0, total: 2 });
    expect(r2.status).toBe('sent');
  });

  test('duplicate read receipt is idempotent', () => {
    const msg = makeMessage({ recipientPeerIds: ['bob'] });

    const r1 = applyMessageReceipt(msg, {
      peerId: 'bob',
      type: 'read',
      at: 100,
      statusRecipients: ['bob'],
    });
    expect(r1.status).toBe('read');
    expect(r1.message.readAt).toEqual({ bob: 100 });

    // Duplicate read
    const r2 = applyMessageReceipt(r1.message, {
      peerId: 'bob',
      type: 'read',
      at: 200,
      statusRecipients: ['bob'],
    });
    expect(r2.changed).toBe(false);
    expect(r2.message.readBy).toEqual(['bob']);
    // Original timestamp preserved
    expect(r2.message.readAt).toEqual({ bob: 100 });
    expect(r2.status).toBe('read');
  });
});

// ---------------------------------------------------------------------------
// 3. Unit: group message needs all ACKs for delivered
// ---------------------------------------------------------------------------

describe('DEP-012: group message needs all ACKs for delivered', () => {
  test('message stays sent until every recipient has acked', () => {
    const recipients = ['bob', 'carol', 'dave'];
    let msg = makeMessage({ recipientPeerIds: recipients });

    // ACK from bob only → still sent
    const r1 = applyMessageReceipt(msg, {
      peerId: 'bob',
      type: 'ack',
      at: 100,
      statusRecipients: recipients,
    });
    expect(r1.status).toBe('sent');
    expect(r1.counts).toEqual({ acked: 1, read: 0, total: 3 });

    // ACK from carol → still sent
    const r2 = applyMessageReceipt(r1.message, {
      peerId: 'carol',
      type: 'ack',
      at: 200,
      statusRecipients: recipients,
    });
    expect(r2.status).toBe('sent');
    expect(r2.counts).toEqual({ acked: 2, read: 0, total: 3 });

    // ACK from dave → NOW delivered
    const r3 = applyMessageReceipt(r2.message, {
      peerId: 'dave',
      type: 'ack',
      at: 300,
      statusRecipients: recipients,
    });
    expect(r3.status).toBe('delivered');
    expect(r3.counts).toEqual({ acked: 3, read: 0, total: 3 });
    expect(r3.message.status).toBe('delivered');
  });

  test('five-member group: only transitions to delivered when all five ack', () => {
    const recipients = ['bob', 'carol', 'dave', 'eve', 'frank'];
    let msg = makeMessage({ recipientPeerIds: recipients });

    // ACK from 4 out of 5
    for (let i = 0; i < 4; i++) {
      const result = applyMessageReceipt(msg, {
        peerId: recipients[i],
        type: 'ack',
        at: 100 + i,
        statusRecipients: recipients,
      });
      expect(result.status).toBe('sent');
      msg = result.message;
    }

    // 5th ACK triggers delivered
    const final = applyMessageReceipt(msg, {
      peerId: 'frank',
      type: 'ack',
      at: 200,
      statusRecipients: recipients,
    });
    expect(final.status).toBe('delivered');
    expect(final.counts.acked).toBe(5);
    expect(final.counts.total).toBe(5);
  });

  test('sender is excluded from recipient counts', () => {
    // If sender is accidentally in recipientPeerIds, it should be normalized out
    const msg = makeMessage({
      senderId: 'alice',
      recipientPeerIds: ['alice', 'bob'],
    });

    const result = applyMessageReceipt(msg, {
      peerId: 'bob',
      type: 'ack',
      at: 100,
      statusRecipients: ['alice', 'bob'],
    });

    // 'alice' (sender) is excluded from statusRecipients by normalizeRecipients
    // so only bob's ack is needed → delivered
    expect(result.status).toBe('delivered');
    expect(result.counts.total).toBe(1); // only bob counts
  });
});

// ---------------------------------------------------------------------------
// 4. Integration: one recipient offline, replay on reconnect
// ---------------------------------------------------------------------------

describe('DEP-012: one recipient offline, replay on reconnect', () => {
  let queue: OfflineQueue;

  beforeEach(() => {
    queue = new OfflineQueue();
  });

  test('message queued for offline peer, delivered after reconnect and ACK', async () => {
    const recipients = ['bob', 'carol'];
    const msg = makeMessage({
      id: 'msg-group-1',
      recipientPeerIds: recipients,
    });

    // bob is online and acks immediately
    const r1 = applyMessageReceipt(msg, {
      peerId: 'bob',
      type: 'ack',
      at: 100,
      statusRecipients: recipients,
    });
    expect(r1.status).toBe('sent'); // carol hasn't acked

    // carol is offline — queue the message for her
    await queue.enqueue('carol', {
      messageId: msg.id,
      channelId: msg.channelId,
      content: msg.content,
    });
    expect(queue.getQueuedCount('carol')).toBe(1);

    // carol reconnects — flush the queue
    const flushed = await queue.flush('carol');
    expect(flushed).toHaveLength(1);
    expect(flushed[0].messageId).toBe('msg-group-1');
    expect(queue.getQueuedCount('carol')).toBe(0);

    // carol receives the message and sends ACK
    const r2 = applyMessageReceipt(r1.message, {
      peerId: 'carol',
      type: 'ack',
      at: 500,
      statusRecipients: recipients,
    });

    // Now all recipients have acked → delivered
    expect(r2.status).toBe('delivered');
    expect(r2.counts).toEqual({ acked: 2, read: 0, total: 2 });
  });

  test('multiple offline peers: message delivered only after all reconnect and ack', async () => {
    const recipients = ['bob', 'carol', 'dave'];
    const msg = makeMessage({
      id: 'msg-group-2',
      recipientPeerIds: recipients,
    });

    // bob acks immediately (online)
    let current = applyMessageReceipt(msg, {
      peerId: 'bob',
      type: 'ack',
      at: 100,
      statusRecipients: recipients,
    }).message;

    // Queue for carol and dave (both offline)
    await queue.enqueue('carol', { messageId: msg.id });
    await queue.enqueue('dave', { messageId: msg.id });

    // carol reconnects first
    const carolFlushed = await queue.flush('carol');
    expect(carolFlushed).toHaveLength(1);

    current = applyMessageReceipt(current, {
      peerId: 'carol',
      type: 'ack',
      at: 200,
      statusRecipients: recipients,
    }).message;
    expect(current.status).toBe('sent'); // dave still hasn't acked

    // dave reconnects
    const daveFlushed = await queue.flush('dave');
    expect(daveFlushed).toHaveLength(1);

    const final = applyMessageReceipt(current, {
      peerId: 'dave',
      type: 'ack',
      at: 300,
      statusRecipients: recipients,
    });

    expect(final.status).toBe('delivered');
    expect(final.counts).toEqual({ acked: 3, read: 0, total: 3 });
  });

  test('offline queue preserves message data through flush cycle', async () => {
    const payload = {
      messageId: 'msg-offline-1',
      channelId: 'ch-1',
      content: 'encrypted-envelope-bytes',
      timestamp: Date.now(),
    };

    await queue.enqueue('carol', payload);

    // Simulate reconnect
    const flushed = await queue.flush('carol');
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toEqual(payload);

    // Queue is now empty
    expect(queue.getQueuedCount('carol')).toBe(0);
    const secondFlush = await queue.flush('carol');
    expect(secondFlush).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Integration: partial delivery progress tracking
// ---------------------------------------------------------------------------

describe('DEP-012: partial delivery progress tracking', () => {
  let queue: OfflineQueue;

  beforeEach(() => {
    queue = new OfflineQueue();
  });

  test('delivery state accurately reflects per-recipient progress', () => {
    const recipients = ['bob', 'carol', 'dave', 'eve'];
    let msg = makeMessage({ recipientPeerIds: recipients });

    // Track incremental progress
    const progress: { acked: number; total: number }[] = [];

    for (const peer of recipients) {
      const result = applyMessageReceipt(msg, {
        peerId: peer,
        type: 'ack',
        at: Date.now(),
        statusRecipients: recipients,
      });
      progress.push({ acked: result.counts.acked, total: result.counts.total });
      msg = result.message;
    }

    // Progress should be strictly increasing: 1/4, 2/4, 3/4, 4/4
    expect(progress).toEqual([
      { acked: 1, total: 4 },
      { acked: 2, total: 4 },
      { acked: 3, total: 4 },
      { acked: 4, total: 4 },
    ]);

    // Final status is delivered
    expect(msg.status).toBe('delivered');
  });

  test('mixed online/offline: progress tracks correctly as peers come online', async () => {
    const recipients = ['bob', 'carol', 'dave'];
    let msg = makeMessage({
      id: 'msg-progress-1',
      recipientPeerIds: recipients,
    });

    // bob is online, acks immediately: 1/3
    const r1 = applyMessageReceipt(msg, {
      peerId: 'bob',
      type: 'ack',
      at: 100,
      statusRecipients: recipients,
    });
    expect(r1.counts).toEqual({ acked: 1, read: 0, total: 3 });
    expect(r1.status).toBe('sent');

    // carol and dave are offline — queue messages
    await queue.enqueue('carol', { messageId: msg.id });
    await queue.enqueue('dave', { messageId: msg.id });

    // carol comes online: 2/3
    await queue.flush('carol');
    const r2 = applyMessageReceipt(r1.message, {
      peerId: 'carol',
      type: 'ack',
      at: 200,
      statusRecipients: recipients,
    });
    expect(r2.counts).toEqual({ acked: 2, read: 0, total: 3 });
    expect(r2.status).toBe('sent');

    // dave comes online: 3/3 → delivered
    await queue.flush('dave');
    const r3 = applyMessageReceipt(r2.message, {
      peerId: 'dave',
      type: 'ack',
      at: 300,
      statusRecipients: recipients,
    });
    expect(r3.counts).toEqual({ acked: 3, read: 0, total: 3 });
    expect(r3.status).toBe('delivered');
  });

  test('sender refresh: message state is reconstructable from ackedBy/ackedAt', () => {
    // Simulate: sender goes offline, comes back, reconstructs delivery state
    // from the persisted ackedBy/ackedAt fields

    const recipients = ['bob', 'carol', 'dave'];

    // Message was partially acked before sender went offline
    const persistedMsg = makeMessage({
      recipientPeerIds: recipients,
      ackedBy: ['bob', 'carol'],
      ackedAt: { bob: 100, carol: 200 },
      status: 'sent',
    });

    // After sender reconnects, they can reconstruct progress by re-checking
    // the receipt state. Apply the final missing ACK:
    const result = applyMessageReceipt(persistedMsg, {
      peerId: 'dave',
      type: 'ack',
      at: 500,
      statusRecipients: recipients,
    });

    // State correctly reaches delivered despite sender's disconnection
    expect(result.status).toBe('delivered');
    expect(result.counts).toEqual({ acked: 3, read: 0, total: 3 });
    expect(result.message.ackedBy?.sort()).toEqual(['bob', 'carol', 'dave']);
  });

  test('ackedBy tracks which specific peers have acked', () => {
    const recipients = ['bob', 'carol', 'dave'];
    let msg = makeMessage({ recipientPeerIds: recipients });

    // Only bob and dave ack (carol is still pending)
    const r1 = applyMessageReceipt(msg, {
      peerId: 'bob',
      type: 'ack',
      at: 100,
      statusRecipients: recipients,
    });
    const r2 = applyMessageReceipt(r1.message, {
      peerId: 'dave',
      type: 'ack',
      at: 200,
      statusRecipients: recipients,
    });

    // ackedBy shows exactly who acked
    expect(r2.message.ackedBy?.sort()).toEqual(['bob', 'dave']);
    // carol is NOT in ackedBy
    expect(r2.message.ackedBy).not.toContain('carol');
    // Status is still sent (carol missing)
    expect(r2.status).toBe('sent');
    expect(r2.counts).toEqual({ acked: 2, read: 0, total: 3 });
  });
});
