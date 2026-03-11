import '../setup';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { PersistentStore } from '../../src/storage/PersistentStore';
import type {
  ChannelAccessPolicy,
  DirectoryShardRef,
  HistoryPageRef,
  MemberDirectoryPage,
  PresenceAggregate,
  WorkspaceShell,
} from '../../src';

describe('PersistentStore — public workspace normalized stores', () => {
  let store: PersistentStore;

  beforeEach(async () => {
    store = new PersistentStore({ dbName: `public-ws-${Date.now()}-${Math.random()}` });
    await store.init();
  });

  afterEach(async () => {
    await store.close();
  });

  test('saves and loads a workspace shell', async () => {
    const shell: WorkspaceShell = {
      id: 'ws-1',
      name: 'Big Workspace',
      createdBy: 'alice',
      createdAt: 1,
      version: 5,
      memberCount: 150000,
      channelCount: 32,
      capabilityFlags: ['workspace-shell'],
    };

    await store.saveWorkspaceShell(shell);
    const loaded = await store.getWorkspaceShell('ws-1');

    expect(loaded).toBeDefined();
    expect(loaded?.memberCount).toBe(150000);
    expect(loaded?.version).toBe(5);
  });

  test('saves and loads member directory pages', async () => {
    const page: MemberDirectoryPage = {
      workspaceId: 'ws-1',
      pageSize: 100,
      cursor: 'cursor-0',
      nextCursor: 'cursor-1',
      members: [{ peerId: 'bob', alias: 'Bob', role: 'member', joinedAt: 1 }],
    };

    await store.saveMemberDirectoryPage(page);
    const loaded = await store.getMemberDirectoryPage('ws-1', 'cursor-0');

    expect(loaded?.members).toHaveLength(1);
    expect(loaded?.members[0].peerId).toBe('bob');
    expect(loaded?.nextCursor).toBe('cursor-1');
  });

  test('saves and loads channel policies', async () => {
    const policy: ChannelAccessPolicy = {
      mode: 'role-gated',
      roles: ['owner', 'admin'],
    };

    await store.saveChannelPolicy('ws-1', 'ch-admins', policy);
    const loaded = await store.getChannelPolicy('ws-1', 'ch-admins');

    expect(loaded?.mode).toBe('role-gated');
    expect(loaded?.roles).toEqual(['owner', 'admin']);
  });

  test('saves and loads history page refs', async () => {
    const pageRef: HistoryPageRef = {
      workspaceId: 'ws-1',
      channelId: 'ch-1',
      pageId: 'page-1',
      startCursor: '0',
      endCursor: '99',
      replicaPeerIds: ['peer-1', 'peer-2'],
    };

    await store.saveHistoryPageRef(pageRef);
    const loaded = await store.getHistoryPageRef('ws-1', 'ch-1', 'page-1');

    expect(loaded?.pageId).toBe('page-1');
    expect(loaded?.replicaPeerIds).toEqual(['peer-1', 'peer-2']);
  });

  test('saves and loads directory shard refs and presence aggregates', async () => {
    const shard: DirectoryShardRef = {
      workspaceId: 'ws-1',
      shardId: 'aa',
      shardPrefix: 'aa',
      replicaPeerIds: ['peer-a', 'peer-b'],
      version: 3,
    };
    const presence: PresenceAggregate = {
      workspaceId: 'ws-1',
      onlineCount: 234,
      awayCount: 12,
      updatedAt: 999,
    };

    await store.saveDirectoryShardRef(shard);
    await store.savePresenceAggregate(presence);

    const shards = await store.getDirectoryShardRefs('ws-1');
    const loadedPresence = await store.getPresenceAggregate('ws-1');

    expect(shards).toHaveLength(1);
    expect(shards[0].shardPrefix).toBe('aa');
    expect(loadedPresence?.onlineCount).toBe(234);
  });
});
