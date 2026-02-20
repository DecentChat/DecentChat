/**
 * T2.4: StorageQuotaManager unit tests
 *
 * Tests quota checking and message pruning logic.
 * navigator.storage.estimate() is mocked below.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { StorageQuotaManager } from '../../src/storage/StorageQuotaManager';

// ---------------------------------------------------------------------------
// navigator.storage mock
// ---------------------------------------------------------------------------

type StorageMock = {
  usageBytes: number;
  quotaBytes: number;
};

let storageMock: StorageMock = { usageBytes: 0, quotaBytes: 1_000_000_000 };

function setStorageMock(usageBytes: number, quotaBytes = 1_000_000_000) {
  storageMock = { usageBytes, quotaBytes };
}

// Inject global mock
(globalThis as any).navigator = {
  storage: {
    estimate: async () => ({
      usage: storageMock.usageBytes,
      quota: storageMock.quotaBytes,
    }),
  },
};

// ---------------------------------------------------------------------------
// Mock PersistentStore and WorkspaceManager for prune tests
// ---------------------------------------------------------------------------

function makeMessage(channelId: string, idx: number) {
  return { id: `msg-${channelId}-${idx}`, channelId, timestamp: idx * 1000, content: `msg ${idx}` };
}

function makeMockStore(messagesByChannel: Record<string, ReturnType<typeof makeMessage>[]>) {
  const deletedIds: string[] = [];

  return {
    getMessageCount: async (channelId: string) => (messagesByChannel[channelId]?.length ?? 0),
    getChannelMessages: async (channelId: string) => [...(messagesByChannel[channelId] ?? [])],
    deleteMessages: async (ids: string[]) => {
      for (const id of ids) deletedIds.push(id);
      // Remove from messagesByChannel too
      for (const channelId of Object.keys(messagesByChannel)) {
        messagesByChannel[channelId] = messagesByChannel[channelId].filter(m => !ids.includes(m.id));
      }
    },
    _deletedIds: deletedIds,
  };
}

function makeMockWorkspaceManager(channelIds: string[]) {
  return {
    getAllWorkspaces: () => [{
      id: 'ws-1',
      channels: channelIds.map(id => ({ id, name: `#${id}` })),
    }],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StorageQuotaManager — check()', () => {
  let qm: StorageQuotaManager;

  beforeEach(() => {
    qm = new StorageQuotaManager();
    setStorageMock(0);
  });

  test('returns zero fractions when usage is 0', async () => {
    setStorageMock(0, 1_000_000_000);
    const status = await qm.check();

    expect(status.usageBytes).toBe(0);
    expect(status.quotaBytes).toBe(1_000_000_000);
    expect(status.usageFraction).toBe(0);
    expect(status.isWarning).toBe(false);
    expect(status.isPruneNeeded).toBe(false);
  });

  test('isWarning true when usage > 70%', async () => {
    setStorageMock(750_000_000, 1_000_000_000); // 75%
    const status = await qm.check();

    expect(status.usageFraction).toBeCloseTo(0.75, 2);
    expect(status.isWarning).toBe(true);
    expect(status.isPruneNeeded).toBe(false);
  });

  test('isPruneNeeded true when usage > 85%', async () => {
    setStorageMock(900_000_000, 1_000_000_000); // 90%
    const status = await qm.check();

    expect(status.isPruneNeeded).toBe(true);
    expect(status.isWarning).toBe(true);
  });

  test('exactly at warn threshold is not warning', async () => {
    setStorageMock(700_000_000, 1_000_000_000); // exactly 70.0%
    const status = await qm.check();
    expect(status.isWarning).toBe(false); // threshold is strict >
  });

  test('just above warn threshold triggers warning', async () => {
    setStorageMock(700_000_001, 1_000_000_000); // 70.0000001%
    const status = await qm.check();
    expect(status.isWarning).toBe(true);
  });

  test('custom warn/prune thresholds are respected', async () => {
    const custom = new StorageQuotaManager({ warnThreshold: 0.5, pruneThreshold: 0.6 });

    setStorageMock(550_000_000, 1_000_000_000); // 55%
    const status = await custom.check();
    expect(status.isWarning).toBe(true);
    expect(status.isPruneNeeded).toBe(false);

    setStorageMock(650_000_000, 1_000_000_000); // 65%
    const status2 = await custom.check();
    expect(status2.isPruneNeeded).toBe(true);
  });

  test('usageFraction is 0 when quota is 0 (avoid divide-by-zero)', async () => {
    setStorageMock(0, 0);
    const status = await qm.check();
    expect(status.usageFraction).toBe(0);
  });

  test('graceful fallback when navigator.storage unavailable', async () => {
    const origNav = (globalThis as any).navigator;
    (globalThis as any).navigator = {};
    const status = await qm.check();
    expect(status.usageFraction).toBe(0);
    expect(status.isWarning).toBe(false);
    (globalThis as any).navigator = origNav;
  });

  test('graceful fallback when estimate() throws', async () => {
    const origNav = (globalThis as any).navigator;
    (globalThis as any).navigator = {
      storage: { estimate: async () => { throw new Error('not allowed'); } },
    };
    const status = await qm.check();
    expect(status.usageFraction).toBe(0);
    (globalThis as any).navigator = origNav;
  });
});

describe('StorageQuotaManager — prune()', () => {
  let qm: StorageQuotaManager;

  beforeEach(() => {
    qm = new StorageQuotaManager({ keepMessagesPerChannel: 3 });
  });

  test('deletes oldest messages, keeps last N', async () => {
    // 5 messages, keep 3 → delete 2 oldest (idx 0, 1)
    const msgs = [0, 1, 2, 3, 4].map(i => makeMessage('ch-1', i));
    const store = makeMockStore({ 'ch-1': msgs });
    const wm = makeMockWorkspaceManager(['ch-1']);

    const result = await qm.prune(store, wm);

    expect(result.channelsPruned).toBe(1);
    expect(result.messagesDeleted).toBe(2);
    expect(store._deletedIds).toContain('msg-ch-1-0');
    expect(store._deletedIds).toContain('msg-ch-1-1');
    expect(store._deletedIds).not.toContain('msg-ch-1-2');
  });

  test('channels with <= keepMessagesPerChannel are untouched', async () => {
    const msgs = [0, 1, 2].map(i => makeMessage('ch-1', i)); // exactly 3
    const store = makeMockStore({ 'ch-1': msgs });
    const wm = makeMockWorkspaceManager(['ch-1']);

    const result = await qm.prune(store, wm);

    expect(result.channelsPruned).toBe(0);
    expect(result.messagesDeleted).toBe(0);
    expect(store._deletedIds).toHaveLength(0);
  });

  test('multiple channels pruned independently', async () => {
    const store = makeMockStore({
      'ch-a': [0, 1, 2, 3, 4].map(i => makeMessage('ch-a', i)), // 5 → delete 2
      'ch-b': [0, 1].map(i => makeMessage('ch-b', i)),           // 2 → no prune
      'ch-c': [0, 1, 2, 3, 4, 5, 6].map(i => makeMessage('ch-c', i)), // 7 → delete 4
    });
    const wm = makeMockWorkspaceManager(['ch-a', 'ch-b', 'ch-c']);

    const result = await qm.prune(store, wm);

    expect(result.channelsPruned).toBe(2);        // ch-a + ch-c
    expect(result.messagesDeleted).toBe(2 + 4);   // 6 total
  });

  test('empty workspace has nothing to prune', async () => {
    const store = makeMockStore({});
    const wm = makeMockWorkspaceManager([]);

    const result = await qm.prune(store, wm);

    expect(result.channelsPruned).toBe(0);
    expect(result.messagesDeleted).toBe(0);
  });

  test('keeps most recent messages (oldest deleted first)', async () => {
    // Messages timestamped 0..4, keep last 2 → keep timestamps 3,4
    const msgs = [0, 1, 2, 3, 4].map(i => makeMessage('ch-1', i));
    const store = makeMockStore({ 'ch-1': msgs });
    const wm = makeMockWorkspaceManager(['ch-1']);

    const custom = new StorageQuotaManager({ keepMessagesPerChannel: 2 });
    await custom.prune(store, wm);

    // Remaining messages in store should be idx 3 and 4
    const remaining = await store.getChannelMessages('ch-1');
    const remainingTs = remaining.map((m: any) => m.timestamp).sort((a: number, b: number) => a - b);
    expect(remainingTs).toEqual([3000, 4000]);
  });
});

describe('StorageQuotaManager — formatBytes()', () => {
  test('formats 0 bytes', () => {
    expect(StorageQuotaManager.formatBytes(0)).toBe('0 B');
  });

  test('formats bytes', () => {
    expect(StorageQuotaManager.formatBytes(512)).toBe('512 B');
  });

  test('formats kilobytes', () => {
    expect(StorageQuotaManager.formatBytes(1024)).toBe('1.0 KB');
  });

  test('formats megabytes', () => {
    expect(StorageQuotaManager.formatBytes(1024 * 1024)).toBe('1.0 MB');
  });

  test('formats gigabytes', () => {
    expect(StorageQuotaManager.formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
  });

  test('formats fractional MB', () => {
    expect(StorageQuotaManager.formatBytes(42 * 1024 * 1024 + 300 * 1024)).toBe('42.3 MB');
  });
});
