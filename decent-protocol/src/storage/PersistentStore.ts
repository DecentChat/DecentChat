/**
 * PersistentStore — IndexedDB persistence for workspaces, messages, and identity
 * 
 * Survives page refresh, tab close, device restart.
 * All data stays local (no server).
 */

export interface PersistentStoreConfig {
  dbName?: string;
  version?: number;
}

export class PersistentStore {
  private db: IDBDatabase | null = null;
  private dbName: string;
  private version: number;

  constructor(config: PersistentStoreConfig = {}) {
    this.dbName = config.dbName || 'decent-protocol';
    this.version = config.version || 3;
  }

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Workspaces
        if (!db.objectStoreNames.contains('workspaces')) {
          db.createObjectStore('workspaces', { keyPath: 'id' });
        }

        // Messages (per channel, ordered)
        if (!db.objectStoreNames.contains('messages')) {
          const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
          msgStore.createIndex('channelId', 'channelId', { unique: false });
          msgStore.createIndex('channelTimestamp', ['channelId', 'timestamp'], { unique: false });
        }

        // Identity
        if (!db.objectStoreNames.contains('identity')) {
          db.createObjectStore('identity', { keyPath: 'key' });
        }

        // Peers (public keys, last seen)
        if (!db.objectStoreNames.contains('peers')) {
          db.createObjectStore('peers', { keyPath: 'peerId' });
        }

        // Offline message queue
        if (!db.objectStoreNames.contains('outbox')) {
          const outbox = db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
          outbox.createIndex('targetPeerId', 'targetPeerId', { unique: false });
        }

        // Settings
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }

        // Ratchet states (per-peer Double Ratchet state for forward secrecy)
        if (!db.objectStoreNames.contains('ratchetStates')) {
          db.createObjectStore('ratchetStates', { keyPath: 'peerId' });
        }

        // Contacts (standalone, independent of workspaces)
        if (!db.objectStoreNames.contains('contacts')) {
          db.createObjectStore('contacts', { keyPath: 'peerId' });
        }

        // Direct conversations (standalone DMs with contacts)
        if (!db.objectStoreNames.contains('directConversations')) {
          const dcStore = db.createObjectStore('directConversations', { keyPath: 'id' });
          dcStore.createIndex('contactPeerId', 'contactPeerId', { unique: true });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = () => reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
    });
  }

  // === Workspaces ===

  async saveWorkspace(workspace: any): Promise<void> {
    await this.put('workspaces', workspace);
  }

  async getWorkspace(id: string): Promise<any | undefined> {
    return this.get('workspaces', id);
  }

  async getAllWorkspaces(): Promise<any[]> {
    return this.getAll('workspaces');
  }

  async deleteWorkspace(id: string): Promise<void> {
    await this.delete('workspaces', id);
  }

  // === Messages ===

  async saveMessage(message: any): Promise<void> {
    await this.put('messages', message);
  }

  async saveMessages(messages: any[]): Promise<void> {
    const tx = this.getDB().transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    for (const msg of messages) {
      store.put(msg);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getChannelMessages(channelId: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const tx = this.getDB().transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const index = store.index('channelId');
      const request = index.getAll(channelId);
      request.onsuccess = () => {
        const messages = request.result || [];
        messages.sort((a: any, b: any) => a.timestamp - b.timestamp);
        resolve(messages);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getMessageCount(channelId: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const tx = this.getDB().transaction('messages', 'readonly');
      const index = tx.objectStore('messages').index('channelId');
      const request = index.count(channelId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // === Identity ===

  async saveIdentity(key: string, value: any): Promise<void> {
    await this.put('identity', { key, value });
  }

  async getIdentity(key: string): Promise<any | undefined> {
    const result = await this.get('identity', key);
    return result?.value;
  }

  // === Peers ===

  async savePeer(peer: { peerId: string; publicKey: string; lastSeen: number; alias?: string }): Promise<void> {
    await this.put('peers', peer);
  }

  async getPeer(peerId: string): Promise<any | undefined> {
    return this.get('peers', peerId);
  }

  async getAllPeers(): Promise<any[]> {
    return this.getAll('peers');
  }

  // === Offline Outbox ===

  async enqueueMessage(targetPeerId: string, data: any): Promise<void> {
    await this.put('outbox', {
      targetPeerId,
      data,
      createdAt: Date.now(),
    });
  }

  async getQueuedMessages(targetPeerId: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const tx = this.getDB().transaction('outbox', 'readonly');
      const index = tx.objectStore('outbox').index('targetPeerId');
      const request = index.getAll(targetPeerId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async dequeueMessage(id: number): Promise<void> {
    await this.delete('outbox', id);
  }

  async dequeueAllForPeer(targetPeerId: string): Promise<any[]> {
    const messages = await this.getQueuedMessages(targetPeerId);
    const tx = this.getDB().transaction('outbox', 'readwrite');
    const store = tx.objectStore('outbox');
    for (const msg of messages) {
      store.delete(msg.id);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return messages;
  }

  // === Ratchet States ===

  async saveRatchetState(peerId: string, state: any): Promise<void> {
    await this.put('ratchetStates', { peerId, state, updatedAt: Date.now() });
  }

  async getRatchetState(peerId: string): Promise<any | undefined> {
    const result = await this.get('ratchetStates', peerId);
    return result?.state;
  }

  async deleteRatchetState(peerId: string): Promise<void> {
    await this.delete('ratchetStates', peerId);
  }

  async getAllRatchetStates(): Promise<any[]> {
    return this.getAll('ratchetStates');
  }

  // === Settings ===

  async saveSetting(key: string, value: any): Promise<void> {
    await this.put('settings', { key, value });
  }

  async getSetting(key: string): Promise<any | undefined> {
    const result = await this.get('settings', key);
    return result?.value;
  }

  /**
   * Retrieve the entire app-settings object in one call.
   * Returns a sensible default if not yet stored.
   */
  async getSettings<T extends Record<string, any>>(
    defaults: T,
  ): Promise<T> {
    const stored = await this.getSetting('app-settings');
    return stored ? { ...defaults, ...stored } as T : { ...defaults } as T;
  }

  /**
   * Persist the entire app-settings object in one call.
   */
  async saveSettings(settings: Record<string, any>): Promise<void> {
    await this.saveSetting('app-settings', settings);
  }

  // === Contacts ===

  async saveContact(contact: any): Promise<void> {
    await this.put('contacts', contact);
  }

  async getContact(peerId: string): Promise<any | undefined> {
    return this.get('contacts', peerId);
  }

  async getAllContacts(): Promise<any[]> {
    return this.getAll('contacts');
  }

  async deleteContact(peerId: string): Promise<void> {
    await this.delete('contacts', peerId);
  }

  // === Direct Conversations ===

  async saveDirectConversation(conversation: any): Promise<void> {
    await this.put('directConversations', conversation);
  }

  async getDirectConversation(id: string): Promise<any | undefined> {
    return this.get('directConversations', id);
  }

  async getDirectConversationByContact(contactPeerId: string): Promise<any | undefined> {
    return new Promise((resolve, reject) => {
      const tx = this.getDB().transaction('directConversations', 'readonly');
      const index = tx.objectStore('directConversations').index('contactPeerId');
      const request = index.get(contactPeerId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllDirectConversations(): Promise<any[]> {
    return this.getAll('directConversations');
  }

  async deleteDirectConversation(id: string): Promise<void> {
    await this.delete('directConversations', id);
  }

  // === Clear ===

  async clearAll(): Promise<void> {
    const db = this.getDB();
    const allStores = ['workspaces', 'messages', 'identity', 'peers', 'outbox', 'settings', 'ratchetStates', 'contacts', 'directConversations'];
    const storeNames = allStores.filter(s => db.objectStoreNames.contains(s));
    const tx = db.transaction(storeNames, 'readwrite');
    for (const name of storeNames) {
      tx.objectStore(name).clear();
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  // === Generic helpers ===

  private getDB(): IDBDatabase {
    if (!this.db) throw new Error('PersistentStore not initialized — call init() first');
    return this.db;
  }

  private async put(storeName: string, data: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.getDB().transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(data);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private async get(storeName: string, key: any): Promise<any | undefined> {
    return new Promise((resolve, reject) => {
      const tx = this.getDB().transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async getAll(storeName: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const tx = this.getDB().transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  private async delete(storeName: string, key: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.getDB().transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
