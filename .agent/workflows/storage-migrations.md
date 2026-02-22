# Storage Migrations Workflow

When making changes to IndexedDB schema or data format, follow this workflow to avoid breaking existing users.

## When to Create a Migration

**Always create a migration for:**
- Adding/removing object stores
- Adding/removing indexes
- Changing key paths or auto-increment behavior
- Changing message format (new fields, removed fields)
- Changing encryption scheme
- Any protocol-level changes that affect stored data

**No migration needed for:**
- UI changes
- New settings (with defaults)
- Bug fixes that don't change data structure
- Adding optional fields to existing records (if code handles missing fields gracefully)

## Migration Strategy

### Option 1: Version Bump + Clear Data (v0.1.0 approach)

**When to use:**
- Early development (v0.x) with no real users
- Testing phase only
- Breaking changes that are too complex to migrate

**Implementation:**
1. Bump `PersistentStore` version in `decent-protocol/src/storage/PersistentStore.ts`
2. Show clear error message with "Clear Local Data" button
3. Document breaking change in CHANGELOG
4. Announce to users (if any)

**Code:**
```typescript
constructor(config: PersistentStoreConfig = {}) {
  this.dbName = config.dbName || 'decent-protocol';
  this.version = config.version || 4; // ← Increment this
}
```

### Option 2: Versioned Migrations (v1.0+ approach)

**When to use:**
- Production with real users
- Data is valuable (workspaces, messages, keys)
- Migration path is straightforward

**Implementation:**

1. **Create migration module** (`decent-protocol/src/storage/migrations.ts`):

```typescript
export const CURRENT_STORAGE_VERSION = 5;

export interface MigrationContext {
  db: IDBDatabase;
  transaction: IDBTransaction;
  oldVersion: number;
  newVersion: number;
}

async function migrateV4toV5(ctx: MigrationContext): Promise<void> {
  console.log('[Migration] v4 → v5: Adding Negentropy support');
  
  // Example: Transform message format
  const messagesStore = ctx.transaction.objectStore('messages');
  const messages = await getAllFromStore(messagesStore);
  
  for (const msg of messages) {
    // Transform data
    msg.newField = transformOldData(msg.oldField);
    delete msg.oldField;
    
    // Save back
    await messagesStore.put(msg);
  }
  
  // Mark migration complete
  const settingsStore = ctx.transaction.objectStore('settings');
  settingsStore.put({
    key: 'migration:v5',
    value: { timestamp: Date.now(), note: 'Negentropy support added' }
  });
}

export const ALL_MIGRATIONS: Record<number, (ctx: MigrationContext) => Promise<void>> = {
  4: migrateV3toV4,
  5: migrateV4toV5,
};
```

2. **Update PersistentStore** to run migrations on open:

```typescript
request.onsuccess = async (event) => {
  this.db = (event.target as IDBOpenDBRequest).result;
  
  const storedVersion = await getStoredVersion(this.db);
  
  if (storedVersion < this.version) {
    console.log(`Running migrations from v${storedVersion} to v${this.version}`);
    await runMigrations(this.db, storedVersion, this.version);
  }
  
  resolve();
};
```

3. **Test migration** with actual old data:
   - Export user's IndexedDB from DevTools
   - Import into test environment
   - Run migration
   - Verify data integrity

4. **Provide rollback** (advanced):
   - Export backup before migration
   - Store in `localStorage` with version tag
   - On failure, restore from backup

## IndexedDB Version Rules

**Critical constraints:**
1. **Version must be an integer** (no decimals)
2. **Cannot downgrade** - IndexedDB blocks opening older version
3. **onupgradeneeded ONLY runs** when version increases
4. **Schema changes ONLY in onupgradeneeded** - cannot add object stores after

**Safe pattern:**
```typescript
request.onupgradeneeded = (event) => {
  const db = (event.target as IDBOpenDBRequest).result;
  const oldVersion = event.oldVersion;
  
  // Check old version to avoid double-creating stores
  if (oldVersion < 4 && !db.objectStoreNames.contains('newStore')) {
    db.createObjectStore('newStore', { keyPath: 'id' });
  }
};
```

## Testing Migrations

### Manual Test Checklist

1. **Create old data:**
   ```javascript
   // In DevTools Console on old version
   const db = await indexedDB.databases();
   console.log(db); // Note structure
   ```

2. **Export data:**
   - DevTools → Application → IndexedDB → Right-click → Export

3. **Deploy new version**

4. **Import old data:**
   - Clear new DB first
   - Import old data
   - Refresh page

5. **Verify migration:**
   - Check console for migration logs
   - Inspect data structure in DevTools
   - Test app functionality (send message, create workspace)

6. **Check for errors:**
   - Console errors?
   - Missing data?
   - App crashes?

### Automated Testing

```typescript
// decent-protocol/tests/unit/migrations.test.ts
test('Migration v4 → v5 preserves messages', async () => {
  // Create v4 database
  const oldDb = await createV4Database();
  await oldDb.put('messages', { id: 'msg-1', content: 'test' });
  oldDb.close();
  
  // Run migration
  const newDb = await new PersistentStore({ version: 5 }).init();
  
  // Verify data
  const msg = await newDb.get('messages', 'msg-1');
  expect(msg).toBeDefined();
  expect(msg.newField).toBe(transformOldData(msg.oldField));
});
```

## Deployment Checklist

Before shipping a schema change:

- [ ] Version bumped in PersistentStore.ts
- [ ] Migration written (if needed)
- [ ] Migration tested with real old data
- [ ] Console logging added (start, progress, complete, errors)
- [ ] Error handling for failed migrations (show "Clear Data" option)
- [ ] CHANGELOG updated
- [ ] If breaking: announce to users via email/Discord/in-app banner

## Common Pitfalls

**❌ Don't:**
- Change version without testing old data
- Assume users will "just clear their data"
- Add object stores outside `onupgradeneeded`
- Use decimal versions (4.1, 4.2) - must be integers
- Deploy on Friday (weekend = migration issues with no support)

**✅ Do:**
- Test migration with exported real user data
- Log each migration step to console
- Provide graceful fallback (error screen + clear data button)
- Version bump = semver major if breaking, minor if compatible
- Deploy early in week so you can fix issues quickly

## Emergency Rollback

If a migration fails in production:

1. **Immediately revert** the deployment
2. **Communicate** to users (in-app banner, email)
3. **Fix locally** with exported user data
4. **Test thoroughly**
5. **Redeploy** with fix

**Quick fix pattern:**
```typescript
// If migration v5 is broken, bump to v6 with a fix
async function migrateV5toV6(ctx: MigrationContext): Promise<void> {
  // Fix the broken v5 migration
  // Or: revert to v4 structure if needed
}
```

## Future-Proofing

**Design for migrations from day 1:**

1. **Semantic versioning** in storage
   ```typescript
   const SCHEMA_VERSION = { major: 1, minor: 0, patch: 0 };
   // major = breaking, minor = additive, patch = fixes
   ```

2. **Optional fields** everywhere
   ```typescript
   interface Message {
     id: string;
     content: string;
     timestamp: number;
     // New fields are optional
     reactions?: Reaction[];
     threads?: Thread[];
   }
   ```

3. **Feature flags** for gradual rollout
   ```typescript
   const settings = await persistentStore.getSettings();
   if (settings.featureFlags?.negentropySync) {
     // Use new sync method
   } else {
     // Fall back to old method
   }
   ```

4. **Export/import** functionality
   - Let users export their data as JSON
   - Worst case: they can re-import after clearing

## Resources

- [IndexedDB onupgradeneeded docs](https://developer.mozilla.org/en-US/docs/Web/API/IDBOpenDBRequest/upgradeneeded_event)
- [Storage migration patterns](https://web.dev/indexeddb-best-practices/)
- DecentChat reference implementation: `decent-protocol/src/storage/migrations.ts` (commented out for v0.1.0)

---

**Remember:** Breaking user data is worse than shipping slower. When in doubt, migrate conservatively.
