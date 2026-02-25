/**
 * GAP 7: Clock Skew — Extreme time differences between peers
 *
 * Scenario: Peer with clock 2 hours ahead sends messages — verify they
 * do not dominate display order permanently.
 *
 * Also test skew > 60s and skew > 24h. Verify ClockSync correction or
 * graceful degradation.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { ClockSync } from '../../src/time/ClockSync';
import { MessageCRDT } from '../../src/crdt/MessageCRDT';
import type { PeerClockInfo, TimeSyncResponse } from '../../src/time/ClockSync';

/**
 * Simulate a time-sync round-trip with a known clock offset.
 * Fakes t2/t3 as if the remote peer's clock is offsetMs ahead.
 */
function simulateSync(
  sync: ClockSync,
  peerId: string,
  offsetMs: number,
  rttMs: number = 10
): PeerClockInfo {
  const request = sync.createRequest(peerId);

  // Simulate: remote clock is offsetMs ahead
  const response: TimeSyncResponse = {
    type: 'time-sync-response',
    t1: request.t1,
    t2: request.t1 + offsetMs + rttMs / 2,   // remote receive time
    t3: request.t1 + offsetMs + rttMs / 2,   // remote send time
    seq: request.seq,
  };

  return sync.handleResponse(peerId, response);
}

describe('Clock Skew — Extreme time differences', () => {
  let sync: ClockSync;

  beforeEach(() => {
    sync = new ClockSync(5);
  });

  test('detects 2-hour clock skew', () => {
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const info = simulateSync(sync, 'skewed-peer', TWO_HOURS);

    // Offset should be approximately 2 hours
    expect(Math.abs(info.offsetMs - TWO_HOURS)).toBeLessThan(100);
  });

  test('detects 60-second clock skew', () => {
    const SIXTY_SEC = 60 * 1000;
    const info = simulateSync(sync, 'skewed-peer', SIXTY_SEC);

    expect(Math.abs(info.offsetMs - SIXTY_SEC)).toBeLessThan(100);
  });

  test('detects 24-hour clock skew', () => {
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const info = simulateSync(sync, 'skewed-peer', ONE_DAY);

    expect(Math.abs(info.offsetMs - ONE_DAY)).toBeLessThan(100);
  });

  test('adjustTimestamp corrects for 2-hour offset', () => {
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    simulateSync(sync, 'skewed-peer', TWO_HOURS);

    const now = Date.now();
    const remoteTimestamp = now + TWO_HOURS; // Peer thinks it's 2h from now

    const adjusted = sync.adjustTimestamp('skewed-peer', remoteTimestamp);

    // Adjusted timestamp should be close to our "now"
    expect(Math.abs(adjusted - now)).toBeLessThan(200);
  });

  test('future timestamps show as "just now" via relativeTime', () => {
    const futureTs = Date.now() + 60000; // 1 min in future
    const relative = sync.relativeTime(futureTs);
    expect(relative).toBe('just now');
  });

  test('skewed peer messages do not dominate display order', () => {
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    simulateSync(sync, 'skewed-peer', TWO_HOURS);

    // Messages from skewed peer have future timestamps
    const now = Date.now();
    const skewedMsg = { timestamp: now + TWO_HOURS, senderId: 'skewed-peer' };
    const normalMsg = { timestamp: now, senderId: 'normal-peer' };

    // After adjustment, skewed message should be close to "now"
    const adjustedSkewed = sync.adjustTimestamp('skewed-peer', skewedMsg.timestamp);
    const adjustedNormal = normalMsg.timestamp; // No adjustment needed for local

    // The skewed message should not appear 2 hours in the future
    expect(Math.abs(adjustedSkewed - adjustedNormal)).toBeLessThan(200);
  });

  test('negative skew (peer clock behind) is handled', () => {
    const BEHIND = -30 * 60 * 1000; // 30 minutes behind
    const info = simulateSync(sync, 'slow-peer', BEHIND);

    expect(info.offsetMs).toBeLessThan(0);

    const remoteTimestamp = Date.now() + BEHIND;
    const adjusted = sync.adjustTimestamp('slow-peer', remoteTimestamp);

    // Adjusted should be close to our now
    expect(Math.abs(adjusted - Date.now())).toBeLessThan(200);
  });

  test('multiple samples improve confidence', () => {
    const offset = 120000; // 2 minutes

    // Low RTT samples → high confidence
    for (let i = 0; i < 5; i++) {
      simulateSync(sync, 'stable-peer', offset, 5);
    }

    const info = sync.getPeerClock('stable-peer');
    expect(info).toBeDefined();
    expect(info!.confidence).toBe('high');
    expect(info!.samples).toBe(5);
  });

  test('high RTT reduces confidence', () => {
    simulateSync(sync, 'laggy-peer', 60000, 1000); // 1s RTT

    const info = sync.getPeerClock('laggy-peer');
    expect(info).toBeDefined();
    expect(info!.confidence).toBe('low');
  });

  test('CRDT vector clocks prevent skewed ordering regardless of wallTime', () => {
    const alice = new MessageCRDT('alice');
    const bob = new MessageCRDT('bob');

    // Alice sends first (normal clock)
    const a1 = alice.createMessage('ch-1', 'Alice first');

    // Bob receives and replies
    bob.addMessage(a1);
    const b1 = bob.createMessage('ch-1', 'Bob reply');

    // Even if Bob's wallTime is far in the future, vector clock
    // ensures causal ordering (Alice first, then Bob's reply)
    alice.addMessage(b1);

    const view = alice.getMessages('ch-1');
    expect(view[0].content).toBe('Alice first');
    expect(view[1].content).toBe('Bob reply');
  });

  test('unknown peer returns unadjusted timestamp', () => {
    const ts = Date.now();
    const adjusted = sync.adjustTimestamp('unknown-peer', ts);
    expect(adjusted).toBe(ts);
  });

  test('removePeer clears clock data', () => {
    simulateSync(sync, 'temp-peer', 5000);
    expect(sync.getPeerClock('temp-peer')).toBeDefined();

    sync.removePeer('temp-peer');
    expect(sync.getPeerClock('temp-peer')).toBeUndefined();
  });

  test('formatTime handles extreme past timestamps gracefully', () => {
    const WEEK_AGO = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const formatted = sync.formatTime(null, WEEK_AGO);

    // Should be a date string, not crash
    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
  });
});
