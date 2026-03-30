import { describe, expect, mock, test } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

function makeWorkspace(channelPolicyMode: 'public-workspace' | 'explicit', peerIds: string[]) {
  const members = [
    { peerId: 'me', alias: 'Me', publicKey: '', joinedAt: 1, role: 'owner' as const },
    ...peerIds.map((peerId) => ({
      peerId,
      alias: peerId,
      publicKey: '',
      joinedAt: 1,
      role: 'member' as const,
    })),
  ];

  return {
    id: 'ws-1',
    name: 'Workspace',
    inviteCode: 'invite',
    createdBy: 'me',
    createdAt: 1,
    members,
    channels: [
      {
        id: 'chan-1',
        workspaceId: 'ws-1',
        name: 'general',
        type: 'channel' as const,
        members: [],
        accessPolicy: { mode: channelPolicyMode },
        createdBy: 'me',
        createdAt: 1,
      },
    ],
  };
}

function makeSendController(params: {
  knownRecipients: string[];
  desiredRecipients: string[];
  readyRecipients: string[];
  channelPolicyMode: 'public-workspace' | 'explicit';
}) {
  const ctrl = Object.create(ChatController.prototype) as any;
  const workspace = makeWorkspace(params.channelPolicyMode, params.knownRecipients);

  ctrl.state = {
    myPeerId: 'me',
    myAlias: 'Me',
    activeWorkspaceId: 'ws-1',
    activeChannelId: 'chan-1',
    activeThreadId: null,
    threadOpen: false,
    sidebarOpen: false,
    activeDirectConversationId: null,
    workspaceAliases: {},
    readyPeers: new Set(params.readyRecipients),
    connectedPeers: new Set(params.readyRecipients),
    connectingPeers: new Set<string>(),
  };

  const msg = {
    id: 'msg-1',
    channelId: 'chan-1',
    senderId: 'me',
    timestamp: Date.now(),
    content: 'hello',
    type: 'text',
    status: 'pending',
  } as any;

  ctrl.messageStore = {
    createMessage: mock(async () => msg),
    addMessage: mock(async () => ({ success: true })),
    getThreadRoot: mock(() => null),
  };
  ctrl.getOrCreateCRDT = mock(() => ({ createMessage: mock(() => ({ vectorClock: { me: 1 } })) }));
  ctrl.persistMessage = mock(async () => {});
  ctrl.ensureThreadRoot = mock(async () => {});
  ctrl.queueCustodyEnvelope = mock(async () => {});
  ctrl.replicateToCustodians = mock(async () => {});
  ctrl.runPeerMaintenanceNow = mock(() => 0);
  ctrl.reinitializeTransportIfStuck = mock(async () => {});

  ctrl.workspaceManager = {
    getWorkspace: mock((workspaceId: string) => (workspaceId === 'ws-1' ? workspace : null)),
    getAllWorkspaces: mock(() => [workspace]),
    isPublicWorkspaceChannel: mock((channel: any) => channel?.accessPolicy?.mode === 'public-workspace'),
  };

  ctrl.transport = {
    send: mock(() => true),
    getConnectedPeers: mock(() => params.readyRecipients),
  };

  ctrl.messageProtocol = {
    encryptMessage: mock(async (peerId: string) => ({ cipher: `for-${peerId}` })),
    hasRatchetState: mock(() => true),
    restoreRatchetState: mock(async () => {}),
  };

  ctrl.contactStore = {
    getSync: mock(() => null),
  };
  ctrl.outgoingDeliveryRecoveryConnectAt = new Map<string, number>();
  ctrl.peerConnectedAt = new Map<string, number>();
  ctrl.peerLastSeenAt = new Map<string, number>();

  ctrl.offlineQueue = { enqueue: mock(async () => {}) };
  ctrl.persistentStore = { saveMessage: mock(async () => {}) };
  ctrl.ui = {
    showToast: mock(() => {}),
    appendMessageToDOM: mock(() => {}),
    renderThreadMessages: mock(() => {}),
    updateThreadIndicator: mock(() => {}),
    updateMessageStatus: mock(() => {}),
  };

  ctrl.getWorkspaceRecipientPeerIds = mock(() => params.knownRecipients);
  ctrl.selectDesiredPeers = mock(() => ({
    anchors: [],
    core: [],
    explorers: [],
    desiredPeerIds: params.desiredRecipients,
    budget: params.desiredRecipients.length,
  }));
  ctrl.isPartialMeshEnabled = () => true;

  return { ctrl, msg };
}

describe('capability peer failure fallbacks', () => {
  test('directory page prefetch falls back to another directory helper when preferred peer is gone', async () => {
    const workspace = {
      id: 'ws-1',
      name: 'Workspace',
      inviteCode: 'invite',
      createdBy: 'me',
      createdAt: 1,
      members: [
        { peerId: 'me', alias: 'Me', publicKey: 'pk-me', joinedAt: 1, role: 'owner' as const },
        { peerId: 'dir-a', alias: 'Dir A', publicKey: 'pk-a', joinedAt: 2, role: 'member' as const },
        { peerId: 'dir-b', alias: 'Dir B', publicKey: 'pk-b', joinedAt: 3, role: 'member' as const },
      ],
      channels: [],
      shell: {
        id: 'ws-1',
        name: 'Workspace',
        createdBy: 'me',
        createdAt: 1,
        version: 2,
        memberCount: 120,
        channelCount: 0,
        capabilityFlags: ['large-workspace-v1'],
      },
    };

    const sendControlWithRetry = mock(() => true);
    const beginPageRequest = mock(() => true);

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myPeerId: 'me',
      activeWorkspaceId: 'ws-1',
      readyPeers: new Set(['dir-b']),
      connectedPeers: new Set(['dir-b']),
      connectingPeers: new Set<string>(),
    };
    ctrl.peerCapabilities = new Map<string, Set<string>>([
      ['dir-a', new Set(['member-directory-v1'])],
      ['dir-b', new Set(['member-directory-v1'])],
    ]);
    ctrl.directoryRequestFailoverTimers = new Map();
    ctrl.workspaceManager = {
      getWorkspace: mock((workspaceId: string) => workspaceId === 'ws-1' ? workspace : null),
    };
    ctrl.publicWorkspaceController = {
      getSnapshot: mock(() => ({
        members: [],
        loadedCount: 30,
        totalCount: 120,
        hasMore: true,
        nextCursor: 'cursor-1',
      })),
      beginPageRequest,
      endPageRequest: mock(() => {}),
    };
    ctrl.sendControlWithRetry = sendControlWithRetry;

    await ChatController.prototype.prefetchWorkspaceMemberDirectory.call(ctrl, 'ws-1', 'dir-a');

    expect(beginPageRequest).toHaveBeenCalledWith('ws-1', 'cursor-1');
    expect(sendControlWithRetry).toHaveBeenCalledTimes(1);
    expect(sendControlWithRetry).toHaveBeenCalledWith(
      'dir-b',
      expect.objectContaining({
        type: 'workspace-sync',
        workspaceId: 'ws-1',
        sync: expect.objectContaining({
          type: 'member-page-request',
          cursor: 'cursor-1',
        }),
      }),
      { label: 'workspace-sync' },
    );

    ChatController.prototype.clearDirectoryRequestFailoverTimer.call(ctrl, 'ws-1', 'cursor-1');
  });

  test('chat delivery continues through bounded fanout when a relay helper is lost', async () => {
    const { ctrl } = makeSendController({
      knownRecipients: ['relay-1', 'peer-1', 'peer-2'],
      desiredRecipients: ['relay-1'],
      readyRecipients: ['peer-1', 'peer-2'],
      channelPolicyMode: 'public-workspace',
    });

    await ChatController.prototype.sendMessage.call(ctrl, 'hello after relay loss');

    const sentTo = ctrl.transport.send.mock.calls.map((call: any[]) => call[0]);
    expect(sentTo).toContain('peer-1');
    expect(sentTo).toContain('peer-2');
  });

  test('reliability state reports degraded-but-correct behavior for helper-peer loss', () => {
    const workspace = {
      id: 'ws-1',
      name: 'Workspace',
      inviteCode: 'invite',
      createdBy: 'me',
      createdAt: 1,
      members: [
        { peerId: 'me', alias: 'Me', publicKey: 'pk-me', joinedAt: 1, role: 'owner' as const },
        { peerId: 'peer-1', alias: 'Peer 1', publicKey: 'pk-p1', joinedAt: 2, role: 'member' as const },
        { peerId: 'dir-1', alias: 'Dir 1', publicKey: 'pk-d1', joinedAt: 3, role: 'member' as const },
      ],
      channels: [],
      directoryShards: [
        {
          workspaceId: 'ws-1',
          shardId: 'ws-1:aa',
          shardPrefix: 'aa',
          replicaPeerIds: ['dir-1'],
          version: 2,
        },
      ],
      shell: {
        id: 'ws-1',
        name: 'Workspace',
        createdBy: 'me',
        createdAt: 1,
        version: 3,
        memberCount: 150,
        channelCount: 1,
        capabilityFlags: ['large-workspace-v1'],
      },
    };

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myPeerId: 'me',
      activeWorkspaceId: 'ws-1',
      readyPeers: new Set(['peer-1', 'dir-1']),
      connectedPeers: new Set(['peer-1', 'dir-1']),
      connectingPeers: new Set<string>(),
    };
    ctrl.peerCapabilities = new Map<string, Set<string>>([
      ['dir-1', new Set(['member-directory-v1', 'directory-shard:aa', 'relay-channel:general'])],
    ]);
    ctrl.workspaceManager = {
      getWorkspace: mock((workspaceId: string) => workspaceId === 'ws-1' ? workspace : null),
    };
    ctrl.publicWorkspaceController = {
      getSnapshot: mock(() => ({
        members: [],
        loadedCount: 40,
        totalCount: 150,
        hasMore: true,
        nextCursor: 'cursor-2',
      })),
    };
    ctrl.getWorkspaceRecipientPeerIds = mock(() => ['peer-1']);

    const status = ChatController.prototype.getWorkspaceReliabilityState.call(ctrl, 'ws-1');

    expect(status.chatContinues).toBe(true);
    expect(status.discoverySlower).toBe(true);
    expect(status.deeperHistoryDelayed).toBe(true);
    expect(status.directorySearchPartial).toBe(true);
    expect(status.relayFallbackActive).toBe(true);
    expect(status.underReplicatedShardCount).toBe(1);
  });
});
