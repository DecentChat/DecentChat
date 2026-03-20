import { beforeEach, describe, expect, mock, test } from 'bun:test';

(globalThis as any).$state = <T>(value: T): T => value;

describe('activity navigation', () => {
  beforeEach(() => {
    // no-op; callbacks are overwritten per test
  });

  test('switches workspace before channel and thread when navigating to activity in another workspace', async () => {
    const { registerShellCallbacks } = await import('../../src/ui/registerShellCallbacks');
    const { getShellCallbacks, shellData } = await import('../../src/lib/stores/shell.svelte');

    shellData.activity.panelOpen = true;

    const calls: string[] = [];
    const state: any = {
      myPeerId: 'me',
      myAlias: 'Me',
      workspaceAliases: {},
      connectedPeers: new Set<string>(),
      connectingPeers: new Set<string>(),
      readyPeers: new Set<string>(),
      activeWorkspaceId: 'ws-current',
      activeChannelId: 'ch-current',
      activeThreadId: null,
      threadOpen: false,
      sidebarOpen: true,
      activeDirectConversationId: null,
    };

    registerShellCallbacks({
      state,
      workspaceManager: {
        getWorkspace: mock(() => null),
      } as any,
      messageStore: {} as any,
      callbacks: {
        getActivityPeerAlias: mock((peerId: string) => peerId),
      } as any,
      modalActions: {} as any,
      toggleActivityPanel: mock(() => {
        calls.push('toggleActivityPanel');
        shellData.activity.panelOpen = false;
      }),
      persistViewState: mock(() => {
        calls.push('persistViewState');
      }),
      refreshContactsCache: mock(async () => {}),
      syncShellSidebar: mock(() => {}),
      syncShellRail: mock(() => {
        calls.push('syncShellRail');
      }),
      syncShellHeader: mock(() => {
        calls.push('syncShellHeader');
      }),
      syncShellMessages: mock(() => {}),
      refreshActivityPanel: mock(() => {
        calls.push('refreshActivityPanel');
      }),
      switchWorkspace: mock((workspaceId: string) => {
        calls.push(`switchWorkspace:${workspaceId}`);
        state.activeWorkspaceId = workspaceId;
        state.activeChannelId = 'ch-target';
        state.threadOpen = false;
        state.activeThreadId = null;
      }),
      switchChannel: mock((channelId: string) => {
        calls.push(`switchChannel:${channelId}`);
        state.activeChannelId = channelId;
        state.threadOpen = false;
        state.activeThreadId = null;
      }),
      switchToDirectConversation: mock(() => {}),
      startMemberDM: mock(() => {}),
      openThread: mock((threadId: string) => {
        calls.push(`openThread:${threadId}`);
        state.threadOpen = true;
        state.activeThreadId = threadId;
      }),
      closeThread: mock(() => {}),
      rememberReaction: mock(() => {}),
      showMessageInfo: mock(() => {}),
      openLightbox: mock(() => {}),
      scrollToMessageAndHighlight: mock((messageId: string, containerId?: string) => {
        calls.push(`scroll:${containerId ?? 'messages-list'}:${messageId}`);
      }),
      getPeerAlias: mock((peerId: string) => peerId),
      peerStatusClass: mock(() => ''),
      peerStatusTitle: mock(() => ''),
      showToast: mock(() => {}),
      toggleMobileSidebar: mock(() => {}),
      closeLightbox: mock(() => {}),
      syncShellHuddle: mock(() => {}),
    });

    const shellCallbacks = getShellCallbacks();
    expect(shellCallbacks).toBeTruthy();

    shellCallbacks!.onNavigateActivity({
      id: 'thread:ws-target:ch-target:thread-1',
      type: 'thread-reply',
      workspaceId: 'ws-target',
      channelId: 'ch-target',
      threadId: 'thread-1',
      messageId: 'msg-99',
      actorId: 'alice',
      snippet: 'hi',
      timestamp: Date.now(),
      read: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(calls).toContain('switchWorkspace:ws-target');
    expect(calls).toContain('switchChannel:ch-target');
    expect(calls).toContain('openThread:thread-1');
    expect(calls.indexOf('switchWorkspace:ws-target')).toBeLessThan(calls.indexOf('switchChannel:ch-target'));
    expect(calls.indexOf('switchChannel:ch-target')).toBeLessThan(calls.indexOf('openThread:thread-1'));
    expect(state.activeWorkspaceId).toBe('ws-target');
  });
});
