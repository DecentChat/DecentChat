/**
 * FileStore — JSON file persistence for the DecentChat Node.js peer.
 * Replaces PersistentStore (IndexedDB) for Node.js environments.
 * Stores everything under dataDir (default: ~/.openclaw/data/decentchat/)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class FileStore {
  private readonly dir: string;
  private cache = new Map<string, unknown>();

  constructor(dataDir?: string) {
    this.dir = dataDir ?? join(homedir(), '.openclaw', 'data', 'decentchat');
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  get<T>(key: string, defaultValue: T): T {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    const filePath = join(this.dir, `${key}.json`);
    if (!existsSync(filePath)) return defaultValue;
    try {
      const data = JSON.parse(readFileSync(filePath, 'utf-8')) as T;
      this.cache.set(key, data);
      return data;
    } catch {
      return defaultValue;
    }
  }

  set<T>(key: string, value: T): void {
    this.cache.set(key, value);
    const filePath = join(this.dir, `${key}.json`);
    writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
  }

  delete(key: string): void {
    this.cache.delete(key);
    const filePath = join(this.dir, `${key}.json`);
    if (existsSync(filePath)) unlinkSync(filePath);
  }

  keys(prefix = ''): string[] {
    const keys = new Set<string>();

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) keys.add(key);
    }

    for (const entry of readdirSync(this.dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const key = entry.name.slice(0, -'.json'.length);
      if (key.startsWith(prefix)) keys.add(key);
    }

    return Array.from(keys);
  }
}
