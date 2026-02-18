/**
 * Storage types for messages, peers, and settings
 */

export interface StoredMessage {
  id: string;
  peerId: string;
  timestamp: number;
  type: 'text' | 'file' | 'system';
  content: string; // Encrypted or plain text
  encrypted: boolean;
  status: 'pending' | 'sent' | 'delivered' | 'failed';
  metadata?: {
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
  };
}

export interface StoredPeer {
  id: string;
  publicKey: string; // Base64 ECDH public key
  alias?: string;
  lastSeen: number;
  lastMessageId?: string;
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'auto';
  notifications: boolean;
  signalingServer?: string;
  myPeerId?: string;
}
