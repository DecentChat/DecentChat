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
  PRE_KEY_BUNDLE_VERSION,
  DEFAULT_PRE_KEY_LIFECYCLE_POLICY,
  decideSignedPreKeyLifecycle,
  planLocalOneTimePreKeyLifecycle,
  normalizePeerPreKeyBundle as normalizePeerPreKeyBundlePolicy,
  hasPeerPreKeyBundleChanged,
} from '@decentchat/protocol';
import type {
  KeyPair,
  RatchetState,
  PreKeyBundle,
  PersistedLocalPreKeyState,
  PreKeyType,
  EnvelopeMetadata,
  RatchetEnvelope,
  PreKeySessionEnvelope,
  LegacyEnvelope,
  MessageEnvelope,
  HandshakeData,
  RatchetPersistence,
} from '@decentchat/protocol';
export type {
  EnvelopeMetadata,
  RatchetEnvelope,
  PreKeySessionEnvelope,
  LegacyEnvelope,
  MessageEnvelope,
  HandshakeData,
  RatchetPersistence,
};

interface LocalPreKeyRuntimeRecord {
  keyId: number;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  createdAt: number;
}

interface LocalSignedPreKeyRuntimeRecord extends LocalPreKeyRuntimeRecord {
  signature: string;
  expiresAt: number;
}

const PRE_KEY_POLICY = DEFAULT_PRE_KEY_LIFECYCLE_POLICY;

export class NodeMessageProtocol {
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

  /** Per-peer ECDSA signing public keys (for message signature verification) */
  private signingPublicKeys = new Map<string, CryptoKey>();

  /** Cached peer pre-key bundles (public only) */
  private peerPreKeyBundles = new Map<string, PreKeyBundle>();

  /** Local signed pre-key + one-time pre-keys (includes private key material) */
  private localSignedPreKey: LocalSignedPreKeyRuntimeRecord | null = null;
  private localOneTimePreKeys = new Map<number, LocalPreKeyRuntimeRecord>();
  private localPreKeyBundleCache: PreKeyBundle | null = null;
  private nextOneTimePreKeyId = 1;

  /** Persistence backend (optional) */
  private persistence: RatchetPersistence | null = null;
  private preKeyReady: Promise<void> | null = null;
  private localPreKeyMutation: Promise<void> = Promise.resolve();

  /** Get a peer's ECDSA signing public key (for auth verification) */
  getSigningPublicKey(peerId: string): CryptoKey | undefined {
    return this.signingPublicKeys.get(peerId);
  }

  async signData(data: string): Promise<string> {
    if (!this._signingKeyPair) {
      throw new Error('MessageProtocol not initialized with signing keys');
    }
    return this.cipher.sign(data, this._signingKeyPair.privateKey);
  }

  async verifyData(data: string, signature: string, peerId: string): Promise<boolean> {
    const signingKey = this.signingPublicKeys.get(peerId);
    if (!signingKey) return false;
    return this.cipher.verify(data, signature, signingKey);
  }

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
    await this.ensureLocalPreKeyMaterial();
  }

  setPersistence(persistence: RatchetPersistence): void {
    this.persistence = persistence;
    // If init already generated local pre-keys before persistence was wired,
    // persist them now so restarts can consume one-time keys correctly.
    void this.persistLocalPreKeyState();
  }

  private async runWithLocalPreKeyMutation<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.localPreKeyMutation.catch(() => undefined).then(operation);
    this.localPreKeyMutation = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  async createHandshake(): Promise<HandshakeData> {
    const keyPair = await this.cryptoManager.getKeyPair();
    const publicKey = await this.cryptoManager.exportPublicKey(keyPair.publicKey);

    let ratchetDHPublicKey: string | undefined;
    if (this.ratchetDHKeyPair) {
      const ratchetPubRaw = await crypto.subtle.exportKey('raw', this.ratchetDHKeyPair.publicKey);
      ratchetDHPublicKey = arrayBufferToBase64(ratchetPubRaw);
    }

    let signingPublicKey: string | undefined;
    if (this._signingKeyPair) {
      signingPublicKey = await this.cryptoManager.exportPublicKey(this._signingKeyPair.publicKey);
    }

    return {
      publicKey,
      peerId: this.myPeerId,
      ratchetDHPublicKey,
      protocolVersion: 2,
      signingPublicKey,
      preKeySupport: true,
    };
  }

  async processHandshake(peerId: string, handshake: HandshakeData): Promise<void> {
    const peerPublicKey = await this.cryptoManager.importPublicKey(handshake.publicKey);

    // Store peer's ECDSA signing public key for message signature verification
    if (handshake.signingPublicKey) {
      try {
        const signingKey = await this.cryptoManager.importSigningPublicKey(handshake.signingPublicKey);
        this.signingPublicKeys.set(peerId, signingKey);
      } catch (e) {
        console.warn(`[MessageProtocol] Failed to import signing key for ${peerId.slice(0, 8)}:`, e);
      }
    }

    // Always derive a legacy shared secret for fallback
    const sharedSecret = await this.cryptoManager.deriveSharedSecret(
      peerPublicKey,
      undefined,
      this.myPeerId,
      peerId,
    );
    this.sharedSecrets.set(peerId, sharedSecret);

    // If the handshake is flagged as recovery, force-clear any existing state
    // for this peer so the new ratchet replaces the desynced one. Without this,
    // a stale ratchet on either side causes permanent decrypt failures.
    if ((handshake as any).recovery === true) {
      console.log(`[MessageProtocol] Recovery handshake from ${peerId.slice(0, 8)} — clearing local ratchet state`);
      this.ratchetStates.delete(peerId);
      this.sharedSecrets.delete(peerId);
      if (this.persistence) {
        try { await this.persistence.delete(peerId); } catch {}
      }
    }

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

  async createPreKeyBundle(): Promise<PreKeyBundle> {
    await this.ensureLocalPreKeyMaterial();
    return this.runWithLocalPreKeyMutation(async () => {
      const changed = await this.applyLocalPreKeyLifecyclePolicy();
      if (changed) {
        await this.persistLocalPreKeyState();
      }
      if (!changed && this.localPreKeyBundleCache) {
        return structuredClone(this.localPreKeyBundleCache);
      }

      const bundle = await this.snapshotLocalPreKeyBundle();
      this.localPreKeyBundleCache = bundle;
      return structuredClone(bundle);
    });
  }

  async storePeerPreKeyBundle(peerId: string, bundle: PreKeyBundle): Promise<boolean> {
    const sanitized = await this.sanitizeAndVerifyPeerPreKeyBundle(peerId, bundle);
    if (!sanitized) return false;

    this.peerPreKeyBundles.set(peerId, sanitized);
    await this.persistPeerPreKeyBundle(peerId, sanitized);
    return true;
  }

  async getPeerPreKeyBundle(peerId: string): Promise<PreKeyBundle | null> {
    const cached = this.peerPreKeyBundles.get(peerId);
    if (cached) {
      const normalized = this.normalizePeerPreKeyBundle(cached);
      if (!normalized) {
        await this.clearPeerPreKeyBundle(peerId);
        return null;
      }

      if (this.hasPeerBundleChanged(cached, normalized)) {
        this.peerPreKeyBundles.set(peerId, normalized);
        await this.persistPeerPreKeyBundle(peerId, normalized);
      }

      return normalized;
    }

    if (!this.persistence?.loadPreKeyBundle) return null;

    try {
      const loaded = await this.persistence.loadPreKeyBundle(peerId);
      if (!loaded) return null;

      const sanitized = await this.sanitizeAndVerifyPeerPreKeyBundle(peerId, loaded);
      if (!sanitized) {
        if (this.persistence?.deletePreKeyBundle) {
          try {
            await this.persistence.deletePreKeyBundle(peerId);
          } catch (deleteError) {
            console.warn(`[PreKey] Failed to delete stale peer bundle for ${peerId.slice(0, 8)}:`, deleteError);
          }
        }
        return null;
      }

      this.peerPreKeyBundles.set(peerId, sanitized);
      if (this.hasPeerBundleChanged(loaded, sanitized)) {
        await this.persistPeerPreKeyBundle(peerId, sanitized);
      }
      return sanitized;
    } catch (e) {
      console.warn(`[PreKey] Failed to load peer bundle for ${peerId.slice(0, 8)}:`, e);
      return null;
    }
  }

  async clearPeerPreKeyBundle(peerId: string): Promise<void> {
    this.peerPreKeyBundles.delete(peerId);
    if (!this.persistence?.deletePreKeyBundle) return;
    try {
      await this.persistence.deletePreKeyBundle(peerId);
    } catch (e) {
      console.warn(`[PreKey] Failed to delete peer bundle for ${peerId.slice(0, 8)}:`, e);
    }
  }

  async encryptMessage(
    peerId: string,
    content: string,
    type: 'text' | 'file' | 'system' | 'handshake' = 'text',
    metadata?: EnvelopeMetadata,
  ): Promise<MessageEnvelope> {
    const signature = this._signingKeyPair
      ? await this.cipher.sign(content, this._signingKeyPair.privateKey)
      : '';

    // Prefer ratchet when the sending chain is ready.
    // Bob-side handshake states start with sendChainKey = null until the first receive.
    const state = this.ratchetStates.get(peerId);
    if (state?.sendChainKey) {
      const ratchet = await DoubleRatchet.encrypt(state, content);
      await this.persistState(peerId);
      return {
        id: this.generateMessageId(),
        timestamp: Date.now(),
        sender: this.myPeerId,
        type,
        ratchet,
        signature,
        protocolVersion: 2,
        metadata,
      };
    }

    // Fallback: legacy static shared secret
    const sharedSecret = this.sharedSecrets.get(peerId);
    if (sharedSecret) {
      const encrypted = await this.cipher.encrypt(content, sharedSecret);
      return {
        id: this.generateMessageId(),
        timestamp: Date.now(),
        sender: this.myPeerId,
        type,
        encrypted,
        signature,
        protocolVersion: 1,
        metadata,
      };
    }

    // No shared secret and no ratchet: try pre-key bootstrap from cached bundle.
    const bootstrapped = await this.encryptWithPreKeyBootstrap(peerId, content, type, signature, metadata);
    if (bootstrapped) return bootstrapped;

    throw new Error(`No shared secret with peer ${peerId.slice(0, 8)}`);
  }

  async decryptMessage(peerId: string, envelope: MessageEnvelope, peerPublicKey: CryptoKey): Promise<string | null> {
    // Pre-key session init (protocol v3)
    if ((envelope as PreKeySessionEnvelope).protocolVersion === 3 && (envelope as PreKeySessionEnvelope).sessionInit) {
      return this.decryptPreKeySessionInit(peerId, envelope as PreKeySessionEnvelope, peerPublicKey);
    }

    // Ratchet envelope (v2)
    if (envelope.protocolVersion === 2 && 'ratchet' in envelope) {
      let state = this.ratchetStates.get(peerId);

      // Try restoring from persistence if not in memory
      if (!state && this.persistence) {
        const saved = await this.persistence.load(peerId);
        if (saved) {
          try {
            state = await deserializeRatchetState(saved);
            this.ratchetStates.set(peerId, state);
          } catch (e) {
            console.warn(`[Ratchet] Failed to restore state for ${peerId.slice(0, 8)}:`, e);
          }
        }
      }

      if (!state) {
        throw new Error(`No ratchet state with peer ${peerId.slice(0, 8)}`);
      }

      const content = await DoubleRatchet.decrypt(state, envelope.ratchet);
      await this.persistState(peerId);

      // Verify ECDSA signature (use dedicated signing key if known)
      const signingKey = this.signingPublicKeys.get(peerId) ?? peerPublicKey;
      const isValid = await this.cipher.verify(content, envelope.signature, signingKey);
      if (!isValid) return null;

      return content;
    }

    // Legacy v1
    if (!('encrypted' in envelope)) {
      throw new Error('Unsupported envelope format');
    }

    const sharedSecret = this.sharedSecrets.get(peerId);
    if (!sharedSecret) throw new Error(`No shared secret with peer ${peerId.slice(0, 8)}`);

    const content = await this.cipher.decrypt(envelope.encrypted, sharedSecret);

    // Verify ECDSA signature (use dedicated signing key if known)
    const signingKey = this.signingPublicKeys.get(peerId) ?? peerPublicKey;
    const isValid = await this.cipher.verify(content, envelope.signature, signingKey);
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

  private async encryptWithPreKeyBootstrap(
    peerId: string,
    content: string,
    type: 'text' | 'file' | 'system' | 'handshake',
    signature: string,
    metadata?: EnvelopeMetadata,
  ): Promise<PreKeySessionEnvelope | null> {
    const bundle = await this.getPeerPreKeyBundle(peerId);
    if (!bundle) return null;

    const oneTimeKey = bundle.oneTimePreKeys[0];
    const selectedType: PreKeyType = oneTimeKey ? 'one-time' : 'signed';
    const selectedKeyId = oneTimeKey?.keyId ?? bundle.signedPreKey.keyId;
    const selectedPublic = oneTimeKey?.publicKey ?? bundle.signedPreKey.publicKey;

    if (!selectedPublic) return null;
    if (!oneTimeKey && bundle.signedPreKey.expiresAt <= Date.now()) {
      return null;
    }

    const selectedPublicKey = await this.importEcdhPublicKey(selectedPublic);
    const senderEphemeral = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    );

    const initialSecret = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: selectedPublicKey },
      senderEphemeral.privateKey,
      256,
    );

    const state = await DoubleRatchet.initAlice(initialSecret, selectedPublicKey);
    const ratchet = await DoubleRatchet.encrypt(state, content);
    this.ratchetStates.set(peerId, state);
    await this.persistState(peerId);

    const senderEphemeralPublicKey = await this.exportEcdhPublicKey(senderEphemeral.publicKey);

    if (oneTimeKey) {
      const consumedBundle: PreKeyBundle = {
        ...bundle,
        oneTimePreKeys: bundle.oneTimePreKeys.slice(1),
      };
      const normalized = this.normalizePeerPreKeyBundle(consumedBundle);
      if (normalized) {
        this.peerPreKeyBundles.set(peerId, normalized);
        await this.persistPeerPreKeyBundle(peerId, normalized, 'consumed peer bundle');
      } else {
        await this.clearPeerPreKeyBundle(peerId);
      }
    }

    return {
      id: this.generateMessageId(),
      timestamp: Date.now(),
      sender: this.myPeerId,
      type,
      ratchet,
      signature,
      protocolVersion: 3,
      sessionInit: {
        type: 'pre-key-session-init',
        bundleVersion: PRE_KEY_BUNDLE_VERSION,
        selectedPreKeyId: selectedKeyId,
        selectedPreKeyType: selectedType,
        senderEphemeralPublicKey,
        createdAt: Date.now(),
      },
      metadata,
    };
  }

  private async decryptPreKeySessionInit(
    peerId: string,
    envelope: PreKeySessionEnvelope,
    peerPublicKey: CryptoKey,
  ): Promise<string | null> {
    if (this.ratchetStates.has(peerId)) {
      throw new Error(`Ratchet already established with peer ${peerId.slice(0, 8)}`);
    }

    await this.ensureLocalPreKeyMaterial();
    return this.runWithLocalPreKeyMutation(async () => {
      const init = envelope.sessionInit;
      if (!init || init.type !== 'pre-key-session-init') {
        throw new Error('Invalid pre-key session-init payload');
      }

      const localPreKey = this.resolveLocalPreKey(init.selectedPreKeyType, init.selectedPreKeyId);
      if (!localPreKey) {
        throw new Error(`Pre-key ${init.selectedPreKeyType}:${init.selectedPreKeyId} unavailable`);
      }

      const senderEphemeral = await this.importEcdhPublicKey(init.senderEphemeralPublicKey);
      const initialSecret = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: senderEphemeral },
        localPreKey.privateKey,
        256,
      );

      const state = await DoubleRatchet.initBob(initialSecret, {
        publicKey: localPreKey.publicKey,
        privateKey: localPreKey.privateKey,
      });

      const content = await DoubleRatchet.decrypt(state, envelope.ratchet);

      // Verify signature before mutating durable state.
      const signingKey = this.signingPublicKeys.get(peerId) ?? peerPublicKey;
      const isValid = await this.cipher.verify(content, envelope.signature, signingKey);
      if (!isValid) return null;

      this.ratchetStates.set(peerId, state);
      await this.persistState(peerId);

      let localStateChanged = false;
      if (init.selectedPreKeyType === 'one-time') {
        this.localOneTimePreKeys.delete(init.selectedPreKeyId);
        this.invalidateLocalPreKeyBundleCache();
        localStateChanged = true;
      }

      if (await this.applyLocalPreKeyLifecyclePolicy()) {
        localStateChanged = true;
      }

      if (localStateChanged) {
        await this.persistLocalPreKeyState();
      }

      return content;
    });
  }

  private resolveLocalPreKey(type: PreKeyType, keyId: number): LocalPreKeyRuntimeRecord | null {
    if (type === 'signed') {
      if (!this.localSignedPreKey || this.localSignedPreKey.keyId !== keyId) return null;
      return this.localSignedPreKey;
    }
    return this.localOneTimePreKeys.get(keyId) ?? null;
  }

  private async ensureLocalPreKeyMaterial(): Promise<void> {
    if (this.preKeyReady) {
      await this.preKeyReady;
      return;
    }

    this.preKeyReady = (async () => {
      let restored = false;

      // Try restore persisted local state first.
      if (this.persistence?.loadLocalPreKeyState) {
        try {
          const persisted = await this.persistence.loadLocalPreKeyState(this.myPeerId);
          if (persisted) {
            await this.loadLocalPreKeyState(persisted);
            restored = true;
          }
        } catch (e) {
          console.warn('[PreKey] Failed to load local pre-key state:', e);
        }
      }

      if (!restored) {
        await this.generateFreshLocalPreKeys();
      }

      const changed = await this.applyLocalPreKeyLifecyclePolicy();
      if (!restored || changed) {
        await this.persistLocalPreKeyState();
      }
    })();

    await this.preKeyReady;
  }

  private async loadLocalPreKeyState(state: PersistedLocalPreKeyState): Promise<void> {
    this.localSignedPreKey = {
      keyId: state.signedPreKey.keyId,
      createdAt: state.signedPreKey.createdAt,
      expiresAt: state.signedPreKey.expiresAt,
      signature: state.signedPreKey.signature,
      publicKey: await this.importEcdhPublicKey(state.signedPreKey.publicKey),
      privateKey: await this.importEcdhPrivateKey(state.signedPreKey.privateKey),
    };

    this.localOneTimePreKeys.clear();
    for (const key of state.oneTimePreKeys) {
      this.localOneTimePreKeys.set(key.keyId, {
        keyId: key.keyId,
        createdAt: key.createdAt,
        publicKey: await this.importEcdhPublicKey(key.publicKey),
        privateKey: await this.importEcdhPrivateKey(key.privateKey),
      });
    }

    this.nextOneTimePreKeyId = Math.max(
      state.nextOneTimePreKeyId,
      ...Array.from(this.localOneTimePreKeys.keys(), (id) => id + 1),
      1,
    );
    this.invalidateLocalPreKeyBundleCache();
  }

  private async generateFreshLocalPreKeys(): Promise<void> {
    if (!this._signingKeyPair) throw new Error('MessageProtocol not initialized with signing keys');

    this.invalidateLocalPreKeyBundleCache();
    const now = Date.now();
    const signedPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    );
    const signedPub = await this.exportEcdhPublicKey(signedPair.publicKey);

    this.localSignedPreKey = {
      keyId: now,
      publicKey: signedPair.publicKey,
      privateKey: signedPair.privateKey,
      createdAt: now,
      expiresAt: now + PRE_KEY_POLICY.signedPreKeyTtlMs,
      signature: await this.cipher.sign(signedPub, this._signingKeyPair.privateKey),
    };

    this.localOneTimePreKeys.clear();
    this.nextOneTimePreKeyId = 1;
    await this.generateMoreOneTimePreKeys(PRE_KEY_POLICY.targetOneTimePreKeys);
  }

  private async rotateLocalSignedPreKey(now = Date.now()): Promise<void> {
    if (!this._signingKeyPair) throw new Error('MessageProtocol not initialized with signing keys');

    this.invalidateLocalPreKeyBundleCache();
    const signedPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    );
    const signedPub = await this.exportEcdhPublicKey(signedPair.publicKey);

    this.localSignedPreKey = {
      keyId: Math.max(now, (this.localSignedPreKey?.keyId ?? 0) + 1),
      publicKey: signedPair.publicKey,
      privateKey: signedPair.privateKey,
      createdAt: now,
      expiresAt: now + PRE_KEY_POLICY.signedPreKeyTtlMs,
      signature: await this.cipher.sign(signedPub, this._signingKeyPair.privateKey),
    };
  }

  private async applyLocalPreKeyLifecyclePolicy(now = Date.now()): Promise<boolean> {
    const signedDecision = decideSignedPreKeyLifecycle(this.localSignedPreKey, {
      now,
      refreshWindowMs: PRE_KEY_POLICY.signedPreKeyRefreshWindowMs,
    });

    if (signedDecision.regenerateAll) {
      await this.generateFreshLocalPreKeys();
      return true;
    }

    let changed = false;

    if (signedDecision.rotateSignedPreKey) {
      await this.rotateLocalSignedPreKey(now);
      changed = true;
    }

    const oneTimePlan = planLocalOneTimePreKeyLifecycle(this.localOneTimePreKeys.values(), {
      now,
      maxAgeMs: PRE_KEY_POLICY.maxOneTimePreKeyAgeMs,
      targetCount: PRE_KEY_POLICY.targetOneTimePreKeys,
      lowWatermark: PRE_KEY_POLICY.lowWatermarkOneTimePreKeys,
    });

    if (oneTimePlan.staleKeyIds.length > 0) {
      for (const keyId of oneTimePlan.staleKeyIds) {
        this.localOneTimePreKeys.delete(keyId);
      }
      this.invalidateLocalPreKeyBundleCache();
      changed = true;
    }

    if (this.localOneTimePreKeys.size > PRE_KEY_POLICY.targetOneTimePreKeys) {
      const keyIdsToRemove = Array.from(this.localOneTimePreKeys.values())
        .sort((a, b) => b.keyId - a.keyId)
        .slice(PRE_KEY_POLICY.targetOneTimePreKeys)
        .map((record) => record.keyId);
      for (const keyId of keyIdsToRemove) {
        this.localOneTimePreKeys.delete(keyId);
      }
      this.invalidateLocalPreKeyBundleCache();
      changed = true;
    }

    if (oneTimePlan.replenishCount > 0) {
      await this.generateMoreOneTimePreKeys(oneTimePlan.replenishCount);
      changed = true;
    }

    return changed;
  }

  private async generateMoreOneTimePreKeys(count: number): Promise<void> {
    if (count > 0) {
      this.invalidateLocalPreKeyBundleCache();
    }
    for (let i = 0; i < count; i++) {
      const keyId = this.nextOneTimePreKeyId++;
      const pair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits'],
      );
      this.localOneTimePreKeys.set(keyId, {
        keyId,
        publicKey: pair.publicKey,
        privateKey: pair.privateKey,
        createdAt: Date.now(),
      });
    }
  }

  private async snapshotLocalPreKeyBundle(): Promise<PreKeyBundle> {
    if (!this.localSignedPreKey || !this._signingKeyPair) {
      throw new Error('Local pre-key state unavailable');
    }

    const oneTimePreKeys = await Promise.all(
      Array.from(this.localOneTimePreKeys.values())
        .sort((a, b) => a.keyId - b.keyId)
        .map(async (record) => ({
          keyId: record.keyId,
          publicKey: await this.exportEcdhPublicKey(record.publicKey),
          createdAt: record.createdAt,
        })),
    );

    return {
      version: PRE_KEY_BUNDLE_VERSION,
      peerId: this.myPeerId,
      generatedAt: Date.now(),
      signingPublicKey: await this.cryptoManager.exportPublicKey(this._signingKeyPair.publicKey),
      signedPreKey: {
        keyId: this.localSignedPreKey.keyId,
        publicKey: await this.exportEcdhPublicKey(this.localSignedPreKey.publicKey),
        signature: this.localSignedPreKey.signature,
        createdAt: this.localSignedPreKey.createdAt,
        expiresAt: this.localSignedPreKey.expiresAt,
      },
      oneTimePreKeys,
    };
  }

  private async persistLocalPreKeyState(): Promise<void> {
    if (!this.persistence?.saveLocalPreKeyState || !this.localSignedPreKey) return;

    try {
      const state: PersistedLocalPreKeyState = {
        version: PRE_KEY_BUNDLE_VERSION,
        generatedAt: Date.now(),
        signedPreKey: {
          keyId: this.localSignedPreKey.keyId,
          publicKey: await this.exportEcdhPublicKey(this.localSignedPreKey.publicKey),
          privateKey: await this.exportEcdhPrivateKey(this.localSignedPreKey.privateKey),
          signature: this.localSignedPreKey.signature,
          createdAt: this.localSignedPreKey.createdAt,
          expiresAt: this.localSignedPreKey.expiresAt,
        },
        oneTimePreKeys: await Promise.all(
          Array.from(this.localOneTimePreKeys.values())
            .sort((a, b) => a.keyId - b.keyId)
            .map(async (record) => ({
              keyId: record.keyId,
              publicKey: await this.exportEcdhPublicKey(record.publicKey),
              privateKey: await this.exportEcdhPrivateKey(record.privateKey),
              createdAt: record.createdAt,
            })),
        ),
        nextOneTimePreKeyId: this.nextOneTimePreKeyId,
      };

      await this.persistence.saveLocalPreKeyState(this.myPeerId, state);
    } catch (e) {
      console.warn('[PreKey] Failed to persist local pre-key state:', e);
    }
  }

  private async persistPeerPreKeyBundle(
    peerId: string,
    bundle: PreKeyBundle,
    context: string = 'peer bundle',
  ): Promise<void> {
    if (!this.persistence?.savePreKeyBundle) return;

    try {
      await this.persistence.savePreKeyBundle(peerId, bundle);
    } catch (e) {
      console.warn(`[PreKey] Failed to persist ${context} for ${peerId.slice(0, 8)}:`, e);
    }
  }

  private invalidateLocalPreKeyBundleCache(): void {
    this.localPreKeyBundleCache = null;
  }

  private normalizePeerPreKeyBundle(bundle: PreKeyBundle, now = Date.now()): PreKeyBundle | null {
    return normalizePeerPreKeyBundlePolicy(bundle, {
      now,
      expectedVersion: PRE_KEY_BUNDLE_VERSION,
      maxBundleAgeMs: PRE_KEY_POLICY.maxPeerBundleAgeMs,
      maxOneTimePreKeyAgeMs: PRE_KEY_POLICY.maxOneTimePreKeyAgeMs,
    });
  }

  private hasPeerBundleChanged(before: PreKeyBundle, after: PreKeyBundle): boolean {
    return hasPeerPreKeyBundleChanged(before, after);
  }

  private async sanitizeAndVerifyPeerPreKeyBundle(peerId: string, bundle: PreKeyBundle): Promise<PreKeyBundle | null> {
    const normalized = this.normalizePeerPreKeyBundle(bundle);
    if (!normalized) return null;
    if (normalized.peerId !== peerId) return null;

    try {
      const signingKey = await this.cryptoManager.importSigningPublicKey(normalized.signingPublicKey);
      const isValid = await this.cipher.verify(
        normalized.signedPreKey.publicKey,
        normalized.signedPreKey.signature,
        signingKey,
      );
      if (!isValid) return null;

      // Validate public keys are importable ECDH keys.
      await this.importEcdhPublicKey(normalized.signedPreKey.publicKey);
      for (const entry of normalized.oneTimePreKeys) {
        await this.importEcdhPublicKey(entry.publicKey);
      }
      return normalized;
    } catch {
      return null;
    }
  }

  private async exportEcdhPublicKey(key: CryptoKey): Promise<string> {
    const raw = await crypto.subtle.exportKey('raw', key);
    return arrayBufferToBase64(raw);
  }

  private async exportEcdhPrivateKey(key: CryptoKey): Promise<string> {
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', key);
    return arrayBufferToBase64(pkcs8);
  }

  private async importEcdhPublicKey(rawBase64: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      'raw',
      base64ToArrayBuffer(rawBase64),
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      [],
    );
  }

  private async importEcdhPrivateKey(pkcs8Base64: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      'pkcs8',
      base64ToArrayBuffer(pkcs8Base64),
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    );
  }

  private generateMessageId(): string {
    return crypto.randomUUID();
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
