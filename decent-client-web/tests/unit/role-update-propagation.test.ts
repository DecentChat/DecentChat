/**
 * Role change propagation tests
 *
 * Tests that when a workspace owner changes a member's role (promote/demote),
 * the change propagates correctly to all connected peers and triggers
 * appropriate UI updates.
 *
 * Uses lightweight simulation pattern (no WebRTC needed), matching
 * workspace-state-sync.test.ts style.
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';

// ─── Lightweight types mirroring the real protocol ───────────────────────────

interface Member {
  peerId: string;
  alias: string;
  publicKey: string;
  signingPublicKey?: string;
  role: 'owner' | 'admin' | 'member';
}

interface Channel {
  id: string;
  name: string;
  type: string;
}

interface Workspace {
  id: string;
  name: string;
  channels: Channel[];
  members: Member[];
  permissions?: {
    whoCanCreateChannels: 'everyone' | 'admins';
    whoCanInviteMembers: 'everyone' | 'admins';
  };
}

interface RoleChangedSync {
  type: 'role-changed';
  peerId: string;
  newRole: 'owner' | 'admin' | 'member';
  changedBy: string;
  timestamp: number;
  signature?: string;
}

interface WorkspaceSyncMessage {
  type: 'workspace-sync';
  workspaceId: string;
  sync: RoleChangedSync;
}

interface UICallbacks {
  updateSidebar: () => void;
  updateChannelHeader: () => void;
  renderApp: () => void;
  showToast: (message: string) => void;
}

// ─── Simulation helpers ──────────────────────────────────────────────────────

/** Simulates the send side — owner promotes a member and broadcasts */
function simulatePromoteMember(
  ws: Workspace,
  ownerPeerId: string,
  targetPeerId: string,
  newRole: 'admin',
  connectedPeers: string[],
  transport: { send: (peerId: string, msg: any) => void },
  ui: UICallbacks,
  persistWorkspace: () => void,
  signRoleEvent: (event: any) => string,
): { success: boolean; error?: string } {
  const owner = ws.members.find(m => m.peerId === ownerPeerId);
  const target = ws.members.find(m => m.peerId === targetPeerId);

  if (!owner || owner.role !== 'owner') return { success: false, error: 'Only the owner can promote members' };
  if (!target) return { success: false, error: 'Member not found' };
  if (target.role === 'admin' || target.role === 'owner') return { success: false, error: `Member is already ${target.role}` };

  // 1. Update local workspace
  target.role = newRole;

  // 2. Persist
  persistWorkspace();

  // 3. Sign the event
  const timestamp = Date.now();
  const signature = signRoleEvent({ peerId: targetPeerId, newRole, changedBy: ownerPeerId, timestamp });

  // 4. Broadcast to all connected peers
  const msg: WorkspaceSyncMessage = {
    type: 'workspace-sync',
    workspaceId: ws.id,
    sync: {
      type: 'role-changed',
      peerId: targetPeerId,
      newRole,
      changedBy: ownerPeerId,
      timestamp,
      signature,
    },
  };

  for (const peerId of connectedPeers) {
    transport.send(peerId, msg);
  }

  // 5. Update UI on sender side
  ui.updateSidebar();
  ui.updateChannelHeader();

  return { success: true };
}

/** Simulates the send side — owner demotes a member and broadcasts */
function simulateDemoteMember(
  ws: Workspace,
  ownerPeerId: string,
  targetPeerId: string,
  connectedPeers: string[],
  transport: { send: (peerId: string, msg: any) => void },
  ui: UICallbacks,
  persistWorkspace: () => void,
  signRoleEvent: (event: any) => string,
): { success: boolean; error?: string } {
  const owner = ws.members.find(m => m.peerId === ownerPeerId);
  const target = ws.members.find(m => m.peerId === targetPeerId);

  if (!owner || owner.role !== 'owner') return { success: false, error: 'Only the owner can demote members' };
  if (!target) return { success: false, error: 'Member not found' };
  if (target.role === 'owner') return { success: false, error: 'Cannot demote the owner' };
  if (target.role === 'member') return { success: false, error: 'Member is already a regular member' };

  // 1. Update local workspace
  target.role = 'member';

  // 2. Persist
  persistWorkspace();

  // 3. Sign and broadcast
  const timestamp = Date.now();
  const signature = signRoleEvent({ peerId: targetPeerId, newRole: 'member', changedBy: ownerPeerId, timestamp });

  const msg: WorkspaceSyncMessage = {
    type: 'workspace-sync',
    workspaceId: ws.id,
    sync: {
      type: 'role-changed',
      peerId: targetPeerId,
      newRole: 'member',
      changedBy: ownerPeerId,
      timestamp,
      signature,
    },
  };

  for (const peerId of connectedPeers) {
    transport.send(peerId, msg);
  }

  // 5. Update UI on sender side
  ui.updateSidebar();
  ui.updateChannelHeader();

  return { success: true };
}

/**
 * Simulates the receive side — peer handles incoming role-changed sync.
 * Returns { accepted: boolean; error?: string }
 */
function handleRoleChangedSync(
  ws: Workspace,
  sync: RoleChangedSync,
  senderPeerId: string,
  ownerPeerId: string,
  ui: UICallbacks,
  persistWorkspace: () => void,
  replayTimestamps: Map<string, number>,
  verifySignature: (sync: RoleChangedSync, ownerSigningKey: string) => boolean,
  ownerSigningKey: string | undefined,
): { accepted: boolean; error?: string } {
  // 1. Validate newRole
  if (sync.newRole !== 'admin' && sync.newRole !== 'member') {
    return { accepted: false, error: `Invalid role: ${sync.newRole}` };
  }

  // 2. Replay protection
  const lastTimestamp = replayTimestamps.get(sync.peerId) ?? 0;
  if (sync.timestamp <= lastTimestamp) {
    return { accepted: false, error: 'Replay detected: timestamp not newer' };
  }

  // 3. ECDSA verification (if signature present)
  if (sync.signature && ownerSigningKey) {
    const valid = verifySignature(sync, ownerSigningKey);
    if (!valid) {
      return { accepted: false, error: 'Invalid signature' };
    }
  } else {
    // 4. Fallback: transport sender must be the workspace owner
    if (senderPeerId !== ownerPeerId) {
      return { accepted: false, error: 'Role change from non-owner without valid signature' };
    }
  }

  // 5. Update member's role
  const member = ws.members.find(m => m.peerId === sync.peerId);
  if (!member) {
    return { accepted: false, error: 'Member not found in workspace' };
  }
  member.role = sync.newRole;

  // 6. Record timestamp for replay protection
  replayTimestamps.set(sync.peerId, sync.timestamp);

  // 7. Persist
  persistWorkspace();

  // 8. Show toast
  const alias = member.alias || member.peerId.slice(0, 8);
  ui.showToast(`${alias} is now ${sync.newRole}`);

  // 9. Trigger UI re-render
  ui.renderApp();

  return { accepted: true };
}

/** Permission check: can this member create channels? */
function canCreateChannel(ws: Workspace, peerId: string): boolean {
  const member = ws.members.find(m => m.peerId === peerId);
  if (!member) return false;
  const policy = ws.permissions?.whoCanCreateChannels ?? 'everyone';
  if (policy === 'everyone') return true;
  return member.role === 'owner' || member.role === 'admin';
}

/** Deep-clone a workspace (for export/import simulation) */
function cloneWorkspace(ws: Workspace): Workspace {
  return JSON.parse(JSON.stringify(ws));
}

// ─── Test fixtures ───────────────────────────────────────────────────────────

function createTestWorkspace(): Workspace {
  return {
    id: 'ws-1',
    name: 'Test Workspace',
    channels: [
      { id: 'ch-general', name: 'general', type: 'channel' },
    ],
    members: [
      { peerId: 'owner-peer', alias: 'Alice', publicKey: 'pk-owner', signingPublicKey: 'spk-owner', role: 'owner' },
      { peerId: 'admin-peer', alias: 'Bob', publicKey: 'pk-admin', role: 'admin' },
      { peerId: 'member-peer', alias: 'Carol', publicKey: 'pk-member', role: 'member' },
      { peerId: 'member-2', alias: 'Dave', publicKey: 'pk-member2', role: 'member' },
    ],
    permissions: { whoCanCreateChannels: 'admins', whoCanInviteMembers: 'everyone' },
  };
}

function createMockUI(): UICallbacks {
  return {
    updateSidebar: mock(() => {}),
    updateChannelHeader: mock(() => {}),
    renderApp: mock(() => {}),
    showToast: mock((_msg: string) => {}),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Role change broadcast', () => {
  let ws: Workspace;
  let transport: { send: ReturnType<typeof mock> };
  let ui: UICallbacks;
  let persistWorkspace: ReturnType<typeof mock>;
  let signRoleEvent: ReturnType<typeof mock>;

  beforeEach(() => {
    ws = createTestWorkspace();
    transport = { send: mock((_peerId: string, _msg: any) => {}) };
    ui = createMockUI();
    persistWorkspace = mock(() => {});
    signRoleEvent = mock((_event: any) => 'mock-signature');
  });

  test('owner promotes member → role-changed message sent to all connected peers', () => {
    const connectedPeers = ['admin-peer', 'member-2'];

    const result = simulatePromoteMember(
      ws, 'owner-peer', 'member-peer', 'admin',
      connectedPeers, transport, ui, persistWorkspace, signRoleEvent,
    );

    expect(result.success).toBe(true);
    expect(transport.send).toHaveBeenCalledTimes(2);

    // Verify sent to each connected peer
    const calls = transport.send.mock.calls;
    expect(calls[0][0]).toBe('admin-peer');
    expect(calls[1][0]).toBe('member-2');
  });

  test('owner demotes admin → role-changed message sent with newRole=member', () => {
    const connectedPeers = ['member-peer', 'member-2'];

    const result = simulateDemoteMember(
      ws, 'owner-peer', 'admin-peer',
      connectedPeers, transport, ui, persistWorkspace, signRoleEvent,
    );

    expect(result.success).toBe(true);

    const sentMsg = transport.send.mock.calls[0][1] as WorkspaceSyncMessage;
    expect(sentMsg.sync.newRole).toBe('member');
    expect(sentMsg.sync.peerId).toBe('admin-peer');
  });

  test('message contains correct fields (type, peerId, newRole, changedBy, timestamp)', () => {
    const connectedPeers = ['admin-peer'];

    simulatePromoteMember(
      ws, 'owner-peer', 'member-peer', 'admin',
      connectedPeers, transport, ui, persistWorkspace, signRoleEvent,
    );

    const sentMsg = transport.send.mock.calls[0][1] as WorkspaceSyncMessage;
    expect(sentMsg.type).toBe('workspace-sync');
    expect(sentMsg.workspaceId).toBe('ws-1');
    expect(sentMsg.sync.type).toBe('role-changed');
    expect(sentMsg.sync.peerId).toBe('member-peer');
    expect(sentMsg.sync.newRole).toBe('admin');
    expect(sentMsg.sync.changedBy).toBe('owner-peer');
    expect(typeof sentMsg.sync.timestamp).toBe('number');
    expect(sentMsg.sync.timestamp).toBeGreaterThan(0);
    expect(sentMsg.sync.signature).toBe('mock-signature');
  });

  test('workspace is persisted after role change on sender side', () => {
    simulatePromoteMember(
      ws, 'owner-peer', 'member-peer', 'admin',
      ['admin-peer'], transport, ui, persistWorkspace, signRoleEvent,
    );

    expect(persistWorkspace).toHaveBeenCalledTimes(1);
  });

  test('local workspace is updated before broadcast', () => {
    simulatePromoteMember(
      ws, 'owner-peer', 'member-peer', 'admin',
      ['admin-peer'], transport, ui, persistWorkspace, signRoleEvent,
    );

    const member = ws.members.find(m => m.peerId === 'member-peer');
    expect(member!.role).toBe('admin');
  });
});

describe('Receiving role-changed — happy path', () => {
  let ws: Workspace;
  let ui: UICallbacks;
  let persistWorkspace: ReturnType<typeof mock>;
  let replayTimestamps: Map<string, number>;
  let verifySignature: ReturnType<typeof mock>;

  beforeEach(() => {
    ws = createTestWorkspace();
    ui = createMockUI();
    persistWorkspace = mock(() => {});
    replayTimestamps = new Map();
    verifySignature = mock(() => true);
  });

  test('receiving peer updates member.role in local workspace', () => {
    const sync: RoleChangedSync = {
      type: 'role-changed',
      peerId: 'member-peer',
      newRole: 'admin',
      changedBy: 'owner-peer',
      timestamp: Date.now(),
      signature: 'valid-sig',
    };

    const result = handleRoleChangedSync(
      ws, sync, 'owner-peer', 'owner-peer',
      ui, persistWorkspace, replayTimestamps, verifySignature, 'spk-owner',
    );

    expect(result.accepted).toBe(true);
    const member = ws.members.find(m => m.peerId === 'member-peer');
    expect(member!.role).toBe('admin');
  });

  test('toast notification shown with correct alias and role', () => {
    const sync: RoleChangedSync = {
      type: 'role-changed',
      peerId: 'member-peer',
      newRole: 'admin',
      changedBy: 'owner-peer',
      timestamp: Date.now(),
      signature: 'valid-sig',
    };

    handleRoleChangedSync(
      ws, sync, 'owner-peer', 'owner-peer',
      ui, persistWorkspace, replayTimestamps, verifySignature, 'spk-owner',
    );

    expect(ui.showToast).toHaveBeenCalledTimes(1);
    expect(ui.showToast).toHaveBeenCalledWith('Carol is now admin');
  });

  test('UI renderApp() called after role change', () => {
    const sync: RoleChangedSync = {
      type: 'role-changed',
      peerId: 'member-peer',
      newRole: 'admin',
      changedBy: 'owner-peer',
      timestamp: Date.now(),
      signature: 'valid-sig',
    };

    handleRoleChangedSync(
      ws, sync, 'owner-peer', 'owner-peer',
      ui, persistWorkspace, replayTimestamps, verifySignature, 'spk-owner',
    );

    expect(ui.renderApp).toHaveBeenCalledTimes(1);
  });

  test('workspace persisted after receiving role change', () => {
    const sync: RoleChangedSync = {
      type: 'role-changed',
      peerId: 'member-peer',
      newRole: 'admin',
      changedBy: 'owner-peer',
      timestamp: Date.now(),
      signature: 'valid-sig',
    };

    handleRoleChangedSync(
      ws, sync, 'owner-peer', 'owner-peer',
      ui, persistWorkspace, replayTimestamps, verifySignature, 'spk-owner',
    );

    expect(persistWorkspace).toHaveBeenCalledTimes(1);
  });

  test('demotion via role-changed updates member to regular member', () => {
    const sync: RoleChangedSync = {
      type: 'role-changed',
      peerId: 'admin-peer',
      newRole: 'member',
      changedBy: 'owner-peer',
      timestamp: Date.now(),
      signature: 'valid-sig',
    };

    const result = handleRoleChangedSync(
      ws, sync, 'owner-peer', 'owner-peer',
      ui, persistWorkspace, replayTimestamps, verifySignature, 'spk-owner',
    );

    expect(result.accepted).toBe(true);
    const member = ws.members.find(m => m.peerId === 'admin-peer');
    expect(member!.role).toBe('member');
    expect(ui.showToast).toHaveBeenCalledWith('Bob is now member');
  });
});

describe('Receiving role-changed — security', () => {
  let ws: Workspace;
  let ui: UICallbacks;
  let persistWorkspace: ReturnType<typeof mock>;
  let replayTimestamps: Map<string, number>;
  let verifySignature: ReturnType<typeof mock>;

  beforeEach(() => {
    ws = createTestWorkspace();
    ui = createMockUI();
    persistWorkspace = mock(() => {});
    replayTimestamps = new Map();
    verifySignature = mock(() => true);
  });

  test('rejects invalid role: owner', () => {
    const sync: RoleChangedSync = {
      type: 'role-changed',
      peerId: 'member-peer',
      newRole: 'owner' as any,
      changedBy: 'owner-peer',
      timestamp: Date.now(),
      signature: 'valid-sig',
    };

    const result = handleRoleChangedSync(
      ws, sync, 'owner-peer', 'owner-peer',
      ui, persistWorkspace, replayTimestamps, verifySignature, 'spk-owner',
    );

    expect(result.accepted).toBe(false);
    expect(result.error).toContain('Invalid role');
  });

  test('rejects invalid role: superadmin', () => {
    const sync: RoleChangedSync = {
      type: 'role-changed',
      peerId: 'member-peer',
      newRole: 'superadmin' as any,
      changedBy: 'owner-peer',
      timestamp: Date.now(),
      signature: 'valid-sig',
    };

    const result = handleRoleChangedSync(
      ws, sync, 'owner-peer', 'owner-peer',
      ui, persistWorkspace, replayTimestamps, verifySignature, 'spk-owner',
    );

    expect(result.accepted).toBe(false);
    expect(result.error).toContain('Invalid role');
  });

  test('rejects invalid role: empty string', () => {
    const sync: RoleChangedSync = {
      type: 'role-changed',
      peerId: 'member-peer',
      newRole: '' as any,
      changedBy: 'owner-peer',
      timestamp: Date.now(),
      signature: 'valid-sig',
    };

    const result = handleRoleChangedSync(
      ws, sync, 'owner-peer', 'owner-peer',
      ui, persistWorkspace, replayTimestamps, verifySignature, 'spk-owner',
    );

    expect(result.accepted).toBe(false);
    expect(result.error).toContain('Invalid role');
  });

  test('rejects replay (same timestamp)', () => {
    const timestamp = Date.now();

    // First message succeeds
    const sync1: RoleChangedSync = {
      type: 'role-changed',
      peerId: 'member-peer',
      newRole: 'admin',
      changedBy: 'owner-peer',
      timestamp,
      signature: 'valid-sig',
    };

    handleRoleChangedSync(
      ws, sync1, 'owner-peer', 'owner-peer',
      ui, persistWorkspace, replayTimestamps, verifySignature, 'spk-owner',
    );

    // Replay with same timestamp is rejected
    const sync2: RoleChangedSync = {
      type: 'role-changed',
      peerId: 'member-peer',
      newRole: 'member',
      changedBy: 'owner-peer',
      timestamp, // same timestamp
      signature: 'valid-sig',
    };

    const result = handleRoleChangedSync(
      ws, sync2, 'owner-peer', 'owner-peer',
      ui, persistWorkspace, replayTimestamps, verifySignature, 'spk-owner',
    );

    expect(result.accepted).toBe(false);
    expect(result.error).toContain('Replay');
  });

  test('rejects replay (older timestamp)', () => {
    const now = Date.now();

    // Accept a message with a recent timestamp
    const sync1: RoleChangedSync = {
      type: 'role-changed',
      peerId: 'member-peer',
      newRole: 'admin',
      changedBy: 'owner-peer',
      timestamp: now,
      signature: 'valid-sig',
    };

    handleRoleChangedSync(
      ws, sync1, 'owner-peer', 'owner-peer',
      ui, persistWorkspace, replayTimestamps, verifySignature, 'spk-owner',
    );

    // Replay with older timestamp is rejected
    const sync2: RoleChangedSync = {
      type: 'role-changed',
      peerId: 'member-peer',
      newRole: 'member',
      changedBy: 'owner-peer',
      timestamp: now - 1000, // older
      signature: 'valid-sig',
    };

    const result = handleRoleChangedSync(
      ws, sync2, 'owner-peer', 'owner-peer',
      ui, persistWorkspace, replayTimestamps, verifySignature, 'spk-owner',
    );

    expect(result.accepted).toBe(false);
    expect(result.error).toContain('Replay');
  });

  test('accepts newer timestamp after rejecting replay', () => {
    const now = Date.now();

    // Accept first
    handleRoleChangedSync(
      ws,
      { type: 'role-changed', peerId: 'member-peer', newRole: 'admin', changedBy: 'owner-peer', timestamp: now, signature: 'sig' },
      'owner-peer', 'owner-peer', ui, persistWorkspace, replayTimestamps, verifySignature, 'spk-owner',
    );

    // Reject replay
    const replayResult = handleRoleChangedSync(
      ws,
      { type: 'role-changed', peerId: 'member-peer', newRole: 'member', changedBy: 'owner-peer', timestamp: now, signature: 'sig' },
      'owner-peer', 'owner-peer', ui, persistWorkspace, replayTimestamps, verifySignature, 'spk-owner',
    );
    expect(replayResult.accepted).toBe(false);

    // Accept newer timestamp
    const newerResult = handleRoleChangedSync(
      ws,
      { type: 'role-changed', peerId: 'member-peer', newRole: 'member', changedBy: 'owner-peer', timestamp: now + 1000, signature: 'sig' },
      'owner-peer', 'owner-peer', ui, persistWorkspace, replayTimestamps, verifySignature, 'spk-owner',
    );
    expect(newerResult.accepted).toBe(true);
    expect(ws.members.find(m => m.peerId === 'member-peer')!.role).toBe('member');
  });

  test('rejects role-changed from non-owner when no signature present', () => {
    const sync: RoleChangedSync = {
      type: 'role-changed',
      peerId: 'member-peer',
      newRole: 'admin',
      changedBy: 'owner-peer',
      timestamp: Date.now(),
      // No signature
    };

    const result = handleRoleChangedSync(
      ws, sync, 'admin-peer', 'owner-peer', // sender is admin-peer, NOT the owner
      ui, persistWorkspace, replayTimestamps, verifySignature, undefined,
    );

    expect(result.accepted).toBe(false);
    expect(result.error).toContain('non-owner');
  });

  test('accepts role-changed from non-owner with valid signature', () => {
    verifySignature = mock(() => true);

    const sync: RoleChangedSync = {
      type: 'role-changed',
      peerId: 'member-peer',
      newRole: 'admin',
      changedBy: 'owner-peer',
      timestamp: Date.now(),
      signature: 'valid-ecdsa-signature',
    };

    const result = handleRoleChangedSync(
      ws, sync, 'admin-peer', 'owner-peer', // relayed through admin-peer, not owner
      ui, persistWorkspace, replayTimestamps, verifySignature, 'spk-owner',
    );

    expect(result.accepted).toBe(true);
    expect(verifySignature).toHaveBeenCalledTimes(1);
    expect(ws.members.find(m => m.peerId === 'member-peer')!.role).toBe('admin');
  });

  test('rejects role-changed with invalid signature from non-owner', () => {
    verifySignature = mock(() => false);

    const sync: RoleChangedSync = {
      type: 'role-changed',
      peerId: 'member-peer',
      newRole: 'admin',
      changedBy: 'owner-peer',
      timestamp: Date.now(),
      signature: 'forged-signature',
    };

    const result = handleRoleChangedSync(
      ws, sync, 'admin-peer', 'owner-peer',
      ui, persistWorkspace, replayTimestamps, verifySignature, 'spk-owner',
    );

    expect(result.accepted).toBe(false);
    expect(result.error).toContain('Invalid signature');
  });

  test('no UI updates or persistence on rejected messages', () => {
    const sync: RoleChangedSync = {
      type: 'role-changed',
      peerId: 'member-peer',
      newRole: 'owner' as any,
      changedBy: 'owner-peer',
      timestamp: Date.now(),
      signature: 'valid-sig',
    };

    handleRoleChangedSync(
      ws, sync, 'owner-peer', 'owner-peer',
      ui, persistWorkspace, replayTimestamps, verifySignature, 'spk-owner',
    );

    expect(ui.renderApp).not.toHaveBeenCalled();
    expect(ui.showToast).not.toHaveBeenCalled();
    expect(persistWorkspace).not.toHaveBeenCalled();
  });
});

describe('Role change propagation to workspace members', () => {
  test('after receiving role-changed, member permissions update immediately (canCreateChannel)', () => {
    const ws = createTestWorkspace();
    const ui = createMockUI();
    const persistWorkspace = mock(() => {});
    const replayTimestamps = new Map<string, number>();
    const verifySignature = mock(() => true);

    // member-peer currently cannot create channels (admins-only policy)
    expect(canCreateChannel(ws, 'member-peer')).toBe(false);

    // Receive role-changed: member-peer promoted to admin
    const sync: RoleChangedSync = {
      type: 'role-changed',
      peerId: 'member-peer',
      newRole: 'admin',
      changedBy: 'owner-peer',
      timestamp: Date.now(),
      signature: 'valid-sig',
    };

    handleRoleChangedSync(
      ws, sync, 'owner-peer', 'owner-peer',
      ui, persistWorkspace, replayTimestamps, verifySignature, 'spk-owner',
    );

    // Now member-peer can create channels
    expect(canCreateChannel(ws, 'member-peer')).toBe(true);
  });

  test('multiple peers all receive and apply the same role change', () => {
    // Simulate 3 peers each receiving the same role-changed message
    const baseWs = createTestWorkspace();
    const peer1Ws = cloneWorkspace(baseWs);
    const peer2Ws = cloneWorkspace(baseWs);
    const peer3Ws = cloneWorkspace(baseWs);

    const timestamp = Date.now();
    const sync: RoleChangedSync = {
      type: 'role-changed',
      peerId: 'member-peer',
      newRole: 'admin',
      changedBy: 'owner-peer',
      timestamp,
      signature: 'valid-sig',
    };

    const verifySignature = mock(() => true);

    for (const peerWs of [peer1Ws, peer2Ws, peer3Ws]) {
      const result = handleRoleChangedSync(
        peerWs, { ...sync }, 'owner-peer', 'owner-peer',
        createMockUI(), mock(() => {}), new Map(), verifySignature, 'spk-owner',
      );
      expect(result.accepted).toBe(true);
    }

    // All peers now see member-peer as admin
    for (const peerWs of [peer1Ws, peer2Ws, peer3Ws]) {
      const member = peerWs.members.find(m => m.peerId === 'member-peer');
      expect(member!.role).toBe('admin');
    }
  });

  test('role changes survive workspace re-export/import', () => {
    const ws = createTestWorkspace();
    const ui = createMockUI();
    const persistWorkspace = mock(() => {});
    const replayTimestamps = new Map<string, number>();
    const verifySignature = mock(() => true);

    // Apply role change
    handleRoleChangedSync(
      ws,
      { type: 'role-changed', peerId: 'member-peer', newRole: 'admin', changedBy: 'owner-peer', timestamp: Date.now(), signature: 'sig' },
      'owner-peer', 'owner-peer',
      ui, persistWorkspace, replayTimestamps, verifySignature, 'spk-owner',
    );

    expect(ws.members.find(m => m.peerId === 'member-peer')!.role).toBe('admin');

    // Simulate export/import cycle (JSON serialization round-trip)
    const exported = cloneWorkspace(ws);
    const imported = cloneWorkspace(exported);

    // Validate role survives
    const memberAfterImport = imported.members.find(m => m.peerId === 'member-peer');
    expect(memberAfterImport!.role).toBe('admin');

    // Permissions still work correctly after import
    expect(canCreateChannel(imported, 'member-peer')).toBe(true);
  });

  test('demotion removes admin permissions immediately', () => {
    const ws = createTestWorkspace();
    const ui = createMockUI();
    const persistWorkspace = mock(() => {});
    const replayTimestamps = new Map<string, number>();
    const verifySignature = mock(() => true);

    // admin-peer currently can create channels
    expect(canCreateChannel(ws, 'admin-peer')).toBe(true);

    // Receive demotion
    handleRoleChangedSync(
      ws,
      { type: 'role-changed', peerId: 'admin-peer', newRole: 'member', changedBy: 'owner-peer', timestamp: Date.now(), signature: 'sig' },
      'owner-peer', 'owner-peer',
      ui, persistWorkspace, replayTimestamps, verifySignature, 'spk-owner',
    );

    // admin-peer can no longer create channels
    expect(canCreateChannel(ws, 'admin-peer')).toBe(false);
  });
});

describe('UI update verification', () => {
  let ws: Workspace;
  let transport: { send: ReturnType<typeof mock> };
  let ui: UICallbacks;
  let persistWorkspace: ReturnType<typeof mock>;
  let signRoleEvent: ReturnType<typeof mock>;

  beforeEach(() => {
    ws = createTestWorkspace();
    transport = { send: mock((_peerId: string, _msg: any) => {}) };
    ui = createMockUI();
    persistWorkspace = mock(() => {});
    signRoleEvent = mock(() => 'mock-sig');
  });

  test('promote triggers updateSidebar + updateChannelHeader on sender side', () => {
    simulatePromoteMember(
      ws, 'owner-peer', 'member-peer', 'admin',
      ['admin-peer'], transport, ui, persistWorkspace, signRoleEvent,
    );

    expect(ui.updateSidebar).toHaveBeenCalledTimes(1);
    expect(ui.updateChannelHeader).toHaveBeenCalledTimes(1);
  });

  test('demote triggers updateSidebar + updateChannelHeader on sender side', () => {
    simulateDemoteMember(
      ws, 'owner-peer', 'admin-peer',
      ['member-peer'], transport, ui, persistWorkspace, signRoleEvent,
    );

    expect(ui.updateSidebar).toHaveBeenCalledTimes(1);
    expect(ui.updateChannelHeader).toHaveBeenCalledTimes(1);
  });

  test('received role-changed triggers renderApp on receiver side', () => {
    const receiverUi = createMockUI();
    const verifySignature = mock(() => true);

    handleRoleChangedSync(
      ws,
      { type: 'role-changed', peerId: 'member-peer', newRole: 'admin', changedBy: 'owner-peer', timestamp: Date.now(), signature: 'sig' },
      'owner-peer', 'owner-peer',
      receiverUi, mock(() => {}), new Map(), verifySignature, 'spk-owner',
    );

    expect(receiverUi.renderApp).toHaveBeenCalledTimes(1);
    // Sender-side methods should NOT be called on the receiver
    expect(receiverUi.updateSidebar).not.toHaveBeenCalled();
    expect(receiverUi.updateChannelHeader).not.toHaveBeenCalled();
  });

  test('toast shows correct format for promotion: "{alias} is now admin"', () => {
    const receiverUi = createMockUI();
    const verifySignature = mock(() => true);

    handleRoleChangedSync(
      ws,
      { type: 'role-changed', peerId: 'member-peer', newRole: 'admin', changedBy: 'owner-peer', timestamp: Date.now(), signature: 'sig' },
      'owner-peer', 'owner-peer',
      receiverUi, mock(() => {}), new Map(), verifySignature, 'spk-owner',
    );

    expect(receiverUi.showToast).toHaveBeenCalledWith('Carol is now admin');
  });

  test('toast shows correct format for demotion: "{alias} is now member"', () => {
    const receiverUi = createMockUI();
    const verifySignature = mock(() => true);

    handleRoleChangedSync(
      ws,
      { type: 'role-changed', peerId: 'admin-peer', newRole: 'member', changedBy: 'owner-peer', timestamp: Date.now(), signature: 'sig' },
      'owner-peer', 'owner-peer',
      receiverUi, mock(() => {}), new Map(), verifySignature, 'spk-owner',
    );

    expect(receiverUi.showToast).toHaveBeenCalledWith('Bob is now member');
  });

  test('toast uses peerId prefix when alias is missing', () => {
    // Create workspace with a member that has no alias
    const wsNoAlias: Workspace = {
      ...createTestWorkspace(),
      members: [
        { peerId: 'owner-peer', alias: 'Alice', publicKey: 'pk-owner', signingPublicKey: 'spk-owner', role: 'owner' },
        { peerId: 'abcd1234-long-peer-id', alias: '', publicKey: 'pk-noalias', role: 'member' },
      ],
    };

    const receiverUi = createMockUI();
    const verifySignature = mock(() => true);

    handleRoleChangedSync(
      wsNoAlias,
      { type: 'role-changed', peerId: 'abcd1234-long-peer-id', newRole: 'admin', changedBy: 'owner-peer', timestamp: Date.now(), signature: 'sig' },
      'owner-peer', 'owner-peer',
      receiverUi, mock(() => {}), new Map(), verifySignature, 'spk-owner',
    );

    expect(receiverUi.showToast).toHaveBeenCalledWith('abcd1234 is now admin');
  });
});
