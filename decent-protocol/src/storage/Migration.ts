/**
 * Migration — Database schema versioning and data transformation
 * 
 * When protocol changes require data transformation (new fields,
 * renamed properties, schema changes), migrations handle the upgrade
 * automatically on app startup.
 * 
 * Each migration has:
 *   - version number (sequential)
 *   - description
 *   - up() function to transform data forward
 *   - down() function to rollback (optional)
 * 
 * On startup: check current version → run all pending migrations in order.
 */

export interface Migration {
  /** Sequential version number (1, 2, 3, ...) */
  version: number;
  /** Human-readable description */
  description: string;
  /** Transform data forward */
  up: (ctx: MigrationContext) => Promise<void>;
  /** Rollback (optional) */
  down?: (ctx: MigrationContext) => Promise<void>;
}

/** Context passed to migration functions */
export interface MigrationContext {
  /** Read all items from an object store */
  getAll: (storeName: string) => Promise<any[]>;
  /** Write an item to an object store */
  put: (storeName: string, item: any) => Promise<void>;
  /** Delete an item by key */
  delete: (storeName: string, key: string) => Promise<void>;
  /** Clear an entire store */
  clear: (storeName: string) => Promise<void>;
  /** Get a setting */
  getSetting: (key: string) => Promise<any>;
  /** Set a setting */
  setSetting: (key: string, value: any) => Promise<void>;
  /** Log migration progress */
  log: (message: string) => void;
}

/** Migration result */
export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  migrationsRun: number;
  errors: Array<{ version: number; error: string }>;
  duration: number;
}

export class MigrationRunner {
  private migrations: Migration[] = [];

  constructor() {}

  /**
   * Register a migration
   */
  register(migration: Migration): void {
    // Insert in order
    this.migrations.push(migration);
    this.migrations.sort((a, b) => a.version - b.version);
  }

  /**
   * Register multiple migrations
   */
  registerAll(migrations: Migration[]): void {
    for (const m of migrations) this.register(m);
  }

  /**
   * Get the latest version number
   */
  getLatestVersion(): number {
    if (this.migrations.length === 0) return 0;
    return this.migrations[this.migrations.length - 1].version;
  }

  /**
   * Run all pending migrations
   */
  async run(currentVersion: number, ctx: MigrationContext): Promise<MigrationResult> {
    const start = Date.now();
    const pending = this.migrations.filter(m => m.version > currentVersion);
    const result: MigrationResult = {
      fromVersion: currentVersion,
      toVersion: currentVersion,
      migrationsRun: 0,
      errors: [],
      duration: 0,
    };

    if (pending.length === 0) {
      result.duration = Date.now() - start;
      return result;
    }

    ctx.log(`Running ${pending.length} migration(s) from v${currentVersion}...`);

    for (const migration of pending) {
      try {
        ctx.log(`  v${migration.version}: ${migration.description}`);
        await migration.up(ctx);
        result.toVersion = migration.version;
        result.migrationsRun++;
        await ctx.setSetting('_schemaVersion', migration.version);
      } catch (error) {
        const errMsg = (error as Error).message;
        ctx.log(`  ❌ v${migration.version} failed: ${errMsg}`);
        result.errors.push({ version: migration.version, error: errMsg });
        // Stop on first error
        break;
      }
    }

    result.duration = Date.now() - start;
    ctx.log(`Migrations complete: v${result.fromVersion} → v${result.toVersion} (${result.migrationsRun} run, ${result.errors.length} errors, ${result.duration}ms)`);

    return result;
  }

  /**
   * Rollback to a specific version
   */
  async rollback(currentVersion: number, targetVersion: number, ctx: MigrationContext): Promise<MigrationResult> {
    const start = Date.now();
    const toRollback = this.migrations
      .filter(m => m.version > targetVersion && m.version <= currentVersion)
      .reverse();

    const result: MigrationResult = {
      fromVersion: currentVersion,
      toVersion: currentVersion,
      migrationsRun: 0,
      errors: [],
      duration: 0,
    };

    for (const migration of toRollback) {
      if (!migration.down) {
        result.errors.push({ version: migration.version, error: 'No rollback function' });
        break;
      }

      try {
        ctx.log(`  Rollback v${migration.version}: ${migration.description}`);
        await migration.down(ctx);
        result.toVersion = migration.version - 1;
        result.migrationsRun++;
        await ctx.setSetting('_schemaVersion', migration.version - 1);
      } catch (error) {
        result.errors.push({ version: migration.version, error: (error as Error).message });
        break;
      }
    }

    result.duration = Date.now() - start;
    return result;
  }

  /**
   * Get all registered migrations
   */
  getMigrations(): Migration[] {
    return [...this.migrations];
  }

  /**
   * Get pending migrations
   */
  getPending(currentVersion: number): Migration[] {
    return this.migrations.filter(m => m.version > currentVersion);
  }
}
