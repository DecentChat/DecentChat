/**
 * HDKeyDerivation — Hierarchical Deterministic key derivation for DecentChat
 *
 * One 12-word BIP39 seed → unlimited deterministic key pairs, organized by purpose.
 *
 * Derivation tree (BIP32-style paths using HMAC-SHA512 + HKDF):
 *
 *   seed (12 words)
 *     └─ master key (PBKDF2)
 *         ├─ m/0'/identity/<index>   → main identity ECDH + ECDSA key pairs
 *         ├─ m/1'/workspace/<index>  → per-workspace key pairs
 *         ├─ m/2'/contact/<index>    → per-contact DM key pairs
 *         └─ m/3'/device/<index>     → per-device keys (future multi-device)
 *
 * All derivation uses Web Crypto API (HKDF with HMAC-SHA512 chain).
 * Each derived key is a valid P-256 (secp256r1) key pair for ECDH/ECDSA.
 */

/** Purposes in the HD tree */
export enum HDPurpose {
  Identity = 0,
  Workspace = 1,
  Contact = 2,
  Device = 3,
}

export interface HDDerivedKeys {
  ecdhKeyPair: CryptoKeyPair;
  ecdsaKeyPair: CryptoKeyPair;
  /** The derivation path that produced these keys */
  path: string;
}

export class HDKeyDerivation {

  /**
   * Derive the master key from a BIP39 seed (raw entropy bytes or mnemonic-derived seed).
   * Uses PBKDF2 with a domain-separated salt to produce a 64-byte master key.
   */
  async deriveMasterKey(seed: Uint8Array): Promise<ArrayBuffer> {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      seed.buffer as ArrayBuffer,
      'PBKDF2',
      false,
      ['deriveBits']
    );

    return crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: new TextEncoder().encode('decent-hd-master-v1'),
        iterations: 100000,
        hash: 'SHA-512',
      },
      keyMaterial,
      512 // 64 bytes
    );
  }

  /**
   * Derive identity key pair at the given index.
   * Path: m/0'/identity/<index>
   *
   * Index 0 = primary identity. Higher indices for identity rotation.
   */
  async deriveIdentityKey(masterKey: ArrayBuffer, index: number = 0): Promise<HDDerivedKeys> {
    this.validateIndex(index);
    const path = `m/0'/identity/${index}`;
    return this.deriveKeyPairAtPath(masterKey, HDPurpose.Identity, index, path);
  }

  /**
   * Derive workspace-specific key pair.
   * Path: m/1'/workspace/<index>
   *
   * Each workspace gets a unique key pair — observers can't link
   * your identities across workspaces without the master key.
   */
  async deriveWorkspaceKey(masterKey: ArrayBuffer, workspaceIndex: number): Promise<HDDerivedKeys> {
    this.validateIndex(workspaceIndex);
    const path = `m/1'/workspace/${workspaceIndex}`;
    return this.deriveKeyPairAtPath(masterKey, HDPurpose.Workspace, workspaceIndex, path);
  }

  /**
   * Derive contact-specific DM key pair.
   * Path: m/2'/contact/<index>
   *
   * Each contact relationship gets unique keys for forward secrecy isolation.
   */
  async deriveContactKey(masterKey: ArrayBuffer, contactIndex: number): Promise<HDDerivedKeys> {
    this.validateIndex(contactIndex);
    const path = `m/2'/contact/${contactIndex}`;
    return this.deriveKeyPairAtPath(masterKey, HDPurpose.Contact, contactIndex, path);
  }

  /**
   * Derive device-specific key pair (for multi-device support).
   * Path: m/3'/device/<index>
   *
   * Each device gets unique keys; the master key links them all.
   */
  async deriveDeviceKey(masterKey: ArrayBuffer, deviceIndex: number): Promise<HDDerivedKeys> {
    this.validateIndex(deviceIndex);
    const path = `m/3'/device/${deviceIndex}`;
    return this.deriveKeyPairAtPath(masterKey, HDPurpose.Device, deviceIndex, path);
  }

  // === Internal derivation ===

  /**
   * Core derivation: masterKey + purpose + index → ECDH + ECDSA key pairs.
   *
   * Chain: masterKey → HMAC-SHA512(purpose) → intermediate key → HKDF(index, "ecdh"/"ecdsa") → raw scalar → P-256 key
   */
  private async deriveKeyPairAtPath(
    masterKey: ArrayBuffer,
    purpose: HDPurpose,
    index: number,
    path: string
  ): Promise<HDDerivedKeys> {
    // Step 1: Derive purpose-level intermediate key via HMAC-SHA512
    const intermediateKey = await this.deriveIntermediate(masterKey, purpose);

    // Step 2: Derive ECDH private key bytes
    const ecdhRaw = new Uint8Array(
      await this.hkdfDerive(intermediateKey, `decent-hd-ecdh/${index}`, 32)
    );

    // Step 3: Derive ECDSA private key bytes
    const ecdsaRaw = new Uint8Array(
      await this.hkdfDerive(intermediateKey, `decent-hd-ecdsa/${index}`, 32)
    );

    // Step 4: Clamp scalars for P-256 validity
    this.clampScalar(ecdhRaw);
    this.clampScalar(ecdsaRaw);

    // Step 5: Import as P-256 key pairs
    const ecdhKeyPair = await this.importP256PrivateKey(ecdhRaw, 'ECDH');
    const ecdsaKeyPair = await this.importP256PrivateKey(ecdsaRaw, 'ECDSA');

    return { ecdhKeyPair, ecdsaKeyPair, path };
  }

  /**
   * Derive a purpose-level intermediate key using HMAC-SHA512.
   * This creates domain separation between different key purposes.
   */
  private async deriveIntermediate(masterKey: ArrayBuffer, purpose: HDPurpose): Promise<ArrayBuffer> {
    const hmacKey = await crypto.subtle.importKey(
      'raw',
      masterKey,
      { name: 'HMAC', hash: 'SHA-512' },
      false,
      ['sign']
    );

    // HMAC-SHA512(masterKey, "decent-hd-purpose/<purpose>")
    const data = new TextEncoder().encode(`decent-hd-purpose/${purpose}`);
    return crypto.subtle.sign('HMAC', hmacKey, data);
  }

  /**
   * HKDF derivation: intermediate key + info string → derived bytes.
   */
  private async hkdfDerive(ikm: ArrayBuffer, info: string, length: number): Promise<ArrayBuffer> {
    const key = await crypto.subtle.importKey(
      'raw',
      ikm,
      'HKDF',
      false,
      ['deriveBits']
    );

    return crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(0),
        info: new TextEncoder().encode(info),
      },
      key,
      length * 8
    );
  }

  /**
   * Clamp a 32-byte scalar for P-256 validity.
   * Clear the top bit to ensure value < curve order n.
   * Ensure non-zero.
   */
  private clampScalar(scalar: Uint8Array): void {
    scalar[0] &= 0x7F;
    if (scalar.every(b => b === 0)) scalar[31] = 1;
  }

  /**
   * Import a 32-byte private key scalar as a P-256 key pair.
   * Builds PKCS#8 DER, imports via Web Crypto, extracts public key via JWK roundtrip.
   */
  private async importP256PrivateKey(privateKeyBytes: Uint8Array, algorithm: 'ECDH' | 'ECDSA'): Promise<CryptoKeyPair> {
    const pkcs8 = this.buildP256Pkcs8(privateKeyBytes);

    const usages: KeyUsage[] = algorithm === 'ECDH'
      ? ['deriveKey', 'deriveBits']
      : ['sign'];

    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: algorithm, namedCurve: 'P-256' },
      true,
      usages
    );

    // Extract public key via JWK roundtrip
    const jwk = await crypto.subtle.exportKey('jwk', privateKey);
    const pubJwk: JsonWebKey = {
      kty: jwk.kty,
      crv: jwk.crv,
      x: jwk.x,
      y: jwk.y,
      key_ops: algorithm === 'ECDH' ? [] : ['verify'],
      ext: true,
    };

    const publicKey = await crypto.subtle.importKey(
      'jwk',
      pubJwk,
      { name: algorithm, namedCurve: 'P-256' },
      true,
      algorithm === 'ECDH' ? [] : ['verify']
    );

    return { privateKey, publicKey };
  }

  private validateIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error('Derivation index must be a non-negative integer');
    }
  }

  // === DER encoding helpers ===

  private buildP256Pkcs8(d: Uint8Array): ArrayBuffer {
    const ecVersion = new Uint8Array([0x02, 0x01, 0x01]);
    const dOctet = this.derOctetString(d);
    const ecPrivKey = this.derSequence([ecVersion, dOctet]);

    const ecPubOid = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
    const p256Oid = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);
    const algId = this.derSequence([ecPubOid, p256Oid]);

    const version = new Uint8Array([0x02, 0x01, 0x00]);
    const privKeyOctet = this.derOctetString(ecPrivKey);

    return this.derSequence([version, algId, privKeyOctet]).buffer as ArrayBuffer;
  }

  private derSequence(items: Uint8Array[]): Uint8Array {
    const totalLen = items.reduce((acc, item) => acc + item.length, 0);
    const lenBytes = this.encodeDerLength(totalLen);
    const result = new Uint8Array(1 + lenBytes.length + totalLen);
    result[0] = 0x30;
    result.set(lenBytes, 1);
    let offset = 1 + lenBytes.length;
    for (const item of items) {
      result.set(item, offset);
      offset += item.length;
    }
    return result;
  }

  private derOctetString(data: Uint8Array): Uint8Array {
    const lenBytes = this.encodeDerLength(data.length);
    const result = new Uint8Array(1 + lenBytes.length + data.length);
    result[0] = 0x04;
    result.set(lenBytes, 1);
    result.set(data, 1 + lenBytes.length);
    return result;
  }

  private encodeDerLength(length: number): Uint8Array {
    if (length < 128) return new Uint8Array([length]);
    if (length < 256) return new Uint8Array([0x81, length]);
    return new Uint8Array([0x82, (length >> 8) & 0xff, length & 0xff]);
  }
}
