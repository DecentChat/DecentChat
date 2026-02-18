/**
 * MessageProtocol - Handles message encryption/decryption and protocol format
 *
 * Client-specific: wraps decent-protocol crypto primitives with the
 * PeerJS message envelope format.
 */

import { CryptoManager, MessageCipher } from 'decent-protocol';
import type { KeyPair } from 'decent-protocol';

export interface MessageEnvelope {
  id: string;
  timestamp: number;
  sender: string;
  type: 'text' | 'file' | 'system' | 'handshake';
  encrypted: {
    ciphertext: string;
    iv: string;
    tag: string;
  };
  signature: string;
  metadata?: {
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
  };
}

export interface HandshakeData {
  publicKey: string; // Base64 ECDH public key
  peerId: string;
}

export class MessageProtocol {
  private cryptoManager: CryptoManager;
  private cipher: MessageCipher;
  private myPeerId: string;
  private _signingKeyPair: KeyPair | null = null;

  // Cache of shared secrets per peer
  private sharedSecrets = new Map<string, CryptoKey>();

  constructor(cryptoManager: CryptoManager, myPeerId: string) {
    this.cryptoManager = cryptoManager;
    this.cipher = new MessageCipher();
    this.myPeerId = myPeerId;
  }

  async init(signingKeyPair: KeyPair): Promise<void> {
    this._signingKeyPair = signingKeyPair;
  }

  async createHandshake(): Promise<HandshakeData> {
    const keyPair = await this.cryptoManager.getKeyPair();
    const publicKey = await this.cryptoManager.exportPublicKey(keyPair.publicKey);
    return { publicKey, peerId: this.myPeerId };
  }

  async processHandshake(peerId: string, handshake: HandshakeData): Promise<void> {
    const peerPublicKey = await this.cryptoManager.importPublicKey(handshake.publicKey);
    const sharedSecret = await this.cryptoManager.deriveSharedSecret(peerPublicKey);
    this.sharedSecrets.set(peerId, sharedSecret);
  }

  async encryptMessage(
    peerId: string,
    content: string,
    type: MessageEnvelope['type'] = 'text',
    metadata?: MessageEnvelope['metadata']
  ): Promise<MessageEnvelope> {
    const sharedSecret = this.sharedSecrets.get(peerId);
    if (!sharedSecret) throw new Error(`No shared secret for peer: ${peerId}`);

    const encrypted = await this.cipher.encrypt(content, sharedSecret);

    if (!this._signingKeyPair) throw new Error('Signing key pair not initialized');
    const signature = await this.cipher.sign(content, this._signingKeyPair.privateKey);

    return {
      id: this.generateMessageId(),
      timestamp: Date.now(),
      sender: this.myPeerId,
      type,
      encrypted,
      signature,
      metadata,
    };
  }

  async decryptMessage(
    peerId: string,
    envelope: MessageEnvelope,
    peerPublicKey: CryptoKey
  ): Promise<string | null> {
    const sharedSecret = this.sharedSecrets.get(peerId);
    if (!sharedSecret) throw new Error(`No shared secret for peer: ${peerId}`);

    try {
      const content = await this.cipher.decrypt(envelope.encrypted, sharedSecret);

      // Verify signature using peer's signing public key
      const isValid = await this.cipher.verify(content, envelope.signature, peerPublicKey);
      if (!isValid) return null;

      return content;
    } catch {
      return null;
    }
  }

  hasSharedSecret(peerId: string): boolean {
    return this.sharedSecrets.has(peerId);
  }

  clearSharedSecret(peerId: string): void {
    this.sharedSecrets.delete(peerId);
  }

  clearAllSecrets(): void {
    this.sharedSecrets.clear();
  }

  private generateMessageId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
