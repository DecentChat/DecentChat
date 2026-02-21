/**
 * GAP 2: Queue + ACK Integration — End-to-end offline queue flush with delivery ACK
 *
 * Scenario: 20 messages queued for an offline peer, peer reconnects,
 * queue flushes, delivery ACK flows back, sender status reaches 'delivered'.
 *
 * Verify: every message transitions through pending→sent→delivered,
 * no messages lost, no duplicates.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { OfflineQueue } from '../../src/messages/OfflineQueue';

// ---------------------------------------------------------------------------
// Minimal ACK state machine (mirrors delivery-ack.test.ts pattern)
// ---------------------------------------------------------------------------

type MessageStatus = 'pending' | 'sent' | 'delivered';

interface TrackedMessage {
  id: string;
  channelId: string;
  content: string;
  status: MessageStatus;
  statusHistory: MessageStatus[];
}

class QueueAckController {
  private messages = new Map<string, TrackedMessage>();
  livePeers = new Set<string>();
  sentEnvelopes: { peerId: string; messageId: string }[] = [];
  acksSent: { peerId: string; messageId: string }[] = [];

  createMessage(channelId: string, content: string): TrackedMessage {
    const msg: TrackedMessage = {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      channelId,
      content,
      status: 'pending',
      statusHistory: ['pending'],
    };
    this.messages.set(msg.id, msg);
    return msg;
  }

  send(peerId: string, msg: TrackedMessage): boolean {
    if (!this.livePeers.has(peerId)) return false;

    this.sentEnvelopes.push({ peerId, messageId: msg.id });
    if (msg.status === 'pending') {
      msg.status = 'sent';
      msg.statusHistory.push('sent');
    }
    return true;
  }

  handleAck(messageId: string): void {
    const msg = this.messages.get(messageId);
    if (!msg || msg.status === 'delivered') return;
    msg.status = 'delivered';
    msg.statusHistory.push('delivered');
  }

  getMessage(id: string): TrackedMessage | undefined {
    return this.messages.get(id);
  }

  getAllMessages(): TrackedMessage[] {
    return Array.from(this.messages.values());
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Queue + ACK Integration — 20 messages offline→flush→delivered', () => {
  let queue: OfflineQueue;
  let sender: QueueAckController;
  const PEER_ID = 'bob';
  const MSG_COUNT = 20;

  beforeEach(() => {
    queue = new OfflineQueue();
    sender = new QueueAckController();
  });

  test('20 messages queued while peer is offline', async () => {
    for (let i = 0; i < MSG_COUNT; i++) {
      const msg = sender.createMessage('ch-1', `Message ${i}`);
      await queue.enqueue(PEER_ID, { messageId: msg.id, channelId: msg.channelId, content: msg.content });
    }

    expect(queue.getQueuedCount(PEER_ID)).toBe(MSG_COUNT);
    expect(sender.getAllMessages().every(m => m.status === 'pending')).toBe(true);
  });

  test('flush delivers all queued messages when peer reconnects', async () => {
    // Queue messages while offline
    const createdMsgs: TrackedMessage[] = [];
    for (let i = 0; i < MSG_COUNT; i++) {
      const msg = sender.createMessage('ch-1', `Message ${i}`);
      createdMsgs.push(msg);
      await queue.enqueue(PEER_ID, { messageId: msg.id, channelId: msg.channelId });
    }

    // Peer comes online
    sender.livePeers.add(PEER_ID);

    // Flush queue
    const flushed = await queue.flush(PEER_ID);
    expect(flushed).toHaveLength(MSG_COUNT);

    // Send each flushed message
    for (const envelope of flushed) {
      const msg = sender.getMessage(envelope.messageId);
      expect(msg).toBeDefined();
      sender.send(PEER_ID, msg!);
    }

    // All should be 'sent'
    expect(createdMsgs.every(m => m.status === 'sent')).toBe(true);
    expect(sender.sentEnvelopes).toHaveLength(MSG_COUNT);
  });

  test('full lifecycle: pending → sent → delivered for all 20 messages', async () => {
    const createdMsgs: TrackedMessage[] = [];

    // 1. Create & queue while offline
    for (let i = 0; i < MSG_COUNT; i++) {
      const msg = sender.createMessage('ch-1', `Message ${i}`);
      createdMsgs.push(msg);
      await queue.enqueue(PEER_ID, { messageId: msg.id });
    }
    expect(createdMsgs.every(m => m.status === 'pending')).toBe(true);

    // 2. Peer reconnects
    sender.livePeers.add(PEER_ID);
    const flushed = await queue.flush(PEER_ID);

    // 3. Send each message
    for (const envelope of flushed) {
      const msg = sender.getMessage(envelope.messageId)!;
      sender.send(PEER_ID, msg);
    }
    expect(createdMsgs.every(m => m.status === 'sent')).toBe(true);

    // 4. Recipient ACKs each message
    for (const msg of createdMsgs) {
      sender.handleAck(msg.id);
    }
    expect(createdMsgs.every(m => m.status === 'delivered')).toBe(true);

    // 5. Verify status history
    for (const msg of createdMsgs) {
      expect(msg.statusHistory).toEqual(['pending', 'sent', 'delivered']);
    }
  });

  test('no messages lost during flush', async () => {
    const msgIds = new Set<string>();

    for (let i = 0; i < MSG_COUNT; i++) {
      const msg = sender.createMessage('ch-1', `Message ${i}`);
      msgIds.add(msg.id);
      await queue.enqueue(PEER_ID, { messageId: msg.id });
    }

    sender.livePeers.add(PEER_ID);
    const flushed = await queue.flush(PEER_ID);

    const flushedIds = new Set(flushed.map(f => f.messageId));
    expect(flushedIds.size).toBe(MSG_COUNT);

    // Every queued message appears in flush
    for (const id of msgIds) {
      expect(flushedIds.has(id)).toBe(true);
    }
  });

  test('no duplicate messages after flush', async () => {
    for (let i = 0; i < MSG_COUNT; i++) {
      const msg = sender.createMessage('ch-1', `Message ${i}`);
      await queue.enqueue(PEER_ID, { messageId: msg.id });
    }

    sender.livePeers.add(PEER_ID);
    const flushed = await queue.flush(PEER_ID);

    // Check for duplicates in flushed set
    const ids = flushed.map(f => f.messageId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);

    // Queue should be empty after flush
    expect(queue.getQueuedCount(PEER_ID)).toBe(0);

    // Second flush returns nothing
    const secondFlush = await queue.flush(PEER_ID);
    expect(secondFlush).toHaveLength(0);
  });

  test('queue preserves message order', async () => {
    const orderedIds: string[] = [];

    for (let i = 0; i < MSG_COUNT; i++) {
      const msg = sender.createMessage('ch-1', `Message ${i}`);
      orderedIds.push(msg.id);
      await queue.enqueue(PEER_ID, { messageId: msg.id, seq: i });
    }

    sender.livePeers.add(PEER_ID);
    const flushed = await queue.flush(PEER_ID);

    // Messages flushed in FIFO order
    for (let i = 0; i < MSG_COUNT; i++) {
      expect(flushed[i].messageId).toBe(orderedIds[i]);
    }
  });

  test('duplicate ACK is a no-op', async () => {
    const msg = sender.createMessage('ch-1', 'Test');
    await queue.enqueue(PEER_ID, { messageId: msg.id });

    sender.livePeers.add(PEER_ID);
    await queue.flush(PEER_ID);
    sender.send(PEER_ID, msg);

    sender.handleAck(msg.id);
    expect(msg.status).toBe('delivered');

    // Second ACK: no crash, status unchanged
    sender.handleAck(msg.id);
    expect(msg.status).toBe('delivered');
    expect(msg.statusHistory).toEqual(['pending', 'sent', 'delivered']);
  });

  test('partial delivery: some ACKs arrive, rest pending', async () => {
    const createdMsgs: TrackedMessage[] = [];
    for (let i = 0; i < MSG_COUNT; i++) {
      const msg = sender.createMessage('ch-1', `Message ${i}`);
      createdMsgs.push(msg);
      await queue.enqueue(PEER_ID, { messageId: msg.id });
    }

    sender.livePeers.add(PEER_ID);
    const flushed = await queue.flush(PEER_ID);

    // Send all
    for (const envelope of flushed) {
      sender.send(PEER_ID, sender.getMessage(envelope.messageId)!);
    }

    // ACK only first 10
    for (let i = 0; i < 10; i++) {
      sender.handleAck(createdMsgs[i].id);
    }

    const delivered = createdMsgs.filter(m => m.status === 'delivered');
    const sent = createdMsgs.filter(m => m.status === 'sent');

    expect(delivered).toHaveLength(10);
    expect(sent).toHaveLength(10);
  });

  test('multiple peers have independent queues and ACKs', async () => {
    const peer1 = 'peer-1';
    const peer2 = 'peer-2';

    const msg1 = sender.createMessage('ch-1', 'For peer 1');
    const msg2 = sender.createMessage('ch-1', 'For peer 2');

    await queue.enqueue(peer1, { messageId: msg1.id });
    await queue.enqueue(peer2, { messageId: msg2.id });

    expect(queue.getQueuedCount(peer1)).toBe(1);
    expect(queue.getQueuedCount(peer2)).toBe(1);

    // Only peer1 comes online
    sender.livePeers.add(peer1);
    const flushed1 = await queue.flush(peer1);
    expect(flushed1).toHaveLength(1);

    // peer2's queue untouched
    expect(queue.getQueuedCount(peer2)).toBe(1);
  });
});
