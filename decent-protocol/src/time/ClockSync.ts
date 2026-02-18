/**
 * ClockSync — NTP-style clock skew estimation between peers
 * 
 * In P2P there's no authoritative time server. Each peer has their own
 * system clock which may be wrong. ClockSync estimates the offset between
 * any two peers so display timestamps can be corrected.
 * 
 * Algorithm (simplified NTP):
 *   1. Alice sends time-sync request with her timestamp t1
 *   2. Bob receives at his time t2, responds with t2 and t3 (his send time)
 *   3. Alice receives at her time t4
 *   4. Round-trip time = (t4 - t1) - (t3 - t2)
 *   5. Clock offset = ((t2 - t1) + (t3 - t4)) / 2
 * 
 * Positive offset = peer clock is ahead of ours.
 * Negative offset = peer clock is behind ours.
 * 
 * Multiple samples are taken and averaged for accuracy.
 */

export interface TimeSyncRequest {
  type: 'time-sync-request';
  t1: number; // Sender's timestamp
  seq: number; // Sequence number
}

export interface TimeSyncResponse {
  type: 'time-sync-response';
  t1: number; // Original sender's timestamp (echoed back)
  t2: number; // Responder's receive timestamp
  t3: number; // Responder's send timestamp
  seq: number;
}

export interface PeerClockInfo {
  /** Estimated clock offset in ms (positive = peer ahead, negative = peer behind) */
  offsetMs: number;
  /** Estimated round-trip time in ms */
  rttMs: number;
  /** Number of samples used for this estimate */
  samples: number;
  /** When this estimate was last updated */
  lastUpdated: number;
  /** Confidence: lower RTT = more accurate offset */
  confidence: 'high' | 'medium' | 'low';
}

interface SyncSample {
  offsetMs: number;
  rttMs: number;
  timestamp: number;
}

export class ClockSync {
  /** Per-peer clock offset estimates */
  private peerClocks = new Map<string, PeerClockInfo>();
  /** Raw samples per peer (for averaging) */
  private samples = new Map<string, SyncSample[]>();
  /** Max samples to keep per peer */
  private maxSamples: number;
  /** Pending outbound sync requests */
  private pending = new Map<string, { t1: number; seq: number }>();
  private seqCounter = 0;

  constructor(maxSamples: number = 5) {
    this.maxSamples = maxSamples;
  }

  /**
   * Create a time-sync request to send to a peer
   */
  createRequest(peerId: string): TimeSyncRequest {
    const seq = ++this.seqCounter;
    const t1 = Date.now();
    this.pending.set(`${peerId}:${seq}`, { t1, seq });

    return { type: 'time-sync-request', t1, seq };
  }

  /**
   * Handle an incoming time-sync request — create a response
   */
  handleRequest(request: TimeSyncRequest): TimeSyncResponse {
    const t2 = Date.now();
    return {
      type: 'time-sync-response',
      t1: request.t1,
      t2,
      t3: Date.now(), // Might differ from t2 by a tiny amount (processing time)
      seq: request.seq,
    };
  }

  /**
   * Handle an incoming time-sync response — compute offset
   */
  handleResponse(peerId: string, response: TimeSyncResponse): PeerClockInfo {
    const t4 = Date.now();
    const key = `${peerId}:${response.seq}`;
    const pendingReq = this.pending.get(key);

    if (!pendingReq) {
      // No matching request — might be stale or duplicate
      return this.getPeerClock(peerId) || this.defaultClockInfo();
    }

    this.pending.delete(key);

    const { t1 } = pendingReq;
    const { t2, t3 } = response;

    // NTP offset calculation
    const offsetMs = ((t2 - t1) + (t3 - t4)) / 2;
    const rttMs = (t4 - t1) - (t3 - t2);

    // Store sample
    const sample: SyncSample = { offsetMs, rttMs, timestamp: Date.now() };
    if (!this.samples.has(peerId)) {
      this.samples.set(peerId, []);
    }
    const peerSamples = this.samples.get(peerId)!;
    peerSamples.push(sample);

    // Keep only recent samples
    if (peerSamples.length > this.maxSamples) {
      peerSamples.shift();
    }

    // Compute weighted average (lower RTT = higher weight)
    const clockInfo = this.computeEstimate(peerSamples);
    this.peerClocks.set(peerId, clockInfo);

    return clockInfo;
  }

  /**
   * Get estimated clock info for a peer
   */
  getPeerClock(peerId: string): PeerClockInfo | undefined {
    return this.peerClocks.get(peerId);
  }

  /**
   * Adjust a remote peer's timestamp to local time
   * Use this for DISPLAY ONLY — never for ordering (use vector clocks for that)
   */
  adjustTimestamp(peerId: string, remoteTimestamp: number): number {
    const clockInfo = this.peerClocks.get(peerId);
    if (!clockInfo) return remoteTimestamp; // No estimate — show as-is

    // Remote timestamp - peer offset = our local time equivalent
    return remoteTimestamp - clockInfo.offsetMs;
  }

  /**
   * Get relative time string ("just now", "2 min ago", etc.)
   * More user-friendly than absolute times when clocks disagree
   */
  relativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 0) return 'just now'; // Future timestamp (clock skew)
    if (diff < 5000) return 'just now';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  /**
   * Format timestamp for display, adjusted for peer clock skew
   */
  formatTime(peerId: string | null, timestamp: number): string {
    const adjusted = peerId ? this.adjustTimestamp(peerId, timestamp) : timestamp;
    const now = Date.now();
    const diff = now - adjusted;

    // Recent: show relative
    if (diff < 3600000) { // < 1 hour
      return this.relativeTime(adjusted);
    }

    // Today: show time
    const date = new Date(adjusted);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // This week: show day + time
    if (diff < 604800000) { // < 7 days
      return date.toLocaleDateString([], { weekday: 'short' }) + ' ' +
        date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Older: show date
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
      date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Get all peer clocks
   */
  getAllPeerClocks(): Map<string, PeerClockInfo> {
    return new Map(this.peerClocks);
  }

  /**
   * Clear data for a disconnected peer
   */
  removePeer(peerId: string): void {
    this.peerClocks.delete(peerId);
    this.samples.delete(peerId);
    // Clean up pending requests for this peer
    for (const key of this.pending.keys()) {
      if (key.startsWith(`${peerId}:`)) {
        this.pending.delete(key);
      }
    }
  }

  /**
   * Run a full sync cycle with a peer (convenience method)
   * Returns a request to send. Call handleResponse when you get the reply.
   */
  startSync(peerId: string): TimeSyncRequest {
    return this.createRequest(peerId);
  }

  // === Internal ===

  private computeEstimate(samples: SyncSample[]): PeerClockInfo {
    if (samples.length === 0) return this.defaultClockInfo();

    // Weight by inverse RTT (lower RTT = better accuracy)
    let totalWeight = 0;
    let weightedOffset = 0;
    let totalRtt = 0;

    for (const s of samples) {
      const weight = 1 / Math.max(s.rttMs, 1); // Avoid division by zero
      weightedOffset += s.offsetMs * weight;
      totalWeight += weight;
      totalRtt += s.rttMs;
    }

    const offsetMs = Math.round(weightedOffset / totalWeight);
    const avgRtt = Math.round(totalRtt / samples.length);

    // Confidence based on RTT and sample count
    let confidence: PeerClockInfo['confidence'];
    if (samples.length >= 3 && avgRtt < 100) {
      confidence = 'high';
    } else if (samples.length >= 2 && avgRtt < 500) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    return {
      offsetMs,
      rttMs: avgRtt,
      samples: samples.length,
      lastUpdated: Date.now(),
      confidence,
    };
  }

  private defaultClockInfo(): PeerClockInfo {
    return {
      offsetMs: 0,
      rttMs: 0,
      samples: 0,
      lastUpdated: Date.now(),
      confidence: 'low',
    };
  }
}
