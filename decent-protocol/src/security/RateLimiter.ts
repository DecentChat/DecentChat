/**
 * RateLimiter — Token bucket rate limiting for P2P peers
 * 
 * Each peer gets independent rate limits per action type.
 * Uses token bucket algorithm: tokens refill over time,
 * each action consumes tokens. When empty → action denied.
 * 
 * No central server — each peer enforces its own limits.
 */

/** Action types that can be rate-limited */
export type RateLimitAction = 'message' | 'bytes' | 'connection' | 'sync' | 'media' | 'handshake';

/** Configuration for a single token bucket */
export interface BucketConfig {
  /** Maximum tokens (burst capacity) */
  max: number;
  /** Tokens added per second */
  refillRate: number;
  /** Cost per action (default: 1) */
  costPerAction?: number;
}

/** Default rate limits per action type */
export const DEFAULT_LIMITS: Record<RateLimitAction, BucketConfig> = {
  message:    { max: 30,       refillRate: 10 },        // 30 burst, 10/sec sustained
  bytes:      { max: 5242880,  refillRate: 102400 },     // 5MB burst, 100KB/sec
  connection: { max: 5,        refillRate: 1/60 },       // 5 burst, 1/min
  sync:       { max: 30,       refillRate: 5 },          // 30 burst, 5/sec sustained
  media:      { max: 100,      refillRate: 20 },         // 100 burst, 20/sec
  handshake:  { max: 3,        refillRate: 1/10 },       // 3 burst, 1 per 10sec
};

/** Internal token bucket state */
interface Bucket {
  tokens: number;
  lastRefill: number;
  config: BucketConfig;
}

/** Violation severity */
export type ViolationSeverity = 'warning' | 'soft' | 'hard' | 'ban';

/** Violation event */
export interface Violation {
  peerId: string;
  action: RateLimitAction;
  severity: ViolationSeverity;
  timestamp: number;
  tokensRequested: number;
  tokensAvailable: number;
}

/** Peer reputation state */
export interface PeerReputation {
  peerId: string;
  violations: number;
  lastViolation: number;
  banned: boolean;
  bannedUntil: number;
  /** Escalation level: 0 = clean, 1 = warned, 2 = throttled, 3+ = temp banned */
  level: number;
}

/** Rate limit check result */
export interface RateLimitResult {
  allowed: boolean;
  tokensRemaining: number;
  retryAfterMs?: number;
  violation?: Violation;
}

export class RateLimiter {
  private limits: Record<RateLimitAction, BucketConfig>;
  /** Per-peer buckets: peerId → action → bucket */
  private buckets = new Map<string, Map<RateLimitAction, Bucket>>();
  /** Per-peer reputation */
  private reputations = new Map<string, PeerReputation>();
  /** Violation callback */
  onViolation?: (violation: Violation) => void;

  /** Ban duration escalation: 1min, 5min, 30min, 2hr, permanent */
  private banDurations = [60000, 300000, 1800000, 7200000, Infinity];

  constructor(limits?: Partial<Record<RateLimitAction, Partial<BucketConfig>>>) {
    this.limits = { ...DEFAULT_LIMITS };
    if (limits) {
      for (const [action, config] of Object.entries(limits)) {
        this.limits[action as RateLimitAction] = {
          ...DEFAULT_LIMITS[action as RateLimitAction],
          ...config,
        };
      }
    }
  }

  /**
   * Check if an action is allowed for a peer. Consumes tokens if allowed.
   */
  check(peerId: string, action: RateLimitAction, cost?: number): RateLimitResult {
    // Check ban first
    const rep = this.getReputation(peerId);
    if (rep.banned) {
      if (Date.now() < rep.bannedUntil) {
        return {
          allowed: false,
          tokensRemaining: 0,
          retryAfterMs: rep.bannedUntil - Date.now(),
          violation: {
            peerId, action,
            severity: 'ban',
            timestamp: Date.now(),
            tokensRequested: cost ?? 1,
            tokensAvailable: 0,
          },
        };
      }
      // Ban expired
      rep.banned = false;
      rep.bannedUntil = 0;
    }

    const bucket = this.getBucket(peerId, action);
    this.refill(bucket);

    const tokenCost = cost ?? bucket.config.costPerAction ?? 1;

    if (bucket.tokens >= tokenCost) {
      bucket.tokens -= tokenCost;
      return { allowed: true, tokensRemaining: bucket.tokens };
    }

    // Calculate retry time
    const deficit = tokenCost - bucket.tokens;
    const retryAfterMs = Math.ceil((deficit / bucket.config.refillRate) * 1000);

    // Media should throttle only (no reputation escalation / no temp bans).
    if (action === 'media') {
      const violation: Violation = {
        peerId,
        action,
        severity: 'warning',
        timestamp: Date.now(),
        tokensRequested: tokenCost,
        tokensAvailable: bucket.tokens,
      };
      this.onViolation?.(violation);
      return {
        allowed: false,
        tokensRemaining: bucket.tokens,
        retryAfterMs,
        violation,
      };
    }

    // Rate limited — record violation
    const severity = this.calculateSeverity(rep);
    const violation: Violation = {
      peerId, action, severity,
      timestamp: Date.now(),
      tokensRequested: tokenCost,
      tokensAvailable: bucket.tokens,
    };

    this.recordViolation(rep, violation);

    return {
      allowed: false,
      tokensRemaining: bucket.tokens,
      retryAfterMs,
      violation,
    };
  }

  /**
   * Check without consuming tokens (peek)
   */
  peek(peerId: string, action: RateLimitAction, cost?: number): boolean {
    const rep = this.getReputation(peerId);
    if (rep.banned && Date.now() < rep.bannedUntil) return false;

    const bucket = this.getBucket(peerId, action);
    this.refill(bucket);
    return bucket.tokens >= (cost ?? bucket.config.costPerAction ?? 1);
  }

  /**
   * Get peer reputation
   */
  getReputation(peerId: string): PeerReputation {
    if (!this.reputations.has(peerId)) {
      this.reputations.set(peerId, {
        peerId,
        violations: 0,
        lastViolation: 0,
        banned: false,
        bannedUntil: 0,
        level: 0,
      });
    }
    return this.reputations.get(peerId)!;
  }

  /**
   * Manually ban a peer
   */
  ban(peerId: string, durationMs: number = Infinity): void {
    const rep = this.getReputation(peerId);
    rep.banned = true;
    rep.bannedUntil = durationMs === Infinity ? Infinity : Date.now() + durationMs;
    rep.level = Math.max(rep.level, 4);
  }

  /**
   * Unban a peer
   */
  unban(peerId: string): void {
    const rep = this.getReputation(peerId);
    rep.banned = false;
    rep.bannedUntil = 0;
    rep.level = 0;
    rep.violations = 0;
  }

  /**
   * Check if a peer is currently banned
   */
  isBanned(peerId: string): boolean {
    const rep = this.reputations.get(peerId);
    if (!rep) return false;
    if (!rep.banned) return false;
    if (Date.now() >= rep.bannedUntil) {
      rep.banned = false;
      return false;
    }
    return true;
  }

  /**
   * Remove all state for a peer (on disconnect)
   */
  removePeer(peerId: string): void {
    this.buckets.delete(peerId);
    // Keep reputation (survives reconnect)
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.buckets.clear();
    this.reputations.clear();
  }

  /**
   * Get all banned peers
   */
  getBannedPeers(): PeerReputation[] {
    return Array.from(this.reputations.values()).filter(r =>
      r.banned && (r.bannedUntil === Infinity || Date.now() < r.bannedUntil)
    );
  }

  // === Internal ===

  private getBucket(peerId: string, action: RateLimitAction): Bucket {
    if (!this.buckets.has(peerId)) {
      this.buckets.set(peerId, new Map());
    }
    const peerBuckets = this.buckets.get(peerId)!;

    if (!peerBuckets.has(action)) {
      const config = this.limits[action];
      peerBuckets.set(action, {
        tokens: config.max,
        lastRefill: Date.now(),
        config,
      });
    }
    return peerBuckets.get(action)!;
  }

  private refill(bucket: Bucket): void {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000; // seconds
    const refill = elapsed * bucket.config.refillRate;

    if (refill > 0) {
      bucket.tokens = Math.min(bucket.config.max, bucket.tokens + refill);
      bucket.lastRefill = now;
    }
  }

  private calculateSeverity(rep: PeerReputation): ViolationSeverity {
    if (rep.level >= 3) return 'ban';
    if (rep.level >= 2) return 'hard';
    if (rep.level >= 1) return 'soft';
    return 'warning';
  }

  private recordViolation(rep: PeerReputation, violation: Violation): void {
    rep.violations++;
    rep.lastViolation = Date.now();

    // Escalate level based on violation count within time window (1 hour)
    const recentWindow = 3600000;
    if (Date.now() - rep.lastViolation < recentWindow || rep.violations > 1) {
      rep.level = Math.min(rep.level + 1, this.banDurations.length);
    }

    // Apply ban if severity warrants it
    if (violation.severity === 'ban' || rep.level >= 3) {
      const banIdx = Math.min(rep.level - 3, this.banDurations.length - 1);
      const duration = this.banDurations[Math.max(0, banIdx)];
      rep.banned = true;
      rep.bannedUntil = duration === Infinity ? Infinity : Date.now() + duration;
    }

    this.onViolation?.(violation);
  }
}
