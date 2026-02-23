import { describe, test, expect } from 'bun:test';

type MsgStatus = 'pending' | 'sent' | 'delivered' | 'read';

interface ReceiptState {
  recipientPeerIds: string[];
  ackedBy: string[];
  readBy: string[];
}

/** Mirrors ChatController DEP-012/013 status logic */
function computeStatus(state: ReceiptState): MsgStatus {
  const recipients = state.recipientPeerIds;
  if (recipients.length === 0) return 'sent';

  const acked = new Set(state.ackedBy);
  const read = new Set(state.readBy);

  const deliveredToAll = recipients.every((id) => acked.has(id));
  const readByAll = recipients.every((id) => read.has(id));

  if (readByAll) return 'read';
  if (deliveredToAll) return 'delivered';
  return 'sent';
}

interface LocalMessage {
  id: string;
  channelId: string;
  senderId: string;
  localReadAt?: number;
}

/** Mirrors onChannelViewed() filtering rules */
function collectLateReadReceipts(
  channelId: string,
  myPeerId: string,
  readyPeers: Set<string>,
  messages: LocalMessage[],
): { direct: Array<{ to: string; payload: any }>; queued: Array<{ to: string; payload: any }>; updated: LocalMessage[] } {
  const direct: Array<{ to: string; payload: any }> = [];
  const queued: Array<{ to: string; payload: any }> = [];

  const updated = messages.map((m) => ({ ...m }));

  for (const msg of updated) {
    if (msg.channelId !== channelId) continue;
    if (msg.senderId === myPeerId) continue; // outgoing
    if (msg.localReadAt) continue; // already receipted locally

    const payload = { type: 'read', messageId: msg.id, channelId };
    if (readyPeers.has(msg.senderId)) {
      direct.push({ to: msg.senderId, payload });
    } else {
      queued.push({ to: msg.senderId, payload });
    }
    msg.localReadAt = Date.now();
  }

  return { direct, queued, updated };
}

describe('Message receipt status (WhatsApp-like ticks)', () => {
  test('single recipient: ack only => delivered (double grey)', () => {
    const status = computeStatus({
      recipientPeerIds: ['bob'],
      ackedBy: ['bob'],
      readBy: [],
    });
    expect(status).toBe('delivered');
  });

  test('single recipient: read => read (double blue)', () => {
    const status = computeStatus({
      recipientPeerIds: ['bob'],
      ackedBy: ['bob'],
      readBy: ['bob'],
    });
    expect(status).toBe('read');
  });

  test('group: partial ack => sent', () => {
    const status = computeStatus({
      recipientPeerIds: ['bob', 'carol', 'dave'],
      ackedBy: ['bob'],
      readBy: [],
    });
    expect(status).toBe('sent');
  });

  test('group: all delivered but not all read => delivered (double grey)', () => {
    const status = computeStatus({
      recipientPeerIds: ['bob', 'carol', 'dave'],
      ackedBy: ['bob', 'carol', 'dave'],
      readBy: ['bob', 'carol'],
    });
    expect(status).toBe('delivered');
  });

  test('group: all read => read (double blue)', () => {
    const status = computeStatus({
      recipientPeerIds: ['bob', 'carol', 'dave'],
      ackedBy: ['bob', 'carol', 'dave'],
      readBy: ['bob', 'carol', 'dave'],
    });
    expect(status).toBe('read');
  });
});

describe('Late read receipts (channel open / reopen)', () => {
  test('sends read receipts for unseen incoming messages in opened channel', () => {
    const result = collectLateReadReceipts(
      'ch-1',
      'me',
      new Set(['alice']),
      [
        { id: 'm1', channelId: 'ch-1', senderId: 'alice' },
        { id: 'm2', channelId: 'ch-1', senderId: 'alice' },
      ],
    );

    expect(result.direct.length).toBe(2);
    expect(result.queued.length).toBe(0);
    expect(result.updated.every((m) => typeof m.localReadAt === 'number')).toBe(true);
  });

  test('does not send read receipt for own messages', () => {
    const result = collectLateReadReceipts(
      'ch-1',
      'me',
      new Set(['alice']),
      [
        { id: 'm1', channelId: 'ch-1', senderId: 'me' },
      ],
    );

    expect(result.direct.length).toBe(0);
    expect(result.queued.length).toBe(0);
    expect(result.updated[0].localReadAt).toBeUndefined();
  });

  test('does not re-send for messages already marked localReadAt', () => {
    const result = collectLateReadReceipts(
      'ch-1',
      'me',
      new Set(['alice']),
      [
        { id: 'm1', channelId: 'ch-1', senderId: 'alice', localReadAt: 123456 },
      ],
    );

    expect(result.direct.length).toBe(0);
    expect(result.queued.length).toBe(0);
    expect(result.updated[0].localReadAt).toBe(123456);
  });

  test('queues read receipts for offline senders', () => {
    const result = collectLateReadReceipts(
      'ch-1',
      'me',
      new Set([]),
      [
        { id: 'm1', channelId: 'ch-1', senderId: 'alice' },
      ],
    );

    expect(result.direct.length).toBe(0);
    expect(result.queued.length).toBe(1);
    expect(result.queued[0].to).toBe('alice');
    expect(result.updated[0].localReadAt).toBeDefined();
  });

  test('ignores messages from other channels', () => {
    const result = collectLateReadReceipts(
      'ch-1',
      'me',
      new Set(['alice']),
      [
        { id: 'm1', channelId: 'ch-2', senderId: 'alice' },
      ],
    );

    expect(result.direct.length).toBe(0);
    expect(result.queued.length).toBe(0);
    expect(result.updated[0].localReadAt).toBeUndefined();
  });
});
