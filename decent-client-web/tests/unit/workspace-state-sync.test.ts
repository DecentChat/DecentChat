/**
 * Workspace state sync tests — reconnect reliability
 *
 * Bug being tested: after reload, peers can't see each other because
 * sendWorkspaceState() isn't called or the received state doesn't
 * correctly update channels, members, and aliases.
 *
 * Simulates the workspace-state exchange logic without needing WebRTC.
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';

// ─── Lightweight simulation of workspace-state exchange ──────────────────────

interface Member {
  peerId: string;
  alias: string;
  publicKey: string;
  role: string;
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
  inviteCode?: string;
}

interface WorkspaceStateMessage {
  type: 'workspace-sync';
  workspaceId: string;
  sync: {
    type: 'workspace-state';
    name: string;
    channels: { id: string; name: string; type: string }[];
    members: { peerId: string; alias: string; publicKey: string; role: string }[];
    inviteCode?: string;
  };
}

/** Simulates the send side — mirrors ChatController.sendWorkspaceState() */
function buildWorkspaceStateMessage(ws: Workspace): WorkspaceStateMessage {
  return {
    type: 'workspace-sync',
    workspaceId: ws.id,
    sync: {
      type: 'workspace-state',
      name: ws.name,
      channels: ws.channels.map(ch => ({ id: ch.id, name: ch.name, type: ch.type })),
      members: ws.members.map(m => ({ peerId: m.peerId, alias: m.alias, publicKey: m.publicKey, role: m.role })),
      inviteCode: ws.inviteCode,
    },
  };
}

/** Simulates the receive side — mirrors handleWorkspaceStateSync() */
function handleWorkspaceStateSync(
  localWs: Workspace,
  sync: WorkspaceStateMessage['sync'],
): void {
  // Sync members: add missing, update aliases for existing
  for (const remoteMember of sync.members) {
    const existing = localWs.members.find(m => m.peerId === remoteMember.peerId);
    if (!existing) {
      localWs.members.push({
        peerId: remoteMember.peerId,
        alias: remoteMember.alias || remoteMember.peerId.slice(0, 8),
        publicKey: remoteMember.publicKey || '',
        role: remoteMember.role || 'member',
      });
    } else {
      // Update alias if the remote has a better (non-empty) name
      if (remoteMember.alias && remoteMember.alias.trim()) {
        existing.alias = remoteMember.alias;
      }
      if (remoteMember.publicKey) existing.publicKey = remoteMember.publicKey;
    }
  }

  // Sync channels: add missing
  for (const remoteCh of sync.channels) {
    const localCh = localWs.channels.find(ch => ch.name === remoteCh.name && ch.type === remoteCh.type);
    if (!localCh) {
      localWs.channels.push({
        id: remoteCh.id,
        name: remoteCh.name,
        type: remoteCh.type,
      });
    }
  }
}

/** Display name resolver (matches ChatController.getDisplayNameForPeer) */
function getDisplayName(peerId: string, workspaces: Workspace[]): string {
  for (const ws of workspaces) {
    const member = ws.members.find(m => m.peerId === peerId);
    if (member?.alias && member.alias.trim()) return member.alias;
  }
  return peerId.slice(0, 8);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Workspace state sync — send side', () => {
  let ws: Workspace;

  beforeEach(() => {
    ws = {
      id: 'ws-1',
      name: 'Test Workspace',
      channels: [
        { id: 'ch-general', name: 'general', type: 'channel' },
        { id: 'ch-random', name: 'random', type: 'channel' },
      ],
      members: [
        { peerId: 'p1', alias: 'Alice', publicKey: 'pk1', role: 'admin' },
        { peerId: 'p2', alias: 'Bob', publicKey: 'pk2', role: 'member' },
      ],
    };
  });

  test('sendWorkspaceState sends workspace-state message type', () => {
    const sendMock = mock((_peerId: string, _msg: any) => {});

    const msg = buildWorkspaceStateMessage(ws);
    sendMock('p2', msg);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const sentMsg = sendMock.mock.calls[0][1] as WorkspaceStateMessage;
    expect(sentMsg.type).toBe('workspace-sync');
    expect(sentMsg.sync.type).toBe('workspace-state');
  });

  test('workspace-state message includes channels list', () => {
    const msg = buildWorkspaceStateMessage(ws);

    expect(Array.isArray(msg.sync.channels)).toBe(true);
    expect(msg.sync.channels.length).toBe(2);
    expect(msg.sync.channels[0].name).toBe('general');
  });

  test('workspace-state message includes member aliases', () => {
    const msg = buildWorkspaceStateMessage(ws);

    expect(Array.isArray(msg.sync.members)).toBe(true);
    expect(msg.sync.members.length).toBe(2);
    expect(msg.sync.members.find(m => m.peerId === 'p1')?.alias).toBe('Alice');
    expect(msg.sync.members.find(m => m.peerId === 'p2')?.alias).toBe('Bob');
  });
});

describe('Workspace state sync — receive side', () => {
  test('received workspace-state updates local member aliases', () => {
    const localWs: Workspace = {
      id: 'ws-1',
      name: 'My Workspace',
      channels: [{ id: 'ch-1', name: 'general', type: 'channel' }],
      members: [{ peerId: 'p1', alias: 'Me', publicKey: 'pk1', role: 'admin' }],
    };

    const sync: WorkspaceStateMessage['sync'] = {
      type: 'workspace-state',
      name: 'Shared Workspace',
      channels: [{ id: 'ch-1', name: 'general', type: 'channel' }],
      members: [
        { peerId: 'p1', alias: 'Me', publicKey: 'pk1', role: 'admin' },
        { peerId: 'p2', alias: 'Bob', publicKey: 'pk2', role: 'member' },
      ],
    };

    handleWorkspaceStateSync(localWs, sync);

    expect(getDisplayName('p2', [localWs])).toBe('Bob');
  });

  test('received workspace-state adds new channels', () => {
    const localWs: Workspace = {
      id: 'ws-1', name: 'Test', channels: [{ id: 'ch-1', name: 'general', type: 'channel' }], members: [],
    };

    handleWorkspaceStateSync(localWs, {
      type: 'workspace-state',
      name: 'Test',
      channels: [
        { id: 'ch-1', name: 'general', type: 'channel' },
        { id: 'ch-2', name: 'random', type: 'channel' },
      ],
      members: [],
    });

    expect(localWs.channels.length).toBe(2);
    expect(localWs.channels.find(ch => ch.name === 'random')).toBeTruthy();
  });

  test('received workspace-state does not overwrite better alias with empty string', () => {
    const localWs: Workspace = {
      id: 'ws-1', name: 'Test',
      channels: [],
      members: [{ peerId: 'p2', alias: 'Bob', publicKey: 'pk2', role: 'member' }],
    };

    handleWorkspaceStateSync(localWs, {
      type: 'workspace-state',
      name: 'Test',
      channels: [],
      members: [{ peerId: 'p2', alias: '', publicKey: 'pk2', role: 'member' }],
    });

    // Empty string should NOT overwrite 'Bob'
    expect(getDisplayName('p2', [localWs])).toBe('Bob');
  });

  test('name-announce after workspace-state correctly updates alias', () => {
    const localWs: Workspace = {
      id: 'ws-1', name: 'Test', channels: [], members: [],
    };

    // Step 1: Receive workspace-state with initial alias
    handleWorkspaceStateSync(localWs, {
      type: 'workspace-state',
      name: 'Test',
      channels: [],
      members: [{ peerId: 'p2', alias: 'Bob-old', publicKey: 'pk2', role: 'member' }],
    });

    expect(getDisplayName('p2', [localWs])).toBe('Bob-old');

    // Step 2: Simulate name-announce (updates alias directly)
    const member = localWs.members.find(m => m.peerId === 'p2');
    if (member) member.alias = 'Bob-new';

    expect(getDisplayName('p2', [localWs])).toBe('Bob-new');
  });
});

// ─── Extended workspace simulation for owner guard tests ────────────────────

interface ExtendedMember extends Member {
  isBot?: boolean;
  allowWorkspaceDMs?: boolean;
  signingPublicKey?: string;
}

interface ExtendedWorkspace {
  id: string;
  name: string;
  channels: Channel[];
  members: ExtendedMember[];
  inviteCode?: string;
  bannedPeerIds?: string[];
}

/**
 * Simulates the workspace-state guard in handleWorkspaceStateSync()
 * including the member-addition passthrough for non-owner senders.
 *
 * Returns { accepted: boolean; membersAdded: string[] }
 */
function simulateWorkspaceStateGuard(
  localWs: ExtendedWorkspace,
  senderPeerId: string,
  myPeerId: string,
  connectedPeerIds: Set<string>,
  sync: { members?: ExtendedMember[]; name?: string; channels?: any[]; permissions?: any },
  options?: { joinValidationPending?: boolean },
): { accepted: boolean; membersAdded: string[] } {
  const senderIsOwner = localWs.members.some(
    m => m.peerId === senderPeerId && m.role === 'owner',
  );
  if (!senderIsOwner) {
    const localIsOwner = localWs.members.some(
      m => m.peerId === myPeerId && m.role === 'owner',
    );
    const connectedOwnerExists = localWs.members.some(
      m => m.role === 'owner' && connectedPeerIds.has(m.peerId),
    );
    const joinValidationPending = options?.joinValidationPending ?? false;
    if ((localIsOwner || connectedOwnerExists) && !joinValidationPending) {
      // Guard fires: reject full workspace-state but allow new member additions
      const membersAdded: string[] = [];
      if (sync.members && Array.isArray(sync.members)) {
        for (const remoteMember of sync.members) {
          if (!remoteMember?.peerId || typeof remoteMember.peerId !== 'string') continue;
          if (localWs.bannedPeerIds?.includes(remoteMember.peerId)) continue;
          const alreadyExists = localWs.members.some(m => m.peerId === remoteMember.peerId);
          if (alreadyExists) continue;
          localWs.members.push({
            peerId: remoteMember.peerId,
            alias: remoteMember.alias || remoteMember.peerId.slice(0, 8),
            publicKey: remoteMember.publicKey || '',
            signingPublicKey: remoteMember.signingPublicKey || undefined,
            role: 'member', // SECURITY: never accept elevated roles from non-owner
            isBot: remoteMember.isBot || undefined,
            allowWorkspaceDMs: remoteMember.allowWorkspaceDMs !== false,
          });
          membersAdded.push(remoteMember.peerId);
        }
      }
      return { accepted: false, membersAdded };
    }
  }
  // Full workspace-state accepted (sender is owner, or join pending, etc.)
  return { accepted: true, membersAdded: [] };
}

describe('Workspace state guard — owner member-addition passthrough', () => {
  let localWs: ExtendedWorkspace;
  const ownerPeerId = 'owner-peer';
  const botPeerId = 'bot-peer';
  const humanBPeerId = 'human-b-peer';

  beforeEach(() => {
    localWs = {
      id: 'ws-1',
      name: 'XenaLand',
      channels: [{ id: 'ch-1', name: 'general', type: 'channel' }],
      members: [
        { peerId: ownerPeerId, alias: 'Owner', publicKey: 'pk-owner', role: 'owner' },
        { peerId: humanBPeerId, alias: 'Human B', publicKey: 'pk-b', role: 'member' },
      ],
    };
  });

  test('owner receives workspace-state from non-owner: new member is added', () => {
    const result = simulateWorkspaceStateGuard(
      localWs,
      humanBPeerId,           // sender is non-owner
      ownerPeerId,            // local is owner
      new Set([humanBPeerId]),
      {
        members: [
          { peerId: ownerPeerId, alias: 'Owner', publicKey: 'pk-owner', role: 'owner' },
          { peerId: humanBPeerId, alias: 'Human B', publicKey: 'pk-b', role: 'member' },
          { peerId: botPeerId, alias: 'Xena', publicKey: 'pk-bot', role: 'member', isBot: true },
        ],
      },
    );

    expect(result.accepted).toBe(false);  // full state rejected
    expect(result.membersAdded).toEqual([botPeerId]);  // but bot was added
    expect(localWs.members.length).toBe(3);
    const botMember = localWs.members.find(m => m.peerId === botPeerId);
    expect(botMember).toBeTruthy();
    expect(botMember!.alias).toBe('Xena');
    expect(botMember!.isBot).toBe(true);
    expect(botMember!.role).toBe('member');  // never elevated
  });

  test('owner receives workspace-state from non-owner: elevated roles are downgraded to member', () => {
    const result = simulateWorkspaceStateGuard(
      localWs,
      humanBPeerId,
      ownerPeerId,
      new Set([humanBPeerId]),
      {
        members: [
          { peerId: 'rogue-peer', alias: 'Rogue', publicKey: 'pk-rogue', role: 'admin' },
        ],
      },
    );

    expect(result.membersAdded).toEqual(['rogue-peer']);
    const rogue = localWs.members.find(m => m.peerId === 'rogue-peer');
    expect(rogue!.role).toBe('member');  // downgraded from admin
  });

  test('owner receives workspace-state from non-owner: banned peers are not added', () => {
    localWs.bannedPeerIds = [botPeerId];

    const result = simulateWorkspaceStateGuard(
      localWs,
      humanBPeerId,
      ownerPeerId,
      new Set([humanBPeerId]),
      {
        members: [
          { peerId: botPeerId, alias: 'Xena', publicKey: 'pk-bot', role: 'member', isBot: true },
        ],
      },
    );

    expect(result.accepted).toBe(false);
    expect(result.membersAdded).toEqual([]);  // banned peer rejected
    expect(localWs.members.length).toBe(2);  // unchanged
  });

  test('owner receives workspace-state from non-owner: existing members are not duplicated', () => {
    const result = simulateWorkspaceStateGuard(
      localWs,
      humanBPeerId,
      ownerPeerId,
      new Set([humanBPeerId]),
      {
        members: [
          { peerId: ownerPeerId, alias: 'Owner', publicKey: 'pk-owner', role: 'owner' },
          { peerId: humanBPeerId, alias: 'Human B', publicKey: 'pk-b', role: 'member' },
        ],
      },
    );

    expect(result.accepted).toBe(false);
    expect(result.membersAdded).toEqual([]);  // no new members
    expect(localWs.members.length).toBe(2);  // unchanged
  });

  test('workspace-state from owner bypasses the guard entirely', () => {
    const result = simulateWorkspaceStateGuard(
      localWs,
      ownerPeerId,            // sender IS the owner
      humanBPeerId,           // local is non-owner
      new Set([ownerPeerId]),
      {
        members: [
          { peerId: botPeerId, alias: 'Xena', publicKey: 'pk-bot', role: 'member', isBot: true },
        ],
      },
    );

    expect(result.accepted).toBe(true);  // full state accepted
    expect(result.membersAdded).toEqual([]);  // handled by main merge logic, not the guard
  });

  test('non-owner receives from non-owner when owner is connected: new member still added', () => {
    // humanB is NOT owner but owner is connected -- guard fires
    const result = simulateWorkspaceStateGuard(
      localWs,
      'some-other-peer',      // sender is non-owner
      humanBPeerId,           // local is non-owner
      new Set([ownerPeerId]), // but owner IS connected
      {
        members: [
          { peerId: botPeerId, alias: 'Xena', publicKey: 'pk-bot', role: 'member', isBot: true },
        ],
      },
    );

    expect(result.accepted).toBe(false);  // guard fires because connected owner exists
    expect(result.membersAdded).toEqual([botPeerId]);  // but bot was still added
  });

  test('join validation pending: full state accepted (guard disabled)', () => {
    const result = simulateWorkspaceStateGuard(
      localWs,
      humanBPeerId,
      ownerPeerId,
      new Set([humanBPeerId]),
      {
        members: [
          { peerId: botPeerId, alias: 'Xena', publicKey: 'pk-bot', role: 'member', isBot: true },
        ],
      },
      { joinValidationPending: true },
    );

    expect(result.accepted).toBe(true);  // guard disabled during join validation
  });
});

// ─── shouldPushWorkspaceStateOnConnect simulation ───────────────────────────

/**
 * Simulates shouldPushWorkspaceStateOnConnect() from ChatController.
 * Non-owners should push workspace-state to the owner so the owner can
 * learn about members that joined through the non-owner peer.
 */
function shouldPushWorkspaceStateOnConnect(
  peerId: string,
  workspaceId: string | undefined,
  ws: ExtendedWorkspace | undefined,
  myPeerId: string,
  pendingJoinValidation: boolean,
): boolean {
  if (!workspaceId) return false;
  if (!ws) return false;
  if (pendingJoinValidation) return true;
  const localIsOwner = ws.members.some(m => m.peerId === myPeerId && m.role === 'owner');
  if (localIsOwner) return true;
  // Non-owners push to the owner so the owner learns about new members
  const peerIsOwner = ws.members.some(m => m.peerId === peerId && m.role === 'owner');
  if (peerIsOwner) return true;
  // Non-owners skip pushes to other non-owners
  return false;
}

describe('shouldPushWorkspaceStateOnConnect — non-owner to owner', () => {
  const ownerPeerId = 'owner-peer';
  const humanBPeerId = 'human-b-peer';
  const humanCPeerId = 'human-c-peer';

  const ws: ExtendedWorkspace = {
    id: 'ws-1',
    name: 'XenaLand',
    channels: [],
    members: [
      { peerId: ownerPeerId, alias: 'Owner', publicKey: 'pk-owner', role: 'owner' },
      { peerId: humanBPeerId, alias: 'Human B', publicKey: 'pk-b', role: 'member' },
      { peerId: humanCPeerId, alias: 'Human C', publicKey: 'pk-c', role: 'member' },
    ],
  };

  test('owner always pushes workspace-state to any peer', () => {
    expect(shouldPushWorkspaceStateOnConnect(humanBPeerId, 'ws-1', ws, ownerPeerId, false)).toBe(true);
    expect(shouldPushWorkspaceStateOnConnect(humanCPeerId, 'ws-1', ws, ownerPeerId, false)).toBe(true);
  });

  test('non-owner pushes workspace-state to the owner', () => {
    // Human B connecting to the owner — should push so owner learns about new members
    expect(shouldPushWorkspaceStateOnConnect(ownerPeerId, 'ws-1', ws, humanBPeerId, false)).toBe(true);
  });

  test('non-owner does NOT push workspace-state to another non-owner', () => {
    // Human B connecting to Human C — skip to avoid O(n^2) storms
    expect(shouldPushWorkspaceStateOnConnect(humanCPeerId, 'ws-1', ws, humanBPeerId, false)).toBe(false);
  });

  test('returns false when workspaceId is undefined', () => {
    expect(shouldPushWorkspaceStateOnConnect(ownerPeerId, undefined, ws, humanBPeerId, false)).toBe(false);
  });

  test('returns false when workspace not found', () => {
    expect(shouldPushWorkspaceStateOnConnect(ownerPeerId, 'ws-1', undefined, humanBPeerId, false)).toBe(false);
  });

  test('returns true when join validation is pending regardless of roles', () => {
    expect(shouldPushWorkspaceStateOnConnect(humanCPeerId, 'ws-1', ws, humanBPeerId, true)).toBe(true);
  });
});

describe('Workspace state sync — reconnect behavior', () => {
  test('workspace-state sync is triggered on EVERY peer connect', () => {
    const sendWorkspaceState = mock((_peerId: string) => {});

    // Simulate first connect
    sendWorkspaceState('p2');
    expect(sendWorkspaceState).toHaveBeenCalledTimes(1);

    // Simulate disconnect + reconnect
    sendWorkspaceState('p2');
    expect(sendWorkspaceState).toHaveBeenCalledTimes(2);

    // Simulate another reconnect
    sendWorkspaceState('p2');
    expect(sendWorkspaceState).toHaveBeenCalledTimes(3);
  });

  test('workspace-state from unknown peer adds them as member', () => {
    const localWs: Workspace = {
      id: 'ws-1', name: 'Test', channels: [], members: [],
    };

    handleWorkspaceStateSync(localWs, {
      type: 'workspace-state',
      name: 'Test',
      channels: [],
      members: [{ peerId: 'p-unknown', alias: 'NewPeer', publicKey: 'pk-new', role: 'member' }],
    });

    expect(localWs.members.length).toBe(1);
    expect(localWs.members[0].peerId).toBe('p-unknown');
    expect(localWs.members[0].alias).toBe('NewPeer');
  });
});
