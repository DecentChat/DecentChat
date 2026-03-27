/**
 * Database - IndexedDB wrapper for app data
 *
 * @deprecated Use `PersistentStore` from `@decentchat/protocol` instead.
 * `PersistentStore` now covers all capabilities previously provided here
 * (peers, settings via getSettings/saveSettings, messages, workspaces).
 * This file is kept for reference and will be removed in a future cleanup.
 */

import type { StoredMessage, StoredPeer, AppSettings } from './types';

const DB_NAME = 'p2p-chat-data';
const DB_VERSION = 1;

export class Database {
  private db: IDBDatabase | null = null;

  /**
   * Initialize database connection
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

        // Messages store
        if (!db.objectStoreNames.contains('messages')) {
          const messagesStore = db.createObjectStore('messages', { keyPath: 'id' });
          messagesStore.createIndex('peerId', 'peerId', { unique: false });
          messagesStore.createIndex('timestamp', 'timestamp', { unique: false });
          messagesStore.createIndex('status', 'status', { unique: false });
        }

        // Peers store
        if (!db.objectStoreNames.contains('peers')) {
          const peersStore = db.createObjectStore('peers', { keyPath: 'id' });
          peersStore.createIndex('lastSeen', 'lastSeen', { unique: false });
        }

        // Settings store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' });
        }
      };
    });
  }

  // === Messages ===

  async saveMessage(message: StoredMessage): Promise<void> {
    return this.put('messages', message);
  }

  async getMessage(id: string): Promise<StoredMessage | null> {
    return this.get('messages', id);
  }

  async getMessagesByPeer(peerId: string, limit = 100): Promise<StoredMessage[]> {
    return this.getByIndex('messages', 'peerId', peerId, limit);
  }

  async getAllMessages(limit = 1000): Promise<StoredMessage[]> {
    return this.getAll('messages', limit);
  }

  async deleteMessage(id: string): Promise<void> {
    return this.delete('messages', id);
  }

  async updateMessageStatus(id: string, status: StoredMessage['status']): Promise<void> {
    const message = await this.getMessage(id);
    if (message) {
      message.status = status;
      await this.saveMessage(message);
    }
  }

  // === Peers ===

  async savePeer(peer: StoredPeer): Promise<void> {
    return this.put('peers', peer);
  }

  async getPeer(id: string): Promise<StoredPeer | null> {
    return this.get('peers', id);
  }

  async getAllPeers(): Promise<StoredPeer[]> {
    return this.getAll('peers');
  }

  async deletePeer(id: string): Promise<void> {
    return this.delete('peers', id);
  }

  async updatePeerAlias(peerId: string, alias: string): Promise<void> {
    const peer = await this.getPeer(peerId);
    if (peer) {
      peer.alias = alias;
      await this.savePeer(peer);
    }
  }

  async updatePeerLastSeen(peerId: string): Promise<void> {
    const peer = await this.getPeer(peerId);
    if (peer) {
      peer.lastSeen = Date.now();
      await this.savePeer(peer);
    }
  }

  // === Settings ===

  async getSettings(): Promise<AppSettings> {
    const stored = await this.get('settings', 'app-settings');
    return stored || {
      theme: 'auto',
      notifications: true,
    };
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    return this.put('settings', { ...settings, id: 'app-settings' });
  }

  // === Utility ===

  async clearAllData(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await Promise.all([
      this.clear('messages'),
      this.clear('peers'),
      this.clear('settings'),
    ]);
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // === Private helpers ===

  private async put(storeName: string, data: any): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(data);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  private async get(storeName: string, id: string): Promise<any | null> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  private async getAll(storeName: string, limit?: number): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = limit ? store.getAll(undefined, limit) : store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  private async getByIndex(
    storeName: string,
    indexName: string,
    value: any,
    limit?: number
  ): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);
      const request = limit
        ? index.getAll(IDBKeyRange.only(value), limit)
        : index.getAll(IDBKeyRange.only(value));

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  private async delete(storeName: string, id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  private async clear(storeName: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}
