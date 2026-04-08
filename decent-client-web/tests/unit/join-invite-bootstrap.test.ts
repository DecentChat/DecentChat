import { describe, expect, mock, test } from 'bun:test';
import { ChatController } from '../../src/app/ChatController';

describe('ChatController join invite bootstrap', () => {
  test('seeds inviter transport key and alias from signed invite metadata', async () => {
    const ws: any = {
      id: 'ws-1',
      inviteCode: 'JOIN1234',
      createdBy: 'me-peer',
      channels: [{ id: 'ch-1', name: 'general' }],
      members: [{ peerId: 'me-peer', alias: 'Joiner', publicKey: 'joiner-pk', role: 'owner', joinedAt: Date.now() }],
    };

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myPeerId: 'me-peer',
      myAlias: 'Joiner',
      activeWorkspaceId: null,
      activeChannelId: null,
    };
    ctrl.myPublicKey = 'joiner-pk';
    ctrl.ui = { renderApp: mock(() => {}), showToast: mock(() => {}) };
    ctrl.workspaceManager = {
      getWorkspace: mock(() => null),
      validateInviteCode: mock(() => null),
      isInviteRevoked: mock(() => false),
      createWorkspace: mock(() => ws),
      addMember: mock((_wsId: string, member: any) => { ws.members.push(member); }),
    };
    ctrl.getServerDiscovery = mock(() => ({ mergeReceivedServers: mock(() => {}) }));
    ctrl.saveServerDiscovery = mock(() => {});
    ctrl.startPEXBroadcasts = mock(() => {});
    ctrl.startPeerMaintenance = mock(() => {});
    ctrl.startQuotaChecks = mock(() => {});
    ctrl.startGossipCleanup = mock(() => {});
    ctrl.onWorkspaceActivated = mock(async () => {});
    ctrl.persistWorkspace = mock(async () => {});
    ctrl.schedulePendingJoinValidation = mock(() => {});
    ctrl.registerWorkspacePeer = mock(async () => {});
    ctrl.connectToMultiplePeers = mock(async () => {});

    await ctrl.joinWorkspace('JOIN1234', 'Joiner', 'inviter-peer', {
      host: '0.peerjs.com',
      port: 443,
      inviteCode: 'JOIN1234',
      secure: true,
      path: '/',
      fallbackServers: [],
      turnServers: [],
      peerId: 'inviter-peer',
      publicKey: 'signing-pk',
      transportPublicKey: 'transport-pk',
      inviterAlias: 'Mira PM',
      inviterIsBot: true,
      inviterAllowWorkspaceDMs: true,
      workspaceId: 'ws-1',
      workspaceName: 'XenaLand',
    });

    const inviter = ws.members.find((m: any) => m.peerId === 'inviter-peer');
    expect(inviter).toBeTruthy();
    expect(inviter.alias).toBe('Mira PM');
    expect(inviter.publicKey).toBe('transport-pk');
    expect(inviter.signingPublicKey).toBe('signing-pk');
    expect(inviter.isBot).toBe(true);
    expect(inviter.allowWorkspaceDMs).toBe(true);
  });

  test('rejects expired invite links with a clear error before creating workspace', async () => {
    const createWorkspace = mock(() => ({ id: 'ws-new' }));
    const showToast = mock(() => {});
    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myPeerId: 'me-peer',
      myAlias: 'Joiner',
      activeWorkspaceId: null,
      activeChannelId: null,
    };
    ctrl.myPublicKey = 'joiner-pk';
    ctrl.ui = { renderApp: mock(() => {}), showToast };
    ctrl.workspaceManager = {
      getWorkspace: mock(() => null),
      validateInviteCode: mock(() => null),
      isInviteRevoked: mock(() => false),
      createWorkspace,
      addMember: mock(() => {}),
    };
    ctrl.getServerDiscovery = mock(() => ({ mergeReceivedServers: mock(() => {}) }));
    ctrl.saveServerDiscovery = mock(() => {});
    ctrl.startPEXBroadcasts = mock(() => {});
    ctrl.startPeerMaintenance = mock(() => {});
    ctrl.startQuotaChecks = mock(() => {});
    ctrl.startGossipCleanup = mock(() => {});
    ctrl.onWorkspaceActivated = mock(async () => {});
    ctrl.persistWorkspace = mock(async () => {});
    ctrl.schedulePendingJoinValidation = mock(() => {});
    ctrl.registerWorkspacePeer = mock(async () => {});
    ctrl.connectToMultiplePeers = mock(async () => {});

    await expect(ctrl.joinWorkspace('JOIN1234', 'Joiner', 'inviter-peer', {
      host: '0.peerjs.com',
      port: 443,
      inviteCode: 'JOIN1234',
      secure: true,
      path: '/',
      fallbackServers: [],
      turnServers: [],
      peerId: 'inviter-peer',
      expiresAt: Date.now() - 1,
    })).rejects.toThrow('expired');

    expect(createWorkspace).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('This invite link has expired', 'error');
  });

  test('rejects revoked invite links with a clear error before creating workspace', async () => {
    const createWorkspace = mock(() => ({ id: 'ws-new' }));
    const showToast = mock(() => {});
    const existingWorkspace = { id: 'ws-existing', members: [], channels: [{ id: 'ch-existing', name: 'general' }] };
    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myPeerId: 'me-peer',
      myAlias: 'Joiner',
      activeWorkspaceId: null,
      activeChannelId: null,
    };
    ctrl.myPublicKey = 'joiner-pk';
    ctrl.ui = { renderApp: mock(() => {}), showToast };
    ctrl.workspaceManager = {
      getWorkspace: mock(() => existingWorkspace),
      validateInviteCode: mock(() => existingWorkspace),
      isInviteRevoked: mock(() => true),
      createWorkspace,
      addMember: mock(() => {}),
    };
    ctrl.getServerDiscovery = mock(() => ({ mergeReceivedServers: mock(() => {}) }));
    ctrl.saveServerDiscovery = mock(() => {});
    ctrl.startPEXBroadcasts = mock(() => {});
    ctrl.startPeerMaintenance = mock(() => {});
    ctrl.startQuotaChecks = mock(() => {});
    ctrl.startGossipCleanup = mock(() => {});
    ctrl.onWorkspaceActivated = mock(async () => {});
    ctrl.persistWorkspace = mock(async () => {});
    ctrl.schedulePendingJoinValidation = mock(() => {});
    ctrl.registerWorkspacePeer = mock(async () => {});
    ctrl.connectToMultiplePeers = mock(async () => {});

    await expect(
      ctrl.joinWorkspace('JOIN1234', 'Joiner', 'inviter-peer', {
        host: '0.peerjs.com',
        port: 443,
        inviteCode: 'JOIN1234',
        secure: true,
        path: '/',
        fallbackServers: [],
        turnServers: [],
        peerId: 'inviter-peer',
        workspaceId: 'ws-existing',
        inviteId: 'inv-revoked',
      }),
    ).rejects.toThrow('revoked');

    expect(createWorkspace).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('This invite link has been revoked by an admin', 'error');
  });

  test('does not create duplicate workspace state when invite is reused locally', async () => {
    const existingWorkspace: any = {
      id: 'ws-existing',
      inviteCode: 'JOIN1234',
      channels: [{ id: 'ch-existing', name: 'general' }],
      members: [{ peerId: 'me-peer', alias: 'Joiner', publicKey: 'joiner-pk', role: 'member', joinedAt: Date.now() }],
    };

    const createWorkspace = mock(() => ({ id: 'ws-should-not-be-created' }));
    const renderApp = mock(() => {});
    const showToast = mock(() => {});
    const onWorkspaceActivated = mock(async () => {});

    const ctrl = Object.create(ChatController.prototype) as any;
    ctrl.state = {
      myPeerId: 'me-peer',
      myAlias: 'Joiner',
      activeWorkspaceId: null,
      activeChannelId: null,
    };
    ctrl.myPublicKey = 'joiner-pk';
    ctrl.ui = { renderApp, showToast };
    ctrl.workspaceManager = {
      getWorkspace: mock((workspaceId: string) => (workspaceId === 'ws-existing' ? existingWorkspace : null)),
      validateInviteCode: mock(() => existingWorkspace),
      isInviteRevoked: mock(() => false),
      createWorkspace,
      addMember: mock(() => {}),
    };
    ctrl.getServerDiscovery = mock(() => ({ mergeReceivedServers: mock(() => {}) }));
    ctrl.saveServerDiscovery = mock(() => {});
    ctrl.startPEXBroadcasts = mock(() => {});
    ctrl.startPeerMaintenance = mock(() => {});
    ctrl.startQuotaChecks = mock(() => {});
    ctrl.startGossipCleanup = mock(() => {});
    ctrl.onWorkspaceActivated = onWorkspaceActivated;
    ctrl.persistWorkspace = mock(async () => {});
    ctrl.schedulePendingJoinValidation = mock(() => {});
    ctrl.registerWorkspacePeer = mock(async () => {});
    ctrl.connectToMultiplePeers = mock(async () => {});

    await ctrl.joinWorkspace('JOIN1234', 'Joiner', 'inviter-peer', {
      host: '0.peerjs.com',
      port: 443,
      inviteCode: 'JOIN1234',
      secure: true,
      path: '/',
      fallbackServers: [],
      turnServers: [],
      peerId: 'inviter-peer',
      workspaceId: 'ws-existing',
    });

    expect(createWorkspace).not.toHaveBeenCalled();
    expect(ctrl.connectToMultiplePeers).not.toHaveBeenCalled();
    expect(ctrl.state.activeWorkspaceId).toBe('ws-existing');
    expect(ctrl.state.activeChannelId).toBe('ch-existing');
    expect(renderApp).toHaveBeenCalled();
    expect(onWorkspaceActivated).toHaveBeenCalledWith('ws-existing');
    expect(showToast).toHaveBeenCalledWith('You already joined this workspace', 'info');
  });
});
