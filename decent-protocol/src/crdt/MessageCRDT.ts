/**
 * MessageCRDT - Conflict-free Replicated Data Type for messages
 * 
 * Uses vector clocks for ordering + set-based CRDT for convergence.
 * When peers reconnect after being offline, their message sets
 * merge automatically without conflicts.
 * 
 * Properties:
 * - Commutative: merge(A,B) = merge(B,A)
 * - Associative: merge(merge(A,B),C) = merge(A,merge(B,C))
 * - Idempotent: merge(A,A) = A
 * - Convergent: all peers reach same state regardless of merge order
 */

import { VectorClock } from './VectorClock';
import { validateMessageContentLength } from '../messages/messageLimits';

export interface CRDTMessage {
  id: string;
  channelId: string;
  senderId: string;
  content: string;
  type: 'text' | 'file' | 'system';
  threadId?: string;
  vectorClock: Record<string, number>; // Serialized VectorClock
  wallTime: number; // Wall clock (for display, NOT for ordering)
  prevHash: string; // Hash chain integrity
}

/**
 * Grow-only Set CRDT for messages (G-Set)
 * Messages can only be added, never removed (immutable by design).
 */
export class MessageCRDT {
  private messages = new Map<string, CRDTMessage>(); // id → message
  private clock: VectorClock;
  private peerId: string;

  constructor(peerId: string) {
    this.peerId = peerId;
    this.clock = new VectorClock();
  }

  /** O(1) check whether a message ID is already known. */
  hasMessage(id: string): boolean {
    return this.messages.has(id);
  }

  /**
   * Create a new message (increments local clock)
   */
  createMessage(channelId: string, content: string, type: CRDTMessage['type'] = 'text', threadId?: string): CRDTMessage {
    validateMessageContentLength(content);
    this.clock = this.clock.increment(this.peerId);

    const msg: CRDTMessage = {
      id: `${this.peerId}-${this.clock.get(this.peerId)}`,
      channelId,
      senderId: this.peerId,
      content,
      type,
      threadId,
      vectorClock: this.clock.toJSON(),
      wallTime: Date.now(),
      prevHash: '', // Set by hash chain layer
    };

    this.messages.set(msg.id, msg);
    return msg;
  }

  /**
   * Add a received message (merges clock)
   */
  addMessage(msg: CRDTMessage): { added: boolean; duplicate: boolean } {
    validateMessageContentLength(msg.content);
    if (this.messages.has(msg.id)) {
      return { added: false, duplicate: true };
    }

    // Merge vector clock
    const remoteClock = VectorClock.fromJSON(msg.vectorClock);
    this.clock = this.clock.merge(remoteClock).increment(this.peerId);

    this.messages.set(msg.id, msg);
    return { added: true, duplicate: false };
  }

  /**
   * Merge with another peer's message set (CRDT merge)
   * Returns list of new messages that were added
   */
  merge(remoteMessages: CRDTMessage[]): CRDTMessage[] {
    const newMessages: CRDTMessage[] = [];

    for (const msg of remoteMessages) {
      if (!this.messages.has(msg.id)) {
        this.messages.set(msg.id, msg);
        newMessages.push(msg);

        // Merge clock
        const remoteClock = VectorClock.fromJSON(msg.vectorClock);
        this.clock = this.clock.merge(remoteClock);
      }
    }

    return newMessages;
  }

  /**
   * Evict the oldest messages for a channel, keeping only the most recent
   * `keepCount`.  Uses wallTime for ordering (same as display).
   * Returns the number of entries removed from the Map.
   */
  trimChannel(channelId: string, keepCount: number): number {
    const channelMsgs: CRDTMessage[] = [];
    for (const msg of this.messages.values()) {
      if (msg.channelId === channelId) channelMsgs.push(msg);
    }
    if (channelMsgs.length <= keepCount) return 0;
    // Sort newest-first by wallTime (ties broken by id for determinism).
    channelMsgs.sort((a, b) => b.wallTime - a.wallTime || b.id.localeCompare(a.id));
    // IDs to keep = first `keepCount` entries.
    const keepIds = new Set(channelMsgs.slice(0, keepCount).map(m => m.id));
    let removed = 0;
    for (const msg of channelMsgs) {
      if (!keepIds.has(msg.id)) {
        this.messages.delete(msg.id);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Get messages for a channel, sorted by causal order
   * Concurrent messages are sorted by (wallTime, senderId) as tiebreaker
   */
  getMessages(channelId: string): CRDTMessage[] {
    const channelMsgs = Array.from(this.messages.values())
      .filter(m => m.channelId === channelId);

    return this.sortCausal(channelMsgs);
  }

  /**
   * Get thread messages
   */
  getThread(channelId: string, threadId: string): CRDTMessage[] {
    return this.getMessages(channelId).filter(m => m.threadId === threadId);
  }

  /**
   * Get all messages (for sync)
   */
  getAllMessages(): CRDTMessage[] {
    return Array.from(this.messages.values());
  }

  /**
   * Get current vector clock
   */
  getClock(): VectorClock {
    return this.clock.clone();
  }

  /**
   * Get message count
   */
  get size(): number {
    return this.messages.size;
  }

  /**
   * Sort messages by causal order using vector clocks
   */
  private sortCausal(messages: CRDTMessage[]): CRDTMessage[] {
    return messages.sort((a, b) => {
      const clockA = VectorClock.fromJSON(a.vectorClock);
      const clockB = VectorClock.fromJSON(b.vectorClock);
      const relation = clockA.compare(clockB);

      if (relation === 'before') return -1;
      if (relation === 'after') return 1;

      // Concurrent: deterministic tiebreaker
      // 1. Wall time
      if (a.wallTime !== b.wallTime) return a.wallTime - b.wallTime;
      // 2. Sender ID (lexicographic)
      if (a.senderId !== b.senderId) return a.senderId.localeCompare(b.senderId);
      // 3. Message ID
      return a.id.localeCompare(b.id);
    });
  }
}
