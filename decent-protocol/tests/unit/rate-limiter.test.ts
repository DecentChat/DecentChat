/**
 * Rate Limiter + Message Guard tests
 */

import { describe, test, expect } from 'bun:test';
import { RateLimiter, MessageGuard } from '../../src/security';

describe('RateLimiter - Token Bucket', () => {
  test('allows actions within budget', () => {
    const rl = new RateLimiter({ message: { max: 5, refillRate: 1 } });

    for (let i = 0; i < 5; i++) {
      const result = rl.check('peer1', 'message');
      expect(result.allowed).toBe(true);
    }
  });

  test('denies when bucket empty', () => {
    const rl = new RateLimiter({ message: { max: 3, refillRate: 0.001 } });

    rl.check('peer1', 'message');
    rl.check('peer1', 'message');
    rl.check('peer1', 'message');

    const result = rl.check('peer1', 'message');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.violation).toBeDefined();
  });

  test('tokens refill over time', async () => {
    const rl = new RateLimiter({ message: { max: 2, refillRate: 100 } }); // 100/sec

    rl.check('peer1', 'message');
    rl.check('peer1', 'message');
    expect(rl.check('peer1', 'message').allowed).toBe(false);

    await new Promise(r => setTimeout(r, 50));

    // Should have refilled some tokens
    expect(rl.check('peer1', 'message').allowed).toBe(true);
  });

  test('peers have independent buckets', () => {
    const rl = new RateLimiter({ message: { max: 2, refillRate: 0 } });

    rl.check('peer1', 'message');
    rl.check('peer1', 'message');
    expect(rl.check('peer1', 'message').allowed).toBe(false);

    // peer2 still has tokens
    expect(rl.check('peer2', 'message').allowed).toBe(true);
  });

  test('custom cost per action', () => {
    const rl = new RateLimiter({ bytes: { max: 1000, refillRate: 0 } });

    expect(rl.check('peer1', 'bytes', 500).allowed).toBe(true);
    expect(rl.check('peer1', 'bytes', 500).allowed).toBe(true);
    expect(rl.check('peer1', 'bytes', 1).allowed).toBe(false);
  });

  test('peek does not consume tokens', () => {
    const rl = new RateLimiter({ message: { max: 1, refillRate: 0 } });

    expect(rl.peek('peer1', 'message')).toBe(true);
    expect(rl.peek('peer1', 'message')).toBe(true); // Still true
    rl.check('peer1', 'message'); // Consume
    expect(rl.peek('peer1', 'message')).toBe(false);
  });
});

describe('RateLimiter - Banning', () => {
  test('manual ban blocks all actions', () => {
    const rl = new RateLimiter();

    rl.ban('bad-peer', 60000);
    expect(rl.isBanned('bad-peer')).toBe(true);

    const result = rl.check('bad-peer', 'message');
    expect(result.allowed).toBe(false);
    expect(result.violation?.severity).toBe('ban');
  });

  test('unban restores access', () => {
    const rl = new RateLimiter();

    rl.ban('peer1');
    expect(rl.isBanned('peer1')).toBe(true);

    rl.unban('peer1');
    expect(rl.isBanned('peer1')).toBe(false);
    expect(rl.check('peer1', 'message').allowed).toBe(true);
  });

  test('temporary ban expires', async () => {
    const rl = new RateLimiter();

    rl.ban('peer1', 50); // 50ms ban
    expect(rl.isBanned('peer1')).toBe(true);

    await new Promise(r => setTimeout(r, 60));
    expect(rl.isBanned('peer1')).toBe(false);
  });

  test('getBannedPeers lists active bans', () => {
    const rl = new RateLimiter();

    rl.ban('peer1');
    rl.ban('peer2', 60000);

    const banned = rl.getBannedPeers();
    expect(banned).toHaveLength(2);
  });

  test('permanent ban never expires', () => {
    const rl = new RateLimiter();

    rl.ban('peer1', Infinity);
    expect(rl.isBanned('peer1')).toBe(true);

    const rep = rl.getReputation('peer1');
    expect(rep.bannedUntil).toBe(Infinity);
  });
});

describe('RateLimiter - Reputation', () => {
  test('violations escalate severity', () => {
    const rl = new RateLimiter({ message: { max: 1, refillRate: 0 } });
    const violations: any[] = [];
    rl.onViolation = (v) => violations.push(v);

    rl.check('peer1', 'message'); // Consume
    rl.check('peer1', 'message'); // Violation 1 (warning)
    rl.check('peer1', 'message'); // Violation 2 (soft)
    rl.check('peer1', 'message'); // Violation 3 (hard)

    expect(violations.length).toBeGreaterThanOrEqual(3);
    const rep = rl.getReputation('peer1');
    expect(rep.violations).toBeGreaterThanOrEqual(3);
    expect(rep.level).toBeGreaterThan(0);
  });

  test('removePeer clears buckets but keeps reputation', () => {
    const rl = new RateLimiter({ message: { max: 1, refillRate: 0 } });

    rl.check('peer1', 'message'); // Consume
    rl.check('peer1', 'message'); // Violation

    const rep = rl.getReputation('peer1');
    expect(rep.violations).toBeGreaterThan(0);

    rl.removePeer('peer1');

    // Reputation survives
    expect(rl.getReputation('peer1').violations).toBeGreaterThan(0);

    // But bucket is fresh (new tokens)
    expect(rl.check('peer1', 'message').allowed).toBe(true);
  });
});

describe('MessageGuard - Validation', () => {
  test('allows valid chat message', () => {
    const guard = new MessageGuard();
    const result = guard.check('peer1', {
      ciphertext: 'encrypted-data',
      iv: 'some-iv',
      channelId: 'ch1',
    });
    expect(result.allowed).toBe(true);
  });

  test('rejects null message', () => {
    const guard = new MessageGuard();
    expect(guard.check('peer1', null).allowed).toBe(false);
    expect(guard.check('peer1', undefined).allowed).toBe(false);
  });

  test('rejects non-object message', () => {
    const guard = new MessageGuard();
    expect(guard.check('peer1', 'string').allowed).toBe(false);
    expect(guard.check('peer1', 42).allowed).toBe(false);
  });

  test('rejects message with too many fields', () => {
    const guard = new MessageGuard(undefined, { maxMessageFields: 5 });
    const data: Record<string, string> = {};
    for (let i = 0; i < 10; i++) data[`field${i}`] = 'value';

    const result = guard.check('peer1', data);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('too many fields');
  });

  test('rejects oversized text', () => {
    const guard = new MessageGuard(undefined, { maxTextBytes: 100 });
    const result = guard.check('peer1', { content: 'A'.repeat(200) });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('text too large');
  });

  test('rejects too many attachments', () => {
    const guard = new MessageGuard(undefined, { maxAttachmentsPerMessage: 3 });
    const attachments = Array.from({ length: 5 }, (_, i) => ({ id: `att${i}` }));
    const result = guard.check('peer1', { content: 'hi', attachments });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('too many attachments');
  });

  test('rate limits handshakes', () => {
    const guard = new MessageGuard({ handshake: { max: 2, refillRate: 0 } });

    guard.check('peer1', { type: 'handshake', publicKey: 'key' });
    guard.check('peer1', { type: 'handshake', publicKey: 'key' });
    const result = guard.check('peer1', { type: 'handshake', publicKey: 'key' });
    expect(result.allowed).toBe(false);
  });

  test('rate limits sync requests', () => {
    const guard = new MessageGuard({ sync: { max: 1, refillRate: 0 } });

    guard.check('peer1', { type: 'workspace-sync', data: {} });
    const result = guard.check('peer1', { type: 'workspace-sync', data: {} });
    expect(result.allowed).toBe(false);
  });

  test('rate limits media chunks', () => {
    const guard = new MessageGuard({ media: { max: 2, refillRate: 0 } });

    guard.check('peer1', { type: 'media-chunk', data: 'abc' });
    guard.check('peer1', { type: 'media-chunk', data: 'def' });
    const result = guard.check('peer1', { type: 'media-chunk', data: 'ghi' });
    expect(result.allowed).toBe(false);
  });

  test('stream-start/stream-delta/stream-done pass through MessageGuard media bucket', () => {
    const guard = new MessageGuard({ message: { max: 1, refillRate: 0 }, media: { max: 3, refillRate: 0 } });

    // stream frames should ignore tight message bucket and use media bucket
    expect(guard.check('peer1', { type: 'stream-start', messageId: 'm1' }).allowed).toBe(true);
    expect(guard.check('peer1', { type: 'stream-delta', messageId: 'm1', content: 'A' }).allowed).toBe(true);
    expect(guard.check('peer1', { type: 'stream-done', messageId: 'm1' }).allowed).toBe(true);
    // 4th media-frame should now be blocked by media bucket exhaustion
    expect(guard.check('peer1', { type: 'stream-delta', messageId: 'm1', content: 'B' }).allowed).toBe(false);
  });

  test('oversized stream-delta is rejected', () => {
    const guard = new MessageGuard();
    const huge = 'x'.repeat(1024 * 1024 + 1);
    const result = guard.check('peer1', { type: 'stream-delta', messageId: 'm1', content: huge });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('stream delta too large');
  });

  test('banned peer rejected on all checks', () => {
    const guard = new MessageGuard();
    guard.ban('bad-peer');

    expect(guard.check('bad-peer', { content: 'hi' }).allowed).toBe(false);
    expect(guard.checkConnection('bad-peer').allowed).toBe(false);
  });

  test('connection rate limiting', () => {
    const guard = new MessageGuard({ connection: { max: 2, refillRate: 0 } });

    guard.checkConnection('peer1');
    guard.checkConnection('peer1');
    expect(guard.checkConnection('peer1').allowed).toBe(false);
  });
});

describe('MessageGuard - Integration', () => {
  test('realistic message flow with rate limiting', () => {
    const guard = new MessageGuard({ message: { max: 5, refillRate: 0 } });

    // 5 messages allowed
    for (let i = 0; i < 5; i++) {
      expect(guard.check('peer1', { ciphertext: `msg${i}` }).allowed).toBe(true);
    }

    // 6th blocked
    expect(guard.check('peer1', { ciphertext: 'msg5' }).allowed).toBe(false);

    // Different peer still fine
    expect(guard.check('peer2', { ciphertext: 'msg0' }).allowed).toBe(true);
  });

  test('byte budget tracks cumulative size', () => {
    const guard = new MessageGuard({ bytes: { max: 500, refillRate: 0 } });

    // Small messages pass
    expect(guard.check('peer1', { content: 'small' }).allowed).toBe(true);

    // Eventually byte budget runs out
    let blocked = false;
    for (let i = 0; i < 50; i++) {
      if (!guard.check('peer1', { content: 'A'.repeat(50) }).allowed) {
        blocked = true;
        break;
      }
    }
    expect(blocked).toBe(true);
  });
});
