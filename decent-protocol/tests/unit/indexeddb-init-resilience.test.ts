import '../setup';
import { describe, test, expect } from 'bun:test';
import { PersistentStore } from '../../src/storage/PersistentStore';
import { KeyStore } from '../../src/crypto/KeyStore';
import { CryptoManager } from '../../src/crypto/CryptoManager';

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function openRawDatabase(name: string, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onerror = () => reject(req.error ?? new Error('Failed to open database'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      // no-op: used only to hold an open connection in tests
    };
  });
}

async function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onerror = () => reject(req.error ?? new Error(`Failed to delete DB ${name}`));
    req.onsuccess = () => resolve();
    req.onblocked = () => reject(new Error(`Deleting DB ${name} was blocked`));
  });
}

describe('IndexedDB init resilience', () => {
  test('PersistentStore closes stale connection on versionchange to avoid blocked upgrades', async () => {
    const dbName = `persistent-upgrade-${Date.now()}-${Math.random()}`;
    const storeV1 = new PersistentStore({ dbName, version: 1 });
    await storeV1.init();

    const storeV2 = new PersistentStore({ dbName, version: 2 });

    await expect(
      withTimeout(storeV2.init(), 500, 'PersistentStore v2 init')
    ).resolves.toBeUndefined();

    await storeV2.close();
    await storeV1.close();
    await deleteDatabase(dbName);
  });

  test('PersistentStore surfaces actionable blocked-upgrade error', async () => {
    const dbName = `persistent-blocked-${Date.now()}-${Math.random()}`;

    const blocker = await openRawDatabase(dbName, 1);
    const upgradingStore = new PersistentStore({ dbName, version: 2 });

    let thrown: unknown;
    try {
      await withTimeout(upgradingStore.init(), 500, 'PersistentStore blocked init');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    expect(thrown).toBeInstanceOf(Error);
    const err = thrown as Error & { code?: string };
    expect(err.name).toBe('IndexedDBInitError');
    expect(err.code).toBe('blocked');
    expect(err.message.toLowerCase()).toContain('close');
    expect(err.message.toLowerCase()).toContain('tab');

    blocker.close();
    await deleteDatabase(dbName);
  });

  test('PersistentStore coalesces concurrent init calls to a single IndexedDB.open', async () => {
    const dbName = `persistent-init-coalesce-${Date.now()}-${Math.random()}`;
    const store = new PersistentStore({ dbName, version: 1 });

    const originalOpen = indexedDB.open.bind(indexedDB);
    let openCalls = 0;
    (indexedDB as any).open = (...args: any[]) => {
      openCalls += 1;
      return originalOpen(...args as [string, number | undefined]);
    };

    try {
      await Promise.all([store.init(), store.init(), store.init()]);
    } finally {
      (indexedDB as any).open = originalOpen;
    }

    expect(openCalls).toBe(1);

    await store.close();
    await deleteDatabase(dbName);
  });

  test('KeyStore surfaces actionable blocked-upgrade error', async () => {
    const dbName = `keys-blocked-${Date.now()}-${Math.random()}`;

    const blocker = await openRawDatabase(dbName, 1);
    const keyStore = new KeyStore(new CryptoManager(), { dbName, version: 2 });

    let thrown: unknown;
    try {
      await withTimeout(keyStore.init(), 500, 'KeyStore blocked init');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    expect(thrown).toBeInstanceOf(Error);
    const err = thrown as Error & { code?: string };
    expect(err.name).toBe('IndexedDBInitError');
    expect(err.code).toBe('blocked');
    expect(err.message.toLowerCase()).toContain('close');
    expect(err.message.toLowerCase()).toContain('tab');

    blocker.close();
    await deleteDatabase(dbName);
  });

  test('KeyStore closes stale connection on versionchange to avoid blocked upgrades', async () => {
    const dbName = `keys-upgrade-${Date.now()}-${Math.random()}`;
    const keyStore = new KeyStore(new CryptoManager(), { dbName, version: 1 });
    await keyStore.init();

    const upgrade = new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(dbName, 2);
      req.onerror = () => reject(req.error ?? new Error('KeyStore upgrade failed'));
      req.onblocked = () => reject(new Error('KeyStore upgrade remained blocked'));
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onupgradeneeded = () => {
        // no-op
      };
    });

    await expect(
      withTimeout(upgrade, 500, 'KeyStore upgrade open')
    ).resolves.toBeUndefined();

    keyStore.close();
    await deleteDatabase(dbName);
  });

  test('KeyStore coalesces concurrent init calls to a single IndexedDB.open', async () => {
    const dbName = `keys-init-coalesce-${Date.now()}-${Math.random()}`;
    const keyStore = new KeyStore(new CryptoManager(), { dbName, version: 1 });

    const originalOpen = indexedDB.open.bind(indexedDB);
    let openCalls = 0;
    (indexedDB as any).open = (...args: any[]) => {
      openCalls += 1;
      return originalOpen(...args as [string, number | undefined]);
    };

    try {
      await Promise.all([keyStore.init(), keyStore.init(), keyStore.init()]);
    } finally {
      (indexedDB as any).open = originalOpen;
    }

    expect(openCalls).toBe(1);

    keyStore.close();
    await deleteDatabase(dbName);
  });
});
