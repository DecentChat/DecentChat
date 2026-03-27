import type { BlobStorage } from '@decentchat/protocol';

const DB_NAME = 'decent-chat-media';
const DB_VERSION = 1;
const STORE_NAME = 'blobs';

/** IndexedDB-backed blob storage for MediaStore. */
export class IndexedDBBlobStorage implements BlobStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  async store(id: string, data: ArrayBuffer): Promise<void> {
    await this.set(id, data);
  }

  async get(id: string): Promise<ArrayBuffer | null> {
    return await this.withStore('readonly', (store) =>
      new Promise<ArrayBuffer | null>((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) ?? null);
        req.onerror = () => reject(req.error);
      })
    );
  }

  async set(id: string, data: ArrayBuffer): Promise<void> {
    await this.withStore('readwrite', (store) =>
      new Promise<void>((resolve, reject) => {
        const req = store.put(data, id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      })
    );
  }

  async delete(id: string): Promise<void> {
    await this.withStore('readwrite', (store) =>
      new Promise<void>((resolve, reject) => {
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      })
    );
  }

  async has(id: string): Promise<boolean> {
    return await this.withStore('readonly', (store) =>
      new Promise<boolean>((resolve, reject) => {
        const req = store.getKey(id);
        req.onsuccess = () => resolve(req.result !== undefined);
        req.onerror = () => reject(req.error);
      })
    );
  }

  async list(): Promise<string[]> {
    return await this.keys();
  }

  async keys(): Promise<string[]> {
    return await this.withStore('readonly', (store) =>
      new Promise<string[]>((resolve, reject) => {
        const req = store.getAllKeys();
        req.onsuccess = () => resolve((req.result as IDBValidKey[]).map((key) => String(key)));
        req.onerror = () => reject(req.error);
      })
    );
  }

  private async withStore<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => Promise<T>
  ): Promise<T> {
    const db = await this.getDb();
    const tx = db.transaction([STORE_NAME], mode);
    const store = tx.objectStore(STORE_NAME);

    const result = await fn(store);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    return result;
  }

  private async getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    return await this.dbPromise;
  }
}
