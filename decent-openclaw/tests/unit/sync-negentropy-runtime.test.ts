import { describe, expect, mock, test } from 'bun:test';
import { MessageStore, SyncProtocol as LegacySyncProtocol, WorkspaceManager } from 'decent-protocol';
import { SyncProtocol } from '../../src/peer/SyncProtocol.ts';
import { DecentChatNodePeer } from '../../src/peer/DecentChatNodePeer.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VALID_SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function makeAccount(overrides: Partial<any> = {}): any {
  return {
    accountId: 'acct-sync',
    enabled: true,
    dmPolicy: 'allow',
    configured: true,
    seedPhrase: VALID_SEED,
    signalingServer: 'https://decentchat.app/peerjs',
    invites: [],
    alias: 'DecentChat Bot',
    dataDir: mkdtempSync(join(tmpdir(), 'openclaw-negentropy-test-')),
    ...overrides,
  };
}

function normalizeSyncPayload(raw: any): any {
  if (!raw?.sync) return raw;
  return raw.workspaceId ? { ...raw.sync, workspaceId: raw.workspaceId } : raw.sync;
}

async function waitFor(condition: () => boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition');
}

async function addMessages(store: MessageStore, channelId: string, senderId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const message = await store.createMessage(channelId, senderId, `m-${i}`);
    const added = await store.addMessage(message);
    if (!added.success) throw new Error(added.error ?? 'failed to add message');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

describe('SyncProtocol runtime Negentropy sync', () => {
  test('uses Negentropy reconciliation and requests only missing messages', async () => {
    const aliceWm = new WorkspaceManager();
    const bobWm = new WorkspaceManager();
    const aliceMs = new MessageStore();
    const bobMs = new MessageStore();

    const ws = aliceWm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');
    aliceWm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: Date.now(), role: 'member' });
    bobWm.importWorkspace(JSON.parse(JSON.stringify(aliceWm.exportWorkspace(ws.id)!)));

    const channelId = ws.channels[0].id;
    await addMessages(bobMs, channelId, 'bob', 6);

    const aliceSent: string[] = [];
    const bobSent: string[] = [];
    const aliceEvents: string[] = [];

    let aliceSync: SyncProtocol;
    let bobSync: SyncProtocol;

    aliceSync = new SyncProtocol(
      aliceWm,
      aliceMs,
      (_peerId, data) => {
        aliceSent.push(data?.sync?.type);
        void bobSync.handleMessage('alice', normalizeSyncPayload(data));
        return true;
      },
      (event) => {
        aliceEvents.push(event.type);
      },
      'alice',
      undefined,
      { capabilityWaitMs: 60 },
    );

    bobSync = new SyncProtocol(
      bobWm,
      bobMs,
      (_peerId, data) => {
        bobSent.push(data?.sync?.type);
        void aliceSync.handleMessage('bob', normalizeSyncPayload(data));
        return true;
      },
      () => {},
      'bob',
      undefined,
      { capabilityWaitMs: 60 },
    );

    aliceSync.requestSync('bob', ws.id);
    await waitFor(() => aliceEvents.includes('sync-complete'));

    expect(aliceMs.getMessages(channelId)).toHaveLength(6);
    expect(aliceSent).toContain('sync-capabilities');
    expect(aliceSent).toContain('negentropy-query');
    expect(aliceSent).toContain('negentropy-request-messages');
    expect(aliceSent).not.toContain('sync-request');
    expect(bobSent).toContain('negentropy-response');
    expect(bobSent).toContain('negentropy-message-batch');
  });

  test('falls back to legacy timestamp sync when peer does not support Negentropy', async () => {
    const aliceWm = new WorkspaceManager();
    const bobWm = new WorkspaceManager();
    const aliceMs = new MessageStore();
    const bobMs = new MessageStore();

    const ws = aliceWm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');
    aliceWm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: Date.now(), role: 'member' });
    bobWm.importWorkspace(JSON.parse(JSON.stringify(aliceWm.exportWorkspace(ws.id)!)));

    const channelId = ws.channels[0].id;
    await addMessages(bobMs, channelId, 'bob', 4);

    const aliceSent: string[] = [];
    const aliceEvents: string[] = [];

    let aliceSync: SyncProtocol;
    let bobSync: LegacySyncProtocol;

    aliceSync = new SyncProtocol(
      aliceWm,
      aliceMs,
      (_peerId, data) => {
        aliceSent.push(data?.sync?.type);
        void bobSync.handleMessage('alice', normalizeSyncPayload(data));
        return true;
      },
      (event) => {
        aliceEvents.push(event.type);
      },
      'alice',
      undefined,
      { capabilityWaitMs: 40 },
    );

    bobSync = new LegacySyncProtocol(
      bobWm,
      bobMs,
      (_peerId, data) => {
        void aliceSync.handleMessage('bob', normalizeSyncPayload(data));
        return true;
      },
      () => {},
      'bob',
    );

    aliceSync.requestSync('bob', ws.id);
    await waitFor(() => aliceEvents.includes('sync-complete'));

    expect(aliceMs.getMessages(channelId)).toHaveLength(4);
    expect(aliceSent).toContain('sync-capabilities');
    expect(aliceSent).toContain('sync-request');
    expect(aliceSent).not.toContain('negentropy-query');
  });

  test('falls back to legacy sync when Negentropy reconciliation rejects', async () => {
    const wm = new WorkspaceManager();
    const ms = new MessageStore();

    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');

    const sync = new SyncProtocol(
      wm,
      ms,
      () => true,
      () => {},
      'alice',
      undefined,
      { capabilityWaitMs: 40 },
    );

    const sendLegacySyncRequest = mock(() => {});
    (sync as any).sendLegacySyncRequest = sendLegacySyncRequest;
    (sync as any).startNegentropySync = mock(async () => {
      throw new Error('negentropy failed');
    });
    (sync as any).peerCapabilities.set('bob', {
      negentropy: true,
      updatedAt: Date.now(),
    });

    sync.requestSync('bob', ws.id);
    await waitFor(() => sendLegacySyncRequest.mock.calls.length === 1);

    expect(sendLegacySyncRequest).toHaveBeenCalledWith('bob', ws.id);
  });

  test('DecentChatNodePeer reconnect flow requests sync for shared workspaces', async () => {
    const peer = new DecentChatNodePeer({
      account: makeAccount(),
      onIncomingMessage: async () => {},
      onReply: () => {},
    });

    (peer as any).workspaceManager.getAllWorkspaces = () => [
      { id: 'ws-shared', members: [{ peerId: 'peer-1' }] },
      { id: 'ws-other', members: [{ peerId: 'peer-2' }] },
    ];

    const requestSync = mock(() => {});
    (peer as any).syncProtocol = { requestSync };
    (peer as any).transport = {
      send: () => true,
      getConnectedPeers: () => ['peer-1'],
    };
    (peer as any).messageProtocol = {
      processHandshake: mock(async () => {}),
      clearSharedSecret: () => {},
      clearRatchetState: async () => {},
    };

    await (peer as any).handlePeerMessage('peer-1', {
      type: 'handshake',
      publicKey: 'peer-public-key',
      peerId: 'peer-1',
    });

    expect(requestSync).toHaveBeenCalledTimes(1);
    expect(requestSync).toHaveBeenCalledWith('peer-1', 'ws-shared');
  });
});
