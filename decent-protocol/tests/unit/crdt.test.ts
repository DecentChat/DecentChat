/**
 * MessageCRDT tests - conflict-free message merging
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { MessageCRDT } from '../../src/crdt/MessageCRDT';

describe('MessageCRDT', () => {
  let alice: MessageCRDT;
  let bob: MessageCRDT;

  beforeEach(() => {
    alice = new MessageCRDT('alice');
    bob = new MessageCRDT('bob');
  });

  test('creates message with vector clock', () => {
    const msg = alice.createMessage('ch-1', 'Hello');
    expect(msg.id).toBe('alice-1');
    expect(msg.senderId).toBe('alice');
    expect(msg.vectorClock.alice).toBe(1);
  });

  test('increments clock on each message', () => {
    alice.createMessage('ch-1', 'First');
    const msg2 = alice.createMessage('ch-1', 'Second');
    expect(msg2.vectorClock.alice).toBe(2);
  });

  test('adds received message and merges clock', () => {
    const aliceMsg = alice.createMessage('ch-1', 'Hello from Alice');
    const result = bob.addMessage(aliceMsg);

    expect(result.added).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(bob.size).toBe(1);
  });

  test('rejects duplicate message', () => {
    const msg = alice.createMessage('ch-1', 'Hello');
    bob.addMessage(msg);
    const result = bob.addMessage(msg);

    expect(result.added).toBe(false);
    expect(result.duplicate).toBe(true);
  });

  test('orders messages causally', () => {
    // Alice sends first
    const msg1 = alice.createMessage('ch-1', 'First');

    // Bob receives and replies
    bob.addMessage(msg1);
    const msg2 = bob.createMessage('ch-1', 'Reply');

    // Alice receives reply
    alice.addMessage(msg2);

    const aliceView = alice.getMessages('ch-1');
    expect(aliceView).toHaveLength(2);
    expect(aliceView[0].content).toBe('First');
    expect(aliceView[1].content).toBe('Reply');
  });

  test('handles concurrent messages with deterministic order', () => {
    // Both type at the same time (no merge before creating)
    const aliceMsg = alice.createMessage('ch-1', 'Alice says hi');
    const bobMsg = bob.createMessage('ch-1', 'Bob says hi');

    // Both add each other's messages
    alice.addMessage(bobMsg);
    bob.addMessage(aliceMsg);

    // Both should see same order (deterministic tiebreaker)
    const aliceView = alice.getMessages('ch-1');
    const bobView = bob.getMessages('ch-1');

    expect(aliceView).toHaveLength(2);
    expect(bobView).toHaveLength(2);

    // Same order on both peers!
    expect(aliceView[0].id).toBe(bobView[0].id);
    expect(aliceView[1].id).toBe(bobView[1].id);
  });
});

// === CRDT Merge Properties ===

describe('MessageCRDT - Merge Properties', () => {
  test('commutative: merge(A,B) = merge(B,A)', () => {
    const alice = new MessageCRDT('alice');
    const bob = new MessageCRDT('bob');

    const msg1 = alice.createMessage('ch-1', 'A1');
    const msg2 = alice.createMessage('ch-1', 'A2');
    const msg3 = bob.createMessage('ch-1', 'B1');

    // Peer C merges in order: Alice then Bob
    const peerC = new MessageCRDT('charlie');
    peerC.merge([msg1, msg2]);
    peerC.merge([msg3]);

    // Peer D merges in order: Bob then Alice
    const peerD = new MessageCRDT('dave');
    peerD.merge([msg3]);
    peerD.merge([msg1, msg2]);

    // Same result regardless of merge order
    const cView = peerC.getMessages('ch-1');
    const dView = peerD.getMessages('ch-1');

    expect(cView).toHaveLength(3);
    expect(dView).toHaveLength(3);
    expect(cView.map(m => m.id)).toEqual(dView.map(m => m.id));
  });

  test('idempotent: merge(A,A) = A', () => {
    const alice = new MessageCRDT('alice');
    const msg1 = alice.createMessage('ch-1', 'Hello');

    const bob = new MessageCRDT('bob');
    bob.merge([msg1]);
    bob.merge([msg1]); // Merge same message again

    expect(bob.getMessages('ch-1')).toHaveLength(1);
  });

  test('associative: merge(merge(A,B),C) = merge(A,merge(B,C))', () => {
    const a = new MessageCRDT('alice');
    const b = new MessageCRDT('bob');
    const c = new MessageCRDT('charlie');

    const msgA = a.createMessage('ch-1', 'From A');
    const msgB = b.createMessage('ch-1', 'From B');
    const msgC = c.createMessage('ch-1', 'From C');

    // Path 1: merge(merge(A,B), C)
    const path1 = new MessageCRDT('p1');
    path1.merge([msgA]);
    path1.merge([msgB]);
    path1.merge([msgC]);

    // Path 2: merge(A, merge(B,C))
    const path2 = new MessageCRDT('p2');
    path2.merge([msgB]);
    path2.merge([msgC]);
    path2.merge([msgA]);

    const view1 = path1.getMessages('ch-1');
    const view2 = path2.getMessages('ch-1');

    expect(view1).toHaveLength(3);
    expect(view1.map(m => m.id)).toEqual(view2.map(m => m.id));
  });
});

// === Offline/Reconnection Scenarios ===

describe('MessageCRDT - Offline Scenarios', () => {
  test('peers diverge offline then merge cleanly', () => {
    const alice = new MessageCRDT('alice');
    const bob = new MessageCRDT('bob');

    // Shared history
    const shared = alice.createMessage('ch-1', 'Shared message');
    bob.addMessage(shared);

    // Go offline - both keep chatting
    const a1 = alice.createMessage('ch-1', 'Alice offline 1');
    const a2 = alice.createMessage('ch-1', 'Alice offline 2');

    const b1 = bob.createMessage('ch-1', 'Bob offline 1');
    const b2 = bob.createMessage('ch-1', 'Bob offline 2');
    const b3 = bob.createMessage('ch-1', 'Bob offline 3');

    // Reconnect: exchange all messages
    alice.merge([b1, b2, b3]);
    bob.merge([a1, a2]);

    // Both should have all 6 messages
    const aliceView = alice.getMessages('ch-1');
    const bobView = bob.getMessages('ch-1');

    expect(aliceView).toHaveLength(6);
    expect(bobView).toHaveLength(6);

    // Same order on both!
    expect(aliceView.map(m => m.id)).toEqual(bobView.map(m => m.id));

    // Shared message is always first (causally before everything)
    expect(aliceView[0].content).toBe('Shared message');
  });

  test('three peers with partial connectivity', () => {
    const alice = new MessageCRDT('alice');
    const bob = new MessageCRDT('bob');
    const charlie = new MessageCRDT('charlie');

    // Alice → Bob (Charlie offline)
    const a1 = alice.createMessage('ch-1', 'Hi Bob');
    bob.addMessage(a1);
    const b1 = bob.createMessage('ch-1', 'Hi Alice');
    alice.addMessage(b1);

    // Bob → Charlie (Alice offline)
    charlie.merge([a1, b1]); // Bob syncs history
    const c1 = charlie.createMessage('ch-1', 'Hi everyone');
    bob.addMessage(c1);

    // Alice reconnects with Charlie
    alice.merge([c1]);
    charlie.merge(alice.getAllMessages());

    // All three should converge
    const aliceView = alice.getMessages('ch-1');
    const bobView = bob.getMessages('ch-1');
    const charlieView = charlie.getMessages('ch-1');

    expect(aliceView).toHaveLength(3);
    expect(bobView).toHaveLength(3);
    expect(charlieView).toHaveLength(3);

    // All have same order
    expect(aliceView.map(m => m.id)).toEqual(bobView.map(m => m.id));
    expect(bobView.map(m => m.id)).toEqual(charlieView.map(m => m.id));
  });

  test('merge returns only new messages', () => {
    const alice = new MessageCRDT('alice');
    const bob = new MessageCRDT('bob');

    const msg1 = alice.createMessage('ch-1', 'Old');
    bob.addMessage(msg1);

    const msg2 = alice.createMessage('ch-1', 'New');

    // Bob already has msg1, only msg2 is new
    const newMsgs = bob.merge([msg1, msg2]);
    expect(newMsgs).toHaveLength(1);
    expect(newMsgs[0].content).toBe('New');
  });
});

// === Thread Support ===

describe('MessageCRDT - Threads', () => {
  test('thread messages are filtered correctly', () => {
    const alice = new MessageCRDT('alice');

    const parent = alice.createMessage('ch-1', 'Discussion topic');
    alice.createMessage('ch-1', 'Reply 1', 'text', parent.id);
    alice.createMessage('ch-1', 'Back to main');
    alice.createMessage('ch-1', 'Reply 2', 'text', parent.id);

    const thread = alice.getThread('ch-1', parent.id);
    expect(thread).toHaveLength(2);
    expect(thread[0].content).toBe('Reply 1');
    expect(thread[1].content).toBe('Reply 2');
  });
});
