/**
 * ClockSync tests — NTP-style peer clock offset estimation
 */

import { describe, test, expect } from 'bun:test';
import { ClockSync } from '../../src/time/ClockSync';

describe('ClockSync - Basic Flow', () => {
  test('request → response → offset calculated', () => {
    const alice = new ClockSync();
    const bob = new ClockSync();

    // Alice creates request
    const request = alice.createRequest('bob');
    expect(request.type).toBe('time-sync-request');
    expect(request.t1).toBeGreaterThan(0);

    // Bob handles request
    const response = bob.handleRequest(request);
    expect(response.type).toBe('time-sync-response');
    expect(response.t1).toBe(request.t1); // Echoed back
    expect(response.t2).toBeGreaterThanOrEqual(request.t1);

    // Alice handles response
    const clockInfo = alice.handleResponse('bob', response);
    expect(clockInfo.samples).toBe(1);
    expect(clockInfo.rttMs).toBeGreaterThanOrEqual(0);
    // On same machine, offset should be near zero
    expect(Math.abs(clockInfo.offsetMs)).toBeLessThan(100);
  });

  test('multiple samples improve estimate', () => {
    const alice = new ClockSync();
    const bob = new ClockSync();

    for (let i = 0; i < 5; i++) {
      const request = alice.createRequest('bob');
      const response = bob.handleRequest(request);
      alice.handleResponse('bob', response);
    }

    const clockInfo = alice.getPeerClock('bob');
    expect(clockInfo).toBeDefined();
    expect(clockInfo!.samples).toBe(5);
    expect(clockInfo!.confidence).toBe('high'); // 5 samples + low RTT
  });
});

describe('ClockSync - Simulated Clock Skew', () => {
  test('detects peer clock ahead by 5 seconds', () => {
    const alice = new ClockSync();
    const SKEW = 5000; // Bob is 5 seconds ahead

    // Simulate: Alice sends at her time, Bob receives at his time (5s ahead)
    const request = alice.createRequest('bob');

    // Manually construct response as if Bob's clock is 5s ahead
    const t2 = request.t1 + SKEW + 1; // Bob receives (his clock is ahead)
    const t3 = t2 + 1; // Bob sends back
    const response = {
      type: 'time-sync-response' as const,
      t1: request.t1,
      t2,
      t3,
      seq: request.seq,
    };

    const clockInfo = alice.handleResponse('bob', response);

    // Offset should be approximately +5000ms (peer ahead)
    // Not exact due to RTT estimation
    expect(clockInfo.offsetMs).toBeGreaterThan(2000);
    expect(clockInfo.offsetMs).toBeLessThan(8000);
  });

  test('detects peer clock behind by 3 seconds', () => {
    const alice = new ClockSync();
    const SKEW = -3000; // Bob is 3 seconds behind

    const request = alice.createRequest('bob');

    const t2 = request.t1 + SKEW + 1;
    const t3 = t2 + 1;
    const response = {
      type: 'time-sync-response' as const,
      t1: request.t1,
      t2,
      t3,
      seq: request.seq,
    };

    const clockInfo = alice.handleResponse('bob', response);
    expect(clockInfo.offsetMs).toBeLessThan(-1000);
    expect(clockInfo.offsetMs).toBeGreaterThan(-5000);
  });
});

describe('ClockSync - Timestamp Adjustment', () => {
  test('adjusts remote timestamp to local time', () => {
    const sync = new ClockSync();

    // Manually set peer clock info (peer is 5 seconds ahead)
    const request = sync.createRequest('bob');
    const response = {
      type: 'time-sync-response' as const,
      t1: request.t1,
      t2: request.t1 + 5000,
      t3: request.t1 + 5001,
      seq: request.seq,
    };
    sync.handleResponse('bob', response);

    const now = Date.now();
    const bobTimestamp = now + 5000; // Bob's clock says now+5s
    const adjusted = sync.adjustTimestamp('bob', bobTimestamp);

    // Adjusted should be close to our "now"
    expect(Math.abs(adjusted - now)).toBeLessThan(1000);
  });

  test('returns raw timestamp for unknown peer', () => {
    const sync = new ClockSync();
    const ts = Date.now();
    expect(sync.adjustTimestamp('unknown', ts)).toBe(ts);
  });
});

describe('ClockSync - Relative Time', () => {
  test('just now (< 5s)', () => {
    const sync = new ClockSync();
    expect(sync.relativeTime(Date.now())).toBe('just now');
    expect(sync.relativeTime(Date.now() - 3000)).toBe('just now');
  });

  test('seconds ago', () => {
    const sync = new ClockSync();
    expect(sync.relativeTime(Date.now() - 30000)).toBe('30s ago');
  });

  test('minutes ago', () => {
    const sync = new ClockSync();
    expect(sync.relativeTime(Date.now() - 120000)).toBe('2m ago');
  });

  test('hours ago', () => {
    const sync = new ClockSync();
    expect(sync.relativeTime(Date.now() - 7200000)).toBe('2h ago');
  });

  test('days ago', () => {
    const sync = new ClockSync();
    expect(sync.relativeTime(Date.now() - 172800000)).toBe('2d ago');
  });

  test('future timestamp shows just now', () => {
    const sync = new ClockSync();
    expect(sync.relativeTime(Date.now() + 10000)).toBe('just now');
  });
});

describe('ClockSync - Peer Management', () => {
  test('tracks multiple peers independently', () => {
    const sync = new ClockSync();

    // Sync with Bob (no skew)
    const req1 = sync.createRequest('bob');
    const resp1 = { type: 'time-sync-response' as const, t1: req1.t1, t2: req1.t1 + 1, t3: req1.t1 + 2, seq: req1.seq };
    sync.handleResponse('bob', resp1);

    // Sync with Charlie (5s ahead)
    const req2 = sync.createRequest('charlie');
    const resp2 = { type: 'time-sync-response' as const, t1: req2.t1, t2: req2.t1 + 5000, t3: req2.t1 + 5001, seq: req2.seq };
    sync.handleResponse('charlie', resp2);

    const bobClock = sync.getPeerClock('bob');
    const charlieClock = sync.getPeerClock('charlie');

    expect(bobClock).toBeDefined();
    expect(charlieClock).toBeDefined();
    expect(Math.abs(bobClock!.offsetMs)).toBeLessThan(100);
    expect(charlieClock!.offsetMs).toBeGreaterThan(2000);
  });

  test('removePeer cleans up data', () => {
    const sync = new ClockSync();

    const req = sync.createRequest('bob');
    const resp = { type: 'time-sync-response' as const, t1: req.t1, t2: req.t1 + 1, t3: req.t1 + 2, seq: req.seq };
    sync.handleResponse('bob', resp);

    expect(sync.getPeerClock('bob')).toBeDefined();

    sync.removePeer('bob');
    expect(sync.getPeerClock('bob')).toBeUndefined();
  });

  test('getAllPeerClocks returns all tracked peers', () => {
    const sync = new ClockSync();

    for (const peer of ['bob', 'charlie', 'dave']) {
      const req = sync.createRequest(peer);
      const resp = { type: 'time-sync-response' as const, t1: req.t1, t2: req.t1 + 1, t3: req.t1 + 2, seq: req.seq };
      sync.handleResponse(peer, resp);
    }

    const all = sync.getAllPeerClocks();
    expect(all.size).toBe(3);
  });
});

describe('ClockSync - Edge Cases', () => {
  test('handles stale/duplicate response gracefully', () => {
    const sync = new ClockSync();

    const resp = {
      type: 'time-sync-response' as const,
      t1: Date.now() - 10000,
      t2: Date.now() - 9999,
      t3: Date.now() - 9998,
      seq: 999, // No matching request
    };

    // Should not crash, returns default info
    const info = sync.handleResponse('bob', resp);
    expect(info.samples).toBe(0);
  });

  test('max samples limit respected', () => {
    const sync = new ClockSync(3); // Max 3 samples

    for (let i = 0; i < 10; i++) {
      const req = sync.createRequest('bob');
      const resp = { type: 'time-sync-response' as const, t1: req.t1, t2: req.t1 + 1, t3: req.t1 + 2, seq: req.seq };
      sync.handleResponse('bob', resp);
    }

    expect(sync.getPeerClock('bob')!.samples).toBe(3);
  });

  test('confidence levels based on samples and RTT', () => {
    const sync = new ClockSync();

    // 1 sample = low confidence
    const req1 = sync.createRequest('bob');
    sync.handleResponse('bob', { type: 'time-sync-response', t1: req1.t1, t2: req1.t1 + 1, t3: req1.t1 + 2, seq: req1.seq });
    expect(sync.getPeerClock('bob')!.confidence).toBe('low');

    // 2 samples = medium
    const req2 = sync.createRequest('bob');
    sync.handleResponse('bob', { type: 'time-sync-response', t1: req2.t1, t2: req2.t1 + 1, t3: req2.t1 + 2, seq: req2.seq });
    expect(sync.getPeerClock('bob')!.confidence).toBe('medium');

    // 3+ samples with low RTT = high
    const req3 = sync.createRequest('bob');
    sync.handleResponse('bob', { type: 'time-sync-response', t1: req3.t1, t2: req3.t1 + 1, t3: req3.t1 + 2, seq: req3.seq });
    expect(sync.getPeerClock('bob')!.confidence).toBe('high');
  });
});
