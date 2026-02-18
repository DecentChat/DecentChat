/**
 * MessageProtocol - Handles message encryption/decryption and protocol format
 *
 * Uses DoubleRatchet (Signal-style) for forward secrecy.
 * Falls back to legacy MessageCipher for peers that haven't upgraded.
 */

import {
  CryptoManager,
  MessageCipher,
  DoubleRatchet,
  serializeRatchetState,
  deserializeRatchetState,
} from 'decent-protocol';
import type {
  KeyPair,
  RatchetState,
  RatchetMessage,
  SerializedRatchetState,
} from 'decent-protocol';

/** Wire format for ratchet-encrypted messages */
export interface RatchetEnvelope {
  id: string;
  timestamp: number;
  sender: string;
  type: 'text' | 'file' | 'system' | 'handshake';
  /** Ratchet-encrypted payload */
  ratchet: RatchetMessage;
  /** ECDSA signature over plaintext */
  signature: string;
  /** Protocol version: 2 = DoubleRatchet */
  protocolVersion: 2;
  metadata?: {
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
  };
}

/** Legacy wire format (v1: static shared secret) */
export interface LegacyEnvelope {
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
  protocolVersion?: 1 | undefined;
  metadata?: {
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
  };
}

export type MessageEnvelope = RatchetEnvelope | LegacyEnvelope;

export interface HandshakeData {
  publicKey: string;  // Base64 ECDH public key (identity key)
  peerId: string;
  /** Bob's ratchet DH public key (raw, base64) for initializing Alice's ratchet */
  ratchetDHPublicKey?: string;
  protocolVersion?: number;
}

/** Persistence interface for ratchet state */
export interface RatchetPersistence {
  save(peerId: string, state: SerializedRatchetState): Promise<void>;
  load(peerId: string): Promise<SerializedRatchetState | null>;
  delete(peerId: string): Promise<void>;
}

export class MessageProtocol {
  private cryptoManager: CryptoManager;
  private cipher: MessageCipher;
  private myPeerId: string;
  private _signingKeyPair: KeyPair | null = null;

  /** Per-peer ratchet state (active sessions) */
  private ratchetStates = new Map<string, RatchetState>();

  /** Pre-generated ratchet DH key pair (used as Bob in handshake) */
  private ratchetDHKeyPair: CryptoKeyPair | null = null;

  /** Legacy shared secrets (fallback for old peers) */
  private sharedSecrets = new Map<string, CryptoKey>();

  /** Persistence backend (optional) */
  private persistence: RatchetPersistence | null = null;

  constructor(cryptoManager: CryptoManager, myPeerId: string) {
    this.cryptoManager = cryptoManager;
    this.cipher = new MessageCipher();
    this.myPeerId = myPeerId;
  }

  async init(signingKeyPair: KeyPair): Promise<void> {
    this._signingKeyPair = signingKeyPair;
    // Pre-generate a DH key pair for ratchet init (Bob's role)
    this.ratchetDHKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    );
  }

  setPersistence(persistence: RatchetPersistence): void {
    this.persistence = persistence;
  }

  async createHandshake(): Promise<HandshakeData> {
    const keyPair = await this.cryptoManager.getKeyPair();
    const publicKey = await this.cryptoManager.exportPublicKey(keyPair.publicKey);

    // Export our ratchet DH public key so the other side can init as Alice
    if (!this.ratchetDHKeyPair) {
      this.ratchetDHKeyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits'],
      );
    }
    const ratchetPubRaw = await crypto.subtle.exportKey('raw', this.ratchetDHKeyPair.publicKey);
    const ratchetDHPublicKey = arrayBufferToBase64(ratchetPubRaw);

    return {
      publicKey,
      peerId: this.myPeerId,
      ratchetDHPublicKey,
      protocolVersion: 2,
    };
  }

  async processHandshake(peerId: string, handshake: HandshakeData): Promise<void> {
    const peerPublicKey = await this.cryptoManager.importPublicKey(handshake.publicKey);

    // Always derive a legacy shared secret for fallback
    const sharedSecret = await this.cryptoManager.deriveSharedSecret(peerPublicKey);
    this.sharedSecrets.set(peerId, sharedSecret);

    // If peer supports ratchet protocol
    if (handshake.protocolVersion === 2 && handshake.ratchetDHPublicKey) {
      // Check if we already have ratchet state (persisted or in-memory)
      if (this.ratchetStates.has(peerId)) return;

      // Try restoring from persistence
      if (this.persistence) {
        const saved = await this.persistence.load(peerId);
        if (saved) {
          try {
            this.ratchetStates.set(peerId, await deserializeRatchetState(saved));
            return;
          } catch (e) {
            console.warn(`[Ratchet] Failed to restore state for ${peerId.slice(0, 8)}, re-initializing:`, e);
          }
        }
      }

      // Determine role: lower peerId is Alice (initiator)
      const isAlice = this.myPeerId < peerId;

      // Derive initial shared secret (raw ECDH bytes for ratchet root key)
      const myKeyPair = await this.cryptoManager.getKeyPair();
      const initialSecret = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: peerPublicKey },
        myKeyPair.privateKey,
        256,
      );

      // Import peer's ratchet DH public key
      const peerRatchetDH = await crypto.subtle.importKey(
        'raw',
        base64ToArrayBuffer(handshake.ratchetDHPublicKey),
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        [],
      );

      let state: RatchetState;
      if (isAlice) {
        state = await DoubleRatchet.initAlice(initialSecret, peerRatchetDH);
      } else {
        state = await DoubleRatchet.initBob(initialSecret, this.ratchetDHKeyPair!);
        // Generate a fresh DH key pair for the next handshake
        this.ratchetDHKeyPair = await crypto.subtle.generateKey(
          { name: 'ECDH', namedCurve: 'P-256' },
          true,
          ['deriveBits'],
        );
      }

      this.ratchetStates.set(peerId, state);
      await this.persistState(peerId);
    }
  }

  async encryptMessage(
    peerId: string,
    content: string,
    type: 'text' | 'file' | 'system' | 'handshake' = 'text',
    metadata?: { fileName?: string; fileSize?: number; mimeType?: string }
  ): Promise<MessageEnvelope> {
    if (!this._signingKeyPair) throw new Error('Signing key pair not initialized');
    const signature = await this.cipher.sign(content, this._signingKeyPair.privateKey);

    // Try DoubleRatchet first
    const ratchetState = this.ratchetStates.get(peerId);
    if (ratchetState && ratchetState.sendChainKey !== null) {
      const ratchetMsg = await DoubleRatchet.encrypt(ratchetState, content);
      await this.persistState(peerId);

      return {
        id: this.generateMessageId(),
        timestamp: Date.now(),
        sender: this.myPeerId,
        type,
        ratchet: ratchetMsg,
        signature,
        protocolVersion: 2,
        metadata,
      };
    }

    // Fallback to legacy (Bob before first ratchet message, or old peers)
    return this.encryptLegacy(peerId, content, type, signature, metadata);
  }

  private async encryptLegacy(
    peerId: string,
    content: string,
    type: 'text' | 'file' | 'system' | 'handshake',
    signature: string,
    metadata?: { fileName?: string; fileSize?: number; mimeType?: string },
  ): Promise<LegacyEnvelope> {
    const sharedSecret = this.sharedSecrets.get(peerId);
    if (!sharedSecret) throw new Error(`No shared secret for peer: ${peerId}`);

    const encrypted = await this.cipher.encrypt(content, sharedSecret);

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
    envelope: MessageEnvelope | any,
    peerPublicKey: CryptoKey
  ): Promise<string | null> {
    try {
      // Detect protocol version
      if (envelope.protocolVersion === 2 && envelope.ratchet) {
        return await this.decryptRatchet(peerId, envelope as RatchetEnvelope, peerPublicKey);
      }

      // Legacy path
      return await this.decryptLegacy(peerId, envelope as LegacyEnvelope, peerPublicKey);
    } catch (e) {
      // If ratchet decrypt fails, try legacy as final fallback
      if (envelope.encrypted) {
        try {
          return await this.decryptLegacy(peerId, envelope as any, peerPublicKey);
        } catch {}
      }
      console.error(`[Ratchet] Decrypt failed for ${peerId.slice(0, 8)}:`, e);
      return null;
    }
  }

  private async decryptRatchet(
    peerId: string,
    envelope: RatchetEnvelope,
    peerPublicKey: CryptoKey,
  ): Promise<string | null> {
    const state = this.ratchetStates.get(peerId);
    if (!state) {
      throw new Error(`No ratchet state for peer: ${peerId}`);
    }

    const content = await DoubleRatchet.decrypt(state, envelope.ratchet);
    await this.persistState(peerId);

    // Verify signature
    const isValid = await this.cipher.verify(content, envelope.signature, peerPublicKey);
    if (!isValid) return null;

    return content;
  }

  private async decryptLegacy(
    peerId: string,
    envelope: LegacyEnvelope,
    peerPublicKey: CryptoKey,
  ): Promise<string | null> {
    const sharedSecret = this.sharedSecrets.get(peerId);
    if (!sharedSecret) throw new Error(`No shared secret for peer: ${peerId}`);

    const content = await this.cipher.decrypt(envelope.encrypted, sharedSecret);

    const isValid = await this.cipher.verify(content, envelope.signature, peerPublicKey);
    if (!isValid) return null;

    return content;
  }

  hasSharedSecret(peerId: string): boolean {
    return this.ratchetStates.has(peerId) || this.sharedSecrets.has(peerId);
  }

  hasRatchetState(peerId: string): boolean {
    return this.ratchetStates.has(peerId);
  }

  clearSharedSecret(peerId: string): void {
    this.sharedSecrets.delete(peerId);
    // Keep ratchet state — it survives reconnections
  }

  async clearRatchetState(peerId: string): Promise<void> {
    this.ratchetStates.delete(peerId);
    if (this.persistence) {
      await this.persistence.delete(peerId);
    }
  }

  clearAllSecrets(): void {
    this.sharedSecrets.clear();
  }

  /** Restore ratchet state from persistence for a peer */
  async restoreRatchetState(peerId: string): Promise<boolean> {
    if (!this.persistence) return false;
    const saved = await this.persistence.load(peerId);
    if (!saved) return false;

    try {
      this.ratchetStates.set(peerId, await deserializeRatchetState(saved));
      return true;
    } catch (e) {
      console.warn(`[Ratchet] Failed to restore state for ${peerId.slice(0, 8)}:`, e);
      return false;
    }
  }

  /** Persist the ratchet state for a peer */
  private async persistState(peerId: string): Promise<void> {
    if (!this.persistence) return;
    const state = this.ratchetStates.get(peerId);
    if (!state) return;

    try {
      const serialized = await serializeRatchetState(state);
      await this.persistence.save(peerId, serialized);
    } catch (e) {
      console.warn(`[Ratchet] Failed to persist state for ${peerId.slice(0, 8)}:`, e);
    }
  }

  private generateMessageId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ── Base64 Utilities ──────────────────────────────────────────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
