/**
 * Migration tests focused on established, real-world workspace sizes.
 *
 * These tests validate:
 * - data-shape upgrades on large persisted datasets
 * - no data loss during migration
 * - preservation of unknown/custom fields
 * - resume behavior after transient migration failure
 */

import { describe, test, expect } from 'bun:test';
import { MigrationRunner } from '../../src/storage/Migration';
import type { MigrationContext, Migration } from '../../src/storage/Migration';
import { ALL_MIGRATIONS, CURRENT_SCHEMA_VERSION } from '../../src/storage/migrations';

function createMockContext(): MigrationContext & {
  stores: Record<string, any[]>;
  settings: Record<string, any>;
  logs: string[];
} {
  const stores: Record<string, any[]> = {
    workspaces: [],
    messages: [],
    peers: [],
    identity: [],
    outbox: [],
    settings: [],
    ratchetStates: [],
    contacts: [],
    directConversations: [],
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
      // For migration tests we operate mainly on stores keyed by `id`
      const idx = stores[storeName].findIndex((i: any) => i.id === item.id);
      if (idx >= 0) stores[storeName][idx] = item;
      else stores[storeName].push(item);
    },
    delete: async (storeName, key) => {
      if (stores[storeName]) {
        stores[storeName] = stores[storeName].filter((i: any) => i.id !== key);
      }
    },
    clear: async (storeName) => {
      stores[storeName] = [];
    },
    getSetting: async (key) => settings[key],
    setSetting: async (key, value) => {
      settings[key] = value;
    },
    log: (msg) => logs.push(msg),
  };
}

function seedEstablishedWorkspaceData(
  ctx: ReturnType<typeof createMockContext>,
  options: {
    workspaceCount: number;
    channelsPerWorkspace: number;
    messagesPerWorkspace: number;
  },
): {
  totalMessages: number;
  vectorClockPresetId: string;
  attachmentPresetId: string;
  customWorkspaceMetaId: string;
} {
  const { workspaceCount, channelsPerWorkspace, messagesPerWorkspace } = options;

  let messageCounter = 0;
  let vectorClockPresetId = '';
  let attachmentPresetId = '';
  let customWorkspaceMetaId = '';

  for (let w = 0; w < workspaceCount; w++) {
    const wsId = `ws-${w}`;
    const channels = Array.from({ length: channelsPerWorkspace }, (_, c) => ({
      id: `${wsId}-ch-${c}`,
      name: c === 0 ? 'general' : `ch-${c}`,
      type: 'group',
      createdBy: 'alice',
      members: ['alice', 'bob'],
      createdAt: 1_700_000_000_000 + c,
    }));

    const ws: any = {
      id: wsId,
      name: `Workspace ${w}`,
      inviteCode: `INVITE${w}`,
      createdBy: 'alice',
      createdAt: 1_700_000_000_000 + w,
      members: [
        { peerId: 'alice', alias: 'Alice', publicKey: 'alice-pk', joinedAt: 1_700_000_000_000, role: 'owner' },
        { peerId: 'bob', alias: 'Bob', publicKey: 'bob-pk', joinedAt: 1_700_000_001_000, role: 'member' },
      ],
      channels,
      // simulate plugin/client metadata that migrations must preserve
      customMetadata: { migrationProbe: true, workspaceIndex: w },
    };

    if (!customWorkspaceMetaId) customWorkspaceMetaId = wsId;
    ctx.stores.workspaces.push(ws);

    for (let m = 0; m < messagesPerWorkspace; m++) {
      const channelId = channels[m % channels.length].id;
      const msgId = `msg-${messageCounter++}`;

      const msg: any = {
        id: msgId,
        channelId,
        senderId: m % 2 === 0 ? 'alice' : 'bob',
        content: `message ${m} in ${wsId}`,
        timestamp: 1_700_000_000_000 + messageCounter,
        type: 'text',
        // intentionally no vectorClock / no attachments for most records
      };

      // Preserve existing vectorClock (should not be overwritten)
      if (w === 0 && m === 0) {
        msg.vectorClock = { alice: 42 };
        vectorClockPresetId = msg.id;
      }

      // Preserve existing attachments (should not be overwritten)
      if (w === 0 && m === 1) {
        msg.attachments = [{ id: 'att-1', name: 'photo.jpg' }];
        attachmentPresetId = msg.id;
      }

      // random custom field should survive additive migrations
      msg.customPayload = { stable: true, i: m };

      ctx.stores.messages.push(msg);
    }
  }

  return {
    totalMessages: workspaceCount * messagesPerWorkspace,
    vectorClockPresetId,
    attachmentPresetId,
    customWorkspaceMetaId,
  };
}

describe('Migration - established workspace safety', () => {
  test('migrates large established dataset without data loss or shape corruption', async () => {
    const runner = new MigrationRunner();
    runner.registerAll(ALL_MIGRATIONS);

    const ctx = createMockContext();
    const seeded = seedEstablishedWorkspaceData(ctx, {
      workspaceCount: 60,
      channelsPerWorkspace: 4,
      messagesPerWorkspace: 300,
    });

    const workspaceCountBefore = ctx.stores.workspaces.length;
    const messageCountBefore = ctx.stores.messages.length;

    // Start from v1 so v2/v3/v4 shape migrations are exercised
    const result = await runner.run(1, ctx);

    expect(result.errors).toHaveLength(0);
    expect(result.toVersion).toBe(CURRENT_SCHEMA_VERSION);

    // No record loss
    expect(ctx.stores.workspaces).toHaveLength(workspaceCountBefore);
    expect(ctx.stores.messages).toHaveLength(messageCountBefore);
    expect(messageCountBefore).toBe(seeded.totalMessages);

    // v2 backfill: every message now has vectorClock
    for (const msg of ctx.stores.messages) {
      expect(msg.vectorClock).toBeDefined();
    }

    // v3 backfill: every message now has attachments array
    for (const msg of ctx.stores.messages) {
      expect(Array.isArray(msg.attachments)).toBe(true);
    }

    // v4 backfill: every workspace now has settings
    for (const ws of ctx.stores.workspaces) {
      expect(ws.settings).toBeDefined();
      expect(ws.settings.autoDownloadImages).toBe(true);
      expect(ws.settings.autoDownloadVoice).toBe(true);
    }

    // Existing fields preserved (not overwritten)
    const presetVector = ctx.stores.messages.find((m: any) => m.id === seeded.vectorClockPresetId);
    expect(presetVector.vectorClock).toEqual({ alice: 42 });

    const presetAttachments = ctx.stores.messages.find((m: any) => m.id === seeded.attachmentPresetId);
    expect(presetAttachments.attachments).toEqual([{ id: 'att-1', name: 'photo.jpg' }]);

    // Unknown/custom fields still intact
    const customWs = ctx.stores.workspaces.find((w: any) => w.id === seeded.customWorkspaceMetaId);
    expect(customWs.customMetadata).toEqual({ migrationProbe: true, workspaceIndex: 0 });

    const randomMsg = ctx.stores.messages[Math.floor(ctx.stores.messages.length / 2)];
    expect(randomMsg.customPayload?.stable).toBe(true);
  }, 30_000);

  test('is idempotent when already at latest schema', async () => {
    const runner = new MigrationRunner();
    runner.registerAll(ALL_MIGRATIONS);

    const ctx = createMockContext();
    seedEstablishedWorkspaceData(ctx, {
      workspaceCount: 10,
      channelsPerWorkspace: 3,
      messagesPerWorkspace: 100,
    });

    const firstRun = await runner.run(1, ctx);
    expect(firstRun.errors).toHaveLength(0);

    const snapshot = JSON.stringify({
      workspaces: ctx.stores.workspaces,
      messages: ctx.stores.messages,
      settings: ctx.settings,
    });

    const secondRun = await runner.run(CURRENT_SCHEMA_VERSION, ctx);
    expect(secondRun.migrationsRun).toBe(0);
    expect(secondRun.errors).toHaveLength(0);

    const snapshotAfter = JSON.stringify({
      workspaces: ctx.stores.workspaces,
      messages: ctx.stores.messages,
      settings: ctx.settings,
    });

    expect(snapshotAfter).toBe(snapshot);
  });

  test('can resume safely after transient migration failure', async () => {
    const ctx = createMockContext();
    ctx.stores.messages = [{ id: 'm1', content: 'hello' }];

    let flakyAttempts = 0;

    const flakyMigrations: Migration[] = [
      {
        version: 1,
        description: 'baseline',
        up: async (mctx) => {
          await mctx.setSetting('_schemaVersion', 1);
        },
      },
      {
        version: 2,
        description: 'flaky step',
        up: async (mctx) => {
          flakyAttempts++;
          if (flakyAttempts === 1) {
            throw new Error('transient failure');
          }
          const all = await mctx.getAll('messages');
          for (const msg of all) {
            if (!msg.vectorClock) {
              msg.vectorClock = {};
              await mctx.put('messages', msg);
            }
          }
        },
      },
      {
        version: 3,
        description: 'final additive field',
        up: async (mctx) => {
          const all = await mctx.getAll('messages');
          for (const msg of all) {
            if (!msg.attachments) {
              msg.attachments = [];
              await mctx.put('messages', msg);
            }
          }
        },
      },
    ];

    const runner = new MigrationRunner();
    runner.registerAll(flakyMigrations);

    const first = await runner.run(0, ctx);
    expect(first.errors).toHaveLength(1);
    expect(first.toVersion).toBe(1);

    // Resume from recorded version should complete cleanly
    const second = await runner.run(first.toVersion, ctx);
    expect(second.errors).toHaveLength(0);
    expect(second.toVersion).toBe(3);

    const msg = ctx.stores.messages[0];
    expect(msg.vectorClock).toEqual({});
    expect(msg.attachments).toEqual([]);
  });
});
