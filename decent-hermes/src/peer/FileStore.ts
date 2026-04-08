/**
 * FileStore — SQLite-backed key-value persistence for the DecentChat Node.js peer.
 *
 * Uses `bun:sqlite` when running under Bun (tests) and `better-sqlite3` when
 * running under Node.js (production via OpenClaw/jiti). Both provide a
 * synchronous SQLite API; this module normalises the minor API differences.
 *
 * WAL mode is enabled for crash-safe, concurrent-reader writes.
 * On first run, migrates any existing JSON files from the legacy filesystem
 * layout into the SQLite database.
 *
 * Stores everything under dataDir (default: ~/.openclaw/data/decentchat/)
 * in a single `store.db` file.
 */
import { readFileSync, mkdirSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Minimal interface covering the subset of both bun:sqlite and better-sqlite3
// that FileStore actually uses.  This lets us swap backends at runtime without
// leaking library-specific types into the rest of the codebase.
// ---------------------------------------------------------------------------
interface StoreStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): void;
}

interface StoreDatabase {
  exec(sql: string): void;
  prepare(sql: string): StoreStatement;
  close(): void;
  transaction<T>(fn: () => T): () => T;
}

/**
 * Open a SQLite database using whichever driver is available at runtime.
 *
 * Bun ships a built-in `bun:sqlite` module that is faster and requires no
 * native compilation.  When the process is *not* Bun (e.g. Node.js via
 * OpenClaw's jiti loader), we fall back to `better-sqlite3`.
 */
function openDatabase(dbPath: string): StoreDatabase {
  // Detect Bun via the global `Bun` object (always present in Bun ≥0.1).
  const isBun = typeof globalThis !== 'undefined' && 'Bun' in globalThis;

  if (isBun) {
    // Dynamic import resolved at runtime — Bun treats `bun:sqlite` as a
    // built-in module so `require()` works synchronously.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Database } = require('bun:sqlite') as {
      Database: new (path: string) => {
        exec(sql: string): void;
        prepare(sql: string): {
          get(...params: unknown[]): unknown;
          all(...params: unknown[]): unknown[];
          run(...params: unknown[]): void;
        };
        close(): void;
        transaction<T>(fn: () => T): () => T;
      };
    };
    const db = new Database(dbPath);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    return db as StoreDatabase;
  }

  // Node.js path — use better-sqlite3 (native N-API addon).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite3 = require('better-sqlite3') as {
    new (path: string): {
      pragma(pragma: string): unknown;
      exec(sql: string): void;
      prepare(sql: string): {
        get(...params: unknown[]): unknown;
        all(...params: unknown[]): unknown[];
        run(...params: unknown[]): void;
      };
      close(): void;
      transaction<T>(fn: () => T): () => T;
    };
  };
  const db = new BetterSqlite3(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  return db as unknown as StoreDatabase;
}

export class FileStore {
  private readonly dir: string;
  private readonly db: StoreDatabase;
  private readonly stmtGet: StoreStatement;
  private readonly stmtSet: StoreStatement;
  private readonly stmtDel: StoreStatement;
  private readonly stmtKeys: StoreStatement;
  private readonly stmtKeysAll: StoreStatement;
  private cache = new Map<string, unknown>();

  constructor(dataDir?: string) {
    this.dir = dataDir ?? join(homedir(), '.openclaw', 'data', 'decentchat');
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });

    this.db = openDatabase(join(this.dir, 'store.db'));
    this.db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

    // Prepare statements once for reuse — faster than ad-hoc queries.
    this.stmtGet = this.db.prepare('SELECT value FROM kv WHERE key = ?');
    this.stmtSet = this.db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)');
    this.stmtDel = this.db.prepare('DELETE FROM kv WHERE key = ?');
    this.stmtKeys = this.db.prepare("SELECT key FROM kv WHERE key LIKE ? ESCAPE '\\'");
    this.stmtKeysAll = this.db.prepare('SELECT key FROM kv');

    // Migrate legacy JSON files into SQLite on first run.
    this.migrateJsonFiles();
  }

  get<T>(key: string, defaultValue: T): T {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    const row = this.stmtGet.get(key) as { value: string } | undefined;
    if (!row) return defaultValue;
    try {
      const data = JSON.parse(row.value) as T;
      this.cache.set(key, data);
      return data;
    } catch {
      return defaultValue;
    }
  }

  set<T>(key: string, value: T): void {
    this.cache.set(key, value);
    this.stmtSet.run(key, JSON.stringify(value));
  }

  delete(key: string): void {
    this.cache.delete(key);
    this.stmtDel.run(key);
  }

  keys(prefix = ''): string[] {
    const rows = prefix
      ? (this.stmtKeys.all(this.likeEscape(prefix) + '%') as { key: string }[])
      : (this.stmtKeysAll.all() as { key: string }[]);

    // Merge with any cached keys that haven't been flushed yet (shouldn't
    // happen under normal operation since set() writes through, but keeps
    // the contract safe).
    const result = new Set(rows.map(r => r.key));
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) result.add(key);
    }
    return Array.from(result);
  }

  /** Close the database. Called during peer shutdown. */
  close(): void {
    try {
      this.db.close();
    } catch {
      // Already closed or never opened — ignore.
    }
  }

  // ---------------------------------------------------------------------------
  // Migration
  // ---------------------------------------------------------------------------

  /**
   * One-time migration: read all `.json` files in dataDir, insert their
   * contents into the SQLite kv table, then rename them to `.json.migrated`
   * so they are not re-imported on next startup.
   */
  private migrateJsonFiles(): void {
    let jsonFiles: string[];
    try {
      jsonFiles = readdirSync(this.dir).filter(
        f => f.endsWith('.json') && !f.endsWith('.migrated'),
      );
    } catch {
      return;
    }
    if (jsonFiles.length === 0) return;

    const insertMany = this.db.transaction(() => {
      for (const file of jsonFiles) {
        const key = file.slice(0, -'.json'.length);
        const filePath = join(this.dir, file);
        try {
          const raw = readFileSync(filePath, 'utf-8');
          // Validate JSON before importing — skip corrupt files.
          JSON.parse(raw);
          this.stmtSet.run(key, raw);
        } catch {
          continue;
        }
      }
    });
    insertMany();

    // Rename migrated files so they're not re-imported, but keep them around
    // as a safety net until the user confirms everything works.
    for (const file of jsonFiles) {
      try {
        renameSync(join(this.dir, file), join(this.dir, `${file}.migrated`));
      } catch {
        // Non-fatal — worst case we re-import on next startup (idempotent).
      }
    }
  }

  /** Escape LIKE pattern meta-characters so prefix search is literal. */
  private likeEscape(s: string): string {
    return s.replace(/[\\%_]/g, c => `\\${c}`);
  }
}
