/**
 * Storage Migrations — Versioned schema upgrades
 * 
 * Each migration is a function that transforms data from version N to N+1.
 * Migrations run sequentially when the stored version is older than code version.
 */

export const CURRENT_STORAGE_VERSION = 4;
export const CURRENT_SCHEMA_VERSION = CURRENT_STORAGE_VERSION; // Alias for compatibility

export interface MigrationContext {
  db: IDBDatabase;
  transaction: IDBTransaction;
  oldVersion: number;
  newVersion: number;
}

/**
 * Migration from v3 to v4 (Feb 2026)
 * - Add PEX server discovery data
 * - No schema changes, just version bump for compatibility check
 */
async function migrateV3toV4(ctx: MigrationContext): Promise<void> {
  console.log('[Migration] v3 → v4: Adding PEX support');
  
  // PEX data is stored in settings with key pattern "pex:workspaceId"
  // No migration needed, just version bump
  
  // Create a marker to indicate this migration ran
  const settingsStore = ctx.transaction.objectStore('settings');
  settingsStore.put({
    key: 'migration:v4',
    value: { timestamp: Date.now(), note: 'PEX support added' }
  });
}

/**
 * All available migrations (exported for introspection)
 */
export const ALL_MIGRATIONS: Record<number, (ctx: MigrationContext) => Promise<void>> = {
  4: migrateV3toV4,
  // Add future migrations here:
  // 5: migrateV4toV5,
};

/**
 * Run all necessary migrations to bring storage from oldVersion to newVersion
 */
export async function runMigrations(db: IDBDatabase, oldVersion: number, newVersion: number): Promise<void> {
  console.log(`[Storage] Migrating from v${oldVersion} to v${newVersion}`);
  
  // Create a transaction for migrations
  const transaction = db.transaction(
    Array.from(db.objectStoreNames), 
    'readwrite'
  );
  
  const ctx: MigrationContext = { db, transaction, oldVersion, newVersion };
  
  // Run migrations sequentially
  for (let v = oldVersion + 1; v <= newVersion; v++) {
    if (ALL_MIGRATIONS[v]) {
      await ALL_MIGRATIONS[v](ctx);
    }
  }
  
  // Store the new version
  const settingsStore = transaction.objectStore('settings');
  settingsStore.put({
    key: 'storage_version',
    value: newVersion
  });
  
  // Wait for transaction to complete
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  
  console.log(`[Storage] Migration complete: v${oldVersion} → v${newVersion}`);
}

/**
 * Get stored version from settings
 */
export async function getStoredVersion(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('settings', 'readonly');
    const store = transaction.objectStore('settings');
    const request = store.get('storage_version');
    
    request.onsuccess = () => {
      const result = request.result;
      // If no version stored, assume v3 (first versioned release)
      resolve(result?.value || 3);
    };
    
    request.onerror = () => {
      // If settings store doesn't exist yet, we're at v0
      resolve(0);
    };
  });
}
