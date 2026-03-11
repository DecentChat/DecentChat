import { describe, test, expect } from 'bun:test';
import { MessageStore } from '../../src/messages/MessageStore';
import { MessageCRDT } from '../../src/crdt/MessageCRDT';
import { MAX_MESSAGE_CHARS } from '../../src/messages/messageLimits';

describe('message length limits', () => {
  test('MessageStore.createMessage rejects oversized content', async () => {
    const store = new MessageStore();
    await expect(store.createMessage('ch1', 'alice', 'x'.repeat(MAX_MESSAGE_CHARS + 1))).rejects.toThrow(/too long/i);
  });

  test('MessageStore.addMessage rejects oversized content', async () => {
    const store = new MessageStore();
    const msg = {
      id: 'm1',
      channelId: 'ch1',
      senderId: 'alice',
      timestamp: Date.now(),
      content: 'x'.repeat(MAX_MESSAGE_CHARS + 1),
      type: 'text' as const,
      prevHash: 'GENESIS',
      status: 'pending' as const,
    };
    const result = await store.addMessage(msg);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/too long/i);
  });

  test('MessageCRDT.createMessage rejects oversized content', () => {
    const crdt = new MessageCRDT('alice');
    expect(() => crdt.createMessage('ch1', 'x'.repeat(MAX_MESSAGE_CHARS + 1))).toThrow(/too long/i);
  });
});
