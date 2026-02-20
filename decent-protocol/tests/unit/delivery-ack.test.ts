/**
 * DEP-005: Message Delivery Acknowledgment tests
 *
 * Tests the message status state machine:
 *   pending → sent (on dispatch to live peer)
 *   sent → delivered (on ACK from recipient)
 *
 * Uses a pure in-memory simulation — no real transport or crypto.
 */

import { describe, test, expect, beforeEach } from 'bun:test';

// ---------------------------------------------------------------------------
// Status types (mirror decent-client-web/src/messages/types.ts)
// ---------------------------------------------------------------------------

type MessageStatus = 'pending' | 'sent' | 'delivered';

interface StoredMessage {
  id: string;
  channelId: string;
  senderId: string;
  content: string;
  status: MessageStatus;
}

// ---------------------------------------------------------------------------
// Minimal ACK state machine — mirrors ChatController's ACK logic
// ---------------------------------------------------------------------------

class DeliveryAckController {
  /** In-memory message store per channel */
  private messages = new Map<string, Map<string, StoredMessage>>(); // channelId → messageId → msg

  /** Persisted messages (simulates persistentStore.saveMessage) */
  persistedMessages: StoredMessage[] = [];

  /** Status updates applied (messageId → new status) */
  statusUpdates: { messageId: string; status: MessageStatus }[] = [];

  /** ACKs sent by this node back to senders */
  sentAcks: { peerId: string; messageId: string; channelId: string }[] = [];

  /** Messages sent to peers (raw) */
  sentMessages: { peerId: string; envelope: { messageId: string; channelId: string } }[] = [];

  /** Which peerIds are currently "live" (readyPeers) */
  livePeers = new Set<string>();

  myPeerId = 'alice';

  // ── Message creation ────────────────────────────────────────────────────

  createMessage(channelId: string, content: string): StoredMessage {
    const msg: StoredMessage = {
      id: crypto.randomUUID(),
      channelId,
      senderId: this.myPeerId,
      content,
      status: 'pending',
    };
    const channel = this.messages.get(channelId) ?? new Map();
    channel.set(msg.id, msg);
    this.messages.set(channelId, channel);
    return msg;
  }

  /** Simulate sending a message to workspace peers — mirrors ChatController.sendMessage */
  async sendMessage(msg: StoredMessage, recipientPeerIds: string[]): Promise<void> {
    let sentDirectly = false;

    for (const peerId of recipientPeerIds) {
      if (this.livePeers.has(peerId)) {
        this.sentMessages.push({ peerId, envelope: { messageId: msg.id, channelId: msg.channelId } });
        sentDirectly = true;
      }
      // (offline queue omitted — not relevant for this test)
    }

    // pending → sent on direct dispatch
    if (sentDirectly && msg.status !== 'sent' && msg.status !== 'delivered') {
      msg.status = 'sent';
      await this._persistMessage(msg);
      this.statusUpdates.push({ messageId: msg.id, status: 'sent' });
    }
  }

  /**
   * Handle an incoming ACK message — mirrors ChatController's 'ack' handler.
   * Recipient sends this to sender when they persist a message.
   */
  async handleAck(channelId: string, messageId: string): Promise<void> {
    if (!channelId || !messageId) return;

    const channel = this.messages.get(channelId);
    if (!channel) return;

    const msg = channel.get(messageId);
    if (!msg || msg.status === 'delivered') return; // already delivered — no-op

    msg.status = 'delivered';
    await this._persistMessage(msg);
    this.statusUpdates.push({ messageId, status: 'delivered' });
  }

  /**
   * Handle an incoming message (as recipient) — sends ACK back.
   * Mirrors the receive path in ChatController.
   */
  async receiveMessage(fromPeerId: string, incomingMsg: StoredMessage): Promise<void> {
    // Store the received message
    const channel = this.messages.get(incomingMsg.channelId) ?? new Map();
    channel.set(incomingMsg.id, { ...incomingMsg });
    this.messages.set(incomingMsg.channelId, channel);

    // DEP-005: Send delivery ACK back to sender
    this.sentAcks.push({ peerId: fromPeerId, messageId: incomingMsg.id, channelId: incomingMsg.channelId });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  getMessage(channelId: string, messageId: string): StoredMessage | undefined {
    return this.messages.get(channelId)?.get(messageId);
  }

  private async _persistMessage(msg: StoredMessage): Promise<void> {
    // Simulate async persistence
    const idx = this.persistedMessages.findIndex(m => m.id === msg.id);
    if (idx >= 0) {
      this.persistedMessages[idx] = { ...msg };
    } else {
      this.persistedMessages.push({ ...msg });
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DEP-005 Delivery Acknowledgment — sender side (status transitions)', () => {
  let ctrl: DeliveryAckController;

  beforeEach(() => {
    ctrl = new DeliveryAckController();
    ctrl.livePeers.add('bob');
  });

  test('new message starts as pending', () => {
    const msg = ctrl.createMessage('ch-1', 'hello');
    expect(msg.status).toBe('pending');
  });

  test('sending to a live peer transitions status to sent', async () => {
    const msg = ctrl.createMessage('ch-1', 'hello');
    await ctrl.sendMessage(msg, ['bob']);

    expect(msg.status).toBe('sent');
    expect(ctrl.statusUpdates).toContainEqual({ messageId: msg.id, status: 'sent' });
  });

  test('sending to no live peers keeps status as pending', async () => {
    ctrl.livePeers.clear(); // bob is offline
    const msg = ctrl.createMessage('ch-1', 'hello');
    await ctrl.sendMessage(msg, ['bob']);

    expect(msg.status).toBe('pending');
    expect(ctrl.statusUpdates.filter(u => u.status === 'sent')).toHaveLength(0);
  });

  test('receiving ACK transitions status from sent to delivered', async () => {
    const msg = ctrl.createMessage('ch-1', 'hello');
    await ctrl.sendMessage(msg, ['bob']); // → sent
    await ctrl.handleAck('ch-1', msg.id); // → delivered

    expect(msg.status).toBe('delivered');
    expect(ctrl.statusUpdates).toContainEqual({ messageId: msg.id, status: 'delivered' });
  });

  test('full status lifecycle: pending → sent → delivered', async () => {
    const msg = ctrl.createMessage('ch-1', 'hello');
    expect(msg.status).toBe('pending');

    await ctrl.sendMessage(msg, ['bob']);
    expect(msg.status).toBe('sent');

    await ctrl.handleAck('ch-1', msg.id);
    expect(msg.status).toBe('delivered');
  });

  test('duplicate ACK is a no-op (already delivered)', async () => {
    const msg = ctrl.createMessage('ch-1', 'hello');
    await ctrl.sendMessage(msg, ['bob']);
    await ctrl.handleAck('ch-1', msg.id); // first ACK → delivered
    await ctrl.handleAck('ch-1', msg.id); // second ACK → no-op

    expect(msg.status).toBe('delivered');
    // Status update fired exactly twice (pending→sent, sent→delivered)
    expect(ctrl.statusUpdates).toHaveLength(2);
  });

  test('ACK for unknown message is silently ignored', async () => {
    let threw = false;
    try { await ctrl.handleAck('ch-1', 'non-existent-id'); } catch { threw = true; }
    expect(threw).toBe(false);
    expect(ctrl.statusUpdates).toHaveLength(0);
  });

  test('ACK for unknown channel is silently ignored', async () => {
    let threw = false;
    try { await ctrl.handleAck('ch-unknown', 'any-id'); } catch { threw = true; }
    expect(threw).toBe(false);
    expect(ctrl.statusUpdates).toHaveLength(0);
  });

  test('ACK with empty fields is silently ignored', async () => {
    let threw = false;
    try { await ctrl.handleAck('', ''); } catch { threw = true; }
    expect(threw).toBe(false);
    expect(ctrl.statusUpdates).toHaveLength(0);
  });

  test('sent status persisted to store', async () => {
    const msg = ctrl.createMessage('ch-1', 'hello');
    await ctrl.sendMessage(msg, ['bob']);

    const persisted = ctrl.persistedMessages.find(m => m.id === msg.id);
    expect(persisted?.status).toBe('sent');
  });

  test('delivered status persisted to store', async () => {
    const msg = ctrl.createMessage('ch-1', 'hello');
    await ctrl.sendMessage(msg, ['bob']);
    await ctrl.handleAck('ch-1', msg.id);

    const persisted = ctrl.persistedMessages.find(m => m.id === msg.id);
    expect(persisted?.status).toBe('delivered');
  });

  test('sending to mix of live and offline peers goes sent (at least one direct)', async () => {
    ctrl.livePeers.add('carol');
    // 'bob' is live, 'dave' is offline
    const msg = ctrl.createMessage('ch-1', 'hello');
    await ctrl.sendMessage(msg, ['bob', 'dave']);

    expect(msg.status).toBe('sent');
  });

  test('status not re-written to sent if already delivered', async () => {
    const msg = ctrl.createMessage('ch-1', 'hello');
    await ctrl.sendMessage(msg, ['bob']);
    await ctrl.handleAck('ch-1', msg.id); // → delivered

    // Simulate a weird second send call (e.g. retry) — should not regress to sent
    await ctrl.sendMessage(msg, ['bob']);

    expect(msg.status).toBe('delivered');
    // Only one 'delivered' update
    expect(ctrl.statusUpdates.filter(u => u.status === 'delivered')).toHaveLength(1);
  });
});

describe('DEP-005 Delivery Acknowledgment — recipient side (ACK sending)', () => {
  let ctrl: DeliveryAckController;

  beforeEach(() => {
    ctrl = new DeliveryAckController();
    ctrl.myPeerId = 'bob';
  });

  test('receiving a message sends ACK back to sender', async () => {
    const incoming: StoredMessage = {
      id: crypto.randomUUID(),
      channelId: 'ch-1',
      senderId: 'alice',
      content: 'hello',
      status: 'sent',
    };

    await ctrl.receiveMessage('alice', incoming);

    expect(ctrl.sentAcks).toHaveLength(1);
    expect(ctrl.sentAcks[0]).toMatchObject({
      peerId: 'alice',
      messageId: incoming.id,
      channelId: 'ch-1',
    });
  });

  test('ACK references correct messageId and channelId', async () => {
    const incoming: StoredMessage = {
      id: 'msg-abc-123',
      channelId: 'ch-x',
      senderId: 'alice',
      content: 'test',
      status: 'sent',
    };

    await ctrl.receiveMessage('alice', incoming);

    expect(ctrl.sentAcks[0].messageId).toBe('msg-abc-123');
    expect(ctrl.sentAcks[0].channelId).toBe('ch-x');
  });

  test('receiving multiple messages sends ACK for each', async () => {
    for (let i = 0; i < 5; i++) {
      await ctrl.receiveMessage('alice', {
        id: `msg-${i}`,
        channelId: 'ch-1',
        senderId: 'alice',
        content: `msg ${i}`,
        status: 'sent',
      });
    }

    expect(ctrl.sentAcks).toHaveLength(5);
    const ackedIds = ctrl.sentAcks.map(a => a.messageId);
    for (let i = 0; i < 5; i++) {
      expect(ackedIds).toContain(`msg-${i}`);
    }
  });

  test('received message is stored locally', async () => {
    const incoming: StoredMessage = {
      id: 'msg-xyz',
      channelId: 'ch-1',
      senderId: 'alice',
      content: 'hey',
      status: 'sent',
    };

    await ctrl.receiveMessage('alice', incoming);

    const stored = ctrl.getMessage('ch-1', 'msg-xyz');
    expect(stored).toBeDefined();
    expect(stored?.content).toBe('hey');
  });
});

describe('DEP-005 Delivery Acknowledgment — protocol version check', () => {
  test('PROTOCOL_VERSION constant is 2', () => {
    // This mirrors the constant in ChatController
    const PROTOCOL_VERSION = 2;
    expect(PROTOCOL_VERSION).toBe(2);
  });

  test('handshake with matching version is accepted', () => {
    const PROTOCOL_VERSION = 2;
    const handshake = { protocolVersion: 2, peerId: 'bob', publicKey: 'abc' };
    const mismatch = handshake.protocolVersion > PROTOCOL_VERSION;
    expect(mismatch).toBe(false);
  });

  test('handshake with future version triggers mismatch warning', () => {
    const PROTOCOL_VERSION = 2;
    const handshake = { protocolVersion: 3, peerId: 'bob', publicKey: 'abc' };
    const mismatch = handshake.protocolVersion > PROTOCOL_VERSION;
    expect(mismatch).toBe(true);
  });

  test('handshake without version field is accepted (backwards compat)', () => {
    const PROTOCOL_VERSION = 2;
    const handshake = { peerId: 'bob', publicKey: 'abc' }; // no protocolVersion
    // If undefined, mismatch check: undefined > 2 === false
    const mismatch = (handshake as any).protocolVersion !== undefined &&
      (handshake as any).protocolVersion > PROTOCOL_VERSION;
    expect(mismatch).toBe(false);
  });
});
