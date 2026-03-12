import { describe, expect, test } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';
import { PresenceManager } from '../../src/ui/PresenceManager';

describe('presence directory consumption', () => {
  test('getWorkspaceMemberDirectory exposes aggregate/page summary and marks sampled peers online', () => {
    const presence = new PresenceManager();
    presence.handlePresenceAggregate({
      workspaceId: 'ws-1',
      onlineCount: 7,
      updatedAt: 50,
      activeChannelId: 'chan-a',
    });
    presence.handlePresencePageResponse({
      type: 'presence-page-response',
      workspaceId: 'ws-1',
      channelId: 'chan-a',
      cursor: undefined,
      nextCursor: 'peer-z',
      pageSize: 2,
      peers: [
        { peerId: 'peer-1', status: 'online' },
        { peerId: 'peer-2', status: 'offline' },
      ],
      updatedAt: 60,
    });

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myPeerId: 'me',
      activeWorkspaceId: 'ws-1',
      activeChannelId: 'chan-a',
      readyPeers: new Set<string>(['dir-1']),
    };
    ctrl.presence = presence;
    ctrl.publicWorkspaceController = {
      getSnapshot: () => ({
        members: [
          {
            peerId: 'peer-1',
            alias: 'Alice',
            role: 'member',
            isBot: false,
            allowWorkspaceDMs: true,
          },
        ],
        loadedCount: 1,
        totalCount: 100,
        hasMore: true,
      }),
    };
    ctrl.peerCapabilities = new Map<string, Set<string>>([
      ['dir-1', new Set(['member-directory-v1'])],
    ]);
    ctrl.workspaceManager = {
      getWorkspace: (workspaceId: string) => workspaceId === 'ws-1' ? {
        id: 'ws-1',
        members: [
          { peerId: 'me' },
          { peerId: 'dir-1' },
          { peerId: 'peer-1' },
        ],
        shell: { capabilityFlags: ['large-workspace-v1'] },
      } : null,
      getMember: () => undefined,
    };

    const view = ChatController.prototype.getWorkspaceMemberDirectory.call(ctrl, 'ws-1');

    expect(view.members[0]?.isOnline).toBe(true);
    expect(view.presence).toEqual({
      onlineCount: 7,
      sampledOnlineCount: 1,
      sampledPeerCount: 2,
      hasMore: true,
      nextCursor: 'peer-z',
      loadedPages: 1,
      activeChannelId: 'chan-a',
      updatedAt: 60,
    });

    presence.destroy();
  });
});
