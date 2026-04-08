/**
 * MessageStore - Manages messages with hash chain integrity
 *
 * Messages are IMMUTABLE - no editing, no deleting.
 * Each message links to the previous via prevHash.
 */

import { HashChain, GENESIS_HASH } from '../crypto/HashChain';
import type { HashableMessage } from '../crypto/HashChain';
import type { PlaintextMessage } from './types';
import { validateMessageContentLength } from './messageLimits';

type ImportedMessage = Omit<PlaintextMessage, 'content'> & { content?: string | null };

export class MessageStore {
  private hashChain: HashChain;
  // In-memory store per channel (channelId → messages[])
  private channels = new Map<string, PlaintextMessage[]>();
  // O(1) duplicate-ID lookup per channel — kept in sync with `channels`.
  private channelIdSets = new Map<string, Set<string>>();
  // Thread root snapshots — copies of parent messages that started threads.
  // Stored separately from the hash chain to preserve thread context after channel compaction.
  private threadRoots = new Map<string, PlaintextMessage>();

  constructor() {
    this.hashChain = new HashChain();
  }

  /** Ensure both the message array and ID set exist for a channel. */
  private ensureChannel(channelId: string): { msgs: PlaintextMessage[]; ids: Set<string> } {
    if (!this.channels.has(channelId)) {
      this.channels.set(channelId, []);
      this.channelIdSets.set(channelId, new Set());
    }
    return {
      msgs: this.channels.get(channelId)!,
      ids: this.channelIdSets.get(channelId)!,
    };
  }

  /** Binary-search for the first index where msgs[i].timestamp > target. */
  private upperBoundTimestamp(msgs: PlaintextMessage[], target: number): number {
    let lo = 0;
    let hi = msgs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (msgs[mid].timestamp <= target) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /**
   * Create a new message with correct prevHash
   */
  async createMessage(
    channelId: string,
    senderId: string,
    content: string,
    type: PlaintextMessage['type'] = 'text',
    threadId?: string
  ): Promise<PlaintextMessage> {
    validateMessageContentLength(content);
    const channelMessages = this.channels.get(channelId) || [];
    const lastMessage = channelMessages[channelMessages.length - 1];

    let prevHash: string;
    if (lastMessage) {
      prevHash = await this.hashChain.hashMessage(this.toHashable(lastMessage));
    } else {
      prevHash = GENESIS_HASH;
    }

    const message: PlaintextMessage = {
      id: this.generateId(),
      channelId,
      senderId,
      timestamp: Date.now(),
      content,
      type,
      threadId,
      prevHash,
      status: 'pending',
    };

    return message;
  }

  /**
   * Add a message to the store (after sending or receiving)
   * Verifies hash chain integrity before adding
   */
  async addMessage(message: PlaintextMessage): Promise<{ success: boolean; error?: string }> {
    const { msgs: channelMessages, ids } = this.ensureChannel(message.channelId);

    // Reject duplicate IDs early to keep insertions replay-safe.
    if (ids.has(message.id)) {
      return { success: false, error: `Duplicate message ID: ${message.id}` };
    }

    try {
      validateMessageContentLength(message.content);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }

    // Verify hash chain
    if (channelMessages.length === 0) {
      // First message must have genesis hash
      if (message.prevHash !== GENESIS_HASH) {
        return {
          success: false,
          error: `First message in channel must have genesis prevHash. Got: ${message.prevHash}`,
        };
      }
    } else {
      // Verify prevHash matches hash of last message
      const lastMessage = channelMessages[channelMessages.length - 1];
      const expectedHash = await this.hashChain.hashMessage(this.toHashable(lastMessage));

      if (message.prevHash !== expectedHash) {
        return {
          success: false,
          error: `Hash chain broken! Expected prevHash ${expectedHash}, got ${message.prevHash}`,
        };
      }

      // Verify timestamp is not in the past (replay attack prevention)
      if (message.timestamp <= lastMessage.timestamp) {
        return {
          success: false,
          error: `Message timestamp ${message.timestamp} is not after previous message ${lastMessage.timestamp}`,
        };
      }
    }

    // Add to store
    channelMessages.push(message);
    ids.add(message.id);

    return { success: true };
  }

  /**
   * Force-add a message without hash chain validation.
   * ONLY use for restoring from trusted local storage.
   * The hash chain was already verified when messages were first received.
   */
  forceAdd(message: PlaintextMessage): void {
    const { msgs, ids } = this.ensureChannel(message.channelId);
    // Avoid duplicates — O(1) via Set
    if (ids.has(message.id)) return;
    // Insert in timestamp order — O(log n) via binary search
    const insertIdx = this.upperBoundTimestamp(msgs, message.timestamp);
    if (insertIdx === msgs.length) {
      msgs.push(message);
    } else {
      msgs.splice(insertIdx, 0, message);
    }
    ids.add(message.id);
  }

  /**
   * Bulk-add pre-sorted messages. O(n log n) instead of O(n²).
   * Messages MUST be sorted by timestamp ascending.
   * Skips duplicates. Creates channel if needed.
   */
  bulkAdd(messages: PlaintextMessage[]): number {
    if (messages.length === 0) return 0;
    let added = 0;
    // Group by channel
    const byChannel = new Map<string, PlaintextMessage[]>();
    for (const msg of messages) {
      if (!byChannel.has(msg.channelId)) byChannel.set(msg.channelId, []);
      byChannel.get(msg.channelId)!.push(msg);
    }
    for (const [channelId, newMsgs] of byChannel) {
      const { msgs: existing, ids: existingIds } = this.ensureChannel(channelId);
      const deduped = newMsgs.filter(m => !existingIds.has(m.id));
      if (deduped.length === 0) continue;
      // Merge: push all then sort once — O(n log n)
      for (const m of deduped) {
        existing.push(m);
        existingIds.add(m.id);
      }
      existing.sort((a, b) => a.timestamp - b.timestamp);
      added += deduped.length;
    }
    return added;
  }

  /**
   * Get messages for a channel
   */
  getMessages(channelId: string): PlaintextMessage[] {
    return this.channels.get(channelId) || [];
  }

  /**
   * Get all channel IDs that have messages
   */
  getAllChannelIds(): string[] {
    return Array.from(this.channels.keys());
  }

  /**
   * Get thread messages (messages with matching threadId)
   */
  getThread(channelId: string, threadId: string): PlaintextMessage[] {
    const messages = this.channels.get(channelId) || [];
    return messages.filter(m => m.threadId === threadId);
  }

  /**
   * Verify the entire hash chain for a channel
   */
  async verifyChannel(channelId: string): Promise<{ valid: boolean; brokenAt?: number; reason?: string }> {
    const messages = this.channels.get(channelId) || [];
    const hashable = messages.map(m => this.toHashable(m));
    return this.hashChain.verifyFullChain(hashable);
  }

  /**
   * Import messages from a peer (during sync)
   * Verifies full chain before accepting
   */
  async importMessages(
    channelId: string,
    messages: ImportedMessage[]
  ): Promise<{ success: boolean; error?: string }> {
    const normalized: PlaintextMessage[] = messages.map((message) => ({
      ...message,
      content: typeof message.content === 'string' ? message.content : '',
    }));

    const hasOmittedContent = messages.some((message) => typeof message.content !== 'string');

    try {
      for (const message of normalized) validateMessageContentLength(message.content);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }

    // Full-chain verification requires message content; metadata-only sync intentionally omits it.
    if (!hasOmittedContent) {
      const hashable = normalized.map(m => this.toHashable(m));
      const verification = await this.hashChain.verifyFullChain(hashable);

      if (!verification.valid) {
        return {
          success: false,
          error: `Tampered message history detected: ${verification.reason}`,
        };
      }
    }

    // Replace channel messages (peer's chain is valid)
    this.channels.set(channelId, normalized);
    this.channelIdSets.set(channelId, new Set(normalized.map(m => m.id)));
    return { success: true };
  }

  /**
   * Get the hash of the last message in a channel (for creating next message)
   */
  async getLastHash(channelId: string): Promise<string> {
    const messages = this.channels.get(channelId) || [];
    if (messages.length === 0) {
      return GENESIS_HASH;
    }
    const last = messages[messages.length - 1];
    return this.hashChain.hashMessage(this.toHashable(last));
  }

  /**
   * Remap all messages from one channel ID to another.
   * Moves the message array and updates each message's channelId field.
   * Used during workspace-state sync when channel IDs are reconciled via min-wins.
   */
  remapChannel(oldId: string, newId: string): PlaintextMessage[] {
    if (oldId === newId) return this.channels.get(oldId) ?? [];

    const messages = this.channels.get(oldId);
    if (!messages || messages.length === 0) return [];

    // Update each message's channelId.
    // Safe: channelId is excluded from HashChain.canonicalize(), so this
    // mutation does not invalidate prevHash values or break verifyFullChain.
    for (const msg of messages) {
      msg.channelId = newId;
    }

    // Merge with existing messages at newId, deduplicating by message ID,
    // then sort by timestamp to maintain chronological order.
    const { msgs: existing, ids: existingIds } = this.ensureChannel(newId);
    const deduped = messages.filter(m => !existingIds.has(m.id));
    const merged = [...existing, ...deduped];
    merged.sort((a, b) => a.timestamp - b.timestamp);

    // Rebuild ID set for the merged channel
    const mergedIds = new Set(merged.map(m => m.id));
    this.channels.set(newId, merged);
    this.channelIdSets.set(newId, mergedIds);
    this.channels.delete(oldId);
    this.channelIdSets.delete(oldId);

    return this.channels.get(newId)!;
  }

  /**
   * Trim a channel to keep only the most recent `maxSize` messages.
   * Returns the number of evicted messages, or 0 if no trimming was needed.
   * The evicted messages are assumed to still exist in IndexedDB for on-demand loading.
   */
  trimChannel(channelId: string, maxSize: number): number {
    const msgs = this.channels.get(channelId);
    if (!msgs || msgs.length <= maxSize) return 0;
    const evictCount = msgs.length - maxSize;
    // Messages are sorted by timestamp; splice off the oldest.
    const evicted = msgs.splice(0, evictCount);
    // Remove evicted IDs from the set
    const ids = this.channelIdSets.get(channelId);
    if (ids) {
      for (const m of evicted) ids.delete(m.id);
    }
    return evictCount;
  }

  /**
   * Prepend older messages to the front of a channel's in-memory array.
   * Messages must be sorted by timestamp ascending.
   * Skips duplicates by ID.  Returns the number actually prepended.
   */
  prependMessages(channelId: string, older: PlaintextMessage[]): number {
    if (older.length === 0) return 0;
    const { msgs: existing, ids: existingIds } = this.ensureChannel(channelId);
    const deduped = older.filter(m => !existingIds.has(m.id));
    if (deduped.length === 0) return 0;
    // Prepend (older messages go to the front).
    existing.unshift(...deduped);
    for (const m of deduped) existingIds.add(m.id);
    return deduped.length;
  }

  /**
   * Clear a channel (for testing only)
   */
  clearChannel(channelId: string): void {
    this.channels.delete(channelId);
    this.channelIdSets.delete(channelId);
  }


  /**
   * Store a thread root snapshot (copy of the parent message that started a thread).
   * Preserves thread context even if the parent message is compacted from the channel.
   * Only stores the first snapshot — subsequent calls for the same threadId are no-ops.
   */
  setThreadRoot(threadId: string, snapshot: PlaintextMessage): void {
    if (!this.threadRoots.has(threadId)) {
      this.threadRoots.set(threadId, snapshot);
    }
  }

  /**
   * Get the stored thread root snapshot for a thread.
   */
  getThreadRoot(threadId: string): PlaintextMessage | undefined {
    return this.threadRoots.get(threadId);
  }

  /**
   * Get all stored thread roots (for persistence/restore).
   */
  getAllThreadRoots(): Map<string, PlaintextMessage> {
    return new Map(this.threadRoots);
  }

  /**
   * Assert internal consistency between `channels` and `channelIdSets`.
   * Throws descriptive errors when invariants are violated.
   */
  validateInvariants(): void {
    // In Vite production builds, skip invariant checks to avoid runtime overhead.
    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV === false) return;

    if (this.channels.size !== this.channelIdSets.size) {
      throw new Error(
        `[MessageStore] Key parity violated: channels.size=${this.channels.size} !== channelIdSets.size=${this.channelIdSets.size}`
      );
    }

    for (const channelId of this.channels.keys()) {
      if (!this.channelIdSets.has(channelId)) {
        throw new Error(
          `[MessageStore] Key parity violated: '${channelId}' exists in channels but is missing from channelIdSets`
        );
      }
    }

    for (const channelId of this.channelIdSets.keys()) {
      if (!this.channels.has(channelId)) {
        throw new Error(
          `[MessageStore] Key parity violated: '${channelId}' exists in channelIdSets but is missing from channels`
        );
      }
    }

    for (const [channelId, msgs] of this.channels) {
      const ids = this.channelIdSets.get(channelId)!;

      if (msgs.length !== ids.size) {
        throw new Error(
          `[MessageStore] Size parity violated for '${channelId}': msgs.length=${msgs.length} !== ids.size=${ids.size}`
        );
      }

      const seen = new Set<string>();
      for (let i = 0; i < msgs.length; i++) {
        const msg = msgs[i]!;

        if (seen.has(msg.id)) {
          throw new Error(
            `[MessageStore] Duplicate IDs violated for '${channelId}': duplicate id='${msg.id}'`
          );
        }
        seen.add(msg.id);

        if (!ids.has(msg.id)) {
          throw new Error(
            `[MessageStore] Array→Set violated for '${channelId}': msgs[${i}].id='${msg.id}' missing in channelIdSets`
          );
        }

        if (msg.channelId !== channelId) {
          throw new Error(
            `[MessageStore] ChannelId mismatch for '${channelId}': msgs[${i}].channelId='${msg.channelId}'`
          );
        }

        if (i > 0 && msg.timestamp < msgs[i - 1]!.timestamp) {
          throw new Error(
            `[MessageStore] Timestamp order violated for '${channelId}': msgs[${i}].timestamp=${msg.timestamp} < msgs[${i - 1}].timestamp=${msgs[i - 1]!.timestamp}`
          );
        }
      }

      for (const id of ids) {
        if (!seen.has(id)) {
          throw new Error(
            `[MessageStore] Set→Array violated for '${channelId}': id='${id}' missing from message array`
          );
        }
      }
    }
  }

  // === Helpers ===

  private toHashable(msg: PlaintextMessage): HashableMessage {
    return {
      id: msg.id,
      channelId: msg.channelId,
      senderId: msg.senderId,
      timestamp: msg.timestamp,
      content: msg.content,
      type: msg.type,
      prevHash: msg.prevHash,
    };
  }

  private generateId(): string {
    return crypto.randomUUID();
  }
}
