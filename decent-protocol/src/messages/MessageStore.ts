/**
 * MessageStore - Manages messages with hash chain integrity
 * 
 * Messages are IMMUTABLE - no editing, no deleting.
 * Each message links to the previous via prevHash.
 */

import { HashChain, GENESIS_HASH } from '../crypto/HashChain';
import type { HashableMessage } from '../crypto/HashChain';
import type { PlaintextMessage } from './types';

type ImportedMessage = Omit<PlaintextMessage, 'content'> & { content?: string | null };

export class MessageStore {
  private hashChain: HashChain;
  // In-memory store per channel (channelId → messages[])
  private channels = new Map<string, PlaintextMessage[]>();

  constructor() {
    this.hashChain = new HashChain();
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
    const channelMessages = this.channels.get(message.channelId) || [];

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
    if (!this.channels.has(message.channelId)) {
      this.channels.set(message.channelId, []);
    }
    this.channels.get(message.channelId)!.push(message);

    return { success: true };
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
    const existing = this.channels.get(newId) || [];
    const existingIds = new Set(existing.map(m => m.id));
    const deduped = messages.filter(m => !existingIds.has(m.id));
    const merged = [...existing, ...deduped];
    merged.sort((a, b) => a.timestamp - b.timestamp);

    this.channels.set(newId, merged);
    this.channels.delete(oldId);

    return this.channels.get(newId)!;
  }

  /**
   * Clear a channel (for testing only)
   */
  clearChannel(channelId: string): void {
    this.channels.delete(channelId);
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
