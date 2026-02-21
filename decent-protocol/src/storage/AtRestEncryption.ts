/**
 * AtRestEncryption — AES-GCM-256 encryption for IndexedDB message content.
 *
 * Derives an encryption key from the user's master seed via HKDF-SHA-256.
 * Only the message `content` field is encrypted; metadata (channelId, timestamp,
 * senderId) stays plaintext for IndexedDB indexing.
 *
 * Format: `enc:v1:<base64url-iv>:<base64url-ciphertext>`
 * Legacy (unencrypted) data is detected by the absence of the prefix and returned as-is.
 */

const ENC_PREFIX = 'enc:v1:';
const HKDF_INFO = new TextEncoder().encode('decent-at-rest-v1');
const IV_LENGTH = 12; // AES-GCM standard

export class AtRestEncryption {
  private key: CryptoKey | null = null;

  /** True once the encryption key has been derived and is ready to use */
  get ready(): boolean {
    return this.key !== null;
  }

  /**
   * Derive the at-rest encryption key from the identity master seed.
   * Call once after restoring the seed phrase.
   *
   * @param masterSeed — raw bytes from SeedPhrase.deriveKeys().masterSeed
   */
  async init(masterSeed: ArrayBuffer): Promise<void> {
    const hkdfKey = await crypto.subtle.importKey(
      'raw', masterSeed, 'HKDF', false, ['deriveKey'],
    );

    this.key = await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(32), // zero salt (masterSeed already has high entropy)
        info: HKDF_INFO,
      },
      hkdfKey,
      { name: 'AES-GCM', length: 256 },
      false,          // non-extractable
      ['encrypt', 'decrypt'],
    );
  }

  /**
   * Encrypt a plaintext string.
   * Returns an `enc:v1:…` tagged string for storage.
   * Returns the original string unchanged if the key is not ready.
   */
  async encrypt(plaintext: string): Promise<string> {
    if (!this.key) return plaintext;

    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.key,
      encoded,
    );

    // Use Array.from + join instead of spread (...) to avoid call-stack overflow
    // on large messages (spread pushes every byte onto the stack).
    const toBase64 = (buf: Uint8Array) =>
      btoa(Array.from(buf).map(b => String.fromCharCode(b)).join(''));

    return ENC_PREFIX + toBase64(iv) + ':' + toBase64(new Uint8Array(ciphertext));
  }

  /**
   * Decrypt a stored value.
   * Detects the `enc:v1:` prefix. Returns the value as-is if it's not encrypted
   * (backward compat with existing unencrypted data).
   */
  async decrypt(stored: string): Promise<string> {
    if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy plaintext

    if (!this.key) {
      // Key not available — return placeholder rather than crashing
      console.warn('[AtRestEncryption] Encrypted message but no key available');
      return '[encrypted — unlock required]';
    }

    try {
      const parts = stored.slice(ENC_PREFIX.length).split(':');
      if (parts.length !== 2) throw new Error('malformed');

      const iv = Uint8Array.from(atob(parts[0]), c => c.charCodeAt(0));
      const ciphertext = Uint8Array.from(atob(parts[1]), c => c.charCodeAt(0));

      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        this.key,
        ciphertext,
      );

      return new TextDecoder().decode(plaintext);
    } catch {
      return '[decryption failed]';
    }
  }

  /** Check whether a stored value is encrypted */
  static isEncrypted(stored: string): boolean {
    return stored.startsWith(ENC_PREFIX);
  }

  /** Clear the in-memory key (call on app lock / idle timeout) */
  clear(): void {
    this.key = null;
  }
}
