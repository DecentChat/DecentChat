/**
 * Message types for the P2P chat protocol
 */

export interface AssistantMessageMetadata {
  /** Full selected model id when available (e.g. openai-codex/gpt-5.3-codex). */
  modelId?: string;
  /** Provider-free model name (e.g. gpt-5.3-codex). */
  modelName?: string;
  /** Alias used by the caller/config when available (e.g. codex). */
  modelAlias?: string;
  /** Final display label for UI badges. */
  modelLabel?: string;
}

export interface MessageMetadata {
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  assistant?: AssistantMessageMetadata;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  senderId: string;
  /** Canonical identity of the sender (stable across devices). Falls back to senderId for old messages. */
  senderIdentityId?: string;
  timestamp: number;
  content: string;
  type: 'text' | 'file' | 'system';
  threadId?: string;        // Parent message ID if reply in thread
  prevHash: string;         // Hash of previous message in channel (integrity chain)
  encrypted: {
    ciphertext: string;
    iv: string;
    tag: string;
  };
  status: 'pending' | 'sent' | 'delivered' | 'read';
  recipientPeerIds?: string[];
  ackedBy?: string[];
  ackedAt?: Record<string, number>;
  readBy?: string[];
  readAt?: Record<string, number>;
  metadata?: MessageMetadata;
}

/**
 * Plaintext version before encryption (for local storage)
 */
export interface PlaintextMessage {
  id: string;
  channelId: string;
  senderId: string;
  /** Canonical identity of the sender (stable across devices). Falls back to senderId for old messages. */
  senderIdentityId?: string;
  timestamp: number;
  content: string;
  type: 'text' | 'file' | 'system';
  threadId?: string;
  prevHash: string;
  status: 'pending' | 'sent' | 'delivered' | 'read';
  recipientPeerIds?: string[];
  ackedBy?: string[];
  ackedAt?: Record<string, number>;
  readBy?: string[];
  readAt?: Record<string, number>;
  vectorClock?: Record<string, number>;
  metadata?: MessageMetadata;
}
