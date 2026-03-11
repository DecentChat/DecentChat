import { beforeEach, describe, expect, test } from 'bun:test';
import { MessageStore } from '../../src/messages/MessageStore';
import { DirectoryProtocol } from '../../src/workspace/DirectoryProtocol';
import { DirectoryShardPlanner } from '../../src/workspace/DirectoryShardPlanner';
import { SyncProtocol } from '../../src/workspace/SyncProtocol';
import { WorkspaceManager } from '../../src/workspace/WorkspaceManager';

const member = (peerId: string, alias = peerId) => ({
  peerId,
  alias,
  publicKey: `${peerId}-pk`,
  joinedAt: 1,
  role: 'member' as const,
});

function createPeer(peerId: string) {
  const wm = new WorkspaceManager();
  const ms = new MessageStore();
  const events: any[] = [];
  const outbox: { to: string; data: any }[] = [];
  const sendFn = (targetPeerId: string, data: any) => {
    outbox.push({ to: targetPeerId, data });
    return true;
  };
  const sync = new SyncProtocol(wm, ms, sendFn, (event) => events.push(event), peerId);
  return { wm, ms, events, outbox, sync };
}

describe('DirectoryShardPlanner', () => {
  test('deterministically partitions members into shard prefixes', () => {
    const plannerA = new DirectoryShardPlanner();
    const plannerB = new DirectoryShardPlanner();

    const a1 = plannerA.getShardPrefixForMember(member('alice'));
    const a2 = plannerA.getShardPrefixForMember(member('bob'));
    const b1 = plannerB.getShardPrefixForMember(member('alice'));
    const b2 = plannerB.getShardPrefixForMember(member('bob'));

    expect(a1).toBe(b1);
    expect(a2).toBe(b2);
    expect(a1).toHaveLength(2);
    expect(a2).toHaveLength(2);
  });

  test('builds shard refs with replica advertisements', () => {
    const planner = new DirectoryShardPlanner();
    const refs = planner.planShardRefs(
      'ws-1',
      [member('alice'), member('bob'), member('charlie')],
      ['peer-2', 'peer-1', 'peer-1'],
    );

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.workspaceId).toBe('ws-1');
      expect(ref.shardId).toContain(ref.shardPrefix);
      expect(ref.replicaPeerIds).toEqual([...new Set(ref.replicaPeerIds)].sort());
    }
  });
});

describe('DirectoryProtocol', () => {
  let wm: WorkspaceManager;
  let protocol: DirectoryProtocol;
  let workspaceId: string;

  beforeEach(() => {
    wm = new WorkspaceManager();
    const ws = wm.createWorkspace('Big Team', 'owner', 'Owner', 'owner-pk');
    workspaceId = ws.id;

    ['alice', 'bob', 'charlie', 'diana', 'eve'].forEach((peerId, idx) => {
      wm.addMember(workspaceId, {
        peerId,
        alias: peerId.toUpperCase(),
        publicKey: `${peerId}-pk`,
        joinedAt: idx + 2,
        role: 'member',
      });
    });

    protocol = new DirectoryProtocol(wm, new DirectoryShardPlanner());
  });

  test('returns member directory pages by cursor', () => {
    const first = protocol.getMemberPage(workspaceId, { pageSize: 3 });
    expect(first.members).toHaveLength(3);
    expect(first.nextCursor).toBeDefined();

    const second = protocol.getMemberPage(workspaceId, { pageSize: 3, cursor: first.nextCursor });
    expect(second.members.length).toBeGreaterThan(0);

    const firstIds = new Set(first.members.map((m) => m.peerId));
    const secondIds = new Set(second.members.map((m) => m.peerId));
    expect([...firstIds].some((id) => secondIds.has(id))).toBe(false);
  });

  test('caps requested page size aggressively', () => {
    const page = protocol.getMemberPage(workspaceId, { pageSize: 9999 });
    expect(page.pageSize).toBe(200);
  });

  test('supports shard-scoped page requests', () => {
    const all = protocol.getMemberPage(workspaceId, { pageSize: 200 });
    const target = all.members[0];
    const shardPrefix = protocol.getShardPrefixForMember(target.peerId, workspaceId)!;

    const shardPage = protocol.getMemberPage(workspaceId, { pageSize: 200, shardPrefix });
    expect(shardPage.members.length).toBeGreaterThan(0);
    for (const item of shardPage.members) {
      expect(protocol.getShardPrefixForMember(item.peerId, workspaceId)).toBe(shardPrefix);
    }
  });

  test('builds member-page response and repair request messages', () => {
    const response = protocol.buildMemberPageResponse(workspaceId, { pageSize: 2 });
    expect(response.type).toBe('member-page-response');
    expect(response.page.members).toHaveLength(2);

    const repair = protocol.buildShardRepairRequest(workspaceId, 'aa', 'peer-1', ['peer-2']);
    expect(repair.type).toBe('directory-shard-repair');
    expect(repair.shardId).toBe('aa');
    expect(repair.requestedBy).toBe('peer-1');
  });
});

describe('SyncProtocol directory messages', () => {
  test('requests and serves member directory pages at runtime', async () => {
    const alice = createPeer('alice');
    const ws = alice.wm.createWorkspace('Huge Team', 'alice', 'Alice', 'alice-key');
    alice.wm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: 2, role: 'member' });
    alice.wm.addMember(ws.id, { peerId: 'charlie', alias: 'Charlie', publicKey: 'charlie-key', joinedAt: 3, role: 'member' });

    alice.sync.requestMemberPage('bob', ws.id, { pageSize: 2 });
    expect(alice.outbox[0]?.data.sync.type).toBe('member-page-request');

    await alice.sync.handleMessage('bob', alice.outbox[0].data.sync);
    expect(alice.outbox[1]?.to).toBe('bob');
    expect(alice.outbox[1]?.data.sync.type).toBe('member-page-response');
    expect(alice.outbox[1]?.data.sync.page.members).toHaveLength(2);
  });

  test('emits member-page-received when a page response arrives', async () => {
    const bob = createPeer('bob');

    await bob.sync.handleMessage('alice', {
      type: 'member-page-response',
      page: {
        workspaceId: 'ws-1',
        pageSize: 2,
        members: [
          { peerId: 'alice', alias: 'Alice', role: 'owner', joinedAt: 1 },
          { peerId: 'bob', alias: 'Bob', role: 'member', joinedAt: 2 },
        ],
        nextCursor: 'bob',
      },
    });

    expect(bob.events).toContainEqual({
      type: 'member-page-received',
      workspaceId: 'ws-1',
      page: {
        workspaceId: 'ws-1',
        pageSize: 2,
        members: [
          { peerId: 'alice', alias: 'Alice', role: 'owner', joinedAt: 1 },
          { peerId: 'bob', alias: 'Bob', role: 'member', joinedAt: 2 },
        ],
        nextCursor: 'bob',
      },
    });
  });

  test('merges advertised directory shards into workspace state and answers repair requests', async () => {
    const alice = createPeer('alice');
    const ws = alice.wm.createWorkspace('Huge Team', 'alice', 'Alice', 'alice-key');
    alice.wm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: 2, role: 'member' });
    ws.directoryShards = [{
      workspaceId: ws.id,
      shardId: `${ws.id}:aa`,
      shardPrefix: 'aa',
      replicaPeerIds: ['alice'],
      version: 1,
    }];

    await alice.sync.handleMessage('bob', {
      type: 'directory-shard-advertisement',
      shard: {
        workspaceId: ws.id,
        shardId: `${ws.id}:aa`,
        shardPrefix: 'aa',
        replicaPeerIds: ['alice', 'bob', 'bob'],
        version: 2,
      },
    });

    expect(alice.wm.getWorkspace(ws.id)?.directoryShards).toEqual([
      {
        workspaceId: ws.id,
        shardId: `${ws.id}:aa`,
        shardPrefix: 'aa',
        replicaPeerIds: ['alice', 'bob'],
        version: 2,
      },
    ]);
    expect(alice.events[alice.events.length - 1]).toEqual({
      type: 'directory-shards-updated',
      workspaceId: ws.id,
      shards: [
        {
          workspaceId: ws.id,
          shardId: `${ws.id}:aa`,
          shardPrefix: 'aa',
          replicaPeerIds: ['alice', 'bob'],
          version: 2,
        },
      ],
    });

    await alice.sync.handleMessage('bob', {
      type: 'directory-shard-repair',
      workspaceId: ws.id,
      shardId: `${ws.id}:aa`,
      requestedBy: 'bob',
      targetReplicaPeerIds: ['alice'],
    });

    expect(alice.outbox[alice.outbox.length - 1]).toEqual({
      to: 'bob',
      data: {
        type: 'workspace-sync',
        workspaceId: ws.id,
        sync: {
          type: 'directory-shard-advertisement',
          shard: {
            workspaceId: ws.id,
            shardId: `${ws.id}:aa`,
            shardPrefix: 'aa',
            replicaPeerIds: ['alice', 'bob'],
            version: 2,
          },
        },
      },
    });
  });
});
