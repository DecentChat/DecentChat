import { describe, expect, test, mock } from 'bun:test';
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
    signalingServer: 'https://decentchat.app/peerjs',
    invites: [],
    alias: 'DecentChat Bot',
    dataDir: mkdtempSync(join(tmpdir(), 'openclaw-name-test-')),
    ...overrides,
  };
}

describe('DecentChatNodePeer name-announce flow', () => {
  test('sends name-announce immediately after handshake', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const sent: Array<{ peerId: string; msg: any }> = [];
    (peer as any).transport = {
      send: (peerId: string, msg: any) => {
        sent.push({ peerId, msg });
        return true;
      },
    };
    (peer as any).messageProtocol = {
      createHandshake: async () => ({ publicKey: 'pk', peerId: 'me', preKeySupport: true }),
      createPreKeyBundle: async () => ({
        version: 1,
        peerId: 'me',
        generatedAt: Date.now(),
        signingPublicKey: 'sig',
        signedPreKey: { keyId: 1, publicKey: 'spk', signature: 'sig', createdAt: Date.now(), expiresAt: Date.now() + 1000 },
        oneTimePreKeys: [],
      }),
    };

    await (peer as any).sendHandshake('peer-1');

    expect(sent).toHaveLength(3);
    expect(sent[0]?.peerId).toBe('peer-1');
    expect(sent[0]?.msg.type).toBe('handshake');
    expect(sent[1]?.peerId).toBe('peer-1');
    expect(sent[1]?.msg.type).toBe('pre-key-bundle.publish');
    expect(sent[2]?.peerId).toBe('peer-1');
    expect(sent[2]?.msg).toEqual({ type: 'name-announce', alias: 'DecentChat Bot', isBot: true });
  });

  test('name-announce includes bootstrap target workspace id when peer membership is still converging', async () => {
    const account = makeAccount({
      companySimBootstrap: {
        enabled: true,
        mode: 'runtime',
        targetWorkspaceId: 'ws-target',
      },
    });

    const peer = new DecentChatNodePeer({
      account,
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const me = (peer as any).myPeerId as string;
    (peer as any).workspaceManager.importWorkspace({
      id: 'ws-target',
      name: 'Target',
      description: '',
      inviteCode: 'INV123',
      channels: [],
      members: [{ peerId: me, alias: 'DecentChat Bot', publicKey: '', role: 'member', joinedAt: Date.now() }],
      permissions: {},
      createdAt: Date.now(),
      createdBy: me,
    });

    const sent: Array<{ peerId: string; msg: any }> = [];
    (peer as any).transport = {
      send: (peerId: string, msg: any) => {
        sent.push({ peerId, msg });
        return true;
      },
    };
    (peer as any).messageProtocol = {
      createHandshake: async () => ({ publicKey: 'pk', peerId: 'me', preKeySupport: true }),
      createPreKeyBundle: async () => ({
        version: 1,
        peerId: 'me',
        generatedAt: Date.now(),
        signingPublicKey: 'sig',
        signedPreKey: { keyId: 1, publicKey: 'spk', signature: 'sig', createdAt: Date.now(), expiresAt: Date.now() + 1000 },
        oneTimePreKeys: [],
      }),
    };

    await (peer as any).sendHandshake('peer-not-yet-member');

    expect(sent).toHaveLength(3);
    expect(sent[2]?.msg).toMatchObject({
      type: 'name-announce',
      alias: 'DecentChat Bot',
      isBot: true,
      workspaceId: 'ws-target',
    });
  });

  test('resolveSenderName prefers cached alias over peer ID', () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const values = new Map<string, unknown>();
    values.set('peer-alias-peer-abc', 'Alice');
    (peer as any).store = {
      get: <T>(key: string, defaultValue: T): T => {
        return (values.get(key) as T | undefined) ?? defaultValue;
      },
      set: () => {},
      delete: () => {},
    };

    const senderName = (peer as any).resolveSenderName('', 'peer-abc');
    expect(senderName).toBe('Alice');
  });

  test('caches alias in store on name-announce', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const values = new Map<string, unknown>();
    (peer as any).store = {
      get: <T>(key: string, defaultValue: T): T => {
        return (values.get(key) as T | undefined) ?? defaultValue;
      },
      set: (key: string, value: unknown): void => {
        values.set(key, value);
      },
      delete: () => {},
    };
    (peer as any).syncProtocol = {};
    (peer as any).messageProtocol = {};
    (peer as any).transport = {};

    await (peer as any).handlePeerMessage('peer-xyz', { type: 'name-announce', alias: 'Bob' });

    expect(values.get('peer-alias-peer-xyz')).toBe('Bob');
  });

  test('name-announce with workspaceId upserts previously unknown member and triggers sync', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const me = (peer as any).myPeerId as string;
    (peer as any).workspaceManager.importWorkspace({
      id: 'ws-1',
      name: 'One',
      description: '',
      inviteCode: 'INV',
      channels: [],
      members: [{ peerId: me, alias: 'DecentChat Bot', publicKey: '', role: 'owner', joinedAt: Date.now() }],
      permissions: {},
      createdAt: Date.now(),
      createdBy: me,
    });

    const requestSync = mock(() => {});
    (peer as any).syncProtocol = { requestSync };
    (peer as any).messageProtocol = {};
    (peer as any).transport = {};

    await (peer as any).handlePeerMessage('peer-xyz', {
      type: 'name-announce',
      alias: 'Mira PM',
      workspaceId: 'ws-1',
      isBot: true,
    });

    const ws = (peer as any).workspaceManager.getWorkspace('ws-1');
    const member = ws?.members.find((m: any) => m.peerId === 'peer-xyz');
    expect(member).toBeTruthy();
    expect(member.alias).toBe('Mira PM');
    expect(member.isBot).toBe(true);
    expect(requestSync).toHaveBeenCalledWith('peer-xyz', 'ws-1');
  });

  test('workspace-state channel merge reuses same-name channel instead of creating duplicate ids', () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    const me = (peer as any).myPeerId as string;
    (peer as any).workspaceManager.importWorkspace({
      id: 'ws-1',
      name: 'One',
      description: '',
      inviteCode: 'INV',
      channels: [{ id: 'local-general', workspaceId: 'ws-1', name: 'general', type: 'channel', members: [], createdBy: me, createdAt: Date.now() }],
      members: [{ peerId: me, alias: 'DecentChat Bot', publicKey: '', role: 'owner', joinedAt: Date.now() }],
      permissions: {},
      createdAt: Date.now(),
      createdBy: me,
    });

    (peer as any).handleWorkspaceState('peer-owner', 'ws-1', {
      name: 'One',
      channels: [{ id: 'remote-general', name: 'general', type: 'channel' }],
      members: [],
    });

    const ws = (peer as any).workspaceManager.getWorkspace('ws-1');
    expect(ws.channels.filter((ch: any) => ch.name === 'general')).toHaveLength(1);
  });
});
