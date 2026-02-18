/**
 * PresenceManager — Typing indicators + online presence
 * 
 * Ephemeral state — NOT stored, NOT in hash chain.
 * Sent as lightweight P2P signals.
 */

export interface PresenceState {
  peerId: string;
  typing: boolean;
  lastSeen: number;
  online: boolean;
}

export interface TypingEvent {
  type: 'typing';
  channelId: string;
  peerId: string;
  typing: boolean;
}

export interface ReadReceipt {
  type: 'read-receipt';
  channelId: string;
  messageId: string;
  peerId: string;
  timestamp: number;
}

/** Typing indicator timeout (stop showing after 5s of no update) */
const TYPING_TIMEOUT_MS = 5000;
/** How often to send typing updates */
const TYPING_THROTTLE_MS = 2000;

export class PresenceManager {
  /** Who's currently typing in each channel: channelId → peerId → expiry */
  private typingState = new Map<string, Map<string, number>>();
  /** Last time we sent a typing event */
  private lastTypingSent = 0;
  /** Read receipts: channelId → peerId → last read messageId */
  private readReceipts = new Map<string, Map<string, string>>();
  /** Callbacks */
  onTypingChanged?: (channelId: string, typingPeers: string[]) => void;
  onReadReceiptChanged?: (channelId: string, peerId: string, messageId: string) => void;
  /** Timer for cleanup */
  private cleanupInterval: any;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 1000);
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }

  /**
   * Handle incoming typing event from a peer
   */
  handleTypingEvent(event: TypingEvent): void {
    if (!this.typingState.has(event.channelId)) {
      this.typingState.set(event.channelId, new Map());
    }
    const channelTyping = this.typingState.get(event.channelId)!;

    if (event.typing) {
      channelTyping.set(event.peerId, Date.now() + TYPING_TIMEOUT_MS);
    } else {
      channelTyping.delete(event.peerId);
    }

    this.notifyTypingChanged(event.channelId);
  }

  /**
   * Handle incoming read receipt
   */
  handleReadReceipt(receipt: ReadReceipt): void {
    if (!this.readReceipts.has(receipt.channelId)) {
      this.readReceipts.set(receipt.channelId, new Map());
    }
    this.readReceipts.get(receipt.channelId)!.set(receipt.peerId, receipt.messageId);
    this.onReadReceiptChanged?.(receipt.channelId, receipt.peerId, receipt.messageId);
  }

  /**
   * Create a typing event to send to peers (throttled)
   */
  createTypingEvent(channelId: string, peerId: string): TypingEvent | null {
    const now = Date.now();
    if (now - this.lastTypingSent < TYPING_THROTTLE_MS) return null;
    this.lastTypingSent = now;
    return { type: 'typing', channelId, peerId, typing: true };
  }

  /**
   * Create a stop-typing event
   */
  createStopTypingEvent(channelId: string, peerId: string): TypingEvent {
    return { type: 'typing', channelId, peerId, typing: false };
  }

  /**
   * Create a read receipt
   */
  createReadReceipt(channelId: string, messageId: string, peerId: string): ReadReceipt {
    return { type: 'read-receipt', channelId, messageId, peerId, timestamp: Date.now() };
  }

  /**
   * Get currently typing peers for a channel
   */
  getTypingPeers(channelId: string): string[] {
    const channelTyping = this.typingState.get(channelId);
    if (!channelTyping) return [];

    const now = Date.now();
    const active: string[] = [];
    for (const [peerId, expiry] of channelTyping) {
      if (expiry > now) active.push(peerId);
    }
    return active;
  }

  /**
   * Get last read message for a peer in a channel
   */
  getLastRead(channelId: string, peerId: string): string | undefined {
    return this.readReceipts.get(channelId)?.get(peerId);
  }

  /**
   * Format typing indicator text
   */
  formatTypingText(typingPeers: string[], getAlias: (peerId: string) => string): string {
    if (typingPeers.length === 0) return '';
    if (typingPeers.length === 1) return `${getAlias(typingPeers[0])} is typing...`;
    if (typingPeers.length === 2) return `${getAlias(typingPeers[0])} and ${getAlias(typingPeers[1])} are typing...`;
    return `${typingPeers.length} people are typing...`;
  }

  // === Internal ===

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [channelId, channelTyping] of this.typingState) {
      let changed = false;
      for (const [peerId, expiry] of channelTyping) {
        if (expiry <= now) {
          channelTyping.delete(peerId);
          changed = true;
        }
      }
      if (changed) this.notifyTypingChanged(channelId);
    }
  }

  private notifyTypingChanged(channelId: string): void {
    const peers = this.getTypingPeers(channelId);
    this.onTypingChanged?.(channelId, peers);
  }
}
