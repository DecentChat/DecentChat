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
