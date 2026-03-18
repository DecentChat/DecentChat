import { describe, expect, test } from 'bun:test';
import { ManifestStore } from '../../src/sync/ManifestStore';

const wsId = 'ws-1';

describe('ManifestStore', () => {
  test('tracks per-domain and per-channel versions', () => {
    const store = new ManifestStore();

    store.updateDomain({
      domain: 'membership',
      workspaceId: wsId,
      author: 'peer-a',
      itemCount: 3,
      operation: 'update',
      subject: 'member:peer-b',
    });

    store.updateDomain({
      domain: 'channel-message',
      workspaceId: wsId,
      channelId: 'ch-1',
      author: 'peer-a',
      itemCount: 10,
      operation: 'create',
      subject: 'msg-1',
    });

    store.updateDomain({
      domain: 'channel-message',
      workspaceId: wsId,
      channelId: 'ch-1',
      author: 'peer-a',
      itemCount: 11,
      operation: 'create',
      subject: 'msg-2',
    });

    store.updateDomain({
      domain: 'channel-message',
      workspaceId: wsId,
      channelId: 'ch-2',
      author: 'peer-a',
      itemCount: 1,
      operation: 'create',
      subject: 'msg-3',
    });

    expect(store.getVersion(wsId, 'membership')).toBe(1);
    expect(store.getVersion(wsId, 'channel-message', 'ch-1')).toBe(2);
    expect(store.getVersion(wsId, 'channel-message', 'ch-2')).toBe(1);

    const summary = store.getSummary(wsId);
    expect(summary.versions.length).toBe(3);
  });

  test('builds diff requests against a newer remote summary', () => {
    const local = new ManifestStore();
    local.updateDomain({
      domain: 'membership',
      workspaceId: wsId,
      author: 'me',
      itemCount: 2,
    });

    const remote = {
      workspaceId: wsId,
      generatedAt: Date.now(),
      versions: [
        {
          domain: 'membership' as const,
          workspaceId: wsId,
          version: 3,
          itemCount: 4,
          lastUpdatedAt: Date.now(),
          lastUpdatedBy: 'peer-b',
        },
        {
          domain: 'channel-message' as const,
          workspaceId: wsId,
          channelId: 'ch-1',
          version: 2,
          itemCount: 20,
          lastUpdatedAt: Date.now(),
          lastUpdatedBy: 'peer-b',
        },
      ],
    };

    const diff = local.buildDiffRequest(wsId, remote);
    expect(diff).toEqual([
      {
        domain: 'membership',
        workspaceId: wsId,
        fromVersion: 1,
        toVersion: 3,
      },
      {
        domain: 'channel-message',
        workspaceId: wsId,
        channelId: 'ch-1',
        fromVersion: 0,
        toVersion: 2,
      },
    ]);
  });

  test('stores snapshots and supports restore marker delta', () => {
    const store = new ManifestStore();
    store.updateDomain({
      domain: 'membership',
      workspaceId: wsId,
      author: 'peer-a',
      itemCount: 2,
    });

    store.saveSnapshot({
      domain: 'membership',
      workspaceId: wsId,
      version: 1,
      snapshotId: 'snap-1',
      basedOnVersion: 1,
      memberCount: 2,
      members: [
        { peerId: 'peer-a', role: 'owner', joinedAt: 1, alias: 'A' },
        { peerId: 'peer-b', role: 'member', joinedAt: 2, alias: 'B' },
      ],
      createdAt: Date.now(),
      createdBy: 'peer-a',
    });

    const restoredDelta = store.restoreSnapshot({
      domain: 'membership',
      workspaceId: wsId,
      version: 1,
      snapshotId: 'snap-1',
      basedOnVersion: 1,
      memberCount: 2,
      members: [
        { peerId: 'peer-a', role: 'owner', joinedAt: 1, alias: 'A' },
        { peerId: 'peer-b', role: 'member', joinedAt: 2, alias: 'B' },
      ],
      createdAt: Date.now(),
      createdBy: 'peer-a',
    }, 'peer-c');

    expect(restoredDelta.subject).toBe('snapshot:snap-1');
    expect(store.getVersion(wsId, 'membership')).toBe(2);
    const snapshot = store.getSnapshot(wsId, 'membership');
    expect(snapshot?.snapshotId).toBe('snap-1');
  });

  test('returns deltas after a requested version', () => {
    const store = new ManifestStore();
    store.updateDomain({
      domain: 'receipt',
      workspaceId: wsId,
      author: 'peer-a',
      itemCount: 1,
      subject: 'ack-1',
      operation: 'create',
    });
    store.updateDomain({
      domain: 'receipt',
      workspaceId: wsId,
      author: 'peer-a',
      itemCount: 2,
      subject: 'ack-2',
      operation: 'create',
    });

    const deltas = store.getDeltasSince({
      workspaceId: wsId,
      domain: 'receipt',
      fromVersion: 1,
    });

    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.subject).toBe('ack-2');
    expect(deltas[0]?.version).toBe(2);
  });

  test('exports and imports durable state', () => {
    const original = new ManifestStore();
    original.updateDomain({
      domain: 'membership',
      workspaceId: wsId,
      author: 'peer-a',
      itemCount: 2,
      operation: 'update',
      subject: 'workspace:members',
    });
    original.updateDomain({
      domain: 'channel-message',
      workspaceId: wsId,
      channelId: 'ch-1',
      author: 'peer-a',
      itemCount: 1,
      operation: 'create',
      subject: 'msg-1',
    });
    original.saveSnapshot({
      domain: 'channel-message',
      workspaceId: wsId,
      channelId: 'ch-1',
      version: 1,
      snapshotId: 'snap-msg-1',
      basedOnVersion: 1,
      messageCount: 1,
      messageIds: ['msg-1'],
      minTimestamp: 100,
      maxTimestamp: 100,
      createdAt: 200,
      createdBy: 'peer-a',
    });

    const persisted = original.exportState();

    const restored = new ManifestStore();
    restored.importState(persisted);

    expect(restored.getVersion(wsId, 'membership')).toBe(1);
    expect(restored.getVersion(wsId, 'channel-message', 'ch-1')).toBe(1);
    expect(restored.getDeltasSince({
      workspaceId: wsId,
      domain: 'channel-message',
      channelId: 'ch-1',
      fromVersion: 0,
    })).toHaveLength(1);
    const snapshot = restored.getSnapshot(wsId, 'channel-message', 'ch-1');
    expect(snapshot?.snapshotId).toBe('snap-msg-1');
  });

  test('persists workspace manifests through persistence callbacks', async () => {
    const persisted = new Map<string, any>();

    const store = new ManifestStore();
    store.setPersistence(
      (workspaceId, state) => {
        persisted.set(workspaceId, state);
      },
      async (workspaceId) => persisted.get(workspaceId),
      async (workspaceId) => {
        persisted.delete(workspaceId);
      },
    );

    store.updateDomain({
      domain: 'membership',
      workspaceId: wsId,
      author: 'peer-a',
      itemCount: 2,
    });

    await Promise.resolve();
    expect(persisted.has(wsId)).toBe(true);

    const restored = new ManifestStore();
    restored.setPersistence(
      (workspaceId, state) => {
        persisted.set(workspaceId, state);
      },
      async (workspaceId) => persisted.get(workspaceId),
      async (workspaceId) => {
        persisted.delete(workspaceId);
      },
    );

    const hydrated = await restored.restoreWorkspace(wsId);
    expect(hydrated).toBe(true);
    expect(restored.getVersion(wsId, 'membership')).toBe(1);

    await restored.removeWorkspace(wsId);
    expect(persisted.has(wsId)).toBe(false);
  });

  test('ignores malformed persisted state payloads', () => {
    const store = new ManifestStore();
    store.updateDomain({
      domain: 'membership',
      workspaceId: wsId,
      author: 'peer-a',
      itemCount: 2,
    });

    const before = store.getSummary(wsId);
    expect(() => store.importState({ schemaVersion: 1, workspaces: [{ workspaceId: wsId, versions: 'bad' }] } as any)).not.toThrow();
    const after = store.getSummary(wsId);
    expect(after.versions.length).toBe(before.versions.length);
  });

});
