/**
 * Message types for the P2P chat protocol
 */

export interface ChatMessage {
  id: string;
  channelId: string;
  senderId: string;
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
  metadata?: {
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
  };
}

/**
 * Plaintext version before encryption (for local storage)
 */
export interface PlaintextMessage {
  id: string;
  channelId: string;
  senderId: string;
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
  metadata?: {
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
  };
}
