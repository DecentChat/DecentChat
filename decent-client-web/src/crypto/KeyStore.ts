/**
 * KeyStore - Persists cryptographic keys in IndexedDB
 *
 * Client-specific: depends on browser IndexedDB API.
 */

import type { SerializedKeyPair, KeyPair } from 'decent-protocol';
import { CryptoManager } from 'decent-protocol';

const DB_NAME = 'p2p-chat-keys';
const DB_VERSION = 1;
const STORE_NAME = 'keys';

interface StoredKey {
  id: string;
  type: 'ecdh' | 'ecdsa' | 'shared-secret';
  data: SerializedKeyPair | string;
  peerId?: string;
  createdAt: number;
}

export class KeyStore {
  private db: IDBDatabase | null = null;
  private cryptoManager: CryptoManager;

  constructor(cryptoManager: CryptoManager) {
    this.cryptoManager = cryptoManager;
  }

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
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

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
