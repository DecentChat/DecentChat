/**
 * KeyStore - Persists cryptographic keys in IndexedDB
 */

import type { SerializedKeyPair, KeyPair } from './types';
import { CryptoManager } from './CryptoManager';

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

  /**
   * Initialize IndexedDB connection
   */
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

  /**
   * Store ECDH key pair
   */
  async storeECDHKeyPair(keyPair: KeyPair): Promise<void> {
    const serialized = await this.cryptoManager.serializeKeyPair(keyPair);
    const storedKey: StoredKey = {
      id: 'my-ecdh-keypair',
      type: 'ecdh',
      data: serialized,
      createdAt: Date.now(),
    };

    return this.put(storedKey);
  }

  /**
   * Retrieve ECDH key pair
   */
  async getECDHKeyPair(): Promise<KeyPair | null> {
    const stored = await this.get('my-ecdh-keypair');
    if (!stored || stored.type !== 'ecdh') {
      return null;
    }

    return await this.cryptoManager.deserializeKeyPair(
      stored.data as SerializedKeyPair,
      'ECDH',
      ['deriveKey', 'deriveBits'] as any
    );
  }

  /**
   * Store ECDSA signing key pair
   */
  async storeECDSAKeyPair(keyPair: KeyPair): Promise<void> {
    const serialized = await this.cryptoManager.serializeKeyPair(keyPair);
    const storedKey: StoredKey = {
      id: 'my-ecdsa-keypair',
      type: 'ecdsa',
      data: serialized,
      createdAt: Date.now(),
    };

    return this.put(storedKey);
  }

  /**
   * Retrieve ECDSA signing key pair
   */
  async getECDSAKeyPair(): Promise<KeyPair | null> {
    const stored = await this.get('my-ecdsa-keypair');
    if (!stored || stored.type !== 'ecdsa') {
      return null;
    }

    return await this.cryptoManager.deserializeKeyPair(
      stored.data as SerializedKeyPair,
      'ECDSA',
      ['sign', 'verify'] as any
    );
  }

  /**
   * Store peer's public key (for verification)
   */
  async storePeerPublicKey(peerId: string, publicKey: string): Promise<void> {
    const storedKey: StoredKey = {
      id: `peer-${peerId}`,
      type: 'ecdh',
      data: publicKey as any,
      peerId,
      createdAt: Date.now(),
    };

    return this.put(storedKey);
  }

  /**
   * Get peer's public key
   */
  async getPeerPublicKey(peerId: string): Promise<string | null> {
    const stored = await this.get(`peer-${peerId}`);
    if (!stored) {
      return null;
    }
    return stored.data as string;
  }

  /**
   * Clear all stored keys
   */
  async clearAll(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  // Private helper methods
  private async put(data: StoredKey): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(data);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  private async get(id: string): Promise<StoredKey | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
