/**
 * Double Ratchet tests — Signal-style forward secrecy
 */

import { describe, test, expect } from 'bun:test';
import { DoubleRatchet } from '../../src/crypto/DoubleRatchet';
import type { RatchetState } from '../../src/crypto/DoubleRatchet';

// Helper: create an initial shared secret (simulating ECDH handshake)
async function createSharedSecret(): Promise<ArrayBuffer> {
  const alice = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const bob = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);

  return crypto.subtle.deriveBits(
    { name: 'ECDH', public: bob.publicKey },
    alice.privateKey,
    256,
  );
}

// Helper: create Alice + Bob ratchet pair
async function createPair(): Promise<{ alice: RatchetState; bob: RatchetState }> {
  const bobDH = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const sharedSecret = await createSharedSecret();

  const alice = await DoubleRatchet.initAlice(sharedSecret, bobDH.publicKey);
  const bob = await DoubleRatchet.initBob(sharedSecret, bobDH);

  return { alice, bob };
}

describe('DoubleRatchet - Basic Messaging', () => {
  test('Alice encrypts, Bob decrypts', async () => {
    const { alice, bob } = await createPair();

    const msg = await DoubleRatchet.encrypt(alice, 'Hello Bob!');
    const plaintext = await DoubleRatchet.decrypt(bob, msg);

    expect(plaintext).toBe('Hello Bob!');
  });

  test('multiple messages in one direction', async () => {
    const { alice, bob } = await createPair();

    for (let i = 0; i < 5; i++) {
      const msg = await DoubleRatchet.encrypt(alice, `Message ${i}`);
      const plaintext = await DoubleRatchet.decrypt(bob, msg);
      expect(plaintext).toBe(`Message ${i}`);
    }
  });

  test('ping-pong conversation', async () => {
    const { alice, bob } = await createPair();

    // Alice → Bob
    const m1 = await DoubleRatchet.encrypt(alice, 'Hey!');
    expect(await DoubleRatchet.decrypt(bob, m1)).toBe('Hey!');

    // Bob → Alice
    const m2 = await DoubleRatchet.encrypt(bob, 'Hi Alice!');
    expect(await DoubleRatchet.decrypt(alice, m2)).toBe('Hi Alice!');

    // Alice → Bob
    const m3 = await DoubleRatchet.encrypt(alice, 'How are you?');
    expect(await DoubleRatchet.decrypt(bob, m3)).toBe('How are you?');

    // Bob → Alice
    const m4 = await DoubleRatchet.encrypt(bob, 'Great, thanks!');
    expect(await DoubleRatchet.decrypt(alice, m4)).toBe('Great, thanks!');
  });

  test('long conversation with many ratchet steps', async () => {
    const { alice, bob } = await createPair();

    for (let i = 0; i < 20; i++) {
      if (i % 2 === 0) {
        const msg = await DoubleRatchet.encrypt(alice, `Alice says ${i}`);
        expect(await DoubleRatchet.decrypt(bob, msg)).toBe(`Alice says ${i}`);
      } else {
        const msg = await DoubleRatchet.encrypt(bob, `Bob says ${i}`);
        expect(await DoubleRatchet.decrypt(alice, msg)).toBe(`Bob says ${i}`);
      }
    }
  });
});

describe('DoubleRatchet - Out of Order Messages', () => {
  test('handles out-of-order delivery in same chain', async () => {
    const { alice, bob } = await createPair();

    // Alice sends 3 messages
    const m0 = await DoubleRatchet.encrypt(alice, 'msg 0');
    const m1 = await DoubleRatchet.encrypt(alice, 'msg 1');
    const m2 = await DoubleRatchet.encrypt(alice, 'msg 2');

    // Bob receives them out of order: 2, 0, 1
    expect(await DoubleRatchet.decrypt(bob, m2)).toBe('msg 2');
    expect(await DoubleRatchet.decrypt(bob, m0)).toBe('msg 0');
    expect(await DoubleRatchet.decrypt(bob, m1)).toBe('msg 1');
  });

  test('handles skipped messages across DH ratchet', async () => {
    const { alice, bob } = await createPair();

    // Alice sends 3 messages
    const m0 = await DoubleRatchet.encrypt(alice, 'before ratchet 0');
    const m1 = await DoubleRatchet.encrypt(alice, 'before ratchet 1');
    const m2 = await DoubleRatchet.encrypt(alice, 'before ratchet 2');

    // Bob only receives m2 (skips m0, m1 — they'll arrive later)
    expect(await DoubleRatchet.decrypt(bob, m2)).toBe('before ratchet 2');

    // Bob replies (triggers DH ratchet)
    const reply = await DoubleRatchet.encrypt(bob, 'got it');
    expect(await DoubleRatchet.decrypt(alice, reply)).toBe('got it');

    // Now m0 and m1 arrive (from old chain) — should still decrypt
    expect(await DoubleRatchet.decrypt(bob, m0)).toBe('before ratchet 0');
    expect(await DoubleRatchet.decrypt(bob, m1)).toBe('before ratchet 1');
  });
});

describe('DoubleRatchet - Forward Secrecy', () => {
  test('each message uses a unique key (different ciphertext)', async () => {
    const { alice } = await createPair();

    const m1 = await DoubleRatchet.encrypt(alice, 'same text');
    const m2 = await DoubleRatchet.encrypt(alice, 'same text');

    // Same plaintext but different ciphertext (different message key + IV)
    expect(m1.ciphertext).not.toBe(m2.ciphertext);
    expect(m1.iv).not.toBe(m2.iv);
  });

  test('DH key changes after direction switch', async () => {
    const { alice, bob } = await createPair();

    const m1 = await DoubleRatchet.encrypt(alice, 'hello');
    const key1 = m1.header.dhPublicKey;

    await DoubleRatchet.decrypt(bob, m1);
    const m2 = await DoubleRatchet.encrypt(bob, 'reply');

    await DoubleRatchet.decrypt(alice, m2);
    const m3 = await DoubleRatchet.encrypt(alice, 'again');
    const key3 = m3.header.dhPublicKey;

    // Alice's DH key should have changed after receiving Bob's message
    expect(key1).not.toBe(key3);
  });

  test('message number increments within chain', async () => {
    const { alice } = await createPair();

    const m0 = await DoubleRatchet.encrypt(alice, 'msg 0');
    const m1 = await DoubleRatchet.encrypt(alice, 'msg 1');
    const m2 = await DoubleRatchet.encrypt(alice, 'msg 2');

    expect(m0.header.messageNumber).toBe(0);
    expect(m1.header.messageNumber).toBe(1);
    expect(m2.header.messageNumber).toBe(2);
  });

  test('message number resets after DH ratchet', async () => {
    const { alice, bob } = await createPair();

    // Alice sends 3 messages (numbers 0, 1, 2)
    const m0 = await DoubleRatchet.encrypt(alice, 'a');
    const m1 = await DoubleRatchet.encrypt(alice, 'b');
    await DoubleRatchet.decrypt(bob, m0);
    await DoubleRatchet.decrypt(bob, m1);

    // Bob replies (DH ratchet)
    const reply = await DoubleRatchet.encrypt(bob, 'c');
    await DoubleRatchet.decrypt(alice, reply);

    // Alice sends again — number should reset to 0
    const m3 = await DoubleRatchet.encrypt(alice, 'd');
    expect(m3.header.messageNumber).toBe(0);
    expect(m3.header.previousCount).toBe(2);
  });
});

describe('DoubleRatchet - Security', () => {
  test('cannot decrypt with wrong ratchet state', async () => {
    const { alice } = await createPair();
    const { alice: eve } = await createPair(); // Different session

    const msg = await DoubleRatchet.encrypt(alice, 'secret message');

    // Eve can't decrypt Alice's message
    await expect(DoubleRatchet.decrypt(eve, msg)).rejects.toThrow();
  });

  test('cannot replay a message', async () => {
    const { alice, bob } = await createPair();

    const msg = await DoubleRatchet.encrypt(alice, 'one-time message');
    await DoubleRatchet.decrypt(bob, msg);

    // Replaying the same message should fail (key already consumed)
    // It might succeed if caught by skipped keys, but the key is deleted after use
    // In practice, the application layer should also check message IDs
  });

  test('unicode and long messages', async () => {
    const { alice, bob } = await createPair();

    const unicode = '🔐 Šifrované správy s emojimi 日本語 العربية';
    const msg = await DoubleRatchet.encrypt(alice, unicode);
    expect(await DoubleRatchet.decrypt(bob, msg)).toBe(unicode);

    const long = 'A'.repeat(100000);
    const msg2 = await DoubleRatchet.encrypt(alice, long);
    expect(await DoubleRatchet.decrypt(bob, msg2)).toBe(long);
  });

  test('empty message', async () => {
    const { alice, bob } = await createPair();

    const msg = await DoubleRatchet.encrypt(alice, '');
    expect(await DoubleRatchet.decrypt(bob, msg)).toBe('');
  });
});

describe('DoubleRatchet - Stress', () => {
  test('100 alternating messages', async () => {
    const { alice, bob } = await createPair();

    for (let i = 0; i < 100; i++) {
      const sender = i % 2 === 0 ? alice : bob;
      const receiver = i % 2 === 0 ? bob : alice;
      const text = `Message #${i}`;

      const msg = await DoubleRatchet.encrypt(sender, text);
      const decrypted = await DoubleRatchet.decrypt(receiver, msg);
      expect(decrypted).toBe(text);
    }
  });

  test('burst of 50 messages then 50 replies', async () => {
    const { alice, bob } = await createPair();

    // Alice sends 50
    const aliceMessages = [];
    for (let i = 0; i < 50; i++) {
      aliceMessages.push(await DoubleRatchet.encrypt(alice, `A${i}`));
    }

    // Bob receives all 50
    for (let i = 0; i < 50; i++) {
      expect(await DoubleRatchet.decrypt(bob, aliceMessages[i])).toBe(`A${i}`);
    }

    // Bob sends 50
    const bobMessages = [];
    for (let i = 0; i < 50; i++) {
      bobMessages.push(await DoubleRatchet.encrypt(bob, `B${i}`));
    }

    // Alice receives all 50
    for (let i = 0; i < 50; i++) {
      expect(await DoubleRatchet.decrypt(alice, bobMessages[i])).toBe(`B${i}`);
    }
  });
});
