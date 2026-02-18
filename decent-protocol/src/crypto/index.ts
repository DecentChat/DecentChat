/**
 * Crypto module - End-to-end encryption primitives
 */

export { CryptoManager } from './CryptoManager';
export { MessageCipher } from './MessageCipher';
export { KeyStore } from './KeyStore';
export { HashChain, GENESIS_HASH } from './HashChain';
export { DoubleRatchet, serializeRatchetState, deserializeRatchetState } from './DoubleRatchet';
export type { RatchetState, RatchetHeader, RatchetMessage, SerializedRatchetState } from './DoubleRatchet';
export * from './types';
export type { HashableMessage, ChainVerificationResult } from './HashChain';
