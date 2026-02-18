/**
 * HashChain - Message integrity via cryptographic hash chain
 * 
 * Each message contains hash(prevMessage), forming an unbreakable chain.
 * Tampering with any message breaks the chain → detectable.
 */

export class HashChain {
  /**
   * Compute SHA-256 hash of a message's critical fields
   * This hash becomes `prevHash` in the next message
   */
  async hashMessage(message: HashableMessage): Promise<string> {
    const data = this.canonicalize(message);
    const encoder = new TextEncoder();
    const buffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    return this.bufferToHex(buffer);
  }

  /**
   * Verify that a message's prevHash matches the hash of the previous message
   */
  async verifyChain(prevMessage: HashableMessage, currentMessage: { prevHash: string }): Promise<boolean> {
    const expectedHash = await this.hashMessage(prevMessage);
    return currentMessage.prevHash === expectedHash;
  }

  /**
   * Verify an entire chain of messages
   * Returns { valid: true } or { valid: false, brokenAt: index, reason: string }
   */
  async verifyFullChain(messages: HashableMessage[]): Promise<ChainVerificationResult> {
    if (messages.length === 0) {
      return { valid: true };
    }

    // First message should have prevHash === GENESIS_HASH
    if (messages[0].prevHash !== GENESIS_HASH) {
      return {
        valid: false,
        brokenAt: 0,
        reason: `First message has invalid genesis hash. Expected ${GENESIS_HASH}, got ${messages[0].prevHash}`,
      };
    }

    // Verify each subsequent message links to the previous
    for (let i = 1; i < messages.length; i++) {
      const expectedHash = await this.hashMessage(messages[i - 1]);
      if (messages[i].prevHash !== expectedHash) {
        return {
          valid: false,
          brokenAt: i,
          reason: `Hash chain broken at message ${i}. Expected prevHash ${expectedHash}, got ${messages[i].prevHash}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Get the genesis hash (used for the first message in a channel)
   */
  getGenesisHash(): string {
    return GENESIS_HASH;
  }

  /**
   * Deterministic JSON serialization of message fields for hashing
   * Only includes fields that affect integrity (not status, metadata)
   */
  private canonicalize(message: HashableMessage): string {
    return JSON.stringify({
      id: message.id,
      channelId: message.channelId,
      senderId: message.senderId,
      timestamp: message.timestamp,
      content: message.content,
      type: message.type,
      prevHash: message.prevHash,
    });
  }

  private bufferToHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

// Genesis hash — the "zero block" of the hash chain
export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export interface HashableMessage {
  id: string;
  channelId: string;
  senderId: string;
  timestamp: number;
  content: string;
  type: string;
  prevHash: string;
}

export interface ChainVerificationResult {
  valid: boolean;
  brokenAt?: number;
  reason?: string;
}
