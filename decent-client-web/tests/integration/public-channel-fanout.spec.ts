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

describe('public-channel bounded fanout', () => {
  test('sendMessage does not directly fan out to all known members for public-workspace channels', async () => {
    const knownRecipients = Array.from({ length: 30 }, (_, idx) => `peer-${idx + 1}`);
    const desiredRecipients = ['peer-1', 'peer-2', 'peer-3', 'peer-4'];
    const { ctrl, msg } = makeSendController({
      knownRecipients,
      desiredRecipients,
      readyRecipients: desiredRecipients,
      channelPolicyMode: 'public-workspace',
    });

    await ChatController.prototype.sendMessage.call(ctrl, 'hello public workspace');

    expect(msg.recipientPeerIds.length).toBeLessThan(knownRecipients.length);
    expect(msg.recipientPeerIds).toEqual(desiredRecipients);
    expect(ctrl.messageProtocol.encryptMessage).toHaveBeenCalledTimes(desiredRecipients.length);
    expect(ctrl.messageProtocol.encryptMessage).not.toHaveBeenCalledWith('peer-30', expect.anything(), expect.anything());
  });

  test('explicit/small channels keep direct compatibility fanout', async () => {
    const knownRecipients = ['peer-a', 'peer-b', 'peer-c'];
    const { ctrl, msg } = makeSendController({
      knownRecipients,
      desiredRecipients: ['peer-a'],
      readyRecipients: knownRecipients,
      channelPolicyMode: 'explicit',
    });

    await ChatController.prototype.sendMessage.call(ctrl, 'hello explicit channel');

    expect(msg.recipientPeerIds).toEqual(knownRecipients);
    expect(ctrl.messageProtocol.encryptMessage).toHaveBeenCalledTimes(knownRecipients.length);
  });
});
