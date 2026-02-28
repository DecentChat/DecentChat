/**
 * SeedPhrase — BIP39-style mnemonic seed for deterministic identity recovery
 * 
 * 12 words → 128 bits entropy → deterministic key derivation
 * Same seed always produces the same ECDH + ECDSA key pairs.
 * 
 * Flow:
 *   1. Generate 128 bits of entropy
 *   2. Convert to 12 mnemonic words (BIP39 wordlist)
 *   3. Derive master seed via PBKDF2 (seed phrase + "decent-protocol" salt)
 *   4. Derive ECDH key pair via HKDF (master seed + "ecdh" context)
 *   5. Derive ECDSA key pair via HKDF (master seed + "ecdsa" context)
 * 
 * Security: 128 bits = 2^128 possibilities = heat death of universe to brute force
 */

// BIP39 English wordlist (2048 words)
// Using a minimal curated list for portability — no external deps
import { WORDLIST } from './wordlist';
import { HDKeyDerivation } from './HDKeyDerivation';
import type { HDDerivedKeys } from './HDKeyDerivation';

export interface SeedPhraseResult {
  /** 12 mnemonic words */
  mnemonic: string;
  /** Raw entropy (hex) */
  entropy: string;
}

export interface DerivedKeys {
  ecdhKeyPair: CryptoKeyPair;
  ecdsaKeyPair: CryptoKeyPair;
  /** The master seed (for verification, not for storage) */
  masterSeed: ArrayBuffer;
}

export class SeedPhraseManager {

  /**
   * Generate a new 12-word seed phrase
   */
  generate(): SeedPhraseResult {
    // 128 bits of entropy = 12 words
    const entropy = crypto.getRandomValues(new Uint8Array(16));
    const mnemonic = this.entropyToMnemonic(entropy);

    return {
      mnemonic,
      entropy: Array.from(entropy).map(b => b.toString(16).padStart(2, '0')).join(''),
    };
  }

  /**
   * Validate a mnemonic phrase
   */
  validate(mnemonic: string): { valid: boolean; error?: string } {
    const words = mnemonic.trim().toLowerCase().split(/\s+/);

    if (words.length !== 12) {
      return { valid: false, error: `Expected 12 words, got ${words.length}` };
    }

    for (let i = 0; i < words.length; i++) {
      if (!WORDLIST.includes(words[i])) {
        return { valid: false, error: `Unknown word at position ${i + 1}: "${words[i]}"` };
      }
    }

    // Verify checksum
    try {
      const entropy = this.mnemonicToEntropy(mnemonic);
      const regenerated = this.entropyToMnemonic(entropy);
      if (regenerated !== words.join(' ')) {
        return { valid: false, error: 'Invalid checksum' };
      }
    } catch {
      return { valid: false, error: 'Invalid checksum' };
    }

    return { valid: true };
  }

  /**
   * Derive key pairs from a seed phrase
   * DETERMINISTIC: same phrase always produces same keys
   * 
   * Uses seed → PBKDF2 → master seed → HKDF → raw key bytes → PKCS#8 → CryptoKeyPair
   */
  async deriveKeys(mnemonic: string): Promise<DerivedKeys> {
    const validation = this.validate(mnemonic);
    if (!validation.valid) {
      throw new Error(`Invalid seed phrase: ${validation.error}`);
    }

    // Step 1: Derive master seed via PBKDF2
    const masterSeed = await this.deriveMasterSeed(mnemonic);

    // Step 2: Derive ECDH private key bytes via HKDF
    const ecdhRaw = new Uint8Array(await this.hkdfDerive(masterSeed, 'mesh-ecdh-key-v1', 32));

    // Step 3: Derive ECDSA private key bytes via HKDF
    const ecdsaRaw = new Uint8Array(await this.hkdfDerive(masterSeed, 'mesh-ecdsa-key-v1', 32));

    // Step 4: Ensure scalars are valid for P-256 (must be < curve order n)
    // P-256 order n = FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
    // For 32 random bytes from HKDF, the probability of being >= n is negligible (~2^-128)
    // But we clamp the top bit to be safe (still ~128 bits of entropy)
    ecdhRaw[0] &= 0x7F;
    ecdsaRaw[0] &= 0x7F;
    // Also ensure non-zero
    if (ecdhRaw.every(b => b === 0)) ecdhRaw[31] = 1;
    if (ecdsaRaw.every(b => b === 0)) ecdsaRaw[31] = 1;

    // Step 5: Import as P-256 key pairs via PKCS#8
    const ecdhKeyPair = await this.importP256PrivateKey(ecdhRaw, 'ECDH');
    const ecdsaKeyPair = await this.importP256PrivateKey(ecdsaRaw, 'ECDSA');

    return { ecdhKeyPair, ecdsaKeyPair, masterSeed };
  }

  /**
   * Derive key pairs for a SPECIFIC WORKSPACE (HD key derivation)
   * 
   * Like Bitcoin HD wallets: one seed → unique keys per workspace.
   * People in different workspaces can't link your identity.
   * 
   * Path: masterSeed → HKDF("decent-ecdh-key-v1/{index}") → unique ECDH keys
   *       masterSeed → HKDF("decent-ecdsa-key-v1/{index}") → unique ECDSA keys
   * 
   * Index 0 = default/root identity (same as deriveKeys() for backwards compatibility)
   * Index 1+ = workspace-specific identities
   * 
   * @param mnemonic - 12-word seed phrase
   * @param workspaceIndex - Workspace derivation index (0 = root, 1+ = workspace-specific)
   */
  async deriveWorkspaceKeys(mnemonic: string, workspaceIndex: number): Promise<DerivedKeys> {
    if (!Number.isInteger(workspaceIndex) || workspaceIndex < 0) {
      throw new Error('Workspace index must be a non-negative integer');
    }

    const validation = this.validate(mnemonic);
    if (!validation.valid) {
      throw new Error(`Invalid seed phrase: ${validation.error}`);
    }

    const masterSeed = await this.deriveMasterSeed(mnemonic);

    // Derive workspace-specific keys using index in HKDF context
    // Index 0 uses same context as deriveKeys() for backwards compatibility
    const ecdhContext = workspaceIndex === 0
      ? 'mesh-ecdh-key-v1'
      : `decent-ecdh-key-v1/${workspaceIndex}`;
    const ecdsaContext = workspaceIndex === 0
      ? 'mesh-ecdsa-key-v1'
      : `decent-ecdsa-key-v1/${workspaceIndex}`;

    const ecdhRaw = new Uint8Array(await this.hkdfDerive(masterSeed, ecdhContext, 32));
    const ecdsaRaw = new Uint8Array(await this.hkdfDerive(masterSeed, ecdsaContext, 32));

    ecdhRaw[0] &= 0x7F;
    ecdsaRaw[0] &= 0x7F;
    if (ecdhRaw.every(b => b === 0)) ecdhRaw[31] = 1;
    if (ecdsaRaw.every(b => b === 0)) ecdsaRaw[31] = 1;

    const ecdhKeyPair = await this.importP256PrivateKey(ecdhRaw, 'ECDH');
    const ecdsaKeyPair = await this.importP256PrivateKey(ecdsaRaw, 'ECDSA');

    return { ecdhKeyPair, ecdsaKeyPair, masterSeed };
  }

  /**
   * Derive keys for multiple workspaces at once
   * Returns a map of workspaceIndex → DerivedKeys
   */
  async deriveMultipleWorkspaceKeys(mnemonic: string, indices: number[]): Promise<Map<number, DerivedKeys>> {
    const result = new Map<number, DerivedKeys>();
    for (const index of indices) {
      result.set(index, await this.deriveWorkspaceKeys(mnemonic, index));
    }
    return result;
  }

  /**
   * Verify that a seed phrase produces the expected identity ID
   */
  async verifyPhrase(mnemonic: string, expectedIdentityId: string): Promise<boolean> {
    try {
      const keys = await this.deriveKeys(mnemonic);
      const pubKeyBytes = await crypto.subtle.exportKey('spki', keys.ecdhKeyPair.publicKey);
      const base64 = this.arrayBufferToBase64(pubKeyBytes);

      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(base64));
      const id = Array.from(new Uint8Array(hash).slice(0, 8))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      return id === expectedIdentityId;
    } catch {
      return false;
    }
  }

  /**
   * Derive a deterministic Peer ID from a seed phrase.
   *
   * Algorithm (DEP-003):
   *   seed phrase -> PBKDF2 -> HKDF(mesh-ecdh-key-v1) -> ECDH P-256 key
   *   -> export public key as SPKI -> SHA-256 -> first 9 bytes -> hex (18 chars)
   */
  async derivePeerId(seedPhrase: string): Promise<string> {
    const { peerId } = await this.deriveAll(seedPhrase);
    return peerId;
  }

  /**
   * Derive both the peer ID and full key material in a single PBKDF2 call.
   * Use this when you need both (e.g., startup — peer ID + at-rest encryption key).
   * Avoids running PBKDF2 twice.
   */
  async deriveAll(seedPhrase: string): Promise<{ peerId: string; keys: DerivedKeys }> {
    const keys = await this.deriveKeys(seedPhrase);
    const spki = await crypto.subtle.exportKey('spki', keys.ecdhKeyPair.publicKey);
    const hash = await crypto.subtle.digest('SHA-256', spki);
    const peerId = Array.from(new Uint8Array(hash).slice(0, 9))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return { peerId, keys };
  }

  // === HD Key Derivation ===

  private hd = new HDKeyDerivation();

  /**
   * Derive the HD master key from a mnemonic.
   * This is the root of the HD tree — all purpose-specific keys derive from it.
   */
  async deriveHDMasterKey(mnemonic: string): Promise<ArrayBuffer> {
    const validation = this.validate(mnemonic);
    if (!validation.valid) {
      throw new Error(`Invalid seed phrase: ${validation.error}`);
    }
    const seed = this.mnemonicToEntropy(mnemonic);
    return this.hd.deriveMasterKey(seed);
  }

  /**
   * Derive identity key pair from mnemonic.
   * Path: m/0'/identity/<index>
   */
  async deriveHDIdentityKey(mnemonic: string, index: number = 0): Promise<HDDerivedKeys> {
    const masterKey = await this.deriveHDMasterKey(mnemonic);
    return this.hd.deriveIdentityKey(masterKey, index);
  }

  /**
   * Derive workspace-specific key pair from mnemonic.
   * Path: m/1'/workspace/<index>
   */
  async deriveHDWorkspaceKey(mnemonic: string, workspaceIndex: number): Promise<HDDerivedKeys> {
    const masterKey = await this.deriveHDMasterKey(mnemonic);
    return this.hd.deriveWorkspaceKey(masterKey, workspaceIndex);
  }

  /**
   * Derive contact-specific DM key pair from mnemonic.
   * Path: m/2'/contact/<index>
   */
  async deriveHDContactKey(mnemonic: string, contactIndex: number): Promise<HDDerivedKeys> {
    const masterKey = await this.deriveHDMasterKey(mnemonic);
    return this.hd.deriveContactKey(masterKey, contactIndex);
  }

  /**
   * Derive device-specific key pair from mnemonic.
   * Path: m/3'/device/<index>
   */
  async deriveHDDeviceKey(mnemonic: string, deviceIndex: number): Promise<HDDerivedKeys> {
    const masterKey = await this.deriveHDMasterKey(mnemonic);
    return this.hd.deriveDeviceKey(masterKey, deviceIndex);
  }

  // === Multi-Device Derivation ===

  /**
   * Derive the canonical identityId from a seed phrase.
   * Uses the HD identity key at m/0'/identity/0 — stable across all devices.
   *
   * identityId = SHA-256(base64(SPKI(identityECDH.publicKey)))[0:8].hex() → 16 hex chars
   */
  async deriveIdentityId(mnemonic: string): Promise<string> {
    const identityKeys = await this.deriveHDIdentityKey(mnemonic, 0);
    const spki = await crypto.subtle.exportKey('spki', identityKeys.ecdhKeyPair.publicKey);
    const base64 = this.arrayBufferToBase64(spki);
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(base64));
    return Array.from(new Uint8Array(hash).slice(0, 8))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Derive a device-specific peerId from a seed phrase and device index.
   * Uses the HD device key at m/3'/device/<deviceIndex>.
   *
   * peerId = SHA-256(SPKI(deviceECDH.publicKey))[0:9].hex() → 18 hex chars
   *
   * Each device gets a unique peerId; all share the same identityId.
   */
  async deriveDevicePeerId(mnemonic: string, deviceIndex: number): Promise<string> {
    if (!Number.isInteger(deviceIndex) || deviceIndex < 0) {
      throw new Error('Device index must be a non-negative integer');
    }
    const deviceKeys = await this.deriveHDDeviceKey(mnemonic, deviceIndex);
    const spki = await crypto.subtle.exportKey('spki', deviceKeys.ecdhKeyPair.publicKey);
    const hash = await crypto.subtle.digest('SHA-256', spki);
    return Array.from(new Uint8Array(hash).slice(0, 9))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Derive full key material for a specific device: peerId, identityId, and both key sets.
   * Convenience method combining deriveDevicePeerId + deriveIdentityId + key pairs.
   */
  async deriveDeviceKeys(mnemonic: string, deviceIndex: number): Promise<{
    peerId: string;
    identityId: string;
    deviceKeys: HDDerivedKeys;
    identityKeys: HDDerivedKeys;
  }> {
    if (!Number.isInteger(deviceIndex) || deviceIndex < 0) {
      throw new Error('Device index must be a non-negative integer');
    }
    const masterKey = await this.deriveHDMasterKey(mnemonic);

    // Identity keys: m/0'/identity/0 — same for all devices
    const identityKeys = await this.hd.deriveIdentityKey(masterKey, 0);
    // Device keys: m/3'/device/<deviceIndex> — unique per device
    const deviceKeys = await this.hd.deriveDeviceKey(masterKey, deviceIndex);

    // identityId from identity ECDH public key
    const identitySpki = await crypto.subtle.exportKey('spki', identityKeys.ecdhKeyPair.publicKey);
    const identityBase64 = this.arrayBufferToBase64(identitySpki);
    const identityHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identityBase64));
    const identityId = Array.from(new Uint8Array(identityHash).slice(0, 8))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // peerId from device ECDH public key
    const deviceSpki = await crypto.subtle.exportKey('spki', deviceKeys.ecdhKeyPair.publicKey);
    const deviceHash = await crypto.subtle.digest('SHA-256', deviceSpki);
    const peerId = Array.from(new Uint8Array(deviceHash).slice(0, 9))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return { peerId, identityId, deviceKeys, identityKeys };
  }

  // === Internal: Mnemonic ↔ Entropy ===

  private entropyToMnemonic(entropy: Uint8Array): string {
    // Add checksum: first 4 bits of SHA-256(entropy)
    const hash = this.checksumSync(entropy);
    const checksumBits = hash[0] >> 4; // First 4 bits

    // Convert entropy to bit string
    let bits = '';
    for (const byte of entropy) {
      bits += byte.toString(2).padStart(8, '0');
    }
    bits += checksumBits.toString(2).padStart(4, '0'); // 128 + 4 = 132 bits

    // Split into 12 groups of 11 bits → word indices
    const words: string[] = [];
    for (let i = 0; i < 132; i += 11) {
      const index = parseInt(bits.slice(i, i + 11), 2);
      words.push(WORDLIST[index]);
    }

    return words.join(' ');
  }

  private mnemonicToEntropy(mnemonic: string): Uint8Array {
    const words = mnemonic.trim().toLowerCase().split(/\s+/);

    // Words → bit string
    let bits = '';
    for (const word of words) {
      const index = WORDLIST.indexOf(word);
      if (index === -1) throw new Error(`Unknown word: ${word}`);
      bits += index.toString(2).padStart(11, '0');
    }

    // First 128 bits = entropy, last 4 = checksum
    const entropyBits = bits.slice(0, 128);
    const entropy = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      entropy[i] = parseInt(entropyBits.slice(i * 8, i * 8 + 8), 2);
    }

    return entropy;
  }

  // FNV-1a based checksum (synchronous, for mnemonic checksum only — not security-critical)
  private checksumSync(data: Uint8Array): Uint8Array {
    let hash = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      hash ^= data[i];
      hash = Math.imul(hash, 0x01000193);
    }
    // Expand to bytes
    const result = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      hash = Math.imul(hash, 0x01000193) ^ i;
      result[i] = hash & 0xff;
    }
    return result;
  }

  // === Internal: Key Derivation ===

  private async deriveMasterSeed(mnemonic: string): Promise<ArrayBuffer> {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(mnemonic),
      'PBKDF2',
      false,
      ['deriveBits']
    );

    return crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: new TextEncoder().encode('decent-protocol-seed-v1'),
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      512 // 64 bytes master seed
    );
  }

  private async hkdfDerive(masterSeed: ArrayBuffer, info: string, length: number): Promise<ArrayBuffer> {
    const key = await crypto.subtle.importKey(
      'raw',
      masterSeed,
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
   * Import a 32-byte private key scalar as a P-256 key pair.
   * Builds a minimal PKCS#8 structure (without public key component).
   * Web Crypto will compute the public point from the private scalar.
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

    // Extract public key from private key via JWK roundtrip
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

  /**
   * Build a valid PKCS#8 DER encoding for a P-256 private key
   * Matches the exact format produced by Web Crypto's exportKey('pkcs8')
   * but without the optional public key component (which Web Crypto can recompute)
   */
  private buildP256Pkcs8(d: Uint8Array): ArrayBuffer {
    // Build ECPrivateKey (RFC 5915):
    // SEQUENCE { INTEGER 1, OCTET STRING <d>, [0] OID P-256 }
    // The [0] parameters field is optional per RFC 5915 but Safari WebCrypto
    // requires it — Chrome is lenient, Safari/iOS is not.
    const ecVersion = new Uint8Array([0x02, 0x01, 0x01]);
    const dOctet = this.derOctetString(d);
    // P-256 OID: 1.2.840.10045.3.1.7
    const p256OidValue = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);
    // [0] EXPLICIT context tag wrapping the OID
    const params0 = new Uint8Array([0xa0, p256OidValue.length, ...p256OidValue]);
    const ecPrivKey = this.derSequence([ecVersion, dOctet, params0]);

    // AlgorithmIdentifier: SEQUENCE { OID ecPublicKey, OID P-256 }
    const ecPubOid = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
    const p256Oid = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);
    const algId = this.derSequence([ecPubOid, p256Oid]);

    // PrivateKeyInfo: SEQUENCE { INTEGER 0, AlgorithmIdentifier, OCTET STRING ECPrivateKey }
    const version = new Uint8Array([0x02, 0x01, 0x00]);
    const privKeyOctet = this.derOctetString(ecPrivKey);

    return this.derSequence([version, algId, privKeyOctet]).buffer as ArrayBuffer;
  }

  private derSequence(items: Uint8Array[]): Uint8Array {
    const totalLen = items.reduce((acc, item) => acc + item.length, 0);
    const lenBytes = this.encodeDerLength(totalLen);
    const result = new Uint8Array(1 + lenBytes.length + totalLen);
    result[0] = 0x30; // SEQUENCE tag
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
    result[0] = 0x04; // OCTET STRING tag
    result.set(lenBytes, 1);
    result.set(data, 1 + lenBytes.length);
    return result;
  }

  private encodeDerLength(length: number): Uint8Array {
    if (length < 128) return new Uint8Array([length]);
    if (length < 256) return new Uint8Array([0x81, length]);
    return new Uint8Array([0x82, (length >> 8) & 0xff, length & 0xff]);
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
