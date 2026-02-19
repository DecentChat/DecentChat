/**
 * Thread Tests
 *
 * Tests for threaded messaging: protocol storage, reply routing,
 * and the receive-side bug where threadId was not copied from the
 * incoming envelope → replies appeared in the main channel.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { MessageStore } from '../../src/messages/MessageStore';
import { MessageCRDT } from '../../src/crdt/MessageCRDT';

// Small delay to satisfy hash chain timestamp ordering requirement
const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// MessageStore — thread storage
// ---------------------------------------------------------------------------

describe('MessageStore — thread storage', () => {
  let store: MessageStore;

  beforeEach(() => {
    store = new MessageStore();
  });

  test('creates a message with threadId', async () => {
    const parent = await store.createMessage('ch1', 'alice', 'Hello everyone');
    await store.addMessage(parent);
    await tick();

    const reply = await store.createMessage('ch1', 'bob', 'Hi Alice!', 'text', parent.id);
    expect(reply.threadId).toBe(parent.id);
  });

  test('getThread returns only replies to the given message', async () => {
    const parent = await store.createMessage('ch1', 'alice', 'Root message');
    await store.addMessage(parent);
    await tick();

    const other = await store.createMessage('ch1', 'alice', 'Another root message');
    await store.addMessage(other);
    await tick();

    const r1 = await store.createMessage('ch1', 'bob', 'Reply 1', 'text', parent.id);
    await store.addMessage(r1);
    await tick();

    const r2 = await store.createMessage('ch1', 'carol', 'Reply 2', 'text', parent.id);
    await store.addMessage(r2);
    await tick();

    const wrongThread = await store.createMessage('ch1', 'dave', 'Other thread reply', 'text', other.id);
    await store.addMessage(wrongThread);

    const replies = store.getThread('ch1', parent.id);
    expect(replies).toHaveLength(2);
    expect(replies.map(r => r.id)).toContain(r1.id);
    expect(replies.map(r => r.id)).toContain(r2.id);
    expect(replies.map(r => r.id)).not.toContain(wrongThread.id);
  });

  test('getThread returns empty array when no replies', async () => {
    const parent = await store.createMessage('ch1', 'alice', 'Solo message');
    await store.addMessage(parent);
    expect(store.getThread('ch1', parent.id)).toHaveLength(0);
  });

  test('getMessages (main channel view) excludes thread replies when filtered', async () => {
    const parent = await store.createMessage('ch1', 'alice', 'Root');
    await store.addMessage(parent);
    await tick();

    const reply = await store.createMessage('ch1', 'bob', 'Reply', 'text', parent.id);
    await store.addMessage(reply);

    // Simulating how UIRenderer filters: mainMessages.filter(m => !m.threadId)
    const mainMessages = store.getMessages('ch1').filter(m => !m.threadId);
    expect(mainMessages).toHaveLength(1);
    expect(mainMessages[0].id).toBe(parent.id);
  });

  test('thread replies are stored in the channel message store', async () => {
    const parent = await store.createMessage('ch1', 'alice', 'Root');
    await store.addMessage(parent);
    await tick();

    const reply = await store.createMessage('ch1', 'bob', 'Reply', 'text', parent.id);
    const result = await store.addMessage(reply);
    expect(result.success).toBe(true); // Must be stored successfully

    // All messages (including replies) are in the channel store
    const allMessages = store.getMessages('ch1');
    expect(allMessages).toHaveLength(2);
  });

  test('thread replies have correct metadata', async () => {
    const parent = await store.createMessage('ch1', 'alice', 'Root');
    await store.addMessage(parent);
    await tick();

    const reply = await store.createMessage('ch1', 'bob', 'Reply text', 'text', parent.id);
    await store.addMessage(reply);

    const thread = store.getThread('ch1', parent.id);
    expect(thread).toHaveLength(1);
    expect(thread[0].channelId).toBe('ch1');
    expect(thread[0].senderId).toBe('bob');
    expect(thread[0].content).toBe('Reply text');
    expect(thread[0].threadId).toBe(parent.id);
  });

  test('threads are isolated per channel', async () => {
    const parent1 = await store.createMessage('ch1', 'alice', 'Root in ch1');
    await store.addMessage(parent1);
    const parent2 = await store.createMessage('ch2', 'alice', 'Root in ch2');
    await store.addMessage(parent2);
    await tick();

    // Reply to ch1's message — stored in ch1
    const reply = await store.createMessage('ch1', 'bob', 'Reply in ch1', 'text', parent1.id);
    await store.addMessage(reply);

    expect(store.getThread('ch1', parent1.id)).toHaveLength(1);
    expect(store.getThread('ch2', parent2.id)).toHaveLength(0); // No replies in ch2
  });

  test('multiple threads in same channel are independent', async () => {
    const p1 = await store.createMessage('ch1', 'alice', 'Thread A root');
    await store.addMessage(p1);
    await tick();

    const p2 = await store.createMessage('ch1', 'alice', 'Thread B root');
    await store.addMessage(p2);
    await tick();

    const r1a = await store.createMessage('ch1', 'bob', 'Reply to A', 'text', p1.id);
    await store.addMessage(r1a);
    await tick();

    const r1b = await store.createMessage('ch1', 'carol', 'Another reply to A', 'text', p1.id);
    await store.addMessage(r1b);
    await tick();

    const r2 = await store.createMessage('ch1', 'dave', 'Reply to B', 'text', p2.id);
    await store.addMessage(r2);

    expect(store.getThread('ch1', p1.id)).toHaveLength(2);
    expect(store.getThread('ch1', p2.id)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// MessageCRDT — thread support (CRDT uses different storage, no hash chain)
// ---------------------------------------------------------------------------

describe('MessageCRDT — thread storage', () => {
  let crdt: MessageCRDT;

  beforeEach(() => {
    crdt = new MessageCRDT('alice');
  });

  test('createMessage with threadId stores it correctly', () => {
    const msg = crdt.createMessage('ch1', 'Root message');
    const reply = crdt.createMessage('ch1', 'Reply', 'text', msg.id);
    expect(reply.threadId).toBe(msg.id);
  });

  test('getThread filters by threadId', () => {
    const parent = crdt.createMessage('ch1', 'Root');
    crdt.addMessage(parent);
    const r1 = crdt.createMessage('ch1', 'Reply 1', 'text', parent.id);
    crdt.addMessage(r1);
    const r2 = crdt.createMessage('ch1', 'Reply 2', 'text', parent.id);
    crdt.addMessage(r2);
    const unrelated = crdt.createMessage('ch1', 'Unrelated');
    crdt.addMessage(unrelated);

    const thread = crdt.getThread('ch1', parent.id);
    expect(thread).toHaveLength(2);
    expect(thread.map(m => m.id)).not.toContain(unrelated.id);
  });

  test('getMessages returns all messages including thread replies', () => {
    const parent = crdt.createMessage('ch1', 'Root');
    crdt.addMessage(parent);
    const reply = crdt.createMessage('ch1', 'Reply', 'text', parent.id);
    crdt.addMessage(reply);

    expect(crdt.getMessages('ch1')).toHaveLength(2);
  });

  test('thread replies received from peer are stored correctly', () => {
    const bobCRDT = new MessageCRDT('bob');
    const parent = crdt.createMessage('ch1', 'Hello');
    crdt.addMessage(parent);

    // Bob replies via addMessage (simulating receive)
    const reply = bobCRDT.createMessage('ch1', 'Hi back!', 'text', parent.id);
    crdt.addMessage(reply); // Alice receives Bob's reply

    const thread = crdt.getThread('ch1', parent.id);
    expect(thread).toHaveLength(1);
    expect(thread[0].content).toBe('Hi back!');
    expect(thread[0].threadId).toBe(parent.id);
  });

  test('messages without threadId are not returned by getThread', () => {
    const parent = crdt.createMessage('ch1', 'Root');
    crdt.addMessage(parent);
    const toplevel = crdt.createMessage('ch1', 'Not a reply');
    crdt.addMessage(toplevel);

    expect(crdt.getThread('ch1', parent.id)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Receive-side threadId propagation (the bug fix)
// ---------------------------------------------------------------------------

describe('Thread receive-side — threadId propagation', () => {
  /**
   * This mirrors the critical fix in ChatController.ts:
   *   BEFORE: this.messageStore.createMessage(channelId, peerId, content)
   *   AFTER:  this.messageStore.createMessage(channelId, peerId, content, 'text', data.threadId)
   *
   * Without passing threadId, replies from peers appeared in the main channel.
   */

  test('[BUG FIX] reply stored with threadId routes to thread, not main channel', async () => {
    const store = new MessageStore();

    // Alice sends a root message
    const root = await store.createMessage('ch1', 'alice', 'Root message');
    await store.addMessage(root);
    await tick();

    // Bob's reply arrives — FIXED: pass threadId as 5th arg
    const reply = await store.createMessage('ch1', 'bob', 'Reply from Bob', 'text', root.id);
    const result = await store.addMessage(reply);
    expect(result.success).toBe(true);

    // Main channel view should show only the root
    const mainView = store.getMessages('ch1').filter(m => !m.threadId);
    expect(mainView).toHaveLength(1);
    expect(mainView[0].content).toBe('Root message');

    // Thread should show the reply
    const thread = store.getThread('ch1', root.id);
    expect(thread).toHaveLength(1);
    expect(thread[0].content).toBe('Reply from Bob');
    expect(thread[0].senderId).toBe('bob');
  });

  test('[BUG FIX] reply WITHOUT threadId (old behavior) appears in main channel', async () => {
    const store = new MessageStore();
    const root = await store.createMessage('ch1', 'alice', 'Root message');
    await store.addMessage(root);
    await tick();

    // Old (buggy) behavior: no threadId passed → appears in main channel
    const orphan = await store.createMessage('ch1', 'bob', 'Reply without threadId');
    await store.addMessage(orphan);

    const mainView = store.getMessages('ch1').filter(m => !m.threadId);
    expect(mainView).toHaveLength(2); // Both appear in main channel!

    const thread = store.getThread('ch1', root.id);
    expect(thread).toHaveLength(0); // Thread is empty!
  });

  test('thread reply count is correct after multiple peers reply', async () => {
    const store = new MessageStore();
    const root = await store.createMessage('ch1', 'alice', 'Root');
    await store.addMessage(root);

    // 3 different peers reply
    for (const peer of ['bob', 'carol', 'dave']) {
      await tick();
      const reply = await store.createMessage('ch1', peer, `Reply from ${peer}`, 'text', root.id);
      const r = await store.addMessage(reply);
      expect(r.success).toBe(true);
    }

    expect(store.getThread('ch1', root.id)).toHaveLength(3);

    // Main channel still shows only root
    const mainView = store.getMessages('ch1').filter(m => !m.threadId);
    expect(mainView).toHaveLength(1);
  });

  test('flat thread model — all replies reference root, not each other', async () => {
    // DecentChat uses flat threads (like Slack): all replies reference the root message
    const store = new MessageStore();
    const root = await store.createMessage('ch1', 'alice', 'Root');
    await store.addMessage(root);
    await tick();

    const reply1 = await store.createMessage('ch1', 'bob', 'Reply 1', 'text', root.id);
    await store.addMessage(reply1);
    await tick();

    // Reply to a reply: still references the ROOT, not reply1
    // (This is the Slack model — flat threads, not Reddit-style nested)
    const reply2 = await store.createMessage('ch1', 'carol', 'Reply to reply', 'text', root.id);
    await store.addMessage(reply2);

    const thread = store.getThread('ch1', root.id);
    expect(thread).toHaveLength(2); // Both replies in the same flat thread
    expect(thread[0].threadId).toBe(root.id);
    expect(thread[1].threadId).toBe(root.id);
  });
});

// ---------------------------------------------------------------------------
// Thread reply count tracking
// ---------------------------------------------------------------------------

describe('Thread reply count', () => {
  test('reply count is 0 for a message with no replies', async () => {
    const store = new MessageStore();
    const msg = await store.createMessage('ch1', 'alice', 'Hello');
    await store.addMessage(msg);
    expect(store.getThread('ch1', msg.id).length).toBe(0);
  });

  test('reply count increases as replies are added', async () => {
    const store = new MessageStore();
    const root = await store.createMessage('ch1', 'alice', 'Root');
    await store.addMessage(root);

    expect(store.getThread('ch1', root.id).length).toBe(0);

    await tick();
    const r1 = await store.createMessage('ch1', 'bob', 'Reply 1', 'text', root.id);
    const res1 = await store.addMessage(r1);
    expect(res1.success).toBe(true);
    expect(store.getThread('ch1', root.id).length).toBe(1);

    await tick();
    const r2 = await store.createMessage('ch1', 'carol', 'Reply 2', 'text', root.id);
    const res2 = await store.addMessage(r2);
    expect(res2.success).toBe(true);
    expect(store.getThread('ch1', root.id).length).toBe(2);
  });

  test('reply count is independent per message', async () => {
    const store = new MessageStore();
    const msgA = await store.createMessage('ch1', 'alice', 'Message A');
    await store.addMessage(msgA);
    await tick();
    const msgB = await store.createMessage('ch1', 'alice', 'Message B');
    await store.addMessage(msgB);
    await tick();

    const replyA = await store.createMessage('ch1', 'bob', 'Reply to A', 'text', msgA.id);
    await store.addMessage(replyA);

    expect(store.getThread('ch1', msgA.id).length).toBe(1);
    expect(store.getThread('ch1', msgB.id).length).toBe(0); // B has no replies
  });
});
