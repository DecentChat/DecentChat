import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DecentChatNodePeer } from '../../src/peer/DecentChatNodePeer.ts';

const VALID_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function makeAccount(overrides: Partial<any> = {}): any {
  return {
    accountId: 'acct-1',
    enabled: true,
    dmPolicy: 'allow',
    configured: true,
    seedPhrase: VALID_SEED,
    signalingServer: 'https://0.peerjs.com/',
    invites: [],
    alias: 'DecentChat Bot',
    dataDir: mkdtempSync(join(tmpdir(), 'openclaw-ws-sec-')),
    ...overrides,
  };
}

describe('DecentChatNodePeer workspace-state security', () => {
  test('ignores workspace-state from non-member peer for existing workspace', () => {
    const peer = new DecentChatNodePeer({ account: makeAccount(), onIncomingMessage: async () => {}, onReply: () => {} });
    const me = (peer as any).myPeerId as string;

    (peer as any).workspaceManager.importWorkspace({
      id: 'ws-1',
      name: 'Workspace',
      description: '',
      inviteCode: 'INV123',
      channels: [{ id: 'ch-1', workspaceId: 'ws-1', name: 'general', type: 'channel', members: [], createdBy: 'peer-owner', createdAt: 1 }],
      members: [
        { peerId: me, alias: 'DecentChat Bot', publicKey: '', role: 'member', joinedAt: 1 },
        { peerId: 'peer-owner', alias: 'Owner', publicKey: 'pk-owner', role: 'owner', joinedAt: 1 },
      ],
      permissions: {},
      createdAt: 1,
      createdBy: 'peer-owner',
    });

    (peer as any).handleWorkspaceState('peer-outsider', 'ws-1', {
      name: 'Compromised',
      members: [{ peerId: 'peer-outsider', alias: 'Outsider', publicKey: 'pk-outsider', role: 'owner' }],
      channels: [{ id: 'ch-evil', name: 'evil', type: 'channel' }],
      permissions: { canCreateChannels: true },
    });

    const ws = (peer as any).workspaceManager.getWorkspace('ws-1');
    expect(ws.name).toBe('Workspace');
    expect(ws.channels.some((channel: any) => channel.id === 'ch-evil')).toBe(false);
  });

  test('owner workspace-state syncs explicit channel access policy', () => {
    const peer = new DecentChatNodePeer({ account: makeAccount(), onIncomingMessage: async () => {}, onReply: () => {} });
    const me = (peer as any).myPeerId as string;

    (peer as any).workspaceManager.importWorkspace({
      id: 'ws-1',
      name: 'Workspace',
      description: '',
      inviteCode: 'INV123',
      channels: [{ id: 'ch-1', workspaceId: 'ws-1', name: 'general', type: 'channel', members: [], createdBy: 'peer-owner', createdAt: 1 }],
      members: [
        { peerId: me, alias: 'DecentChat Bot', publicKey: '', role: 'member', joinedAt: 1 },
        { peerId: 'peer-owner', alias: 'Owner', publicKey: 'pk-owner', role: 'owner', joinedAt: 1 },
        { peerId: 'peer-target', alias: 'Target', publicKey: 'pk-target', role: 'member', joinedAt: 1 },
      ],
      permissions: {},
      createdAt: 1,
      createdBy: 'peer-owner',
    });

    (peer as any).handleWorkspaceState('peer-owner', 'ws-1', {
      name: 'Workspace',
      members: [
        { peerId: 'peer-owner', alias: 'Owner', publicKey: 'pk-owner', role: 'owner' },
        { peerId: 'peer-target', alias: 'Target', publicKey: 'pk-target', role: 'member' },
      ],
      channels: [
        {
          id: 'ch-1',
          name: 'general',
          type: 'channel',
          members: ['peer-owner', 'peer-target'],
          accessPolicy: { mode: 'explicit', explicitMemberPeerIds: ['peer-owner', 'peer-target'] },
        },
      ],
    });

    const ws = (peer as any).workspaceManager.getWorkspace('ws-1');
    const channel = ws.channels.find((entry: any) => entry.id === 'ch-1');
    expect(channel.members).toEqual(['peer-owner', 'peer-target']);
    expect(channel.accessPolicy).toEqual({ mode: 'explicit', explicitMemberPeerIds: ['peer-owner', 'peer-target'] });
  });

  test('non-owner workspace-state cannot escalate member role', () => {
    const peer = new DecentChatNodePeer({ account: makeAccount(), onIncomingMessage: async () => {}, onReply: () => {} });
    const me = (peer as any).myPeerId as string;

    (peer as any).workspaceManager.importWorkspace({
      id: 'ws-1',
      name: 'Workspace',
      description: '',
      inviteCode: 'INV123',
      channels: [],
      members: [
        { peerId: me, alias: 'DecentChat Bot', publicKey: '', role: 'member', joinedAt: 1 },
        { peerId: 'peer-owner', alias: 'Owner', publicKey: 'pk-owner', role: 'owner', joinedAt: 1 },
        { peerId: 'peer-rogue', alias: 'Rogue', publicKey: 'pk-rogue', role: 'member', joinedAt: 1 },
        { peerId: 'peer-target', alias: 'Target', publicKey: 'pk-target', role: 'member', joinedAt: 1 },
      ],
      permissions: {},
      createdAt: 1,
      createdBy: 'peer-owner',
    });

    (peer as any).handleWorkspaceState('peer-rogue', 'ws-1', {
      name: 'Workspace',
      members: [
        { peerId: 'peer-rogue', alias: 'Rogue', publicKey: 'pk-rogue', role: 'member' },
        { peerId: 'peer-target', alias: 'Target', publicKey: 'pk-target', role: 'admin' },
      ],
      channels: [],
      permissions: { canCreateChannels: true },
    });

    const ws = (peer as any).workspaceManager.getWorkspace('ws-1');
    expect(ws.members.find((member: any) => member.peerId === 'peer-target')?.role).toBe('member');
    expect(ws.permissions.canCreateChannels).toBeUndefined();
  });
});
