/**
 * Cryptographic types for E2E encryption
 */

export interface KeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export interface SerializedKeyPair {
  publicKey: string;  // Base64 JWK
  privateKey: string; // Base64 JWK
}

export interface EncryptedData {
  ciphertext: string; // Base64
  iv: string;         // Base64 initialization vector
  tag: string;        // Base64 authentication tag
}

export interface SignedMessage {
  data: string;       // Base64 data
  signature: string;  // Base64 ECDSA signature
}

export type KeyUsage = 'encryption' | 'signing';
