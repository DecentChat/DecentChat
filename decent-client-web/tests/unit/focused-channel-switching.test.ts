import { describe, expect, mock, test } from 'bun:test';

(globalThis as any).$state = <T>(value: T): T => value;

describe('focused channel switching', () => {
  test('switching to the DMs list clears focused channel when no DM conversation is active', async () => {
    const { registerShellCallbacks } = await import('../../src/ui/registerShellCallbacks');
    const { getShellCallbacks } = await import('../../src/lib/stores/shell.svelte');

    const state = {
      myPeerId: 'me',
      myAlias: 'Me',
      workspaceAliases: {},
      connectedPeers: new Set<string>(),
      connectingPeers: new Set<string>(),
      readyPeers: new Set<string>(),
      activeWorkspaceId: 'ws-1',
      activeChannelId: 'ch-1',
      activeDirectConversationId: null,
      activeThreadId: null,
      threadOpen: false,
      sidebarOpen: true,
    } as any;

    const callbacks = {
      setFocusedChannel: mock(() => {}),
    } as any;

    registerShellCallbacks({
      state,
      workspaceManager: { getWorkspace: mock(() => null) } as any,
      messageStore: {} as any,
      callbacks,
      modalActions: {} as any,
      toggleActivityPanel: mock(() => {}),
      persistViewState: mock(() => {}),
      refreshContactsCache: mock(async () => {}),
      syncShellSidebar: mock(() => {}),
      syncShellRail: mock(() => {}),
      syncShellHeader: mock(() => {}),
      syncShellMessages: mock(() => {}),
      refreshActivityPanel: mock(() => {}),
      switchWorkspace: mock(() => {}),
      switchChannel: mock(() => {}),
      switchToDirectConversation: mock(() => {}),
      startMemberDM: mock(() => {}),
      openThread: mock(() => {}),
      closeThread: mock(() => {}),
      rememberReaction: mock(() => {}),
      showMessageInfo: mock(() => {}),
      openLightbox: mock(() => {}),
      scrollToMessageAndHighlight: mock(() => {}),
      getPeerAlias: mock((peerId: string) => peerId),
      peerStatusClass: mock(() => ''),
      peerStatusTitle: mock(() => 'Offline'),
      showToast: mock(() => {}),
      toggleMobileSidebar: mock(() => {}),
      closeMobileSidebar: mock(() => {}),
      closeLightbox: mock(() => {}),
      syncShellHuddle: mock(() => {}),
    });

    const shellCallbacks = getShellCallbacks();
    shellCallbacks!.onSwitchToDMs();

    expect(state.activeWorkspaceId).toBeNull();
    expect(state.activeChannelId).toBeNull();
    expect(callbacks.setFocusedChannel).toHaveBeenCalledWith(null);
  });
});
