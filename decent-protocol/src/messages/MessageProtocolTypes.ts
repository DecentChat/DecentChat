import type { MessageMetadata } from './types';
import type { RatchetMessage, SerializedRatchetState } from '../crypto/DoubleRatchet';
import type { PreKeyBundle, PersistedLocalPreKeyState, PreKeySessionInitPayload } from './PreKeyTypes';

export type EnvelopeMetadata = MessageMetadata;

/** Wire format for ratchet-encrypted messages. */
export interface RatchetEnvelope {
  id: string;
  timestamp: number;
  sender: string;
  type: 'text' | 'file' | 'system' | 'handshake';
  ratchet: RatchetMessage;
  signature: string;
  protocolVersion: 2;
  metadata?: EnvelopeMetadata;
}

/** Wire format for pre-key session-init messages. */
export interface PreKeySessionEnvelope {
  id: string;
  timestamp: number;
  sender: string;
  type: 'text' | 'file' | 'system' | 'handshake';
  ratchet: RatchetMessage;
  signature: string;
  protocolVersion: 3;
  sessionInit: PreKeySessionInitPayload;
  metadata?: EnvelopeMetadata;
}

/** Legacy wire format (v1: static shared secret). */
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
  metadata?: EnvelopeMetadata;
}

export type MessageEnvelope = RatchetEnvelope | PreKeySessionEnvelope | LegacyEnvelope;

export interface HandshakeData {
  /** Base64 ECDH public key (identity key, for ratchet key exchange). */
  publicKey: string;
  peerId: string;
  /** Bob's ratchet DH public key (raw, base64) for initializing Alice's ratchet. */
  ratchetDHPublicKey?: string;
  protocolVersion?: number;
  /** Base64 ECDSA signing public key (for message signature verification). */
  signingPublicKey?: string;
  /** Advertise support for pre-key bundle based bootstrap. */
  preKeySupport?: boolean;
}

/** Persistence interface for ratchet + pre-key state. */
export interface RatchetPersistence {
  save(peerId: string, state: SerializedRatchetState): Promise<void>;
  load(peerId: string): Promise<SerializedRatchetState | null>;
  delete(peerId: string): Promise<void>;
  savePreKeyBundle?(peerId: string, bundle: PreKeyBundle): Promise<void>;
  loadPreKeyBundle?(peerId: string): Promise<PreKeyBundle | null>;
  deletePreKeyBundle?(peerId: string): Promise<void>;
  saveLocalPreKeyState?(ownerPeerId: string, state: PersistedLocalPreKeyState): Promise<void>;
  loadLocalPreKeyState?(ownerPeerId: string): Promise<PersistedLocalPreKeyState | null>;
  deleteLocalPreKeyState?(ownerPeerId: string): Promise<void>;
}
