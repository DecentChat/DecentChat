/**
 * MessageGuard — Validates incoming messages before processing
 * 
 * Combines rate limiting with message validation:
 * - Size limits (text, attachments, sync payloads)
 * - Format validation (required fields, types)
 * - Rate limiting per peer per action type
 * - Automatic peer reputation tracking
 * 
 * Place this as the FIRST handler in the message pipeline.
 */

import { RateLimiter } from './RateLimiter';
import type { RateLimitResult, PeerReputation, BucketConfig, RateLimitAction } from './RateLimiter';

/** Message size limits in bytes */
export interface SizeLimits {
  /** Max text message content (default: 64KB) */
  maxTextBytes: number;
  /** Max attachment metadata per message (default: 4KB) */
  maxAttachmentMetaBytes: number;
  /** Max single media blob (default: 50MB) */
  maxMediaBytes: number;
  /** Max workspace sync payload (default: 10MB) */
  maxSyncPayloadBytes: number;
  /** Max attachments per message (default: 10) */
  maxAttachmentsPerMessage: number;
  /** Max message fields total (prevent JSON bombs) */
  maxMessageFields: number;
}

const DEFAULT_SIZE_LIMITS: SizeLimits = {
  maxTextBytes: 64 * 1024,           // 64 KB
  maxAttachmentMetaBytes: 4 * 1024,  // 4 KB
  maxMediaBytes: 50 * 1024 * 1024,   // 50 MB
  maxSyncPayloadBytes: 10 * 1024 * 1024, // 10 MB
  maxAttachmentsPerMessage: 10,
  maxMessageFields: 50,
};

/** Guard check result */
export interface GuardResult {
  allowed: boolean;
  reason?: string;
  rateLimit?: RateLimitResult;
}

/** Known message types and their expected shapes */
const KNOWN_TYPES = new Set([
  'handshake',
  'workspace-sync',
  'time-sync-request',
  'time-sync-response',
  'media-request',
  'media-response',
  'media-chunk',
]);

export class MessageGuard {
  readonly rateLimiter: RateLimiter;
  private sizeLimits: SizeLimits;

  constructor(
    rateLimits?: Partial<Record<RateLimitAction, Partial<BucketConfig>>>,
    sizeLimits?: Partial<SizeLimits>,
  ) {
    this.rateLimiter = new RateLimiter(rateLimits);
    this.sizeLimits = { ...DEFAULT_SIZE_LIMITS, ...sizeLimits };
  }

  /**
   * Validate an incoming message from a peer.
   * Call this BEFORE any processing.
   */
  check(peerId: string, rawData: unknown): GuardResult {
    // 1. Check if peer is banned
    if (this.rateLimiter.isBanned(peerId)) {
      return { allowed: false, reason: 'peer is banned' };
    }

    // 2. Basic type check
    if (rawData === null || rawData === undefined) {
      return { allowed: false, reason: 'null message' };
    }

    if (typeof rawData !== 'object') {
      return { allowed: false, reason: 'message is not an object' };
    }

    const data = rawData as Record<string, unknown>;

    // 3. Field count check (prevent JSON bombs)
    const fieldCount = Object.keys(data).length;
    if (fieldCount > this.sizeLimits.maxMessageFields) {
      return { allowed: false, reason: `too many fields: ${fieldCount}` };
    }

    // 4. Determine message type and apply appropriate checks
    const type = data.type as string | undefined;

    if (type === 'handshake') {
      return this.checkRateLimit(peerId, 'handshake');
    }

    if (type === 'workspace-sync') {
      const sizeCheck = this.checkPayloadSize(data, this.sizeLimits.maxSyncPayloadBytes);
      if (!sizeCheck.allowed) return sizeCheck;
      return this.checkRateLimit(peerId, 'sync');
    }

    if (type === 'time-sync-request' || type === 'time-sync-response') {
      return this.checkRateLimit(peerId, 'message');
    }

    if (type === 'media-request' || type === 'media-response') {
      return this.checkRateLimit(peerId, 'media');
    }

    if (type === 'media-chunk') {
      const chunkData = data.data;
      if (typeof chunkData === 'string' && chunkData.length > this.sizeLimits.maxMediaBytes) {
        return { allowed: false, reason: 'media chunk too large' };
      }
      return this.checkRateLimit(peerId, 'media');
    }

    // Encrypted chat message (no type field, or unknown type)
    // Check message rate + byte budget
    const msgRate = this.checkRateLimit(peerId, 'message');
    if (!msgRate.allowed) return msgRate;

    // Estimate size
    const estimatedSize = JSON.stringify(data).length;
    const byteCheck = this.rateLimiter.check(peerId, 'bytes', estimatedSize);
    if (!byteCheck.allowed) {
      return { allowed: false, reason: 'byte rate limit exceeded', rateLimit: byteCheck };
    }

    // Check text content size
    if (typeof data.content === 'string' && data.content.length > this.sizeLimits.maxTextBytes) {
      return { allowed: false, reason: `text too large: ${data.content.length} bytes` };
    }

    // Check attachments
    if (Array.isArray(data.attachments)) {
      if (data.attachments.length > this.sizeLimits.maxAttachmentsPerMessage) {
        return { allowed: false, reason: `too many attachments: ${data.attachments.length}` };
      }
    }

    return { allowed: true };
  }

  /**
   * Check a connection attempt
   */
  checkConnection(peerId: string): GuardResult {
    if (this.rateLimiter.isBanned(peerId)) {
      return { allowed: false, reason: 'peer is banned' };
    }
    return this.checkRateLimit(peerId, 'connection');
  }

  /**
   * Get peer reputation
   */
  getReputation(peerId: string): PeerReputation {
    return this.rateLimiter.getReputation(peerId);
  }

  /**
   * Ban a peer manually
   */
  ban(peerId: string, durationMs?: number): void {
    this.rateLimiter.ban(peerId, durationMs);
  }

  /**
   * Unban a peer
   */
  unban(peerId: string): void {
    this.rateLimiter.unban(peerId);
  }

  /**
   * Update size limits
   */
  updateLimits(limits: Partial<SizeLimits>): void {
    this.sizeLimits = { ...this.sizeLimits, ...limits };
  }

  // === Internal ===

  private checkRateLimit(peerId: string, action: RateLimitAction): GuardResult {
    const result = this.rateLimiter.check(peerId, action);
    if (!result.allowed) {
      return { allowed: false, reason: `${action} rate limit exceeded`, rateLimit: result };
    }
    return { allowed: true, rateLimit: result };
  }

  private checkPayloadSize(data: Record<string, unknown>, maxBytes: number): GuardResult {
    const size = JSON.stringify(data).length;
    if (size > maxBytes) {
      return { allowed: false, reason: `payload too large: ${size} bytes (max ${maxBytes})` };
    }
    return { allowed: true };
  }
}
