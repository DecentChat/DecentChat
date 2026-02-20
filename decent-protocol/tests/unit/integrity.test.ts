/**
 * Message Integrity & Anti-Tampering Tests
 * 
 * Tests that messages form an unbreakable hash chain and
 * any attempt to tamper, replay, or forge messages is detected.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { HashChain, GENESIS_HASH } from '../../src/crypto/HashChain';
import { MessageStore } from '../../src/messages/MessageStore';
import type { PlaintextMessage } from '../../src/messages/types';
import type { HashableMessage } from '../../src/crypto/HashChain';

// === HashChain Unit Tests ===

describe('HashChain', () => {
  let chain: HashChain;

  beforeEach(() => {
    chain = new HashChain();
  });

  test('hashes a message deterministically', async () => {
    const msg: HashableMessage = {
      id: 'msg-1',
      channelId: 'ch-1',
      senderId: 'alice',
      timestamp: 1000,
      content: 'Hello',
      type: 'text',
      prevHash: GENESIS_HASH,
    };

    const hash1 = await chain.hashMessage(msg);
    const hash2 = await chain.hashMessage(msg);

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64); // SHA-256 hex = 64 chars
  });

  test('different messages produce different hashes', async () => {
    const msg1: HashableMessage = {
      id: 'msg-1', channelId: 'ch-1', senderId: 'alice',
      timestamp: 1000, content: 'Hello', type: 'text', prevHash: GENESIS_HASH,
    };

    const msg2: HashableMessage = {
      ...msg1, content: 'World',
    };

    const hash1 = await chain.hashMessage(msg1);
    const hash2 = await chain.hashMessage(msg2);

    expect(hash1).not.toBe(hash2);
  });

  test('changing any field changes the hash', async () => {
    const base: HashableMessage = {
      id: 'msg-1', channelId: 'ch-1', senderId: 'alice',
      timestamp: 1000, content: 'Hello', type: 'text', prevHash: GENESIS_HASH,
    };

    const baseHash = await chain.hashMessage(base);

    // Change each field and verify hash changes
    // Note: channelId is excluded from the hash (routing metadata, can be remapped)
    const fields: (keyof HashableMessage)[] = ['id', 'senderId', 'content', 'type', 'prevHash'];
    for (const field of fields) {
      const modified = { ...base, [field]: 'TAMPERED' };
      const modifiedHash = await chain.hashMessage(modified);
      expect(modifiedHash).not.toBe(baseHash);
    }

    // Timestamp change
    const timestampModified = { ...base, timestamp: 9999 };
    expect(await chain.hashMessage(timestampModified)).not.toBe(baseHash);
  });

  test('verifies valid chain link', async () => {
    const msg1: HashableMessage = {
      id: 'msg-1', channelId: 'ch-1', senderId: 'alice',
      timestamp: 1000, content: 'Hello', type: 'text', prevHash: GENESIS_HASH,
    };

    const hash1 = await chain.hashMessage(msg1);

    const msg2 = {
      prevHash: hash1,
    };

    const valid = await chain.verifyChain(msg1, msg2);
    expect(valid).toBe(true);
  });

  test('detects broken chain link', async () => {
    const msg1: HashableMessage = {
      id: 'msg-1', channelId: 'ch-1', senderId: 'alice',
      timestamp: 1000, content: 'Hello', type: 'text', prevHash: GENESIS_HASH,
    };

    const msg2 = {
      prevHash: 'fake-hash-that-doesnt-match',
    };

    const valid = await chain.verifyChain(msg1, msg2);
    expect(valid).toBe(false);
  });

  test('verifies full chain', async () => {
    const msg1: HashableMessage = {
      id: 'msg-1', channelId: 'ch-1', senderId: 'alice',
      timestamp: 1000, content: 'First', type: 'text', prevHash: GENESIS_HASH,
    };
    const hash1 = await chain.hashMessage(msg1);

    const msg2: HashableMessage = {
      id: 'msg-2', channelId: 'ch-1', senderId: 'bob',
      timestamp: 2000, content: 'Second', type: 'text', prevHash: hash1,
    };
    const hash2 = await chain.hashMessage(msg2);

    const msg3: HashableMessage = {
      id: 'msg-3', channelId: 'ch-1', senderId: 'alice',
      timestamp: 3000, content: 'Third', type: 'text', prevHash: hash2,
    };

    const result = await chain.verifyFullChain([msg1, msg2, msg3]);
    expect(result.valid).toBe(true);
  });

  test('detects tampered message in chain', async () => {
    const msg1: HashableMessage = {
      id: 'msg-1', channelId: 'ch-1', senderId: 'alice',
      timestamp: 1000, content: 'First', type: 'text', prevHash: GENESIS_HASH,
    };
    const hash1 = await chain.hashMessage(msg1);

    const msg2: HashableMessage = {
      id: 'msg-2', channelId: 'ch-1', senderId: 'bob',
      timestamp: 2000, content: 'Second', type: 'text', prevHash: hash1,
    };
    const hash2 = await chain.hashMessage(msg2);

    const msg3: HashableMessage = {
      id: 'msg-3', channelId: 'ch-1', senderId: 'alice',
      timestamp: 3000, content: 'Third', type: 'text', prevHash: hash2,
    };

    // Tamper with msg2's content
    msg2.content = 'TAMPERED CONTENT';

    const result = await chain.verifyFullChain([msg1, msg2, msg3]);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2); // msg3's prevHash doesn't match tampered msg2
  });

  test('detects missing message (gap in chain)', async () => {
    const msg1: HashableMessage = {
      id: 'msg-1', channelId: 'ch-1', senderId: 'alice',
      timestamp: 1000, content: 'First', type: 'text', prevHash: GENESIS_HASH,
    };
    const hash1 = await chain.hashMessage(msg1);

    const msg2: HashableMessage = {
      id: 'msg-2', channelId: 'ch-1', senderId: 'bob',
      timestamp: 2000, content: 'Second', type: 'text', prevHash: hash1,
    };
    const hash2 = await chain.hashMessage(msg2);

    const msg3: HashableMessage = {
      id: 'msg-3', channelId: 'ch-1', senderId: 'alice',
      timestamp: 3000, content: 'Third', type: 'text', prevHash: hash2,
    };

    // Remove msg2 (gap in chain)
    const result = await chain.verifyFullChain([msg1, msg3]);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  test('detects invalid genesis', async () => {
    const msg1: HashableMessage = {
      id: 'msg-1', channelId: 'ch-1', senderId: 'alice',
      timestamp: 1000, content: 'First', type: 'text', prevHash: 'not-genesis',
    };

    const result = await chain.verifyFullChain([msg1]);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
  });

  test('empty chain is valid', async () => {
    const result = await chain.verifyFullChain([]);
    expect(result.valid).toBe(true);
  });
});

// === MessageStore Integration Tests ===

describe('MessageStore', () => {
  let store: MessageStore;

  beforeEach(() => {
    store = new MessageStore();
  });

  test('creates first message with genesis hash', async () => {
    const msg = await store.createMessage('ch-1', 'alice', 'Hello');

    expect(msg.prevHash).toBe(GENESIS_HASH);
    expect(msg.channelId).toBe('ch-1');
    expect(msg.senderId).toBe('alice');
    expect(msg.content).toBe('Hello');
  });

  test('adds message to store', async () => {
    const msg = await store.createMessage('ch-1', 'alice', 'Hello');
    const result = await store.addMessage(msg);

    expect(result.success).toBe(true);
    expect(store.getMessages('ch-1')).toHaveLength(1);
  });

  test('second message links to first via prevHash', async () => {
    const msg1 = await store.createMessage('ch-1', 'alice', 'First');
    msg1.timestamp = 1000;
    await store.addMessage(msg1);

    const msg2 = await store.createMessage('ch-1', 'bob', 'Second');
    msg2.timestamp = 2000; // Ensure after msg1

    expect(msg2.prevHash).not.toBe(GENESIS_HASH);
    expect(msg2.prevHash.length).toBe(64);

    const result = await store.addMessage(msg2);
    expect(result.success).toBe(true);
    expect(store.getMessages('ch-1')).toHaveLength(2);
  });

  test('builds valid chain of multiple messages', async () => {
    for (let i = 0; i < 10; i++) {
      const msg = await store.createMessage('ch-1', i % 2 === 0 ? 'alice' : 'bob', `Message ${i}`);
      // Small delay to ensure unique timestamps
      msg.timestamp = Date.now() + i;
      const result = await store.addMessage(msg);
      expect(result.success).toBe(true);
    }

    const verification = await store.verifyChannel('ch-1');
    expect(verification.valid).toBe(true);
    expect(store.getMessages('ch-1')).toHaveLength(10);
  });

  test('rejects message with wrong prevHash', async () => {
    const msg1 = await store.createMessage('ch-1', 'alice', 'First');
    await store.addMessage(msg1);

    const fakeMsg: PlaintextMessage = {
      id: 'fake-msg',
      channelId: 'ch-1',
      senderId: 'bob',
      timestamp: Date.now() + 1000,
      content: 'Tampered!',
      type: 'text',
      prevHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'sent',
    };

    const result = await store.addMessage(fakeMsg);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Hash chain broken');
  });

  test('rejects message with timestamp not after previous', async () => {
    const msg1 = await store.createMessage('ch-1', 'alice', 'First');
    msg1.timestamp = 5000;
    await store.addMessage(msg1);

    const msg2 = await store.createMessage('ch-1', 'bob', 'Second');
    msg2.timestamp = 4000; // Before msg1!

    const result = await store.addMessage(msg2);
    expect(result.success).toBe(false);
    expect(result.error).toContain('timestamp');
  });

  test('rejects first message without genesis hash', async () => {
    const badFirst: PlaintextMessage = {
      id: 'msg-1',
      channelId: 'ch-1',
      senderId: 'alice',
      timestamp: Date.now(),
      content: 'Hello',
      type: 'text',
      prevHash: 'not-the-genesis-hash',
      status: 'pending',
    };

    const result = await store.addMessage(badFirst);
    expect(result.success).toBe(false);
    expect(result.error).toContain('genesis');
  });

  test('channels are isolated', async () => {
    const msg1 = await store.createMessage('ch-1', 'alice', 'Channel 1');
    await store.addMessage(msg1);

    const msg2 = await store.createMessage('ch-2', 'alice', 'Channel 2');
    await store.addMessage(msg2);

    expect(store.getMessages('ch-1')).toHaveLength(1);
    expect(store.getMessages('ch-2')).toHaveLength(1);

    // Both first messages should have genesis hash
    expect(store.getMessages('ch-1')[0].prevHash).toBe(GENESIS_HASH);
    expect(store.getMessages('ch-2')[0].prevHash).toBe(GENESIS_HASH);
  });
});

// === Anti-Tampering Attack Scenarios ===

describe('Anti-Tampering Attacks', () => {
  let store: MessageStore;

  beforeEach(() => {
    store = new MessageStore();
  });

  test('ATTACK: Peer modifies message content after sending', async () => {
    // Alice sends a message
    const msg1 = await store.createMessage('ch-1', 'alice', 'I owe Bob $100');
    await store.addMessage(msg1);

    // Bob sends a reply
    const msg2 = await store.createMessage('ch-1', 'bob', 'Thanks Alice!');
    msg2.timestamp = msg1.timestamp + 1;
    await store.addMessage(msg2);

    // Alice tries to tamper with her original message
    const messages = store.getMessages('ch-1');
    const tamperedMessages = [...messages];
    tamperedMessages[0] = { ...tamperedMessages[0], content: 'I owe Bob $10' };

    // Import tampered history should fail
    const importResult = await store.importMessages('ch-1-tampered', tamperedMessages);
    // The chain will break because msg2's prevHash was computed from the original msg1
    // But msg1 was tampered, so hash(tampered_msg1) !== msg2.prevHash
    expect(importResult.success).toBe(false);
    expect(importResult.error).toContain('Tampered');
  });

  test('ATTACK: Peer inserts a fake message into history', async () => {
    const msg1 = await store.createMessage('ch-1', 'alice', 'Hello');
    await store.addMessage(msg1);

    const msg2 = await store.createMessage('ch-1', 'bob', 'Hi');
    msg2.timestamp = msg1.timestamp + 1;
    await store.addMessage(msg2);

    // Attacker tries to insert a fake message between msg1 and msg2
    const messages = store.getMessages('ch-1');
    const chain = new HashChain();
    const hash1 = await chain.hashMessage({
      id: messages[0].id, channelId: messages[0].channelId,
      senderId: messages[0].senderId, timestamp: messages[0].timestamp,
      content: messages[0].content, type: messages[0].type, prevHash: messages[0].prevHash,
    });

    const fakeMessage: PlaintextMessage = {
      id: 'fake-inserted',
      channelId: 'ch-1',
      senderId: 'alice',
      timestamp: msg1.timestamp + 0.5,
      content: 'FORGED MESSAGE',
      type: 'text',
      prevHash: hash1,
      status: 'sent',
    };

    // Insert fake message
    const tampered = [messages[0], fakeMessage, messages[1]];
    const result = await store.importMessages('ch-1-attacked', tampered);
    expect(result.success).toBe(false);
  });

  test('ATTACK: Peer removes a message from history', async () => {
    const msg1 = await store.createMessage('ch-1', 'alice', 'Message 1');
    await store.addMessage(msg1);

    const msg2 = await store.createMessage('ch-1', 'bob', 'Message 2');
    msg2.timestamp = msg1.timestamp + 1;
    await store.addMessage(msg2);

    const msg3 = await store.createMessage('ch-1', 'alice', 'Message 3');
    msg3.timestamp = msg2.timestamp + 1;
    await store.addMessage(msg3);

    // Remove msg2
    const messages = store.getMessages('ch-1');
    const withRemoval = [messages[0], messages[2]]; // Skip msg2

    const result = await store.importMessages('ch-1-removed', withRemoval);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Tampered');
  });

  test('ATTACK: Peer replays old messages', async () => {
    const msg1 = await store.createMessage('ch-1', 'alice', 'Original');
    await store.addMessage(msg1);

    const msg2 = await store.createMessage('ch-1', 'bob', 'Reply');
    msg2.timestamp = msg1.timestamp + 1;
    await store.addMessage(msg2);

    // Attacker tries to add msg1 again
    const replayResult = await store.addMessage({ ...msg1 });
    expect(replayResult.success).toBe(false);
  });

  test('ATTACK: Peer claims to be someone else (impersonation)', async () => {
    const msg1 = await store.createMessage('ch-1', 'alice', 'Hello');
    await store.addMessage(msg1);

    // Bob creates message but claims to be Alice
    const fakeMsg = await store.createMessage('ch-1', 'alice', 'I am Alice (actually Bob)');
    fakeMsg.timestamp = msg1.timestamp + 1;

    // The message will be accepted by the store (sender verification
    // happens at the encryption layer, not the hash chain layer)
    // BUT: The message won't decrypt properly because Bob doesn't
    // have Alice's encryption keys. This test documents that
    // impersonation is caught at the crypto layer, not the hash layer.
    const result = await store.addMessage(fakeMsg);
    expect(result.success).toBe(true);
    // Note: In the real system, this message would fail to decrypt
    // because Bob can't encrypt with Alice's ECDH shared secret.
    // The senderId is verified via the encryption key used.
  });

  test('ATTACK: Peer sends modified history during sync', async () => {
    // Build legitimate history
    const msgs: PlaintextMessage[] = [];
    for (let i = 0; i < 5; i++) {
      const msg = await store.createMessage('ch-1', i % 2 === 0 ? 'alice' : 'bob', `Msg ${i}`);
      msg.timestamp = 1000 + i * 100;
      await store.addMessage(msg);
      msgs.push(msg);
    }

    // Verify original is valid
    const originalCheck = await store.verifyChannel('ch-1');
    expect(originalCheck.valid).toBe(true);

    // Attacker modifies middle message
    const tamperedMsgs = msgs.map(m => ({ ...m }));
    tamperedMsgs[2].content = 'MODIFIED BY ATTACKER';

    // Try to import tampered history
    const result = await store.importMessages('ch-1-synced', tamperedMsgs);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Tampered');
  });

  test('ATTACK: Peer reorders messages', async () => {
    const msg1 = await store.createMessage('ch-1', 'alice', 'First');
    msg1.timestamp = 1000;
    await store.addMessage(msg1);

    const msg2 = await store.createMessage('ch-1', 'bob', 'Second');
    msg2.timestamp = 2000;
    await store.addMessage(msg2);

    const msg3 = await store.createMessage('ch-1', 'alice', 'Third');
    msg3.timestamp = 3000;
    await store.addMessage(msg3);

    // Try to swap msg2 and msg3
    const messages = store.getMessages('ch-1');
    const reordered = [messages[0], messages[2], messages[1]];

    const result = await store.importMessages('ch-1-reordered', reordered);
    expect(result.success).toBe(false);
  });
});

// === Thread Tests ===

describe('Threads', () => {
  let store: MessageStore;

  beforeEach(() => {
    store = new MessageStore();
  });

  test('creates thread reply with threadId', async () => {
    const parentMsg = await store.createMessage('ch-1', 'alice', 'Discussion topic');
    await store.addMessage(parentMsg);

    const reply = await store.createMessage('ch-1', 'bob', 'My reply', 'text', parentMsg.id);
    reply.timestamp = parentMsg.timestamp + 1;
    await store.addMessage(reply);

    expect(reply.threadId).toBe(parentMsg.id);

    const thread = store.getThread('ch-1', parentMsg.id);
    expect(thread).toHaveLength(1);
    expect(thread[0].content).toBe('My reply');
  });

  test('thread messages are part of main chain', async () => {
    const msg1 = await store.createMessage('ch-1', 'alice', 'Hello');
    await store.addMessage(msg1);

    const threadReply = await store.createMessage('ch-1', 'bob', 'Thread reply', 'text', msg1.id);
    threadReply.timestamp = msg1.timestamp + 1;
    await store.addMessage(threadReply);

    const msg2 = await store.createMessage('ch-1', 'alice', 'Back to main');
    msg2.timestamp = threadReply.timestamp + 1;
    await store.addMessage(msg2);

    // Full chain should be valid (threads are part of the chain)
    const verification = await store.verifyChannel('ch-1');
    expect(verification.valid).toBe(true);
    expect(store.getMessages('ch-1')).toHaveLength(3);
  });
});
