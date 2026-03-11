import type { DirectoryShardRef, MemberSummary, WorkspaceMember } from './types';

export class DirectoryShardPlanner {
  constructor(private readonly shardPrefixLength = 2) {}

  getShardPrefixForMember(member: Pick<WorkspaceMember, 'peerId' | 'identityId'> | Pick<MemberSummary, 'peerId' | 'identityId'>): string {
    const key = (member.identityId || member.peerId || '').trim();
    const hash = this.hashToHex(key);
    return hash.slice(0, this.shardPrefixLength);
  }

  planShardRefs(
    workspaceId: string,
    members: Array<Pick<WorkspaceMember, 'peerId' | 'identityId'>>,
    replicaPeerIds: string[],
    version = 1,
  ): DirectoryShardRef[] {
    const replicaIds = [...new Set(replicaPeerIds.filter(Boolean))].sort();
    const prefixes = [...new Set(members.map((m) => this.getShardPrefixForMember(m)))].sort();
    return prefixes.map((prefix) => ({
      workspaceId,
      shardId: `${workspaceId}:${prefix}`,
      shardPrefix: prefix,
      replicaPeerIds: replicaIds,
      version,
    }));
  }

  private hashToHex(input: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }
}
