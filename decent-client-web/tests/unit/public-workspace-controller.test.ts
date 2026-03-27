import { describe, expect, test } from 'bun:test';
import { DirectoryShardPlanner, WorkspaceManager, type MemberDirectoryPage, type WorkspaceShell } from '@decentchat/protocol';
import { PublicWorkspaceController } from '../../src/app/workspace/PublicWorkspaceController';

class FakePersistentStore {
  shells: WorkspaceShell[] = [];
  pagesByWorkspace = new Map<string, MemberDirectoryPage[]>();

  async getAllWorkspaceShells(): Promise<WorkspaceShell[]> {
    return this.shells;
  }

  async getMemberDirectoryPages(workspaceId: string): Promise<MemberDirectoryPage[]> {
    return this.pagesByWorkspace.get(workspaceId) || [];
  }

  async saveWorkspaceShell(shell: WorkspaceShell): Promise<void> {
    const idx = this.shells.findIndex((entry) => entry.id === shell.id);
    if (idx >= 0) this.shells[idx] = shell;
    else this.shells.push(shell);
  }

  async saveMemberDirectoryPage(page: MemberDirectoryPage): Promise<void> {
    const pages = this.pagesByWorkspace.get(page.workspaceId) || [];
    pages.push(page);
    this.pagesByWorkspace.set(page.workspaceId, pages);
  }

  async deletePublicWorkspaceData(workspaceId: string): Promise<void> {
    this.shells = this.shells.filter((shell) => shell.id !== workspaceId);
    this.pagesByWorkspace.delete(workspaceId);
  }
}

describe('PublicWorkspaceController', () => {
  test('restores shell-first workspace placeholders from storage', async () => {
    const workspaceManager = new WorkspaceManager();
    const store = new FakePersistentStore();
    store.shells.push({
      id: 'ws-shell-only',
      name: 'Big Public Workspace',
      createdBy: 'owner-peer',
      createdAt: 1,
      version: 4,
      memberCount: 5000,
      channelCount: 12,
    });

    const controller = new PublicWorkspaceController(workspaceManager, store as any);
    await controller.restoreFromStorage();

    const restored = workspaceManager.getWorkspace('ws-shell-only');
    expect(restored).toBeDefined();
    expect(restored?.name).toBe('Big Public Workspace');
    expect(restored?.members.length).toBe(0);
    expect(restored?.shell?.memberCount).toBe(5000);
  });

  test('ingests member pages and exposes loaded vs total counts', async () => {
    const workspaceManager = new WorkspaceManager();
    const store = new FakePersistentStore();
    const controller = new PublicWorkspaceController(workspaceManager, store as any);

    await controller.ingestWorkspaceShell({
      id: 'ws-1',
      name: 'Workspace',
      createdBy: 'owner',
      createdAt: 1,
      version: 2,
      memberCount: 3,
      channelCount: 1,
    }, 'INVITE123');

    await controller.ingestMemberPage({
      workspaceId: 'ws-1',
      pageSize: 2,
      members: [
        { peerId: 'a', alias: 'Alice', role: 'owner', joinedAt: 1, allowWorkspaceDMs: false },
        { peerId: 'b', alias: 'Bob', role: 'member', joinedAt: 2 },
      ],
      nextCursor: 'b',
    });

    const snapshot = controller.getSnapshot('ws-1');
    expect(snapshot.loadedCount).toBe(2);
    expect(snapshot.totalCount).toBe(3);
    expect(snapshot.hasMore).toBe(true);
    expect(snapshot.members.map((member) => member.alias)).toEqual(['Alice', 'Bob']);
    expect(snapshot.members.find((member) => member.peerId === 'a')?.allowWorkspaceDMs).toBe(false);
  });

  test('builds deterministic pages from known member directory data', async () => {
    const workspaceManager = new WorkspaceManager();
    const store = new FakePersistentStore();
    const controller = new PublicWorkspaceController(workspaceManager, store as any);

    await controller.ingestWorkspaceShell({
      id: 'ws-2',
      name: 'Workspace',
      createdBy: 'owner',
      createdAt: 1,
      version: 2,
      memberCount: 3,
      channelCount: 1,
    });

    await controller.ingestMemberPage({
      workspaceId: 'ws-2',
      pageSize: 3,
      members: [
        { peerId: 'p1', alias: 'Alice', role: 'owner', joinedAt: 1, identityId: 'a' },
        { peerId: 'p2', alias: 'Bob', role: 'member', joinedAt: 2, identityId: 'b' },
        { peerId: 'p3', alias: 'Cara', role: 'member', joinedAt: 3, identityId: 'c' },
      ],
    });

    const page1 = controller.buildPageFromWorkspace('ws-2', { pageSize: 2 });
    expect(page1.members.map((member) => member.peerId)).toEqual(['p1', 'p2']);
    expect(page1.nextCursor).toBe('b');

    const page2 = controller.buildPageFromWorkspace('ws-2', { cursor: page1.nextCursor, pageSize: 2 });
    expect(page2.members.map((member) => member.peerId)).toEqual(['p3']);
    expect(page2.nextCursor).toBeUndefined();

    const page3 = controller.buildPageFromWorkspace('ws-2', { cursor: 'c', pageSize: 2 });
    expect(page3.members).toEqual([]);
    expect(page3.nextCursor).toBeUndefined();
  });

  test('filters shard-scoped pages using deterministic shard prefixes', async () => {
    const workspaceManager = new WorkspaceManager();
    const store = new FakePersistentStore();
    const controller = new PublicWorkspaceController(workspaceManager, store as any);
    const planner = new DirectoryShardPlanner();

    await controller.ingestWorkspaceShell({
      id: 'ws-shards',
      name: 'Workspace',
      createdBy: 'owner',
      createdAt: 1,
      version: 2,
      memberCount: 3,
      channelCount: 1,
    });

    const members = [
      { peerId: 'p1', alias: 'Alice', role: 'owner' as const, joinedAt: 1, identityId: 'alpha' },
      { peerId: 'p2', alias: 'Bob', role: 'member' as const, joinedAt: 2, identityId: 'beta' },
      { peerId: 'p3', alias: 'Cara', role: 'member' as const, joinedAt: 3, identityId: 'gamma' },
    ];

    await controller.ingestMemberPage({
      workspaceId: 'ws-shards',
      pageSize: 3,
      members,
    });

    const target = members[0]!;
    const shardPrefix = planner.getShardPrefixForMember(target);
    const shardPage = controller.buildPageFromWorkspace('ws-shards', { pageSize: 50, shardPrefix });

    expect(shardPage.members.length).toBeGreaterThan(0);
    for (const member of shardPage.members) {
      expect(planner.getShardPrefixForMember(member)).toBe(shardPrefix);
    }
  });

  test('removes persisted shell-first workspace data so deleted workspaces do not reappear after refresh', async () => {
    const workspaceManager = new WorkspaceManager();
    const store = new FakePersistentStore();
    const controller = new PublicWorkspaceController(workspaceManager, store as any);

    await controller.ingestWorkspaceShell({
      id: 'ws-delete-me',
      name: 'Delete Me',
      createdBy: 'owner',
      createdAt: 1,
      version: 2,
      memberCount: 2,
      channelCount: 1,
    });

    await controller.ingestMemberPage({
      workspaceId: 'ws-delete-me',
      pageSize: 2,
      members: [
        { peerId: 'p1', alias: 'Alice', role: 'owner', joinedAt: 1 },
        { peerId: 'p2', alias: 'Bob', role: 'member', joinedAt: 2 },
      ],
    });

    expect(workspaceManager.getWorkspace('ws-delete-me')).toBeDefined();

    await controller.removeWorkspace('ws-delete-me');
    expect(workspaceManager.getWorkspace('ws-delete-me')).toBeUndefined();

    const reloadedManager = new WorkspaceManager();
    const reloaded = new PublicWorkspaceController(reloadedManager, store as any);
    await reloaded.restoreFromStorage();

    expect(reloadedManager.getWorkspace('ws-delete-me')).toBeUndefined();
  });

  test('identifies stale owned shell-only placeholders for startup cleanup', async () => {
    const workspaceManager = new WorkspaceManager();
    const store = new FakePersistentStore();
    const controller = new PublicWorkspaceController(workspaceManager, store as any);

    await controller.ingestWorkspaceShell({
      id: 'ws-stale-owned',
      name: 'Stale Owned',
      createdBy: 'owner',
      createdAt: 1,
      version: 1,
      memberCount: 1,
      channelCount: 1,
    });

    await controller.ingestWorkspaceShell({
      id: 'ws-foreign',
      name: 'Foreign',
      createdBy: 'someone-else',
      createdAt: 1,
      version: 1,
      memberCount: 1,
      channelCount: 1,
    });

    workspaceManager.importWorkspace({
      id: 'ws-hydrated',
      name: 'Hydrated',
      inviteCode: 'ABC123',
      createdBy: 'owner',
      createdAt: 1,
      version: 1,
      members: [{ peerId: 'owner', alias: 'Owner', role: 'owner', joinedAt: 1 }],
      channels: [],
      permissions: {
        whoCanCreateChannels: 'members',
        whoCanInviteMembers: 'members',
        allowMemberDMs: true,
        allowReactions: true,
        allowThreads: true,
        allowEditMessage: 'author',
        allowDeleteMessage: 'author',
        allowPinMessage: 'admins',
        allowVoiceMessage: true,
        allowSendFiles: true,
        allowManageWorkspace: 'owner',
        revokedInviteIds: [],
      },
      bans: [],
      shell: {
        id: 'ws-hydrated',
        name: 'Hydrated',
        createdBy: 'owner',
        createdAt: 1,
        version: 1,
        memberCount: 1,
        channelCount: 0,
      },
    });

    expect(controller.findStaleOwnedShellPlaceholders('owner', new Set(['ws-hydrated']))).toEqual(['ws-stale-owned']);
  });

  test('prefers hydrated workspace-member updates over stale paged directory records', async () => {
    const workspaceManager = new WorkspaceManager();
    const store = new FakePersistentStore();
    const controller = new PublicWorkspaceController(workspaceManager, store as any);

    await controller.ingestWorkspaceShell({
      id: 'ws-3',
      name: 'Workspace',
      createdBy: 'owner',
      createdAt: 1,
      version: 2,
      memberCount: 2,
      channelCount: 1,
    });

    await controller.ingestMemberPage({
      workspaceId: 'ws-3',
      pageSize: 2,
      members: [
        { peerId: 'p1', alias: 'Alice', role: 'member', joinedAt: 1 },
        { peerId: 'p2', alias: 'Bob', role: 'member', joinedAt: 2 },
      ],
    });

    const workspace = workspaceManager.getWorkspace('ws-3');
    expect(workspace).toBeDefined();
    workspace!.members = [
      { peerId: 'p1', alias: 'Alicia', role: 'admin', joinedAt: 1, publicKey: 'pk-1' },
      { peerId: 'p2', alias: 'Bob', role: 'member', joinedAt: 2, publicKey: 'pk-2', isBot: true },
    ];

    const snapshot = controller.getSnapshot('ws-3');
    const hydratedAlice = snapshot.members.find((member) => member.peerId === 'p1');
    const hydratedBob = snapshot.members.find((member) => member.peerId === 'p2');

    expect(hydratedAlice?.alias).toBe('Alicia');
    expect(hydratedAlice?.role).toBe('admin');
    expect(hydratedBob?.isBot).toBe(true);
  });
});
