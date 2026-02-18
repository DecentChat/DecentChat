/**
 * DoubleRatchet — Signal-style forward secrecy for P2P messaging
 * 
 * Combines:
 * 1. Diffie-Hellman ratchet (new ECDH key pair per turn)
 * 2. Symmetric-key ratchet (KDF chain for each message)
 * 
 * Properties:
 * - Forward secrecy: compromise of current key doesn't reveal past messages
 * - Future secrecy (self-healing): after a DH ratchet step, attacker
 *   who had a key can no longer decrypt future messages
 * - Out-of-order message handling via skipped message keys
 * 
 * Simplified for P2P (no X3DH prekey bundle — both peers must be online
 * for initial key exchange, which we already require for WebRTC).
 * 
 * Flow:
 *   1. Initial shared secret from ECDH handshake (already have this)
 *   2. Each message uses a unique message key derived from chain
 *   3. When receiving a new DH public key from peer, ratchet forward
 *   4. Skipped message keys are cached for out-of-order delivery
 */

/** Maximum number of skipped message keys to store */
const MAX_SKIP = 100;

/** HKDF info strings */
const ROOT_KDF_INFO = 'decent-root-kdf-v1';
const CHAIN_KDF_INFO = 'decent-chain-kdf-v1';

/** Ratchet state for one peer session */
export interface RatchetState {
  /** Our current DH key pair (ratchet key) */
  dhKeyPair: CryptoKeyPair;
  /** Peer's current DH public key */
  peerDHPublicKey: CryptoKey | null;
  /** Root key (evolves with each DH ratchet) */
  rootKey: ArrayBuffer;
  /** Sending chain key */
  sendChainKey: ArrayBuffer | null;
  /** Receiving chain key */
  recvChainKey: ArrayBuffer | null;
  /** Number of messages sent in current sending chain */
  sendCount: number;
  /** Number of messages received in current receiving chain */
  recvCount: number;
  /** Previous sending chain length (for header) */
  previousSendCount: number;
  /** Skipped message keys: Map<"dhPubHex:index", messageKey> */
  skippedKeys: Map<string, ArrayBuffer>;
}

/** Message header (sent alongside ciphertext) */
export interface RatchetHeader {
  /** Sender's current DH public key (raw, base64) */
  dhPublicKey: string;
  /** Previous chain message count */
  previousCount: number;
  /** Message number in current chain */
  messageNumber: number;
}

/** Encrypted message with ratchet header */
export interface RatchetMessage {
  header: RatchetHeader;
  /** AES-GCM encrypted payload (base64) */
  ciphertext: string;
  /** AES-GCM IV (base64) */
  iv: string;
}

export class DoubleRatchet {

  /**
   * Initialize ratchet as the INITIATOR (Alice).
   * Alice sent first message, so she does the first DH ratchet step.
   */
  static async initAlice(
    sharedSecret: ArrayBuffer,
    peerDHPublicKey: CryptoKey,
  ): Promise<RatchetState> {
    const dhKeyPair = await generateDHKeyPair();
    const { rootKey, chainKey } = await rootKDF(
      sharedSecret,
      await deriveSharedSecret(dhKeyPair.privateKey, peerDHPublicKey),
    );

    return {
      dhKeyPair,
      peerDHPublicKey,
      rootKey,
      sendChainKey: chainKey,
      recvChainKey: null,
      sendCount: 0,
      recvCount: 0,
      previousSendCount: 0,
      skippedKeys: new Map(),
    };
  }

  /**
   * Initialize ratchet as the RESPONDER (Bob).
   * Bob waits for Alice's first message before ratcheting.
   */
  static async initBob(
    sharedSecret: ArrayBuffer,
    dhKeyPair: CryptoKeyPair,
  ): Promise<RatchetState> {
    return {
      dhKeyPair,
      peerDHPublicKey: null,
      rootKey: sharedSecret,
      sendChainKey: null,
      recvChainKey: null,
      sendCount: 0,
      recvCount: 0,
      previousSendCount: 0,
      skippedKeys: new Map(),
    };
  }

  /**
   * Encrypt a message using the current ratchet state.
   */
  static async encrypt(
    state: RatchetState,
    plaintext: string,
  ): Promise<RatchetMessage> {
    // Advance sending chain
    const { messageKey, nextChainKey } = await chainKDF(state.sendChainKey!);
    state.sendChainKey = nextChainKey;

    // Create header
    const header: RatchetHeader = {
      dhPublicKey: await exportDHPublicKey(state.dhKeyPair.publicKey),
      previousCount: state.previousSendCount,
      messageNumber: state.sendCount,
    };
    state.sendCount++;

    // Encrypt with message key
    const { ciphertext, iv } = await aesEncrypt(messageKey, plaintext);

    return { header, ciphertext, iv };
  }

  /**
   * Decrypt a message using the current ratchet state.
   * Handles DH ratchet steps and out-of-order messages.
   */
  static async decrypt(
    state: RatchetState,
    message: RatchetMessage,
  ): Promise<string> {
    // Check if we have a skipped key for this message
    const skippedKey = await trySkippedKeys(state, message);
    if (skippedKey !== null) return skippedKey;

    const peerDHPublicKey = await importDHPublicKey(message.header.dhPublicKey);

    // Check if this is a new DH ratchet step
    const currentPeerKeyStr = state.peerDHPublicKey
      ? await exportDHPublicKey(state.peerDHPublicKey)
      : null;

    if (message.header.dhPublicKey !== currentPeerKeyStr) {
      // New DH key from peer — skip any remaining messages in old chain
      if (state.recvChainKey !== null) {
        await skipMessageKeys(state, message.header.previousCount);
      }

      // DH ratchet step
      await dhRatchetStep(state, peerDHPublicKey);
    }

    // Skip ahead if needed (out-of-order)
    await skipMessageKeys(state, message.header.messageNumber);

    // Advance receiving chain
    const { messageKey, nextChainKey } = await chainKDF(state.recvChainKey!);
    state.recvChainKey = nextChainKey;
    state.recvCount++;

    // Decrypt
    return aesDecrypt(messageKey, message.ciphertext, message.iv);
  }
}

// ── DH Ratchet Step ─────────────────────────────────────────────────────────

async function dhRatchetStep(state: RatchetState, peerDHPublicKey: CryptoKey): Promise<void> {
  state.peerDHPublicKey = peerDHPublicKey;
  state.previousSendCount = state.sendCount;
  state.sendCount = 0;
  state.recvCount = 0;

  // Derive new receiving chain
  const dhOutput1 = await deriveSharedSecret(state.dhKeyPair.privateKey, peerDHPublicKey);
  const recv = await rootKDF(state.rootKey, dhOutput1);
  state.rootKey = recv.rootKey;
  state.recvChainKey = recv.chainKey;

  // Generate new DH key pair and derive new sending chain
  state.dhKeyPair = await generateDHKeyPair();
  const dhOutput2 = await deriveSharedSecret(state.dhKeyPair.privateKey, peerDHPublicKey);
  const send = await rootKDF(state.rootKey, dhOutput2);
  state.rootKey = send.rootKey;
  state.sendChainKey = send.chainKey;
}

// ── Skipped Message Keys ────────────────────────────────────────────────────

async function skipMessageKeys(state: RatchetState, until: number): Promise<void> {
  if (state.recvCount + MAX_SKIP < until) {
    throw new Error('Too many skipped messages');
  }

  while (state.recvCount < until) {
    const { messageKey, nextChainKey } = await chainKDF(state.recvChainKey!);
    state.recvChainKey = nextChainKey;

    const peerKeyStr = state.peerDHPublicKey
      ? await exportDHPublicKey(state.peerDHPublicKey)
      : 'init';
    state.skippedKeys.set(`${peerKeyStr}:${state.recvCount}`, messageKey);
    state.recvCount++;

    // Prune old skipped keys if too many
    if (state.skippedKeys.size > MAX_SKIP * 2) {
      const keys = Array.from(state.skippedKeys.keys());
      for (let i = 0; i < keys.length - MAX_SKIP; i++) {
        state.skippedKeys.delete(keys[i]);
      }
    }
  }
}

async function trySkippedKeys(state: RatchetState, message: RatchetMessage): Promise<string | null> {
  const key = `${message.header.dhPublicKey}:${message.header.messageNumber}`;
  const messageKey = state.skippedKeys.get(key);

  if (!messageKey) return null;

  state.skippedKeys.delete(key);
  return aesDecrypt(messageKey, message.ciphertext, message.iv);
}

// ── Crypto Primitives ───────────────────────────────────────────────────────

async function generateDHKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
}

async function deriveSharedSecret(privateKey: CryptoKey, publicKey: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256,
  );
}

async function exportDHPublicKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return arrayBufferToBase64(raw);
}

async function importDHPublicKey(base64: string): Promise<CryptoKey> {
  const raw = base64ToArrayBuffer(base64);
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
}

/** Root KDF: HKDF(rootKey, dhOutput) → (newRootKey, chainKey) */
async function rootKDF(
  rootKey: ArrayBuffer,
  dhOutput: ArrayBuffer,
): Promise<{ rootKey: ArrayBuffer; chainKey: ArrayBuffer }> {
  // Import DH output as HKDF key material
  const ikm = await crypto.subtle.importKey('raw', dhOutput, 'HKDF', false, ['deriveBits']);

  const salt = new Uint8Array(rootKey);
  const info = new TextEncoder().encode(ROOT_KDF_INFO);

  // Derive 64 bytes: first 32 = new root key, last 32 = chain key
  const derived = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    ikm,
    512, // 64 bytes
  );

  return {
    rootKey: derived.slice(0, 32),
    chainKey: derived.slice(32, 64),
  };
}

/** Chain KDF: HMAC(chainKey, 0x01) → messageKey, HMAC(chainKey, 0x02) → nextChainKey */
async function chainKDF(
  chainKey: ArrayBuffer,
): Promise<{ messageKey: ArrayBuffer; nextChainKey: ArrayBuffer }> {
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    chainKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const messageKey = await crypto.subtle.sign('HMAC', hmacKey, new Uint8Array([0x01]));
  const nextChainKey = await crypto.subtle.sign('HMAC', hmacKey, new Uint8Array([0x02]));

  return { messageKey, nextChainKey };
}

/** AES-GCM encrypt */
async function aesEncrypt(
  keyData: ArrayBuffer,
  plaintext: string,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await crypto.subtle.importKey('raw', keyData, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  return {
    ciphertext: arrayBufferToBase64(encrypted),
    iv: arrayBufferToBase64(iv.buffer),
  };
}

/** AES-GCM decrypt */
async function aesDecrypt(
  keyData: ArrayBuffer,
  ciphertext: string,
  iv: string,
): Promise<string> {
  const key = await crypto.subtle.importKey('raw', keyData, 'AES-GCM', false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToArrayBuffer(iv) },
    key,
    base64ToArrayBuffer(ciphertext),
  );
  return new TextDecoder().decode(decrypted);
}

// ── State Serialization (for IndexedDB persistence) ─────────────────────────

/** Serialized form of RatchetState (all CryptoKey/ArrayBuffer → base64 strings) */
export interface SerializedRatchetState {
  dhKeyPair: { publicKey: string; privateKey: string };
  peerDHPublicKey: string | null;
  rootKey: string;
  sendChainKey: string | null;
  recvChainKey: string | null;
  sendCount: number;
  recvCount: number;
  previousSendCount: number;
  skippedKeys: Array<[string, string]>;
}

/** Serialize RatchetState for storage */
export async function serializeRatchetState(state: RatchetState): Promise<SerializedRatchetState> {
  const pubRaw = await crypto.subtle.exportKey('raw', state.dhKeyPair.publicKey);
  const privJwk = await crypto.subtle.exportKey('jwk', state.dhKeyPair.privateKey);

  let peerPubB64: string | null = null;
  if (state.peerDHPublicKey) {
    const peerRaw = await crypto.subtle.exportKey('raw', state.peerDHPublicKey);
    peerPubB64 = arrayBufferToBase64(peerRaw);
  }

  const skipped: Array<[string, string]> = [];
  for (const [k, v] of state.skippedKeys) {
    skipped.push([k, arrayBufferToBase64(v)]);
  }

  return {
    dhKeyPair: {
      publicKey: arrayBufferToBase64(pubRaw),
      privateKey: JSON.stringify(privJwk),
    },
    peerDHPublicKey: peerPubB64,
    rootKey: arrayBufferToBase64(state.rootKey),
    sendChainKey: state.sendChainKey ? arrayBufferToBase64(state.sendChainKey) : null,
    recvChainKey: state.recvChainKey ? arrayBufferToBase64(state.recvChainKey) : null,
    sendCount: state.sendCount,
    recvCount: state.recvCount,
    previousSendCount: state.previousSendCount,
    skippedKeys: skipped,
  };
}

/** Deserialize RatchetState from storage */
export async function deserializeRatchetState(data: SerializedRatchetState): Promise<RatchetState> {
  const publicKey = await crypto.subtle.importKey(
    'raw',
    base64ToArrayBuffer(data.dhKeyPair.publicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(data.dhKeyPair.privateKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );

  let peerDHPublicKey: CryptoKey | null = null;
  if (data.peerDHPublicKey) {
    peerDHPublicKey = await importDHPublicKey(data.peerDHPublicKey);
  }

  const skippedKeys = new Map<string, ArrayBuffer>();
  for (const [k, v] of data.skippedKeys) {
    skippedKeys.set(k, base64ToArrayBuffer(v));
  }

  return {
    dhKeyPair: { publicKey, privateKey },
    peerDHPublicKey,
    rootKey: base64ToArrayBuffer(data.rootKey),
    sendChainKey: data.sendChainKey ? base64ToArrayBuffer(data.sendChainKey) : null,
    recvChainKey: data.recvChainKey ? base64ToArrayBuffer(data.recvChainKey) : null,
    sendCount: data.sendCount,
    recvCount: data.recvCount,
    previousSendCount: data.previousSendCount,
    skippedKeys,
  };
}

// ── Base64 Utilities ────────────────────────────────────────────────────────

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
