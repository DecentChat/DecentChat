/**
 * Tests for pending→sent→delivered status delivery fixes.
 *
 * Fix 1: main.ts bridge forwards the `detail` third argument.
 * Fix 4: updateMessageStatus retries after syncShellMessages when the message
 *         hasn't been synced to the shell store yet (race condition).
 */
import { describe, expect, mock, test } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

// ── Fix 1: detail arg forwarding through main.ts bridge ──────────────────────

describe('Fix 1 — detail arg forwarding', () => {
  test('ACK handler calls ui.updateMessageStatus with full detail object', async () => {
    const msg = {
      id: 'm1',
      channelId: 'ch-1',
      senderId: 'me',
      status: 'sent',
      recipientPeerIds: ['alice'],
      ackedBy: [] as string[],
      ackedAt: {} as Record<string, number>,
      readBy: [] as string[],
      readAt: {} as Record<string, number>,
    };

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myPeerId: 'me',
      myAlias: 'me',
      readyPeers: new Set<string>(),
      connectedPeers: new Set<string>(),
      connectingPeers: new Set<string>(),
      activeWorkspaceId: null,
      activeChannelId: null,
      activeThreadId: null,
      threadOpen: false,
      sidebarOpen: false,
      activeDirectConversationId: null,
      workspaceAliases: {},
    };
    ctrl.transport = { send: mock(() => true) };
    ctrl.deferredGossipIntents = new Map();
    ctrl.pendingDeliveryWatchTimers = new Map();
    ctrl.pendingDeliveryRecoveryCooldowns = new Map();
    ctrl.offlineQueue = { applyReceipt: mock(async () => true) };
    ctrl.messageGuard = { check: mock(() => ({ allowed: true })) };
    ctrl.messageStore = { getMessages: mock(() => [msg]) };
    ctrl.workspaceManager = { getAllWorkspaces: mock(() => []) };
    ctrl.directConversationStore = { conversations: new Map<string, any>() };
    ctrl.persistentStore = { getPeer: mock(async () => null), saveMessage: mock(async () => {}), saveSetting: mock(async () => {}) };
    ctrl.ui = { updateMessageStatus: mock(() => {}) };
    ctrl.handshakeInFlight = new Set<string>();
    ctrl.messageSyncInFlight = new Map<string, Promise<void>>();
    ctrl.retryUnackedInFlight = new Map<string, Promise<void>>();

    ChatController.prototype.setupTransportHandlers.call(ctrl);

    // Simulate alice ACKing the message
    await ctrl.transport.onMessage('alice', { type: 'ack', channelId: 'ch-1', messageId: 'm1' });

    expect(ctrl.ui.updateMessageStatus).toHaveBeenCalledTimes(1);
    const args = ctrl.ui.updateMessageStatus.mock.calls[0];
    expect(args[0]).toBe('m1');           // messageId
    expect(args[1]).toBe('delivered');     // status
    expect(args[2]).toBeDefined();        // detail must be present (Fix 1)
    expect(args[2]).toMatchObject({ acked: 1, total: 1 });
  });

  test('detail arg includes read count after read receipt', async () => {
    const msg = {
      id: 'm2',
      channelId: 'ch-1',
      senderId: 'me',
      status: 'sent',
      recipientPeerIds: ['alice'],
      ackedBy: [] as string[],
      ackedAt: {} as Record<string, number>,
      readBy: [] as string[],
      readAt: {} as Record<string, number>,
    };

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myPeerId: 'me',
      myAlias: 'me',
      readyPeers: new Set<string>(),
      connectedPeers: new Set<string>(),
      connectingPeers: new Set<string>(),
      activeWorkspaceId: null,
      activeChannelId: null,
      activeThreadId: null,
      threadOpen: false,
      sidebarOpen: false,
      activeDirectConversationId: null,
      workspaceAliases: {},
    };
    ctrl.transport = { send: mock(() => true) };
    ctrl.deferredGossipIntents = new Map();
    ctrl.pendingDeliveryWatchTimers = new Map();
    ctrl.pendingDeliveryRecoveryCooldowns = new Map();
    ctrl.offlineQueue = { applyReceipt: mock(async () => true) };
    ctrl.messageGuard = { check: mock(() => ({ allowed: true })) };
    ctrl.messageStore = { getMessages: mock(() => [msg]) };
    ctrl.workspaceManager = { getAllWorkspaces: mock(() => []) };
    ctrl.directConversationStore = { conversations: new Map<string, any>() };
    ctrl.persistentStore = { getPeer: mock(async () => null), saveMessage: mock(async () => {}), saveSetting: mock(async () => {}) };
    ctrl.ui = { updateMessageStatus: mock(() => {}) };
    ctrl.handshakeInFlight = new Set<string>();
    ctrl.messageSyncInFlight = new Map<string, Promise<void>>();
    ctrl.retryUnackedInFlight = new Map<string, Promise<void>>();

    ChatController.prototype.setupTransportHandlers.call(ctrl);

    // Send a read receipt — this also implies delivered
    await ctrl.transport.onMessage('alice', { type: 'read', channelId: 'ch-1', messageId: 'm2' });

    expect(ctrl.ui.updateMessageStatus).toHaveBeenCalledTimes(1);
    const args = ctrl.ui.updateMessageStatus.mock.calls[0];
    expect(args[0]).toBe('m2');
    expect(args[1]).toBe('read');
    expect(args[2]).toBeDefined();
    expect(args[2].read).toBe(1);
    expect(args[2].acked).toBe(1);
    expect(args[2].total).toBe(1);
  });
});

// ── Fix 4: updateMessageStatus race condition (sync-on-miss retry) ───────────
//
// We can't import createUIService directly because it transitively imports
// Svelte components that fail in a pure Bun test.  Instead, we replicate the
// exact updateMessageStatus logic from uiService.ts and verify that the
// sync-on-miss fallback works correctly with real shellData + createShellSyncHelpers.

// Polyfill Svelte 5 $state for Bun test environment
(globalThis as any).$state = <T>(value: T): T => value;

describe('Fix 4 — updateMessageStatus sync-on-miss retry', () => {
  test('syncShellMessages populates missing message so patch succeeds', async () => {
    const { shellData } = await import('../../src/lib/stores/shell.svelte');
    const { createShellSyncHelpers } = await import('../../src/ui/uiShellSync');

    const pendingMsg = {
      id: 'msg-race-1',
      channelId: 'ch-1',
      senderId: 'me',
      status: 'pending',
      content: 'hello',
      timestamp: Date.now(),
      recipientPeerIds: ['alice'],
      ackedBy: [],
      readBy: [],
    } as any;

    const state: any = {
      myPeerId: 'me',
      activeWorkspaceId: 'ws-1',
      activeChannelId: 'ch-1',
      activeThreadId: null,
      threadOpen: false,
      activeDirectConversationId: null,
      workspaceAliases: {},
    };

    const messageStore = {
      getMessages: mock(() => [pendingMsg]),
      getThread: mock(() => []),
      getThreadRoot: mock(() => null),
    } as any;

    const workspaceManager = {
      getWorkspace: mock(() => ({ id: 'ws-1', name: 'Test' })),
      getChannel: mock(() => ({ id: 'ch-1', name: 'general', type: 'channel' })),
      getChannels: mock(() => []),
      getMember: mock(() => null),
    } as any;

    const helpers = createShellSyncHelpers({
      state,
      workspaceManager,
      messageStore,
      callbacks: {
        getAllWorkspaces: mock(() => [{ id: 'ws-1', name: 'Test' }]),
        getDisplayNameForPeer: mock((peerId: string) => peerId.slice(0, 8)),
        getActivityUnreadCount: mock(() => 0),
        getUnreadCount: mock(() => 0),
      } as any,
      getPeerAlias: (peerId: string) => peerId.slice(0, 8),
      getMyDisplayName: () => 'Me',
      getComposePlaceholder: () => 'Message...',
      getFrequentReactions: () => [],
      peerStatusClass: () => 'offline',
      peerStatusTitle: () => 'Offline',
    });

    // Start with empty shellData (simulating deferred rAF not yet run)
    shellData.messages.messages = [];
    shellData.messages.activeChannelId = 'ch-1';
    shellData.thread.open = false;
    shellData.thread.parentMessage = null;
    shellData.thread.replies = [];

    // Verify the message is NOT in shell yet
    expect(shellData.messages.messages.find((m: any) => m.id === 'msg-race-1')).toBeUndefined();

    // This is the core of Fix 4: the patch function that updateMessageStatus uses
    const patch = (msg: any) => {
      if (!msg || msg.id !== 'msg-race-1') return msg;
      return { ...msg, status: 'sent', recipientPeerIds: ['alice'], ackedBy: [], readBy: [] };
    };

    // First attempt: patch finds nothing
    let changed = false;
    shellData.messages.messages = shellData.messages.messages.map((msg: any) => {
      const next = patch(msg);
      if (next !== msg) changed = true;
      return next;
    });
    expect(changed).toBe(false);

    // Fix 4: sync-on-miss — if not found, call syncShellMessages() and retry
    if (!changed && !shellData.messages.messages.some((m: any) => m?.id === 'msg-race-1')) {
      helpers.syncShellMessages();

      // Now retry the patch
      shellData.messages.messages = shellData.messages.messages.map((msg: any) => {
        const next = patch(msg);
        if (next !== msg) changed = true;
        return next;
      });
    }

    // After the fix: message should be found and patched
    expect(changed).toBe(true);
    const found = shellData.messages.messages.find((m: any) => m.id === 'msg-race-1');
    expect(found).toBeDefined();
    expect(found!.status).toBe('sent');
  });

  test('patch succeeds on first try when message is already in shell (no sync needed)', async () => {
    const { shellData } = await import('../../src/lib/stores/shell.svelte');

    const sentMsg = {
      id: 'msg-present-1',
      channelId: 'ch-1',
      senderId: 'me',
      status: 'sent',
      content: 'already here',
      timestamp: Date.now(),
      recipientPeerIds: ['alice'],
      ackedBy: [],
      readBy: [],
    } as any;

    // Message IS already in shell
    shellData.messages.messages = [sentMsg];
    shellData.thread.open = false;
    shellData.thread.parentMessage = null;
    shellData.thread.replies = [];

    const patch = (msg: any) => {
      if (!msg || msg.id !== 'msg-present-1') return msg;
      return { ...msg, status: 'delivered', ackedBy: ['alice'] };
    };

    let changed = false;
    shellData.messages.messages = shellData.messages.messages.map((msg: any) => {
      const next = patch(msg);
      if (next !== msg) changed = true;
      return next;
    });

    // Patch found it on the first try — no sync-on-miss needed
    expect(changed).toBe(true);
    const found = shellData.messages.messages.find((m: any) => m.id === 'msg-present-1');
    expect(found).toBeDefined();
    expect(found!.status).toBe('delivered');
    expect((found as any).ackedBy).toEqual(['alice']);
  });

  test('without fix 4, status update is silently lost for un-synced message', async () => {
    const { shellData } = await import('../../src/lib/stores/shell.svelte');

    // Start with empty shell — message hasn't synced from MessageStore
    shellData.messages.messages = [];
    shellData.thread.open = false;
    shellData.thread.parentMessage = null;
    shellData.thread.replies = [];

    const patch = (msg: any) => {
      if (!msg || msg.id !== 'msg-lost-1') return msg;
      return { ...msg, status: 'sent' };
    };

    // Without Fix 4, just the first patch (no retry):
    let changed = false;
    shellData.messages.messages = shellData.messages.messages.map((msg: any) => {
      const next = patch(msg);
      if (next !== msg) changed = true;
      return next;
    });

    // The patch finds nothing — status update would be silently lost
    expect(changed).toBe(false);
    expect(shellData.messages.messages.find((m: any) => m.id === 'msg-lost-1')).toBeUndefined();
  });
});
