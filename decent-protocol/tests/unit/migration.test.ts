/**
 * Migration system tests
 */

import { describe, test, expect } from 'bun:test';
import { MigrationRunner } from '../../src/storage/Migration';
import type { MigrationContext } from '../../src/storage/Migration';
import { ALL_MIGRATIONS, CURRENT_SCHEMA_VERSION } from '../../src/storage/migrations';

// Mock migration context backed by in-memory stores
function createMockContext(): MigrationContext & { stores: Record<string, any[]>; settings: Record<string, any>; logs: string[] } {
  const stores: Record<string, any[]> = {
    workspaces: [],
    messages: [],
    peers: [],
    identity: [],
    outbox: [],
    settings: [],
  };
  const settings: Record<string, any> = {};
  const logs: string[] = [];

  return {
    stores,
    settings,
    logs,
    getAll: async (storeName) => [...(stores[storeName] || [])],
    put: async (storeName, item) => {
      if (!stores[storeName]) stores[storeName] = [];
      const idx = stores[storeName].findIndex((i: any) => i.id === item.id);
      if (idx >= 0) stores[storeName][idx] = item;
      else stores[storeName].push(item);
    },
    delete: async (storeName, key) => {
      if (stores[storeName]) {
        stores[storeName] = stores[storeName].filter((i: any) => i.id !== key);
      }
    },
    clear: async (storeName) => { stores[storeName] = []; },
    getSetting: async (key) => settings[key],
    setSetting: async (key, value) => { settings[key] = value; },
    log: (msg) => logs.push(msg),
  };
}

describe('MigrationRunner - Basic', () => {
  test('runs migrations in order', async () => {
    const runner = new MigrationRunner();
    const order: number[] = [];

    runner.register({ version: 2, description: 'v2', up: async () => { order.push(2); } });
    runner.register({ version: 1, description: 'v1', up: async () => { order.push(1); } });
    runner.register({ version: 3, description: 'v3', up: async () => { order.push(3); } });

    const ctx = createMockContext();
    await runner.run(0, ctx);

    expect(order).toEqual([1, 2, 3]);
  });

  test('skips already-applied migrations', async () => {
    const runner = new MigrationRunner();
    const runs: number[] = [];

    runner.register({ version: 1, description: 'v1', up: async () => { runs.push(1); } });
    runner.register({ version: 2, description: 'v2', up: async () => { runs.push(2); } });
    runner.register({ version: 3, description: 'v3', up: async () => { runs.push(3); } });

    const ctx = createMockContext();
    await runner.run(2, ctx); // Already at v2

    expect(runs).toEqual([3]); // Only v3 runs
  });

  test('no-op when fully migrated', async () => {
    const runner = new MigrationRunner();
    runner.register({ version: 1, description: 'v1', up: async () => { throw new Error('should not run'); } });

    const ctx = createMockContext();
    const result = await runner.run(1, ctx);

    expect(result.migrationsRun).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  test('stops on error', async () => {
    const runner = new MigrationRunner();
    const runs: number[] = [];

    runner.register({ version: 1, description: 'v1', up: async () => { runs.push(1); } });
    runner.register({ version: 2, description: 'v2', up: async () => { throw new Error('boom'); } });
    runner.register({ version: 3, description: 'v3', up: async () => { runs.push(3); } });

    const ctx = createMockContext();
    const result = await runner.run(0, ctx);

    expect(runs).toEqual([1]); // v3 never ran
    expect(result.migrationsRun).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.toVersion).toBe(1);
  });

  test('getLatestVersion returns highest', () => {
    const runner = new MigrationRunner();
    runner.register({ version: 3, description: 'v3', up: async () => {} });
    runner.register({ version: 1, description: 'v1', up: async () => {} });

    expect(runner.getLatestVersion()).toBe(3);
  });

  test('getPending returns only pending', () => {
    const runner = new MigrationRunner();
    runner.register({ version: 1, description: 'v1', up: async () => {} });
    runner.register({ version: 2, description: 'v2', up: async () => {} });
    runner.register({ version: 3, description: 'v3', up: async () => {} });

    const pending = runner.getPending(2);
    expect(pending).toHaveLength(1);
    expect(pending[0].version).toBe(3);
  });
});

describe('MigrationRunner - Rollback', () => {
  test('rolls back in reverse order', async () => {
    const runner = new MigrationRunner();
    const order: string[] = [];

    runner.register({ version: 1, description: 'v1', up: async () => {}, down: async () => { order.push('down-1'); } });
    runner.register({ version: 2, description: 'v2', up: async () => {}, down: async () => { order.push('down-2'); } });
    runner.register({ version: 3, description: 'v3', up: async () => {}, down: async () => { order.push('down-3'); } });

    const ctx = createMockContext();
    await runner.rollback(3, 1, ctx);

    expect(order).toEqual(['down-3', 'down-2']);
  });

  test('fails if migration has no down function', async () => {
    const runner = new MigrationRunner();
    runner.register({ version: 1, description: 'v1', up: async () => {} }); // No down!

    const ctx = createMockContext();
    const result = await runner.rollback(1, 0, ctx);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('No rollback');
  });
});

describe('Built-in Migrations', () => {
  test('all migrations registered and in order', () => {
    expect(ALL_MIGRATIONS.length).toBeGreaterThan(0);

    for (let i = 1; i < ALL_MIGRATIONS.length; i++) {
      expect(ALL_MIGRATIONS[i].version).toBeGreaterThan(ALL_MIGRATIONS[i - 1].version);
    }
  });

  test('CURRENT_SCHEMA_VERSION matches last migration', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(ALL_MIGRATIONS[ALL_MIGRATIONS.length - 1].version);
  });

  test('fresh install: all migrations run cleanly', async () => {
    const runner = new MigrationRunner();
    runner.registerAll(ALL_MIGRATIONS);

    const ctx = createMockContext();
    const result = await runner.run(0, ctx);

    expect(result.errors).toHaveLength(0);
    expect(result.toVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  test('v2 backfills vectorClock on messages', async () => {
    const runner = new MigrationRunner();
    runner.registerAll(ALL_MIGRATIONS);

    const ctx = createMockContext();
    // Pre-populate with messages missing vectorClock
    ctx.stores.messages = [
      { id: 'msg1', content: 'hello', senderId: 'alice' },
      { id: 'msg2', content: 'world', senderId: 'bob', vectorClock: { bob: 1 } },
    ];

    await runner.run(1, ctx); // Start from v1

    // msg1 should now have vectorClock
    expect(ctx.stores.messages[0].vectorClock).toBeDefined();
    // msg2 should keep its existing vectorClock
    expect(ctx.stores.messages[1].vectorClock).toEqual({ bob: 1 });
  });

  test('v3 adds attachments to messages', async () => {
    const runner = new MigrationRunner();
    runner.registerAll(ALL_MIGRATIONS);

    const ctx = createMockContext();
    ctx.stores.messages = [
      { id: 'msg1', content: 'hello', vectorClock: {} },
    ];

    await runner.run(2, ctx);

    expect(ctx.stores.messages[0].attachments).toEqual([]);
  });

  test('v4 adds settings to workspaces', async () => {
    const runner = new MigrationRunner();
    runner.registerAll(ALL_MIGRATIONS);

    const ctx = createMockContext();
    ctx.stores.workspaces = [
      { id: 'ws1', name: 'Test' },
    ];

    await runner.run(3, ctx);

    expect(ctx.stores.workspaces[0].settings).toBeDefined();
    expect(ctx.stores.workspaces[0].settings.autoDownloadImages).toBe(true);
  });
});
