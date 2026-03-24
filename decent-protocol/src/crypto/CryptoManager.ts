/**
 * CryptoManager - Handles key generation, ECDH key exchange, and shared secret derivation
 */

import type { KeyPair, SerializedKeyPair } from './types';

export class CryptoManager {
  private keyPair: KeyPair | null = null;

  /**
   * Generate an ECDH key pair for key exchange
   */
  /**
   * Set an externally-loaded key pair (e.g. restored from KeyStore)
   */
  setKeyPair(keyPair: KeyPair): void {
    this.keyPair = keyPair;
  }

  async generateKeyPair(): Promise<KeyPair> {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'ECDH',
        namedCurve: 'P-256',
      },
      true, // extractable
      ['deriveKey', 'deriveBits']
    );

    this.keyPair = keyPair;
    return keyPair;
  }

  /**
   * Get current key pair (or generate if not exists)
   */
  async getKeyPair(): Promise<KeyPair> {
    if (!this.keyPair) {
      return await this.generateKeyPair();
    }
    return this.keyPair;
  }

  /**
   * Export public key to JWK format (for sharing)
   */
  async exportPublicKey(publicKey: CryptoKey): Promise<string> {
    const jwk = await crypto.subtle.exportKey('jwk', publicKey);
    return btoa(JSON.stringify(jwk));
  }

  /**
   * Import public key from JWK format
   */
  async importPublicKey(publicKeyBase64: string): Promise<CryptoKey> {
    const jwk = JSON.parse(atob(publicKeyBase64));
    return await crypto.subtle.importKey(
      'jwk',
      jwk,
      {
        name: 'ECDH',
        namedCurve: 'P-256',
      },
      true,
      []
    );
  }

  /**
   * Derive shared secret from our private key and peer's public key
   * Uses ECDH + HKDF to create AES-GCM key
   */
  async deriveSharedSecret(
    peerPublicKey: CryptoKey,
    privateKey?: CryptoKey,
    myPeerId?: string,
    theirPeerId?: string,
  ): Promise<CryptoKey> {
    const keyPair = await this.getKeyPair();
    const privKey = privateKey || keyPair.privateKey;

    // Derive raw bits using ECDH
    const sharedSecret = await crypto.subtle.deriveBits(
      {
        name: 'ECDH',
        public: peerPublicKey,
      },
      privKey,
      256
    );

    // Import as raw key for HKDF
    const importedSecret = await crypto.subtle.importKey(
      'raw',
      sharedSecret,
      'HKDF',
      false,
      ['deriveKey']
    );

    let salt: Uint8Array<ArrayBuffer>;
    if (myPeerId && theirPeerId) {
      const pair = [myPeerId, theirPeerId].sort().join(':');
      const hashedSalt = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(pair),
      );
      salt = new Uint8Array(hashedSalt);
    } else {
      // Backward compatibility for callers that don't pass peer IDs.
      salt = new TextEncoder().encode('decent-protocol-v1');
    }

    // Derive AES-GCM key from shared secret using HKDF
    return await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt,
        info: new TextEncoder().encode('p2p-chat-aes-gcm'),
      },
      importedSecret,
      {
        name: 'AES-GCM',
        length: 256,
      },
      false, // not extractable
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Derive an AES-GCM shared secret from pre-computed raw ECDH bytes.
   * This avoids a second deriveBits call when the raw bytes are already available
   * (e.g., from the ratchet handshake path which shares the same ECDH computation).
   */
  async deriveSharedSecretFromRawBytes(
    rawEcdhBytes: ArrayBuffer,
    myPeerId: string,
    theirPeerId: string,
  ): Promise<CryptoKey> {
    const importedSecret = await crypto.subtle.importKey(
      'raw',
      rawEcdhBytes,
      'HKDF',
      false,
      ['deriveKey']
    );

    const pair = [myPeerId, theirPeerId].sort().join(':');
    const hashedSalt = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(pair),
    );
    const salt = new Uint8Array(hashedSalt);

    return await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt,
        info: new TextEncoder().encode('p2p-chat-aes-gcm'),
      },
      importedSecret,
      {
        name: 'AES-GCM',
        length: 256,
      },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Generate signing key pair (ECDSA)
   */
  /** Import an ECDSA signing public key from Base64 JWK (for signature verification) */
  async importSigningPublicKey(publicKeyBase64: string): Promise<CryptoKey> {
    const jwk = JSON.parse(atob(publicKeyBase64));
    return await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify'],
    );
  }

  async generateSigningKeyPair(): Promise<KeyPair> {
    return await crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      true,
      ['sign', 'verify']
    ) as KeyPair;
  }

  /**
   * Serialize key pair to storable format
   */
  async serializeKeyPair(keyPair: KeyPair): Promise<SerializedKeyPair> {
    const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

    return {
      publicKey: btoa(JSON.stringify(publicJwk)),
      privateKey: btoa(JSON.stringify(privateJwk)),
    };
  }

  /**
   * Deserialize key pair from storage
   */
  async deserializeKeyPair(
    serialized: SerializedKeyPair,
    algorithm: 'ECDH' | 'ECDSA',
    _usages: KeyUsage[]
  ): Promise<KeyPair> {
    const publicJwk = JSON.parse(atob(serialized.publicKey));
    const privateJwk = JSON.parse(atob(serialized.privateKey));

    const alg = algorithm === 'ECDH' 
      ? { name: 'ECDH', namedCurve: 'P-256' }
      : { name: 'ECDSA', namedCurve: 'P-256' };

    const publicUsages = algorithm === 'ECDH' ? [] : ['verify'];
    const privateUsages = algorithm === 'ECDH' 
      ? ['deriveKey', 'deriveBits'] 
      : ['sign'];

    const publicKey = await crypto.subtle.importKey(
      'jwk',
      publicJwk,
      alg,
      true,
      publicUsages as any
    );

    const privateKey = await crypto.subtle.importKey(
      'jwk',
      privateJwk,
      alg,
      true,
      privateUsages as any
    );

    return { publicKey, privateKey };
  }
}
