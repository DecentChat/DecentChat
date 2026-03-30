import { describe, expect, test } from 'bun:test';
import { applyMessageReceipt, type PlaintextMessage } from '../../src';

function makeMessage(overrides: Partial<PlaintextMessage> = {}): PlaintextMessage {
  return {
    id: 'msg-1',
    channelId: 'ch-1',
    senderId: 'alice',
    timestamp: 1,
    content: 'hello',
    type: 'text',
    prevHash: 'genesis',
    status: 'sent',
    recipientPeerIds: ['bob', 'carol'],
    ackedBy: [],
    ackedAt: {},
    readBy: [],
    readAt: {},
    ...overrides,
  };
}

describe('applyMessageReceipt', () => {
  test('ack updates delivery state without marking read', () => {
    const result = applyMessageReceipt(makeMessage(), {
      peerId: 'bob',
      type: 'ack',
      at: 100,
      allowedRecipients: ['bob', 'carol'],
      statusRecipients: ['bob', 'carol'],
    });

    expect(result.accepted).toBe(true);
    expect(result.message.ackedBy).toEqual(['bob']);
    expect(result.message.ackedAt).toEqual({ bob: 100 });
    expect(result.message.readBy).toEqual([]);
    expect(result.status).toBe('sent');
    expect(result.counts).toEqual({ acked: 1, read: 0, total: 2 });
  });

  test('read implies ack and upgrades to read when everyone has read', () => {
    const result = applyMessageReceipt(makeMessage({
      ackedBy: ['bob'],
      ackedAt: { bob: 50 },
      readBy: ['bob'],
      readAt: { bob: 60 },
      status: 'delivered',
    }), {
      peerId: 'carol',
      type: 'read',
      at: 200,
      allowedRecipients: ['bob', 'carol'],
      statusRecipients: ['bob', 'carol'],
    });

    expect(result.accepted).toBe(true);
    expect(result.message.ackedBy?.sort()).toEqual(['bob', 'carol']);
    expect(result.message.readBy?.sort()).toEqual(['bob', 'carol']);
    expect(result.message.ackedAt).toEqual({ bob: 50, carol: 200 });
    expect(result.message.readAt).toEqual({ bob: 60, carol: 200 });
    expect(result.status).toBe('read');
    expect(result.counts).toEqual({ acked: 2, read: 2, total: 2 });
  });

  test('rejects receipts from peers outside the allowed recipient set', () => {
    const original = makeMessage();
    const result = applyMessageReceipt(original, {
      peerId: 'mallory',
      type: 'ack',
      at: 300,
      allowedRecipients: ['bob', 'carol'],
      statusRecipients: ['bob', 'carol'],
    });

    expect(result.accepted).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.message).toBe(original);
    expect(result.status).toBe('sent');
  });

  test('does not regress a higher status when status recipient list is empty', () => {
    const result = applyMessageReceipt(makeMessage({ status: 'read' }), {
      peerId: 'bob',
      type: 'ack',
      at: 400,
      allowedRecipients: ['bob'],
      statusRecipients: [],
    });

    expect(result.accepted).toBe(true);
    expect(result.status).toBe('read');
    expect(result.message.status).toBe('read');
  });
});
