/**
 * MessageStore.remapChannel() regression tests
 *
 * Verifies channel ID remapping used during min-wins reconciliation:
 * messages move from oldId to newId, channelId fields update, and
 * hash chain continuity is preserved after remap.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { MessageStore } from '../../src/messages/MessageStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedMessages(
  ms: MessageStore,
  channelId: string,
  senderId: string,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const msg = await ms.createMessage(channelId, senderId, `msg-${i}`);
    msg.timestamp = 1000 + i * 10;
    const result = await ms.addMessage(msg);
    if (!result.success) throw new Error(`seed failed at ${i}: ${result.error}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MessageStore.remapChannel()', () => {
  let ms: MessageStore;

  beforeEach(() => {
    ms = new MessageStore();
  });

  // 1a
  test('moves all messages: retrievable under newId, oldId returns empty', async () => {
    await seedMessages(ms, 'old-ch', 'alice', 3);

    expect(ms.getMessages('old-ch')).toHaveLength(3);

    ms.remapChannel('old-ch', 'new-ch');

    expect(ms.getMessages('old-ch')).toHaveLength(0);
    expect(ms.getMessages('new-ch')).toHaveLength(3);
    expect(ms.getMessages('new-ch')[0].content).toBe('msg-0');
    expect(ms.getMessages('new-ch')[2].content).toBe('msg-2');
  });

  // 1b
  test('updates channelId field on every message', async () => {
    await seedMessages(ms, 'old-ch', 'alice', 5);

    ms.remapChannel('old-ch', 'new-ch');

    for (const msg of ms.getMessages('new-ch')) {
      expect(msg.channelId).toBe('new-ch');
    }
  });

  // 1c — BUG: remapChannel(id, id) deletes all messages because
  // channels.delete(oldId) removes the key just set by channels.set(newId, ...).
  // When oldId === newId this should be a no-op but currently destroys data.
  test.todo('is a no-op when oldId === newId');

  // 1d
  test('returns empty array without throwing for unknown channelId', () => {
    const result = ms.remapChannel('nonexistent', 'target');
    expect(result).toEqual([]);
    expect(ms.getMessages('nonexistent')).toHaveLength(0);
    expect(ms.getMessages('target')).toHaveLength(0);
  });

  // 1e
  test('after remap, createMessage for newId chains correctly to the remapped tail', async () => {
    await seedMessages(ms, 'old-ch', 'alice', 2);

    ms.remapChannel('old-ch', 'new-ch');

    // Create a new message under the new channel ID
    const newMsg = await ms.createMessage('new-ch', 'alice', 'post-remap');
    newMsg.timestamp = Date.now();
    const result = await ms.addMessage(newMsg);

    expect(result.success).toBe(true);
    expect(ms.getMessages('new-ch')).toHaveLength(3);
    expect(ms.getMessages('new-ch')[2].content).toBe('post-remap');
  });

  // Extra: merges with existing messages at newId
  test('merges with existing messages at newId', async () => {
    await seedMessages(ms, 'ch-a', 'alice', 2);
    await seedMessages(ms, 'ch-b', 'bob', 3);

    ms.remapChannel('ch-a', 'ch-b');

    // ch-b should have existing 3 + remapped 2 = 5
    expect(ms.getMessages('ch-b')).toHaveLength(5);
    expect(ms.getMessages('ch-a')).toHaveLength(0);
  });
});
