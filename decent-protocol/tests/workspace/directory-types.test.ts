import { describe, expect, test } from 'bun:test';
import type {
  Channel,
  ChannelAccessPolicy,
  DirectoryShardRef,
  HistoryPageRef,
  MemberDirectoryPage,
  MemberSummary,
  PeerCapabilities,
  PresenceAggregate,
  Workspace,
  WorkspaceShell,
} from '../../src';

describe('adaptive public workspace types', () => {
  test('workspace can carry scalable shell and shard metadata', () => {
    const shell: WorkspaceShell = {
      id: 'ws-1',
      name: 'Big Workspace',
      createdBy: 'alice',
      createdAt: 1,
      version: 7,
      memberCount: 120000,
      channelCount: 42,
      capabilityFlags: ['paged-directory', 'workspace-shell'],
    };

    const shard: DirectoryShardRef = {
      workspaceId: 'ws-1',
      shardId: 'shard-aa',
      shardPrefix: 'aa',
      replicaPeerIds: ['peer-1', 'peer-2'],
      version: 3,
    };

    const presence: PresenceAggregate = {
      workspaceId: 'ws-1',
      onlineCount: 834,
      awayCount: 120,
      updatedAt: Date.now(),
    };

    const capabilities: PeerCapabilities = {
      directory: { shardPrefixes: ['aa', 'ab'] },
      relay: { channels: ['general'] },
      archive: { retentionDays: 30 },
      presenceAggregator: true,
    };

    const workspace: Workspace = {
      id: 'ws-1',
      name: 'Big Workspace',
      inviteCode: 'ABCDEFGH',
      createdBy: 'alice',
      createdAt: 1,
      members: [],
      channels: [],
      shell,
      directoryShards: [shard],
      presenceAggregate: presence,
      peerCapabilities: { 'peer-1': capabilities },
    };

    expect(workspace.shell?.memberCount).toBe(120000);
    expect(workspace.directoryShards?.[0].shardPrefix).toBe('aa');
    expect(workspace.peerCapabilities?.['peer-1']?.directory?.shardPrefixes).toEqual(['aa', 'ab']);
  });

  test('channel access policy can represent scalable public and explicit access', () => {
    const publicPolicy: ChannelAccessPolicy = { mode: 'public-workspace' };
    const explicitPolicy: ChannelAccessPolicy = {
      mode: 'explicit',
      explicitMemberPeerIds: ['alice', 'bob'],
    };

    const historyPage: HistoryPageRef = {
      workspaceId: 'ws-1',
      channelId: 'ch-1',
      pageId: 'page-1',
      startCursor: '0',
      endCursor: '99',
      replicaPeerIds: ['peer-1'],
    };

    const publicChannel: Channel = {
      id: 'ch-public',
      workspaceId: 'ws-1',
      name: 'general',
      type: 'channel',
      members: ['alice'],
      accessPolicy: publicPolicy,
      historyPages: [historyPage],
      createdBy: 'alice',
      createdAt: 1,
    };

    const explicitChannel: Channel = {
      id: 'ch-explicit',
      workspaceId: 'ws-1',
      name: 'private-project',
      type: 'channel',
      members: ['alice', 'bob'],
      accessPolicy: explicitPolicy,
      createdBy: 'alice',
      createdAt: 1,
    };

    expect(publicChannel.accessPolicy?.mode).toBe('public-workspace');
    expect(explicitChannel.accessPolicy?.explicitMemberPeerIds).toEqual(['alice', 'bob']);
    expect(publicChannel.historyPages?.[0].pageId).toBe('page-1');
  });

  test('member directory pages carry summary records and cursors', () => {
    const member: MemberSummary = {
      peerId: 'alice',
      alias: 'Alice',
      role: 'owner',
      joinedAt: 1,
      isBot: false,
      allowWorkspaceDMs: false,
      presence: 'online',
    };

    const page: MemberDirectoryPage = {
      workspaceId: 'ws-1',
      pageSize: 100,
      members: [member],
      cursor: 'cursor-0',
      nextCursor: 'cursor-1',
    };

    expect(page.members[0].alias).toBe('Alice');
    expect(page.members[0].allowWorkspaceDMs).toBe(false);
    expect(page.nextCursor).toBe('cursor-1');
  });
});
