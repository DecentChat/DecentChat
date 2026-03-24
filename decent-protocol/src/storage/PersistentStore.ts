/**
 * PersistentStore — IndexedDB persistence for workspaces, messages, and identity
 * 
 * Survives page refresh, tab close, device restart.
 * All data stays local (no server).
 */

import { AtRestEncryption } from './AtRestEncryption';
import type { DeliveryReceipt } from '../messages/CustodyTypes';
import type { PersistedLocalPreKeyState, PreKeyBundle } from '../messages/PreKeyTypes';
import type { ManifestStoreState, ManifestStoreWorkspaceState } from '../sync/ManifestStore';
import type {
  ChannelAccessPolicy,
  DirectoryShardRef,
  HistoryPageRef,
  HistoryPageSnapshot,
  MemberDirectoryPage,
  PresenceAggregate,
  WorkspaceShell,
} from '../workspace/types';
import {
  PUBLIC_WORKSPACE_STORES,
  makeChannelPolicyKey,
  makeDirectoryShardKey,
  makeHistoryPageKey,
  makeMemberDirectoryPageKey,
} from './schema/PublicWorkspaceStores';

export interface PersistentStoreConfig {
  dbName?: string;
  version?: number;
  openTimeoutMs?: number;
}

const MANIFEST_STORE_STATE_KEY = 'default';
const MANIFESTS_STORE = 'manifests';
const PRE_KEY_MAX_ONE_TIME_AGE_MS = 21 * 24 * 60 * 60 * 1000;
const PRE_KEY_MAX_BUNDLE_AGE_MS = 45 * 24 * 60 * 60 * 1000;
const DEFAULT_OPEN_TIMEOUT_MS = 12_000;

export class PersistentStore {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;
  private dbName: string;
  private version: number;
  private openTimeoutMs: number;
  /** T3.5: Optional at-rest encryption for message content */
  private atRest: AtRestEncryption | null = null;

  constructor(config: PersistentStoreConfig = {}) {
    this.dbName = config.dbName || 'decent-protocol';
    this.version = config.version || 9;
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
          `Timed out opening IndexedDB "${this.dbName}". Close other DecentChat tabs/windows and retry.`,
        ));
      }, this.openTimeoutMs);

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

        // Peer pre-key bundle cache (for async/offline session bootstrap)
        if (!db.objectStoreNames.contains('preKeyBundles')) {
          db.createObjectStore('preKeyBundles', { keyPath: 'peerId' });
        }

        // Local pre-key material (private keys for session-init consumption)
        if (!db.objectStoreNames.contains('preKeyStates')) {
          db.createObjectStore('preKeyStates', { keyPath: 'ownerPeerId' });
        }

        // Delivery receipts (durable custody/receipt reconciliation)
        if (!db.objectStoreNames.contains('deliveryReceipts')) {
          const receiptStore = db.createObjectStore('deliveryReceipts', { keyPath: 'key' });
          receiptStore.createIndex('recipientPeerId', 'recipientPeerId', { unique: false });
          receiptStore.createIndex('recipientTimestamp', ['recipientPeerId', 'timestamp'], { unique: false });
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

        // Sync manifest state (durable reconnect/restart convergence cache)
        if (!db.objectStoreNames.contains('manifestStates')) {
          db.createObjectStore('manifestStates', { keyPath: 'id' });
        }

        // Per-workspace manifest records (used by ManifestStore persistence callbacks)
        if (!db.objectStoreNames.contains(MANIFESTS_STORE)) {
          db.createObjectStore(MANIFESTS_STORE, { keyPath: 'workspaceId' });
        }

        // Public/adaptive workspace normalized stores
        if (!db.objectStoreNames.contains(PUBLIC_WORKSPACE_STORES.workspaceShells)) {
          db.createObjectStore(PUBLIC_WORKSPACE_STORES.workspaceShells, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(PUBLIC_WORKSPACE_STORES.memberDirectoryPages)) {
          const store = db.createObjectStore(PUBLIC_WORKSPACE_STORES.memberDirectoryPages, { keyPath: 'key' });
          store.createIndex('workspaceId', 'workspaceId', { unique: false });
        }
        if (!db.objectStoreNames.contains(PUBLIC_WORKSPACE_STORES.directoryShardRefs)) {
          const store = db.createObjectStore(PUBLIC_WORKSPACE_STORES.directoryShardRefs, { keyPath: 'key' });
          store.createIndex('workspaceId', 'workspaceId', { unique: false });
        }
        if (!db.objectStoreNames.contains(PUBLIC_WORKSPACE_STORES.channelPolicies)) {
          const store = db.createObjectStore(PUBLIC_WORKSPACE_STORES.channelPolicies, { keyPath: 'key' });
          store.createIndex('workspaceId', 'workspaceId', { unique: false });
        }
        if (!db.objectStoreNames.contains(PUBLIC_WORKSPACE_STORES.presenceAggregates)) {
          db.createObjectStore(PUBLIC_WORKSPACE_STORES.presenceAggregates, { keyPath: 'workspaceId' });
        }
        if (!db.objectStoreNames.contains(PUBLIC_WORKSPACE_STORES.historyPages)) {
          const store = db.createObjectStore(PUBLIC_WORKSPACE_STORES.historyPages, { keyPath: 'key' });
          store.createIndex('workspaceId', 'workspaceId', { unique: false });
          store.createIndex('channelId', 'channelId', { unique: false });
        }
      };

      request.onblocked = () => {
        fail(this.makeInitError(
          'blocked',
          `Opening IndexedDB "${this.dbName}" was blocked by another tab/window. Close other DecentChat tabs/windows and retry.`,
        ));
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!finish()) {
          try { db.close(); } catch {}
          return;
        }
        db.onversionchange = () => {
          console.warn(`[PersistentStore] versionchange detected for ${this.dbName}; closing stale connection.`);
          try {
            db.close();
          } finally {
            if (this.db === db) this.db = null;
          }
        };
        this.db = db;
        resolve();
      };

      request.onerror = () => {
        fail(this.makeInitError(
          'open-failed',
          `Failed to open IndexedDB "${this.dbName}": ${request.error?.message || 'unknown error'}`,
          request.error,
        ));
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

  // === Public Workspace Normalized Stores ===

  async saveWorkspaceShell(shell: WorkspaceShell): Promise<void> {
    await this.put(PUBLIC_WORKSPACE_STORES.workspaceShells, shell);
  }

  async getWorkspaceShell(id: string): Promise<WorkspaceShell | undefined> {
    return this.get(PUBLIC_WORKSPACE_STORES.workspaceShells, id);
  }

  async getAllWorkspaceShells(): Promise<WorkspaceShell[]> {
    return this.getAll(PUBLIC_WORKSPACE_STORES.workspaceShells) as Promise<WorkspaceShell[]>;
  }

  async saveMemberDirectoryPage(page: MemberDirectoryPage): Promise<void> {
    await this.put(PUBLIC_WORKSPACE_STORES.memberDirectoryPages, {
      ...page,
      key: makeMemberDirectoryPageKey(page.workspaceId, page.cursor),
    });
  }

  async getMemberDirectoryPage(workspaceId: string, cursor?: string): Promise<MemberDirectoryPage | undefined> {
    const result = await this.get(PUBLIC_WORKSPACE_STORES.memberDirectoryPages, makeMemberDirectoryPageKey(workspaceId, cursor));
    if (!result) return undefined;
    const { key, ...page } = result;
    return page as MemberDirectoryPage;
  }

  async getMemberDirectoryPages(workspaceId: string): Promise<MemberDirectoryPage[]> {
    const records = await this.getAllByIndex(PUBLIC_WORKSPACE_STORES.memberDirectoryPages, 'workspaceId', workspaceId);
    const pages = records.map(({ key, ...page }) => page as MemberDirectoryPage);
    return pages.sort((a, b) => {
      const ac = a.cursor || '';
      const bc = b.cursor || '';
      if (ac === bc) return 0;
      if (!ac) return -1;
      if (!bc) return 1;
      return ac.localeCompare(bc);
    });
  }

  async saveDirectoryShardRef(ref: DirectoryShardRef): Promise<void> {
    await this.put(PUBLIC_WORKSPACE_STORES.directoryShardRefs, {
      ...ref,
      key: makeDirectoryShardKey(ref.workspaceId, ref.shardId),
    });
  }

  async getDirectoryShardRefs(workspaceId: string): Promise<DirectoryShardRef[]> {
    const records = await this.getAllByIndex(PUBLIC_WORKSPACE_STORES.directoryShardRefs, 'workspaceId', workspaceId);
    return records.map(({ key, ...ref }) => ref as DirectoryShardRef);
  }

  async saveChannelPolicy(workspaceId: string, channelId: string, policy: ChannelAccessPolicy): Promise<void> {
    await this.put(PUBLIC_WORKSPACE_STORES.channelPolicies, {
      key: makeChannelPolicyKey(workspaceId, channelId),
      workspaceId,
      channelId,
      policy,
    });
  }

  async getChannelPolicy(workspaceId: string, channelId: string): Promise<ChannelAccessPolicy | undefined> {
    const result = await this.get(PUBLIC_WORKSPACE_STORES.channelPolicies, makeChannelPolicyKey(workspaceId, channelId));
    return result?.policy as ChannelAccessPolicy | undefined;
  }

  async savePresenceAggregate(aggregate: PresenceAggregate): Promise<void> {
    await this.put(PUBLIC_WORKSPACE_STORES.presenceAggregates, aggregate);
  }

  async getPresenceAggregate(workspaceId: string): Promise<PresenceAggregate | undefined> {
    return this.get(PUBLIC_WORKSPACE_STORES.presenceAggregates, workspaceId);
  }

  async saveHistoryPageRef(ref: HistoryPageRef): Promise<void> {
    const key = makeHistoryPageKey(ref.workspaceId, ref.channelId, ref.pageId);
    const existing = await this.get(PUBLIC_WORKSPACE_STORES.historyPages, key);
    await this.put(PUBLIC_WORKSPACE_STORES.historyPages, {
      ...existing,
      ...ref,
      key,
    });
  }

  async getHistoryPageRef(workspaceId: string, channelId: string, pageId: string): Promise<HistoryPageRef | undefined> {
    const result = await this.get(PUBLIC_WORKSPACE_STORES.historyPages, makeHistoryPageKey(workspaceId, channelId, pageId));
    if (!result) return undefined;
    const { key, ...ref } = result;
    return ref as HistoryPageRef;
  }

  async saveHistoryPage(page: HistoryPageSnapshot): Promise<void> {
    const key = makeHistoryPageKey(page.workspaceId, page.channelId, page.pageId);
    const existing = await this.get(PUBLIC_WORKSPACE_STORES.historyPages, key);
    await this.put(PUBLIC_WORKSPACE_STORES.historyPages, {
      ...existing,
      ...page,
      key,
    });
  }

  async getHistoryPage(workspaceId: string, channelId: string, pageId: string): Promise<HistoryPageSnapshot | undefined> {
    const result = await this.get(PUBLIC_WORKSPACE_STORES.historyPages, makeHistoryPageKey(workspaceId, channelId, pageId));
    if (!result) return undefined;
    const { key, ...page } = result;
    return page as HistoryPageSnapshot;
  }

  async getHistoryPages(workspaceId: string, channelId: string): Promise<HistoryPageSnapshot[]> {
    const records = await this.getAllByIndex(PUBLIC_WORKSPACE_STORES.historyPages, 'channelId', channelId);
    return records
      .filter((record) => record.workspaceId === workspaceId)
      .map(({ key, ...page }) => page as HistoryPageSnapshot)
      .sort((a, b) => (a.generatedAt || 0) - (b.generatedAt || 0));
  }

  async deletePublicWorkspaceData(workspaceId: string): Promise<void> {
    if (!workspaceId) return;

    if (this.hasStore(PUBLIC_WORKSPACE_STORES.workspaceShells)) {
      await this.delete(PUBLIC_WORKSPACE_STORES.workspaceShells, workspaceId);
    }

    if (this.hasStore(PUBLIC_WORKSPACE_STORES.memberDirectoryPages)) {
      const pages = await this.getAllByIndex(PUBLIC_WORKSPACE_STORES.memberDirectoryPages, 'workspaceId', workspaceId);
      for (const page of pages) {
        if (page?.key) await this.delete(PUBLIC_WORKSPACE_STORES.memberDirectoryPages, page.key);
      }
    }

    if (this.hasStore(PUBLIC_WORKSPACE_STORES.directoryShardRefs)) {
      const refs = await this.getAllByIndex(PUBLIC_WORKSPACE_STORES.directoryShardRefs, 'workspaceId', workspaceId);
      for (const ref of refs) {
        if (ref?.key) await this.delete(PUBLIC_WORKSPACE_STORES.directoryShardRefs, ref.key);
      }
    }

    if (this.hasStore(PUBLIC_WORKSPACE_STORES.channelPolicies)) {
      const policies = await this.getAllByIndex(PUBLIC_WORKSPACE_STORES.channelPolicies, 'workspaceId', workspaceId);
      for (const policy of policies) {
        if (policy?.key) await this.delete(PUBLIC_WORKSPACE_STORES.channelPolicies, policy.key);
      }
    }

    if (this.hasStore(PUBLIC_WORKSPACE_STORES.presenceAggregates)) {
      await this.delete(PUBLIC_WORKSPACE_STORES.presenceAggregates, workspaceId);
    }

    if (this.hasStore(PUBLIC_WORKSPACE_STORES.historyPages)) {
      const pages = await this.getAllByIndex(PUBLIC_WORKSPACE_STORES.historyPages, 'workspaceId', workspaceId);
      for (const page of pages) {
        if (page?.key) await this.delete(PUBLIC_WORKSPACE_STORES.historyPages, page.key);
      }
    }
  }

  // === Messages ===

  /**
   * T3.5: Set the at-rest encryption handler.
   * Once set, message content is encrypted before storage and decrypted on read.
   * Call after the user's seed phrase has been loaded and keys derived.
   */
  setAtRestEncryption(enc: AtRestEncryption | null): void {
    this.atRest = enc;
  }

  async saveMessage(message: any): Promise<void> {
    if (this.atRest?.ready && typeof message?.content === 'string') {
      const encrypted = await this.atRest.encrypt(message.content);
      await this.put('messages', { ...message, content: encrypted });
    } else {
      await this.put('messages', message);
    }
  }

  async saveMessages(messages: any[]): Promise<void> {
    // T3.5: Encrypt content before batch-saving if at-rest encryption is active
    const toStore = this.atRest?.ready
      ? await Promise.all(
          messages.map(async (msg) =>
            typeof msg?.content === 'string'
              ? { ...msg, content: await this.atRest!.encrypt(msg.content) }
              : msg,
          ),
        )
      : messages;

    const tx = this.getDB().transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    for (const msg of toStore) {
      store.put(msg);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Load messages for a specific channel from persistence.
   * Used on startup to restore messages that survive page refresh.
   * Returns messages sorted by timestamp ascending.
   */
  async getMessagesByChannel(channelId: string): Promise<any[]> {
    const tx = this.getDB().transaction('messages', 'readonly');
    const store = tx.objectStore('messages');
    const index = store.index('channelId');
    const request = index.getAll(channelId);
    return new Promise((resolve, reject) => {
      request.onsuccess = async () => {
        const messages = request.result || [];
        // T3.5: Decrypt content if at-rest encryption is active
        if (this.atRest?.ready) {
          for (const msg of messages) {
            if (typeof msg?.content === 'string') {
              try {
                msg.content = await this.atRest.decrypt(msg.content);
              } catch {
                // Keep encrypted if decryption fails
              }
            }
          }
        }
        // Sort by timestamp ascending (consistent with MessageStore expectations)
        messages.sort((a: any, b: any) => a.timestamp - b.timestamp);
        resolve(messages);
      };
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async getChannelMessages(channelId: string): Promise<any[]> {
    const messages: any[] = await new Promise((resolve, reject) => {
      const tx = this.getDB().transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const index = store.index('channelId');
      const request = index.getAll(channelId);
      request.onsuccess = () => {
        const msgs = request.result || [];
        msgs.sort((a: any, b: any) => a.timestamp - b.timestamp);
        resolve(msgs);
      };
      request.onerror = () => reject(request.error);
    });

    // T3.5: Decrypt message content if at-rest encryption is active
    if (this.atRest) {
      return Promise.all(
        messages.map(async (msg) => {
          if (typeof msg?.content === 'string' && AtRestEncryption.isEncrypted(msg.content)) {
            return { ...msg, content: await this.atRest!.decrypt(msg.content) };
          }
          return msg;
        }),
      );
    }

    return messages;
  }

  /**
   * Load the N most-recent messages for a channel using the compound
   * (channelId, timestamp) index.  Returns messages sorted oldest-first.
   * Falls back to getChannelMessages() if the compound index is unavailable.
   */
  async getRecentChannelMessages(channelId: string, limit: number): Promise<any[]> {
    const messages: any[] = await new Promise((resolve, reject) => {
      const tx = this.getDB().transaction('messages', 'readonly');
      const store = tx.objectStore('messages');

      let index: IDBIndex;
      try {
        index = store.index('channelTimestamp');
      } catch {
        // Compound index not available (older DB version) — fall back.
        const req = store.index('channelId').getAll(channelId);
        req.onsuccess = () => {
          const msgs = req.result || [];
          msgs.sort((a: any, b: any) => a.timestamp - b.timestamp);
          resolve(msgs.slice(-limit));
        };
        req.onerror = () => reject(req.error);
        return;
      }

      // Open a reverse cursor over [channelId, -Infinity] → [channelId, +Infinity]
      const range = IDBKeyRange.bound([channelId, -Infinity], [channelId, Infinity]);
      const request = index.openCursor(range, 'prev');
      const collected: any[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor && collected.length < limit) {
          collected.push(cursor.value);
          cursor.continue();
        } else {
          // collected is newest-first; reverse to oldest-first
          collected.reverse();
          resolve(collected);
        }
      };
      request.onerror = () => reject(request.error);
    });

    // T3.5: Decrypt message content if at-rest encryption is active
    if (this.atRest) {
      return Promise.all(
        messages.map(async (msg) => {
          if (typeof msg?.content === 'string' && AtRestEncryption.isEncrypted(msg.content)) {
            return { ...msg, content: await this.atRest!.decrypt(msg.content) };
          }
          return msg;
        }),
      );
    }

    return messages;
  }

  /**
   * Load the most recent messages for multiple channels in a single IDB
   * transaction.  Returns a Map keyed by channelId.  Channels with no
   * messages are omitted from the result.  At-rest decryption (if active)
   * runs in parallel across all channels.
   */
  async getRecentMessagesForChannels(
    channelIds: string[],
    limitPerChannel: number,
  ): Promise<Map<string, any[]>> {
    if (channelIds.length === 0) return new Map();

    const tx = this.getDB().transaction('messages', 'readonly');
    const store = tx.objectStore('messages');

    // Try the compound index (channelId, timestamp).
    let hasCompoundIndex = true;
    try {
      store.index('channelTimestamp');
    } catch {
      hasCompoundIndex = false;
    }

    // Launch one cursor per channel concurrently within the SAME transaction.
    const channelPromises = channelIds.map((channelId) =>
      new Promise<[string, any[]]>((resolve, reject) => {
        if (hasCompoundIndex) {
          const idx = store.index('channelTimestamp');
          const range = IDBKeyRange.bound([channelId, -Infinity], [channelId, Infinity]);
          const request = idx.openCursor(range, 'prev');
          const collected: any[] = [];
          request.onsuccess = () => {
            const cursor = request.result;
            if (cursor && collected.length < limitPerChannel) {
              collected.push(cursor.value);
              cursor.continue();
            } else {
              collected.reverse();
              resolve([channelId, collected]);
            }
          };
          request.onerror = () => reject(request.error);
        } else {
          // Fallback for older DB without compound index
          const idx = store.index('channelId');
          const req = idx.getAll(channelId);
          req.onsuccess = () => {
            const msgs = req.result || [];
            msgs.sort((a: any, b: any) => a.timestamp - b.timestamp);
            resolve([channelId, msgs.slice(-limitPerChannel)]);
          };
          req.onerror = () => reject(req.error);
        }
      }),
    );

    const results = await Promise.all(channelPromises);

    // At-rest decryption — decrypt all channels in parallel
    const resultMap = new Map<string, any[]>();
    if (this.atRest) {
      const decryptPromises = results.map(async ([channelId, messages]) => {
        if (messages.length === 0) return;
        const decrypted = await Promise.all(
          messages.map(async (msg) => {
            if (typeof msg?.content === 'string' && AtRestEncryption.isEncrypted(msg.content)) {
              return { ...msg, content: await this.atRest!.decrypt(msg.content) };
            }
            return msg;
          }),
        );
        resultMap.set(channelId, decrypted);
      });
      await Promise.all(decryptPromises);
    } else {
      for (const [channelId, messages] of results) {
        if (messages.length > 0) {
          resultMap.set(channelId, messages);
        }
      }
    }

    return resultMap;
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

  /**
   * Load messages for a channel that are older than `beforeTimestamp`.
   * Returns up to `limit` messages sorted oldest-first (ascending timestamp).
   * Used for on-demand "load more" when the user scrolls up.
   */
  async getOlderChannelMessages(channelId: string, beforeTimestamp: number, limit: number): Promise<any[]> {
    const messages: any[] = await new Promise((resolve, reject) => {
      const tx = this.getDB().transaction('messages', 'readonly');
      const store = tx.objectStore('messages');

      let index: IDBIndex;
      try {
        index = store.index('channelTimestamp');
      } catch {
        // Compound index not available — fallback to full getAll + filter.
        const req = store.index('channelId').getAll(channelId);
        req.onsuccess = () => {
          const msgs = (req.result || [])
            .filter((m: any) => m.timestamp < beforeTimestamp)
            .sort((a: any, b: any) => a.timestamp - b.timestamp);
          resolve(msgs.slice(-limit));
        };
        req.onerror = () => reject(req.error);
        return;
      }

      // Reverse cursor from just below beforeTimestamp back to the beginning of the channel.
      const range = IDBKeyRange.bound([channelId, -Infinity], [channelId, beforeTimestamp], false, true);
      const request = index.openCursor(range, 'prev');
      const collected: any[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor && collected.length < limit) {
          collected.push(cursor.value);
          cursor.continue();
        } else {
          // collected is newest-first; reverse to oldest-first
          collected.reverse();
          resolve(collected);
        }
      };
      request.onerror = () => reject(request.error);
    });

    // T3.5: Decrypt message content if at-rest encryption is active
    if (this.atRest) {
      return Promise.all(
        messages.map(async (msg) => {
          if (typeof msg?.content === 'string' && AtRestEncryption.isEncrypted(msg.content)) {
            return { ...msg, content: await this.atRest!.decrypt(msg.content) };
          }
          return msg;
        }),
      );
    }

    return messages;
  }

  /**
   * Re-key all persisted messages from one channel ID to another.
   * Keeps message IDs intact (upsert by primary key), only updates channelId.
   */
  async remapChannelMessages(oldChannelId: string, newChannelId: string): Promise<void> {
    if (!oldChannelId || !newChannelId || oldChannelId === newChannelId) return;
    const messages = await this.getChannelMessages(oldChannelId);
    if (messages.length === 0) return;
    await this.saveMessages(messages.map((m) => ({ ...m, channelId: newChannelId })));
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.delete('messages', messageId);
  }

  /** Bulk-delete messages by ID. More efficient than calling deleteMessage() in a loop. */
  async deleteMessages(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    const tx = this.getDB().transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    for (const id of messageIds) {
      store.delete(id);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
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

  async enqueueMessage(targetPeerId: string, data: any, meta: Record<string, any> = {}): Promise<void> {
    await this.put('outbox', {
      targetPeerId,
      data,
      createdAt: meta.createdAt ?? Date.now(),
      attempts: meta.attempts ?? 0,
      lastAttempt: meta.lastAttempt ?? 0,
      ...meta,
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

  /** Bulk-dequeue outbox messages by ID. Single IDB transaction instead of N separate ones. */
  async dequeueMessages(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    if (ids.length === 1) { await this.delete('outbox', ids[0]); return; }
    const tx = this.getDB().transaction('outbox', 'readwrite');
    const store = tx.objectStore('outbox');
    for (const id of ids) {
      store.delete(id);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async updateQueuedMessage(id: number, patch: Record<string, any>): Promise<void> {
    const existing = await this.get('outbox', id);
    if (!existing) return;
    await this.put('outbox', { ...existing, ...patch });
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

  // === Delivery Receipts ===

  async saveDeliveryReceipt(receipt: DeliveryReceipt): Promise<void> {
    await this.put('deliveryReceipts', {
      ...receipt,
      key: this.makeDeliveryReceiptKey(receipt.recipientPeerId, receipt.receiptId),
    });
  }

  async getDeliveryReceipts(recipientPeerId: string): Promise<DeliveryReceipt[]> {
    const records = await this.getAllByIndex('deliveryReceipts', 'recipientPeerId', recipientPeerId);
    return records
      .map(({ key, ...receipt }) => receipt as DeliveryReceipt)
      .sort((a, b) => a.timestamp - b.timestamp || a.receiptId.localeCompare(b.receiptId));
  }

  async deleteDeliveryReceipt(recipientPeerId: string, receiptId: string): Promise<void> {
    await this.delete('deliveryReceipts', this.makeDeliveryReceiptKey(recipientPeerId, receiptId));
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

  // === Pre-key Bundles / Local Pre-key State ===

  async savePreKeyBundle(peerId: string, bundle: PreKeyBundle): Promise<void> {
    await this.put('preKeyBundles', { peerId, bundle, updatedAt: Date.now() });
  }

  async getPreKeyBundle(peerId: string): Promise<PreKeyBundle | undefined> {
    const result = await this.get('preKeyBundles', peerId);
    return result?.bundle as PreKeyBundle | undefined;
  }

  async deletePreKeyBundle(peerId: string): Promise<void> {
    await this.delete('preKeyBundles', peerId);
  }

  async prunePreKeyBundles(opts?: {
    now?: number;
    maxBundleAgeMs?: number;
    maxOneTimePreKeyAgeMs?: number;
  }): Promise<{ deleted: number; updated: number }> {
    if (!this.hasStore('preKeyBundles')) return { deleted: 0, updated: 0 };

    const now = opts?.now ?? Date.now();
    const maxBundleAgeMs = opts?.maxBundleAgeMs ?? PRE_KEY_MAX_BUNDLE_AGE_MS;
    const maxOneTimePreKeyAgeMs = opts?.maxOneTimePreKeyAgeMs ?? PRE_KEY_MAX_ONE_TIME_AGE_MS;
    const minOneTimeCreatedAt = now - maxOneTimePreKeyAgeMs;

    const records = await this.getAll('preKeyBundles') as Array<{ peerId: string; bundle: PreKeyBundle; updatedAt?: number }>;
    if (records.length === 0) return { deleted: 0, updated: 0 };

    return new Promise((resolve, reject) => {
      const tx = this.getDB().transaction('preKeyBundles', 'readwrite');
      const store = tx.objectStore('preKeyBundles');

      let deleted = 0;
      let updated = 0;

      for (const record of records) {
        const peerId = typeof record?.peerId === 'string' ? record.peerId : '';
        const bundle = record?.bundle;

        const signedExpiresAt = Number(bundle?.signedPreKey?.expiresAt);
        const generatedAt = Number(bundle?.generatedAt);

        const shouldDelete = (
          !peerId
          || !bundle
          || !Number.isFinite(signedExpiresAt)
          || signedExpiresAt <= now
          || !Number.isFinite(generatedAt)
          || generatedAt < (now - maxBundleAgeMs)
        );

        if (shouldDelete) {
          store.delete(peerId || (record as any)?.peerId);
          deleted += 1;
          continue;
        }

        const seen = new Set<number>();
        const sanitizedOneTime = bundle.oneTimePreKeys
          .slice()
          .sort((a, b) => a.keyId - b.keyId)
          .filter((entry) => {
            if (!entry?.publicKey) return false;
            if (!Number.isFinite(entry.keyId) || entry.keyId <= 0) return false;
            if (!Number.isFinite(entry.createdAt) || entry.createdAt < minOneTimeCreatedAt) return false;
            if (seen.has(entry.keyId)) return false;
            seen.add(entry.keyId);
            return true;
          });

        if (sanitizedOneTime.length === bundle.oneTimePreKeys.length) continue;

        store.put({
          ...record,
          peerId,
          bundle: {
            ...bundle,
            oneTimePreKeys: sanitizedOneTime,
          },
          updatedAt: now,
        });
        updated += 1;
      }

      tx.oncomplete = () => resolve({ deleted, updated });
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async saveLocalPreKeyState(ownerPeerId: string, state: PersistedLocalPreKeyState): Promise<void> {
    await this.put('preKeyStates', { ownerPeerId, state, updatedAt: Date.now() });
  }

  async getLocalPreKeyState(ownerPeerId: string): Promise<PersistedLocalPreKeyState | undefined> {
    const result = await this.get('preKeyStates', ownerPeerId);
    return result?.state as PersistedLocalPreKeyState | undefined;
  }

  async deleteLocalPreKeyState(ownerPeerId: string): Promise<void> {
    await this.delete('preKeyStates', ownerPeerId);
  }

  // === Sync Manifest State ===

  async saveManifestStoreState(state: ManifestStoreState): Promise<void> {
    if (this.hasStore('manifestStates')) {
      await this.put('manifestStates', {
        id: MANIFEST_STORE_STATE_KEY,
        state,
        updatedAt: Date.now(),
      });
      return;
    }

    // Backward-compat fallback for pre-v7 DBs opened with a pinned lower version.
    await this.saveSetting('_manifestStoreState', state);
  }

  async getManifestStoreState(): Promise<ManifestStoreState | undefined> {
    if (this.hasStore('manifestStates')) {
      const result = await this.get('manifestStates', MANIFEST_STORE_STATE_KEY);
      return result?.state as ManifestStoreState | undefined;
    }

    return this.getSetting('_manifestStoreState') as Promise<ManifestStoreState | undefined>;
  }

  async clearManifestStoreState(): Promise<void> {
    if (this.hasStore('manifestStates')) {
      await this.delete('manifestStates', MANIFEST_STORE_STATE_KEY);
      return;
    }

    await this.saveSetting('_manifestStoreState', undefined);
  }

  async saveManifest(workspaceId: string, state: ManifestStoreWorkspaceState): Promise<void> {
    if (!workspaceId) return;

    if (this.hasStore(MANIFESTS_STORE)) {
      await this.put(MANIFESTS_STORE, {
        workspaceId,
        state,
        updatedAt: Date.now(),
      });
      return;
    }

    const legacyState = (await this.getManifestStoreState()) || { schemaVersion: 1, workspaces: [] };
    const workspaces = Array.isArray(legacyState.workspaces)
      ? [...legacyState.workspaces.filter((entry) => entry?.workspaceId !== workspaceId), state]
      : [state];
    await this.saveManifestStoreState({
      ...legacyState,
      schemaVersion: legacyState.schemaVersion || 1,
      workspaces,
    });
  }

  async getManifest(workspaceId: string): Promise<ManifestStoreWorkspaceState | undefined> {
    if (!workspaceId) return undefined;

    if (this.hasStore(MANIFESTS_STORE)) {
      const result = await this.get(MANIFESTS_STORE, workspaceId);
      return result?.state as ManifestStoreWorkspaceState | undefined;
    }

    const legacyState = await this.getManifestStoreState();
    if (!legacyState || !Array.isArray(legacyState.workspaces)) return undefined;
    return legacyState.workspaces.find((entry) => entry?.workspaceId === workspaceId);
  }

  async deleteManifest(workspaceId: string): Promise<void> {
    if (!workspaceId) return;

    if (this.hasStore(MANIFESTS_STORE)) {
      await this.delete(MANIFESTS_STORE, workspaceId);
      return;
    }

    const legacyState = await this.getManifestStoreState();
    if (!legacyState || !Array.isArray(legacyState.workspaces)) return;

    const nextWorkspaces = legacyState.workspaces.filter((entry) => entry?.workspaceId !== workspaceId);
    if (nextWorkspaces.length === legacyState.workspaces.length) return;

    await this.saveManifestStoreState({
      ...legacyState,
      workspaces: nextWorkspaces,
    });
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
    const allStores = [
      'workspaces',
      'messages',
      'identity',
      'peers',
      'outbox',
      'settings',
      'ratchetStates',
      'preKeyBundles',
      'preKeyStates',
      'deliveryReceipts',
      'contacts',
      'directConversations',
      'manifestStates',
      PUBLIC_WORKSPACE_STORES.workspaceShells,
      PUBLIC_WORKSPACE_STORES.memberDirectoryPages,
      PUBLIC_WORKSPACE_STORES.directoryShardRefs,
      PUBLIC_WORKSPACE_STORES.channelPolicies,
      PUBLIC_WORKSPACE_STORES.presenceAggregates,
      PUBLIC_WORKSPACE_STORES.historyPages,
    ];
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


  private makeInitError(code: 'blocked' | 'timeout' | 'open-failed', message: string, cause?: unknown): Error {
    const error = new Error(message) as Error & { code?: string; cause?: unknown };
    error.name = 'IndexedDBInitError';
    error.code = code;
    if (cause !== undefined) error.cause = cause;
    return error;
  }

  // === Generic helpers ===

  private hasStore(storeName: string): boolean {
    return this.getDB().objectStoreNames.contains(storeName);
  }

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

  private async getAllByIndex(storeName: string, indexName: string, key: any): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const tx = this.getDB().transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).index(indexName).getAll(key);
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

  private makeDeliveryReceiptKey(recipientPeerId: string, receiptId: string): string {
    return `${recipientPeerId}:${receiptId}`;
  }
}
