/**
 * KeyStore - Persists cryptographic keys in IndexedDB
 *
 * Client-specific: depends on browser IndexedDB API.
 */

import type { SerializedKeyPair, KeyPair } from '@decentchat/protocol';
import { CryptoManager } from '@decentchat/protocol';

const DEFAULT_DB_NAME = 'p2p-chat-keys';
const DEFAULT_DB_VERSION = 1;
const STORE_NAME = 'keys';
const DEFAULT_OPEN_TIMEOUT_MS = 8_000;

export interface KeyStoreConfig {
  dbName?: string;
  version?: number;
  openTimeoutMs?: number;
}

interface StoredKey {
  id: string;
  type: 'ecdh' | 'ecdsa' | 'shared-secret';
  data: SerializedKeyPair | string;
  peerId?: string;
  createdAt: number;
}

export class KeyStore {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;
  private cryptoManager: CryptoManager;
  private dbName: string;
  private version: number;
  private openTimeoutMs: number;

  constructor(cryptoManager: CryptoManager, config: KeyStoreConfig = {}) {
    this.cryptoManager = cryptoManager;
    this.dbName = config.dbName ?? DEFAULT_DB_NAME;
    this.version = config.version ?? DEFAULT_DB_VERSION;
    this.openTimeoutMs = config.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
  }

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    const initPromise = new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const finish = () => {
        if (settled) return false;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        return true;
      };

      const fail = (error: Error) => {
        if (!finish()) return;
        reject(error);
      };

      timeoutId = setTimeout(() => {
        fail(this.makeInitError(
          'timeout',
          `Timed out opening key storage "${this.dbName}". Close other DecentChat tabs/windows and retry.`,
        ));
      }, this.openTimeoutMs);

      request.onerror = () => {
        fail(this.makeInitError(
          'open-failed',
          `Failed to open key storage "${this.dbName}": ${request.error?.message || 'unknown error'}`,
          request.error,
        ));
      };

      request.onblocked = () => {
        fail(this.makeInitError(
          'blocked',
          `Opening key storage "${this.dbName}" was blocked by another tab/window. Close other DecentChat tabs/windows and retry.`,
        ));
      };

      request.onsuccess = () => {
        const db = request.result;
        if (!finish()) {
          try { db.close(); } catch {}
          return;
        }
        db.onversionchange = () => {
          console.warn(`[KeyStore] versionchange detected for ${this.dbName}; closing stale connection.`);
          try {
            db.close();
          } finally {
            if (this.db === db) this.db = null;
          }
        };
        this.db = db;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('peerId', 'peerId', { unique: false });
        }
      };
    });

    this.initPromise = initPromise;
    try {
      await initPromise;
    } finally {
      if (this.initPromise === initPromise) {
        this.initPromise = null;
      }
    }
  }

  async storeECDHKeyPair(keyPair: KeyPair): Promise<void> {
    const serialized = await this.cryptoManager.serializeKeyPair(keyPair);
    return this.put({ id: 'my-ecdh-keypair', type: 'ecdh', data: serialized, createdAt: Date.now() });
  }

  async getECDHKeyPair(): Promise<KeyPair | null> {
    const stored = await this.get('my-ecdh-keypair');
    if (!stored || stored.type !== 'ecdh') return null;
    return this.cryptoManager.deserializeKeyPair(stored.data as SerializedKeyPair, 'ECDH', ['deriveKey', 'deriveBits'] as any);
  }

  async storeECDSAKeyPair(keyPair: KeyPair): Promise<void> {
    const serialized = await this.cryptoManager.serializeKeyPair(keyPair);
    return this.put({ id: 'my-ecdsa-keypair', type: 'ecdsa', data: serialized, createdAt: Date.now() });
  }

  async getECDSAKeyPair(): Promise<KeyPair | null> {
    const stored = await this.get('my-ecdsa-keypair');
    if (!stored || stored.type !== 'ecdsa') return null;
    return this.cryptoManager.deserializeKeyPair(stored.data as SerializedKeyPair, 'ECDSA', ['sign', 'verify'] as any);
  }

  async storePeerPublicKey(peerId: string, publicKey: string): Promise<void> {
    return this.put({ id: `peer-${peerId}`, type: 'ecdh', data: publicKey as any, peerId, createdAt: Date.now() });
  }

  async getPeerPublicKey(peerId: string): Promise<string | null> {
    const stored = await this.get(`peer-${peerId}`);
    return stored ? (stored.data as string) : null;
  }

  async clearAll(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readwrite');
      const req = tx.objectStore(STORE_NAME).clear();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve();
    });
  }

  private async put(data: StoredKey): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(data);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve();
    });
  }

  private async get(id: string): Promise<StoredKey | null> {
    if (!this.db) throw new Error('Database not initialized');
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result || null);
    });
  }

  private makeInitError(code: 'blocked' | 'timeout' | 'open-failed', message: string, cause?: unknown): Error {
    const error = new Error(message) as Error & { code?: string; cause?: unknown };
    error.name = 'IndexedDBInitError';
    error.code = code;
    if (cause !== undefined) error.cause = cause;
    return error;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
