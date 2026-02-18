/**
 * VectorClock tests
 */

import { describe, test, expect } from 'bun:test';
import { VectorClock } from '../../src/crdt/VectorClock';

describe('VectorClock', () => {
  test('starts empty', () => {
    const vc = new VectorClock();
    expect(vc.get('alice')).toBe(0);
    expect(vc.size).toBe(0);
  });

  test('increments peer counter', () => {
    let vc = new VectorClock();
    vc = vc.increment('alice');
    expect(vc.get('alice')).toBe(1);
    vc = vc.increment('alice');
    expect(vc.get('alice')).toBe(2);
  });

  test('tracks multiple peers independently', () => {
    let vc = new VectorClock();
    vc = vc.increment('alice');
    vc = vc.increment('bob');
    vc = vc.increment('alice');

    expect(vc.get('alice')).toBe(2);
    expect(vc.get('bob')).toBe(1);
    expect(vc.size).toBe(2);
  });

  test('merge takes max of each peer', () => {
    const a = new VectorClock({ alice: 3, bob: 1 });
    const b = new VectorClock({ alice: 1, bob: 5, charlie: 2 });

    const merged = a.merge(b);
    expect(merged.get('alice')).toBe(3);
    expect(merged.get('bob')).toBe(5);
    expect(merged.get('charlie')).toBe(2);
  });

  test('compare: equal clocks', () => {
    const a = new VectorClock({ alice: 1, bob: 2 });
    const b = new VectorClock({ alice: 1, bob: 2 });
    expect(a.compare(b)).toBe('equal');
  });

  test('compare: before (causally precedes)', () => {
    const a = new VectorClock({ alice: 1, bob: 1 });
    const b = new VectorClock({ alice: 2, bob: 1 });
    expect(a.compare(b)).toBe('before');
  });

  test('compare: after', () => {
    const a = new VectorClock({ alice: 2, bob: 1 });
    const b = new VectorClock({ alice: 1, bob: 1 });
    expect(a.compare(b)).toBe('after');
  });

  test('compare: concurrent (the key insight!)', () => {
    // Alice incremented, Bob didn't see it; Bob incremented, Alice didn't see it
    const a = new VectorClock({ alice: 2, bob: 1 });
    const b = new VectorClock({ alice: 1, bob: 2 });
    expect(a.compare(b)).toBe('concurrent');
  });

  test('happenedBefore works', () => {
    const a = new VectorClock({ alice: 1 });
    const b = new VectorClock({ alice: 2 });
    expect(a.happenedBefore(b)).toBe(true);
    expect(b.happenedBefore(a)).toBe(false);
  });

  test('serialization roundtrip', () => {
    const vc = new VectorClock({ alice: 3, bob: 7 });
    const json = vc.toJSON();
    const restored = VectorClock.fromJSON(json);

    expect(restored.get('alice')).toBe(3);
    expect(restored.get('bob')).toBe(7);
    expect(vc.compare(restored)).toBe('equal');
  });

  test('clone is independent', () => {
    let original = new VectorClock({ alice: 1 });
    const cloned = original.clone();
    original = original.increment('alice');

    expect(original.get('alice')).toBe(2);
    expect(cloned.get('alice')).toBe(1);
  });

  test('increment is immutable (returns new clock)', () => {
    const a = new VectorClock({ alice: 1 });
    const b = a.increment('alice');

    expect(a.get('alice')).toBe(1);
    expect(b.get('alice')).toBe(2);
  });

  test('merge is immutable', () => {
    const a = new VectorClock({ alice: 1 });
    const b = new VectorClock({ bob: 1 });
    const merged = a.merge(b);

    expect(a.size).toBe(1);
    expect(merged.size).toBe(2);
  });
});

// === Real-World Scenarios ===

describe('VectorClock - Chat Scenarios', () => {
  test('simple conversation ordering', () => {
    // Alice sends msg1
    let aliceClock = new VectorClock();
    aliceClock = aliceClock.increment('alice'); // {alice: 1}

    // Bob receives msg1, sends reply
    let bobClock = new VectorClock();
    bobClock = bobClock.merge(aliceClock).increment('bob'); // {alice: 1, bob: 1}

    // Alice's msg happened before Bob's reply
    expect(aliceClock.compare(bobClock)).toBe('before');
  });

  test('concurrent messages (both peers type at same time)', () => {
    // Both start from shared state {alice: 1, bob: 1}
    const shared = new VectorClock({ alice: 1, bob: 1 });

    // Alice sends without seeing Bob's new message
    const aliceMsg = shared.increment('alice'); // {alice: 2, bob: 1}

    // Bob sends without seeing Alice's new message
    const bobMsg = shared.increment('bob'); // {alice: 1, bob: 2}

    expect(aliceMsg.compare(bobMsg)).toBe('concurrent');
  });

  test('three-peer causality', () => {
    // Alice → Bob → Charlie chain
    let aliceClock = new VectorClock().increment('alice'); // {a:1}
    let bobClock = aliceClock.merge(new VectorClock()).increment('bob'); // {a:1, b:1}
    let charlieClock = bobClock.merge(new VectorClock()).increment('charlie'); // {a:1, b:1, c:1}

    // Alice's msg happened before Charlie's (transitive causality!)
    expect(aliceClock.compare(charlieClock)).toBe('before');
    expect(charlieClock.compare(aliceClock)).toBe('after');
  });

  test('offline divergence and merge', () => {
    // Shared state
    const shared = new VectorClock({ alice: 2, bob: 2 });

    // Alice goes offline, sends 3 messages
    let aliceOffline = shared;
    aliceOffline = aliceOffline.increment('alice'); // {a:3, b:2}
    aliceOffline = aliceOffline.increment('alice'); // {a:4, b:2}
    aliceOffline = aliceOffline.increment('alice'); // {a:5, b:2}

    // Bob goes offline, sends 2 messages
    let bobOffline = shared;
    bobOffline = bobOffline.increment('bob'); // {a:2, b:3}
    bobOffline = bobOffline.increment('bob'); // {a:2, b:4}

    // They're concurrent (diverged)
    expect(aliceOffline.compare(bobOffline)).toBe('concurrent');

    // They reconnect: merge clocks
    const aliceReconnected = aliceOffline.merge(bobOffline);
    const bobReconnected = bobOffline.merge(aliceOffline);

    // After merge, both have same state
    expect(aliceReconnected.compare(bobReconnected)).toBe('equal');
    expect(aliceReconnected.get('alice')).toBe(5);
    expect(aliceReconnected.get('bob')).toBe(4);
  });
});
