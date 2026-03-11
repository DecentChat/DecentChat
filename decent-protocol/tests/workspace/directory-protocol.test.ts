import { beforeEach, describe, expect, test } from 'bun:test';
import { DirectoryProtocol } from '../../src/workspace/DirectoryProtocol';
import { DirectoryShardPlanner } from '../../src/workspace/DirectoryShardPlanner';
import { WorkspaceManager } from '../../src/workspace/WorkspaceManager';

const member = (peerId: string, alias = peerId) => ({
  peerId,
  alias,
  publicKey: `${peerId}-pk`,
  joinedAt: 1,
  role: 'member' as const,
});

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
