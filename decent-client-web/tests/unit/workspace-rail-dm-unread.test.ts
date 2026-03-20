import { beforeEach, describe, expect, mock, test } from 'bun:test';

(globalThis as any).$state = <T>(value: T): T => value;

function makeContext(getUnreadCount: (id: string) => number) {
  return {
    state: {
      activeWorkspaceId: 'ws-1',
      activeChannelId: 'ch-1',
      activeDirectConversationId: null,
      activeThreadId: null,
      threadOpen: false,
      myPeerId: 'me',
    },
    workspaceManager: {
      getWorkspace: mock(() => null),
      getChannels: mock(() => []),
      getChannel: mock(() => null),
    } as any,
    messageStore: {
      getMessages: mock(() => []),
      getThread: mock(() => []),
      getThreadRoot: mock(() => null),
    } as any,
    callbacks: {
      getAllWorkspaces: mock(() => [{ id: 'ws-1', name: 'Workspace' }]),
      getActivityUnreadCount: mock(() => 0),
      getUnreadCount: mock(getUnreadCount),
    } as any,
    getPeerAlias: mock((peerId: string) => peerId),
    getMyDisplayName: mock(() => 'Me'),
    getComposePlaceholder: mock(() => 'Message...'),
    getFrequentReactions: mock(() => []),
    peerStatusClass: mock(() => 'offline'),
    peerStatusTitle: mock(() => 'Offline'),
  };
}

describe('workspace rail DM unread badge', () => {
  beforeEach(async () => {
    const { cachedData } = await import('../../src/lib/stores/ui.svelte');
    const { shellData } = await import('../../src/lib/stores/shell.svelte');

    cachedData.directConversations = [];
    shellData.rail.workspaces = [];
    shellData.rail.activeWorkspaceId = null;
    shellData.rail.activityUnread = 0;
    (shellData.rail as any).dmUnread = 0;
  });

  test('syncShellRail totals unread counts across direct conversations', async () => {
    const { createShellSyncHelpers } = await import('../../src/ui/uiShellSync');
    const { cachedData } = await import('../../src/lib/stores/ui.svelte');
    const { shellData } = await import('../../src/lib/stores/shell.svelte');

    cachedData.directConversations = [
      { id: 'dm-1', contactPeerId: 'alice', lastMessageAt: 10 } as any,
      { id: 'dm-2', contactPeerId: 'bob', lastMessageAt: 20 } as any,
      { id: 'dm-3', contactPeerId: 'carol', lastMessageAt: 30 } as any,
    ];

    const helpers = createShellSyncHelpers(makeContext((id) => {
      if (id === 'dm-1') return 2;
      if (id === 'dm-2') return 5;
      return 0;
    }));

    helpers.syncShellRail();

    expect((shellData.rail as any).dmUnread).toBe(7);
  });
});
