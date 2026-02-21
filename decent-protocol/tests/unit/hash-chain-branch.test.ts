/**
 * GAP 6: Hash Chain Branch — Conflicting prevHash
 *
 * Scenario: Alice and Bob send to #general at the exact same moment,
 * both referencing the same prevHash.
 *
 * Verify: system handles the conflicting prevHash gracefully
 * (no crash, no silent data loss).
 */

import { describe, test, expect } from 'bun:test';
import { MessageStore } from '../../src/messages/MessageStore';
import { HashChain, GENESIS_HASH } from '../../src/crypto/HashChain';
import type { PlaintextMessage } from '../../src/messages/types';

// Helper: ensure strictly increasing timestamps for MessageStore
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('Hash Chain Branch — Conflicting prevHash', () => {
  test('two messages with same prevHash: second is rejected by strict store', async () => {
    const store = new MessageStore();

    // First message links to genesis
    const m1 = await store.createMessage('ch-1', 'alice', 'Hello');
    const added1 = await store.addMessage(m1);
    expect(added1.success).toBe(true);

    // Alice's message is now in the chain. Get its hash for prevHash
    const lastHash = await store.getLastHash('ch-1');

    // Bob creates a message with the same prevHash (simulating simultaneous send)
    const bobMsg: PlaintextMessage = {
      id: crypto.randomUUID(),
      channelId: 'ch-1',
      senderId: 'bob',
      timestamp: m1.timestamp + 1, // Must be after previous
      content: 'World',
      type: 'text',
      prevHash: lastHash,
      status: 'pending',
    };

    const added2 = await store.addMessage(bobMsg);
    expect(added2.success).toBe(true);

    // Now Alice sends another with the same prevHash Bob used (branch!)
    const aliceBranch: PlaintextMessage = {
      id: crypto.randomUUID(),
      channelId: 'ch-1',
      senderId: 'alice',
      timestamp: bobMsg.timestamp + 1,
      content: 'Branch message',
      type: 'text',
      prevHash: lastHash, // Same prevHash as Bob's message
      status: 'pending',
    };

    // This should be rejected because prevHash doesn't match hash of last msg
    const added3 = await store.addMessage(aliceBranch);
    expect(added3.success).toBe(false);
    expect(added3.error).toContain('Hash chain broken');
  });

  test('no crash when branch is attempted', async () => {
    const store = new MessageStore();

    const m1 = await store.createMessage('ch-1', 'alice', 'First');
    await store.addMessage(m1);

    // Create branching message with wrong prevHash
    const branchMsg: PlaintextMessage = {
      id: crypto.randomUUID(),
      channelId: 'ch-1',
      senderId: 'bob',
      timestamp: m1.timestamp + 1,
      content: 'Branch',
      type: 'text',
      prevHash: 'deadbeef'.repeat(8), // Wrong hash
      status: 'pending',
    };

    let threw = false;
    let result;
    try {
      result = await store.addMessage(branchMsg);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result!.success).toBe(false);
  });

  test('original chain remains valid after rejected branch', async () => {
    const store = new MessageStore();

    const m1 = await store.createMessage('ch-1', 'alice', 'First');
    await store.addMessage(m1);

    await sleep(2);

    const m2 = await store.createMessage('ch-1', 'alice', 'Second');
    await store.addMessage(m2);

    // Try branch with m1's hash (should fail)
    const hashChain = new HashChain();
    const m1Hash = await hashChain.hashMessage({
      id: m1.id, channelId: m1.channelId, senderId: m1.senderId,
      timestamp: m1.timestamp, content: m1.content, type: m1.type,
      prevHash: m1.prevHash,
    });

    const branchMsg: PlaintextMessage = {
      id: crypto.randomUUID(),
      channelId: 'ch-1',
      senderId: 'bob',
      timestamp: m2.timestamp + 1,
      content: 'Branch',
      type: 'text',
      prevHash: m1Hash, // Points to m1, not m2
      status: 'pending',
    };

    await store.addMessage(branchMsg); // Should fail

    // Chain is still valid
    const verification = await store.verifyChannel('ch-1');
    expect(verification.valid).toBe(true);
    expect(store.getMessages('ch-1')).toHaveLength(2);
  });

  test('no silent data loss: rejected message does not corrupt store', async () => {
    const store = new MessageStore();

    // Create messages with small delays to ensure strictly increasing timestamps
    const msgs: PlaintextMessage[] = [];
    for (let i = 0; i < 3; i++) {
      if (i > 0) await sleep(2);
      const m = await store.createMessage('ch-1', 'alice', `Msg ${i}`);
      const added = await store.addMessage(m);
      expect(added.success).toBe(true);
      msgs.push(m);
    }

    // Attempt branch with genesis hash (only valid for first msg)
    const branchMsg: PlaintextMessage = {
      id: crypto.randomUUID(),
      channelId: 'ch-1',
      senderId: 'bob',
      timestamp: msgs[2].timestamp + 1,
      content: 'Evil branch',
      type: 'text',
      prevHash: GENESIS_HASH,
      status: 'pending',
    };

    const result = await store.addMessage(branchMsg);
    expect(result.success).toBe(false);

    // All original messages intact
    const stored = store.getMessages('ch-1');
    expect(stored).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(stored[i].content).toBe(`Msg ${i}`);
    }
  });

  test('CRDT handles concurrent messages with empty prevHash gracefully', async () => {
    // MessageCRDT sets prevHash to '' (empty) — hash chain is applied at a
    // higher layer (MessageStore). CRDT ordering uses vector clocks instead.
    const { MessageCRDT } = await import('../../src/crdt/MessageCRDT');

    const alice = new MessageCRDT('alice');
    const bob = new MessageCRDT('bob');

    // Both create messages concurrently (no merge before creating)
    const a1 = alice.createMessage('ch-1', 'Alice concurrent');
    const b1 = bob.createMessage('ch-1', 'Bob concurrent');

    // Both have same (empty) prevHash since CRDT delegates hashing to upper layer
    expect(a1.prevHash).toBe(b1.prevHash);

    // CRDT merge handles this gracefully via vector clocks
    alice.addMessage(b1);
    bob.addMessage(a1);

    expect(alice.getMessages('ch-1')).toHaveLength(2);
    expect(bob.getMessages('ch-1')).toHaveLength(2);

    // Same deterministic order on both peers
    expect(alice.getMessages('ch-1').map(m => m.id)).toEqual(
      bob.getMessages('ch-1').map(m => m.id)
    );
  });

  test('importMessages rejects tampered chain', async () => {
    const store = new MessageStore();

    // Build a valid chain with delays for distinct timestamps
    const m1 = await store.createMessage('ch-1', 'alice', 'First');
    await store.addMessage(m1);

    await sleep(2);

    const m2 = await store.createMessage('ch-1', 'alice', 'Second');
    await store.addMessage(m2);

    const validChain = store.getMessages('ch-1');
    expect(validChain).toHaveLength(2);

    // Tamper with FIRST message's content — this breaks m2's prevHash verification
    // (m2.prevHash was computed from original m1, but hash(tampered_m1) differs)
    const tampered = validChain.map(m => ({ ...m }));
    tampered[0].content = 'TAMPERED';

    // Import should reject
    const importStore = new MessageStore();
    const result = await importStore.importMessages('ch-1', tampered);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Tampered');
  });

  test('genesis hash is required for first message', async () => {
    const store = new MessageStore();

    const wrongGenesis: PlaintextMessage = {
      id: crypto.randomUUID(),
      channelId: 'ch-1',
      senderId: 'alice',
      timestamp: Date.now(),
      content: 'Bad genesis',
      type: 'text',
      prevHash: 'not-the-genesis-hash',
      status: 'pending',
    };

    const result = await store.addMessage(wrongGenesis);
    expect(result.success).toBe(false);
    expect(result.error).toContain('genesis');
  });
});
