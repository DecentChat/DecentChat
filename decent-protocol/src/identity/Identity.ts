/**
 * Identity — Portable cryptographic identity for DecentChat
 * 
 * Your identity = your key pair. No servers, no sign-up.
 * Export/import via encrypted bundles (passphrase-protected).
 * Multi-device via device groups (linked identities).
 */

export interface DecentIdentity {
  /** Unique identity ID (hash of public key) */
  identityId: string;
  /** Human-readable display name */
  displayName: string;
  /** ECDH public key (base64 SPKI) */
  publicKey: string;
  /** ECDSA signing public key (base64 SPKI) */
  signingKey: string;
  /** Creation timestamp */
  createdAt: number;
  /** Device group: linked device IDs (for multi-device) */
  deviceGroup: string[];
  /** This device's unique ID within the group */
  deviceId: string;
  /** Device label (e.g. "MacBook", "iPhone") */
  deviceLabel: string;
}

export interface IdentityBundle {
  /** Version for forward compatibility */
  version: 1;
  /** Identity metadata */
  identity: DecentIdentity;
  /** Encrypted private keys (AES-GCM, passphrase-derived key via PBKDF2) */
  encryptedKeys: {
    ciphertext: string; // base64
    iv: string;         // base64
    salt: string;       // base64 (PBKDF2 salt)
    iterations: number; // PBKDF2 iterations
  };
}

export interface DeviceLinkChallenge {
  /** The identity being linked to */
  identityId: string;
  /** One-time challenge nonce */
  nonce: string;
  /** Timestamp (expires after 5 minutes) */
  timestamp: number;
  /** The new device's temporary public key for key exchange */
  tempPublicKey: string;
}

/** Safety number: visual fingerprint of a peer relationship */
export interface SafetyNumber {
  /** 60-digit number (like Signal) split into 12 groups of 5 */
  numeric: string;
  /** Formatted: "12345 67890 12345 67890 12345 67890\n12345 67890 12345 67890 12345 67890" */
  formatted: string;
  /** QR-encodable compact form */
  qrData: string;
}

export class IdentityManager {
  
  /**
   * Create a new identity from key pairs
   */
  async createIdentity(
    displayName: string,
    publicKey: CryptoKey,
    signingKey: CryptoKey,
    deviceLabel: string = 'Primary'
  ): Promise<DecentIdentity> {
    const pubKeyBase64 = await this.exportKeyBase64(publicKey);
    const sigKeyBase64 = await this.exportKeyBase64(signingKey);
    const identityId = await this.computeIdentityId(pubKeyBase64);
    const deviceId = await this.generateDeviceId();

    return {
      identityId,
      displayName,
      publicKey: pubKeyBase64,
      signingKey: sigKeyBase64,
      createdAt: Date.now(),
      deviceGroup: [deviceId],
      deviceId,
      deviceLabel,
    };
  }

  /**
   * Export identity as an encrypted bundle (passphrase-protected)
   * Can be serialized to JSON, QR code, or file
   */
  async exportIdentity(
    identity: DecentIdentity,
    ecdhPrivateKey: CryptoKey,
    ecdsaPrivateKey: CryptoKey,
    passphrase: string
  ): Promise<IdentityBundle> {
    // Export private keys
    const ecdhPriv = await crypto.subtle.exportKey('pkcs8', ecdhPrivateKey);
    const ecdsaPriv = await crypto.subtle.exportKey('pkcs8', ecdsaPrivateKey);

    const privateKeys = JSON.stringify({
      ecdh: this.arrayBufferToBase64(ecdhPriv),
      ecdsa: this.arrayBufferToBase64(ecdsaPriv),
    });

    // Derive encryption key from passphrase
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iterations = 100000;
    const derivedKey = await this.deriveKeyFromPassphrase(passphrase, salt, iterations);

    // Encrypt private keys
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      derivedKey,
      new TextEncoder().encode(privateKeys)
    );

    return {
      version: 1,
      identity,
      encryptedKeys: {
        ciphertext: this.arrayBufferToBase64(encrypted),
        iv: this.arrayBufferToBase64(iv),
        salt: this.arrayBufferToBase64(salt),
        iterations,
      },
    };
  }

  /**
   * Import identity from an encrypted bundle
   * Returns the identity + decrypted key pairs
   */
  async importIdentity(
    bundle: IdentityBundle,
    passphrase: string
  ): Promise<{
    identity: DecentIdentity;
    ecdhKeyPair: { publicKey: CryptoKey; privateKey: CryptoKey };
    ecdsaKeyPair: { publicKey: CryptoKey; privateKey: CryptoKey };
  }> {
    // Derive key from passphrase
    const salt = this.base64ToArrayBuffer(bundle.encryptedKeys.salt);
    const derivedKey = await this.deriveKeyFromPassphrase(
      passphrase,
      new Uint8Array(salt),
      bundle.encryptedKeys.iterations
    );

    // Decrypt private keys
    const iv = this.base64ToArrayBuffer(bundle.encryptedKeys.iv);
    const ciphertext = this.base64ToArrayBuffer(bundle.encryptedKeys.ciphertext);

    let decrypted: ArrayBuffer;
    try {
      decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        derivedKey,
        ciphertext
      );
    } catch {
      throw new Error('Invalid passphrase');
    }

    const privateKeys = JSON.parse(new TextDecoder().decode(decrypted));

    // Import ECDH keys
    const ecdhPrivateKey = await crypto.subtle.importKey(
      'pkcs8',
      this.base64ToArrayBuffer(privateKeys.ecdh),
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey', 'deriveBits']
    );
    const ecdhPublicKey = await crypto.subtle.importKey(
      'spki',
      this.base64ToArrayBuffer(bundle.identity.publicKey),
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      []
    );

    // Import ECDSA keys
    const ecdsaPrivateKey = await crypto.subtle.importKey(
      'pkcs8',
      this.base64ToArrayBuffer(privateKeys.ecdsa),
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign']
    );
    const ecdsaPublicKey = await crypto.subtle.importKey(
      'spki',
      this.base64ToArrayBuffer(bundle.identity.signingKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify']
    );

    return {
      identity: bundle.identity,
      ecdhKeyPair: { publicKey: ecdhPublicKey, privateKey: ecdhPrivateKey },
      ecdsaKeyPair: { publicKey: ecdsaPublicKey, privateKey: ecdsaPrivateKey },
    };
  }

  /**
   * Generate a safety number for a peer relationship (like Signal)
   * Based on both parties' public keys
   */
  async generateSafetyNumber(myPublicKey: string, peerPublicKey: string): Promise<SafetyNumber> {
    // Sort keys to ensure same result on both sides
    const [first, second] = [myPublicKey, peerPublicKey].sort();
    
    // Hash both keys together
    const combined = first + second;
    const hash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(combined)
    );

    // Convert to 60-digit number
    const bytes = new Uint8Array(hash);
    let numeric = '';
    for (let i = 0; i < 30; i++) {
      numeric += (bytes[i % bytes.length] * 100 + bytes[(i + 16) % bytes.length]).toString().padStart(3, '0').slice(-2);
    }
    // Pad to exactly 60 digits
    while (numeric.length < 60) numeric += '0';
    numeric = numeric.slice(0, 60);

    // Format into 12 groups of 5
    const groups: string[] = [];
    for (let i = 0; i < 60; i += 5) {
      groups.push(numeric.slice(i, i + 5));
    }

    const formatted = groups.slice(0, 6).join(' ') + '\n' + groups.slice(6).join(' ');

    return {
      numeric,
      formatted,
      qrData: `mesh-safety:${numeric}`,
    };
  }

  /**
   * Compute identity ID from public key (SHA-256 hash, first 16 hex chars)
   */
  async computeIdentityId(publicKeyBase64: string): Promise<string> {
    const hash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(publicKeyBase64)
    );
    const bytes = new Uint8Array(hash);
    return Array.from(bytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Create a device link challenge (for QR code scanning)
   */
  async createDeviceLinkChallenge(
    identityId: string,
    tempPublicKey: CryptoKey
  ): Promise<DeviceLinkChallenge> {
    const pubKeyBase64 = await this.exportKeyBase64(tempPublicKey);
    const nonce = this.arrayBufferToBase64(crypto.getRandomValues(new Uint8Array(32)));

    return {
      identityId,
      nonce,
      timestamp: Date.now(),
      tempPublicKey: pubKeyBase64,
    };
  }

  /**
   * Validate a device link challenge (not expired, valid format)
   */
  validateDeviceLinkChallenge(challenge: DeviceLinkChallenge): { valid: boolean; error?: string } {
    const fiveMinutes = 5 * 60 * 1000;
    if (Date.now() - challenge.timestamp > fiveMinutes) {
      return { valid: false, error: 'Challenge expired (>5 minutes)' };
    }
    if (!challenge.identityId || !challenge.nonce || !challenge.tempPublicKey) {
      return { valid: false, error: 'Invalid challenge format' };
    }
    return { valid: true };
  }

  /**
   * Add a device to the identity's device group
   */
  addDevice(identity: DecentIdentity, deviceId: string, _deviceLabel: string): DecentIdentity {
    return {
      ...identity,
      deviceGroup: [...identity.deviceGroup, deviceId],
    };
  }

  /**
   * Remove a device from the identity's device group
   */
  removeDevice(identity: DecentIdentity, deviceId: string): DecentIdentity {
    return {
      ...identity,
      deviceGroup: identity.deviceGroup.filter(d => d !== deviceId),
    };
  }

  /**
   * Generate QR code data for identity sharing or device linking
   */
  generateQRData(identity: DecentIdentity): string {
    return JSON.stringify({
      type: 'mesh-identity',
      id: identity.identityId,
      name: identity.displayName,
      publicKey: identity.publicKey,
      signingKey: identity.signingKey,
    });
  }

  /**
   * Generate QR code data for device linking (includes encrypted private keys)
   */
  async generateDeviceLinkQR(bundle: IdentityBundle): Promise<string> {
    return JSON.stringify({
      type: 'mesh-device-link',
      bundle,
    });
  }

  // === Helpers ===

  private async deriveKeyFromPassphrase(
    passphrase: string,
    salt: Uint8Array,
    iterations: number
  ): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  private async exportKeyBase64(key: CryptoKey): Promise<string> {
    const exported = await crypto.subtle.exportKey('spki', key);
    return this.arrayBufferToBase64(exported);
  }

  private async generateDeviceId(): Promise<string> {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private arrayBufferToBase64(buffer: ArrayBuffer | ArrayBufferView): string {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer as ArrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
