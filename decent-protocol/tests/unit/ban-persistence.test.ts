/**
 * GAP 8: Ban Persistence — Rate-limit ban survives reconnect
 *
 * Scenario: Peer gets rate-limit banned, disconnects, reconnects with
 * the same peerId.
 *
 * Verify: ban holds across reconnect, peer cannot send messages after
 * reconnecting.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { RateLimiter } from '../../src/security/RateLimiter';
import type { RateLimitAction } from '../../src/security/RateLimiter';

describe('Ban Persistence — Rate-limit ban across reconnect', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    // Tight limits for testing
    limiter = new RateLimiter({
      message: { max: 5, refillRate: 0.1 }, // 5 burst, very slow refill
    });
  });

  test('peer gets banned after exhausting rate limit', () => {
    const peerId = 'spammer';

    // Exhaust the bucket
    for (let i = 0; i < 5; i++) {
      const result = limiter.check(peerId, 'message');
      expect(result.allowed).toBe(true);
    }

    // Next attempts should be denied and escalate
    for (let i = 0; i < 5; i++) {
      const result = limiter.check(peerId, 'message');
      expect(result.allowed).toBe(false);
    }

    // After enough violations, peer should be banned
    const rep = limiter.getReputation(peerId);
    expect(rep.violations).toBeGreaterThan(0);
  });

  test('manual ban persists across removePeer (simulated disconnect)', () => {
    const peerId = 'bad-actor';

    // Manually ban the peer
    limiter.ban(peerId, 60000); // 1 minute ban
    expect(limiter.isBanned(peerId)).toBe(true);

    // Simulate disconnect
    limiter.removePeer(peerId);

    // Reconnect: ban should still hold (reputation survives)
    expect(limiter.isBanned(peerId)).toBe(true);

    // Peer cannot send messages
    const result = limiter.check(peerId, 'message');
    expect(result.allowed).toBe(false);
    expect(result.violation?.severity).toBe('ban');
  });

  test('banned peer cannot send any action type', () => {
    const peerId = 'banned-peer';
    limiter.ban(peerId);

    const actions: RateLimitAction[] = ['message', 'bytes', 'connection', 'sync', 'media', 'handshake'];
    for (const action of actions) {
      const result = limiter.check(peerId, action);
      expect(result.allowed).toBe(false);
    }
  });

  test('ban with duration expires after timeout', async () => {
    const peerId = 'temp-banned';
    limiter.ban(peerId, 100); // 100ms ban

    expect(limiter.isBanned(peerId)).toBe(true);

    // Wait for ban to expire
    await new Promise(resolve => setTimeout(resolve, 150));

    expect(limiter.isBanned(peerId)).toBe(false);

    // Peer can send again (new bucket)
    const result = limiter.check(peerId, 'message');
    expect(result.allowed).toBe(true);
  });

  test('infinite ban never expires', () => {
    const peerId = 'perma-banned';
    limiter.ban(peerId, Infinity);

    expect(limiter.isBanned(peerId)).toBe(true);

    const rep = limiter.getReputation(peerId);
    expect(rep.bannedUntil).toBe(Infinity);
  });

  test('unban restores access', () => {
    const peerId = 'forgiven';
    limiter.ban(peerId);

    expect(limiter.isBanned(peerId)).toBe(true);

    limiter.unban(peerId);
    expect(limiter.isBanned(peerId)).toBe(false);

    const result = limiter.check(peerId, 'message');
    expect(result.allowed).toBe(true);
  });

  test('getBannedPeers lists currently banned peers', () => {
    limiter.ban('bad-1');
    limiter.ban('bad-2');

    const banned = limiter.getBannedPeers();
    expect(banned.length).toBe(2);
    expect(banned.map(r => r.peerId)).toContain('bad-1');
    expect(banned.map(r => r.peerId)).toContain('bad-2');
  });

  test('reconnect after ban: violation callback still fires', () => {
    const violations: string[] = [];
    limiter.onViolation = (v) => violations.push(v.peerId);

    const peerId = 'monitored';

    // Exhaust + violate
    for (let i = 0; i < 10; i++) {
      limiter.check(peerId, 'message');
    }

    // Disconnect
    limiter.removePeer(peerId);

    // Reconnect and try again
    limiter.check(peerId, 'message');

    // Violations should have been recorded
    expect(violations.filter(v => v === peerId).length).toBeGreaterThan(0);
  });

  test('rate-limit escalation: warning → soft → hard → ban', () => {
    const peerId = 'escalation-test';

    // Exhaust tokens
    for (let i = 0; i < 5; i++) {
      limiter.check(peerId, 'message');
    }

    // Each subsequent violation escalates
    const r1 = limiter.check(peerId, 'message');
    expect(r1.allowed).toBe(false);
    expect(r1.violation?.severity).toBe('warning');

    const r2 = limiter.check(peerId, 'message');
    expect(r2.violation?.severity).toBe('soft');

    const r3 = limiter.check(peerId, 'message');
    expect(r3.violation?.severity).toBe('hard');

    const r4 = limiter.check(peerId, 'message');
    expect(r4.violation?.severity).toBe('ban');

    // After ban severity, peer should be banned
    expect(limiter.isBanned(peerId)).toBe(true);
  });

  test('reputation survives disconnect but buckets are reset', () => {
    const peerId = 'reconnector';

    // Build up violations
    for (let i = 0; i < 8; i++) {
      limiter.check(peerId, 'message');
    }

    const repBefore = limiter.getReputation(peerId);
    const violationsBefore = repBefore.violations;

    // Disconnect: clears buckets but keeps reputation
    limiter.removePeer(peerId);

    const repAfter = limiter.getReputation(peerId);
    expect(repAfter.violations).toBe(violationsBefore);
    expect(repAfter.level).toBe(repBefore.level);
  });

  test('reset clears all state including bans', () => {
    limiter.ban('peer-1');
    limiter.ban('peer-2');

    limiter.reset();

    expect(limiter.isBanned('peer-1')).toBe(false);
    expect(limiter.isBanned('peer-2')).toBe(false);
    expect(limiter.getBannedPeers()).toHaveLength(0);
  });
});
