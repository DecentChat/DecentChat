import { DEFAULT_WORKSPACE_PERMISSIONS } from 'decent-protocol';
import type {
  MemberDirectoryPage,
  MemberSummary,
  PersistentStore,
  Workspace,
  WorkspaceManager,
  WorkspaceMember,
  WorkspaceShell,
} from 'decent-protocol';

const ROOT_CURSOR = '__root__';

interface WorkspaceDirectoryRuntime {
  membersByPeerId: Map<string, MemberSummary>;
  nextCursor?: string;
  pendingCursorKeys: Set<string>;
}

export interface WorkspaceDirectorySnapshot {
  members: MemberSummary[];
  loadedCount: number;
  totalCount: number;
  hasMore: boolean;
  nextCursor?: string;
}

export class PublicWorkspaceController {
  private readonly runtime = new Map<string, WorkspaceDirectoryRuntime>();

  constructor(
    private readonly workspaceManager: WorkspaceManager,
    private readonly persistentStore: PersistentStore,
  ) {}

  async restoreFromStorage(): Promise<void> {
    const shells = await this.persistentStore.getAllWorkspaceShells();
    for (const shell of shells) {
      this.upsertWorkspaceFromShell(shell);
      const pages = await this.persistentStore.getMemberDirectoryPages(shell.id);
      for (const page of pages) {
        this.applyMemberPage(page, false);
      }
    }
  }

  ingestWorkspaceSnapshot(workspace: Workspace): void {
    const runtime = this.getRuntime(workspace.id);
    for (const member of workspace.members) {
      runtime.membersByPeerId.set(member.peerId, this.toSummary(member));
    }
  }

  async persistWorkspaceShell(workspace: Workspace): Promise<void> {
    await this.persistentStore.saveWorkspaceShell(this.buildShell(workspace));
  }

  async ingestWorkspaceShell(shell: WorkspaceShell, inviteCode?: string): Promise<void> {
    this.upsertWorkspaceFromShell(shell, inviteCode);
    await this.persistentStore.saveWorkspaceShell(shell);
  }

  async ingestMemberPage(page: MemberDirectoryPage): Promise<void> {
    this.applyMemberPage(page, true);
  }

  getSnapshot(workspaceId: string): WorkspaceDirectorySnapshot {
    const runtime = this.getRuntime(workspaceId);
    const workspace = this.workspaceManager.getWorkspace(workspaceId);

    if (workspace) {
      for (const member of workspace.members) {
        const existing = runtime.membersByPeerId.get(member.peerId);
        const next = this.toSummary(member);
        runtime.membersByPeerId.set(member.peerId, {
          ...existing,
          ...next,
          alias: next.alias || existing?.alias || member.peerId.slice(0, 8),
          role: next.role || existing?.role || 'member',
          joinedAt: next.joinedAt || existing?.joinedAt || 0,
          isBot: next.isBot ?? existing?.isBot,
          identityId: next.identityId || existing?.identityId,
        });
      }
    }

    const members = [...runtime.membersByPeerId.values()].sort((a, b) => {
      const aAlias = (a.alias || '').toLowerCase();
      const bAlias = (b.alias || '').toLowerCase();
      if (aAlias !== bAlias) return aAlias.localeCompare(bAlias);
      return a.peerId.localeCompare(b.peerId);
    });

    const loadedCount = members.length;
    const totalCount = Math.max(
      loadedCount,
      workspace?.shell?.memberCount ?? 0,
      workspace?.members.length ?? 0,
    );

    return {
      members,
      loadedCount,
      totalCount,
      hasMore: Boolean(runtime.nextCursor) || loadedCount < totalCount,
      nextCursor: runtime.nextCursor,
    };
  }

  getMemberAlias(peerId: string, workspaceId?: string): string | undefined {
    if (workspaceId) {
      return this.runtime.get(workspaceId)?.membersByPeerId.get(peerId)?.alias;
    }

    for (const runtime of this.runtime.values()) {
      const alias = runtime.membersByPeerId.get(peerId)?.alias;
      if (alias) return alias;
    }

    return undefined;
  }

  beginPageRequest(workspaceId: string, cursor?: string): boolean {
    const runtime = this.getRuntime(workspaceId);
    const cursorKey = this.cursorKey(cursor);
    if (runtime.pendingCursorKeys.has(cursorKey)) return false;
    runtime.pendingCursorKeys.add(cursorKey);
    return true;
  }

  endPageRequest(workspaceId: string, cursor?: string): void {
    this.getRuntime(workspaceId).pendingCursorKeys.delete(this.cursorKey(cursor));
  }

  buildPageFromWorkspace(
    workspaceId: string,
    options: { cursor?: string; pageSize?: number; shardPrefix?: string } = {},
  ): MemberDirectoryPage {
    const snapshot = this.getSnapshot(workspaceId);
    const pageSize = this.clampPageSize(options.pageSize);

    const filtered = snapshot.members
      .filter((member) => {
        if (!options.shardPrefix) return true;
        const key = member.identityId || member.peerId;
        return key.startsWith(options.shardPrefix);
      })
      .sort((a, b) => this.memberCursor(a).localeCompare(this.memberCursor(b)));

    const cursor = options.cursor;
    const startIndex = cursor
      ? Math.max(0, filtered.findIndex((member) => this.memberCursor(member) > cursor))
      : 0;
    const members = filtered.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + pageSize < filtered.length;

    return {
      workspaceId,
      pageSize,
      cursor,
      nextCursor: hasMore && members.length > 0 ? this.memberCursor(members[members.length - 1]!) : undefined,
      members,
    };
  }

  buildShell(workspace: Workspace): WorkspaceShell {
    const fallbackVersion = workspace.version ?? 1;
    return {
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      createdBy: workspace.createdBy,
      createdAt: workspace.createdAt,
      version: workspace.shell?.version ?? fallbackVersion,
      memberCount: workspace.shell?.memberCount ?? workspace.members.length,
      channelCount: workspace.shell?.channelCount ?? workspace.channels.length,
      capabilityFlags: workspace.shell?.capabilityFlags,
    };
  }

  private applyMemberPage(page: MemberDirectoryPage, persist: boolean): void {
    const runtime = this.getRuntime(page.workspaceId);
    for (const member of page.members ?? []) {
      runtime.membersByPeerId.set(member.peerId, member);
    }
    runtime.nextCursor = page.nextCursor;

    if (persist) {
      void this.persistentStore.saveMemberDirectoryPage(page);
    }
  }

  private upsertWorkspaceFromShell(shell: WorkspaceShell, inviteCode = 'PAGED000'): void {
    const existing = this.workspaceManager.getWorkspace(shell.id);
    const next: Workspace = existing
      ? {
          ...existing,
          name: shell.name,
          description: shell.description,
          version: shell.version,
          shell,
        }
      : {
          id: shell.id,
          name: shell.name,
          inviteCode,
          createdBy: shell.createdBy,
          createdAt: shell.createdAt,
          version: shell.version,
          members: [],
          channels: [],
          shell,
          permissions: { ...DEFAULT_WORKSPACE_PERMISSIONS },
          bans: [],
        };

    this.workspaceManager.importWorkspace(structuredClone(next));
  }

  private getRuntime(workspaceId: string): WorkspaceDirectoryRuntime {
    let runtime = this.runtime.get(workspaceId);
    if (!runtime) {
      runtime = {
        membersByPeerId: new Map(),
        pendingCursorKeys: new Set(),
      };
      this.runtime.set(workspaceId, runtime);
    }
    return runtime;
  }

  private toSummary(member: WorkspaceMember): MemberSummary {
    return {
      peerId: member.peerId,
      alias: member.alias,
      role: member.role,
      joinedAt: member.joinedAt,
      identityId: member.identityId,
      isBot: member.isBot,
      allowWorkspaceDMs: member.allowWorkspaceDMs,
    };
  }

  private cursorKey(cursor?: string): string {
    return cursor || ROOT_CURSOR;
  }

  private clampPageSize(pageSize?: number): number {
    if (!pageSize || pageSize <= 0) return 100;
    return Math.min(pageSize, 200);
  }

  private memberCursor(member: MemberSummary): string {
    return `${member.identityId || member.peerId}`;
  }
}
