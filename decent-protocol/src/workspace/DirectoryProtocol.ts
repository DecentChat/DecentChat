import type {
  DirectoryShardRef,
  MemberDirectoryPage,
  MemberSummary,
  SyncMessage,
  WorkspaceMember,
} from './types';
import { WorkspaceManager } from './WorkspaceManager';
import { DirectoryShardPlanner } from './DirectoryShardPlanner';

export interface MemberPageRequestOptions {
  cursor?: string;
  pageSize?: number;
  shardPrefix?: string;
}

export class DirectoryProtocol {
  private static readonly MEDIUM_WORKSPACE_MEMBER_THRESHOLD = 100;
  private static readonly IMPORTANT_SHARD_MIN_REPLICAS = 2;
  private static readonly IMPORTANT_SHARD_PREFERRED_REPLICAS = 3;

  constructor(
    private readonly workspaceManager: WorkspaceManager,
    private readonly shardPlanner = new DirectoryShardPlanner(),
  ) {}

  getMemberPage(workspaceId: string, opts: MemberPageRequestOptions = {}): MemberDirectoryPage {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) {
      return { workspaceId, pageSize: this.clampPageSize(opts.pageSize), members: [] };
    }

    const pageSize = this.clampPageSize(opts.pageSize);
    const members = workspace.members
      .filter((member) => !opts.shardPrefix || this.shardPlanner.getShardPrefixForMember(member) === opts.shardPrefix)
      .map((member) => this.toMemberSummary(member))
      .sort((a, b) => this.memberCursor(a).localeCompare(this.memberCursor(b)));

    const cursor = opts.cursor;
    const startIndex = cursor
      ? (() => {
          const idx = members.findIndex((member) => this.memberCursor(member) > cursor);
          return idx >= 0 ? idx : members.length;
        })()
      : 0;
    const pageMembers = members.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + pageSize < members.length;

    const page: MemberDirectoryPage = {
      workspaceId,
      pageSize,
      cursor: opts.cursor,
      nextCursor: hasMore && pageMembers.length > 0 ? this.memberCursor(pageMembers[pageMembers.length - 1]) : undefined,
      shardRef: opts.shardPrefix ? this.getShardRef(workspaceId, opts.shardPrefix, workspace.members) : undefined,
      members: pageMembers,
    };

    return page;
  }

  getShardPrefixForMember(peerId: string, workspaceId: string): string | undefined {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    const member = workspace?.members.find((m) => m.peerId === peerId);
    return member ? this.shardPlanner.getShardPrefixForMember(member) : undefined;
  }

  buildMemberPageResponse(workspaceId: string, opts: MemberPageRequestOptions = {}): Extract<SyncMessage, { type: 'member-page-response' }> {
    return {
      type: 'member-page-response',
      page: this.getMemberPage(workspaceId, opts),
    };
  }

  buildShardAdvertisement(
    workspaceId: string,
    members: WorkspaceMember[],
    replicaPeerIds: string[],
    version = 1,
  ): Array<Extract<SyncMessage, { type: 'directory-shard-advertisement' }>> {
    const normalizedReplicaPeerIds = this.normalizeReplicaPeerIds(replicaPeerIds, members.length);

    return this.shardPlanner.planShardRefs(workspaceId, members, normalizedReplicaPeerIds, version).map((shard) => ({
      type: 'directory-shard-advertisement',
      shard,
    }));
  }

  buildShardRepairRequest(
    workspaceId: string,
    shardId: string,
    requestedBy: string,
    targetReplicaPeerIds: string[] = [],
  ): Extract<SyncMessage, { type: 'directory-shard-repair' }> {
    return {
      type: 'directory-shard-repair',
      workspaceId,
      shardId,
      requestedBy,
      targetReplicaPeerIds,
    };
  }

  private getShardRef(workspaceId: string, shardPrefix: string, members: WorkspaceMember[]): DirectoryShardRef {
    return this.shardPlanner.planShardRefs(workspaceId, members, [], 1)
      .find((ref) => ref.shardPrefix === shardPrefix) || {
        workspaceId,
        shardId: `${workspaceId}:${shardPrefix}`,
        shardPrefix,
        replicaPeerIds: [],
        version: 1,
      };
  }

  private normalizeReplicaPeerIds(replicaPeerIds: string[], memberCount: number): string[] {
    const uniqueReplicaPeerIds = [...new Set(replicaPeerIds.filter(Boolean))].sort();

    if (memberCount < DirectoryProtocol.MEDIUM_WORKSPACE_MEMBER_THRESHOLD) {
      return uniqueReplicaPeerIds;
    }

    if (uniqueReplicaPeerIds.length <= DirectoryProtocol.IMPORTANT_SHARD_MIN_REPLICAS) {
      return uniqueReplicaPeerIds;
    }

    const targetReplicaCount = Math.min(
      DirectoryProtocol.IMPORTANT_SHARD_PREFERRED_REPLICAS,
      Math.max(DirectoryProtocol.IMPORTANT_SHARD_MIN_REPLICAS, uniqueReplicaPeerIds.length),
    );

    return uniqueReplicaPeerIds.slice(0, targetReplicaCount);
  }

  private clampPageSize(pageSize?: number): number {
    if (!pageSize || pageSize <= 0) return 100;
    return Math.min(pageSize, 200);
  }

  private toMemberSummary(member: WorkspaceMember): MemberSummary {
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

  private memberCursor(member: MemberSummary): string {
    return `${member.identityId || member.peerId}`;
  }
}
