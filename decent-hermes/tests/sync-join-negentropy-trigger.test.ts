import { describe, expect, test } from 'bun:test';
import { MessageStore, WorkspaceManager } from '@decentchat/protocol';
import { SyncProtocol } from '../src/peer/SyncProtocol.js';

function normalizeSyncPayload(raw: any): any {
  if (!raw?.sync) return raw;
  return raw.workspaceId ? { ...raw.sync, workspaceId: raw.workspaceId } : raw.sync;
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition');
}

async function makeMessage(store: MessageStore, channelId: string, senderId: string, text: string): Promise<string> {
  const message = await store.createMessage(channelId, senderId, text);
  const lastTs = store.getMessages(channelId).slice(-1)[0]?.timestamp ?? 0;
  message.timestamp = Math.max(message.timestamp, lastTs + 1);
  const added = await store.addMessage(message);
  if (!added.success) throw new Error(added.error ?? 'failed to add message');
  return message.id;
}

describe('SyncProtocol join-accepted Negentropy trigger', () => {
  test('join-accepted includes compact snapshot instead of full messageHistory', async () => {
    const aliceWm = new WorkspaceManager();
    const aliceMs = new MessageStore();

    const ws = aliceWm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');
    const channelId = ws.channels[0].id;
    await makeMessage(aliceMs, channelId, 'alice', 'seed-message');

    const outbound: any[] = [];

    const aliceSync = new SyncProtocol(
      aliceWm,
      aliceMs,
      (_peerId, data) => {
        outbound.push(normalizeSyncPayload(data));
        return true;
      },
      () => {},
      'alice',
      undefined,
      { capabilityWaitMs: 50 },
    );

    await aliceSync.handleMessage('bob', {
      type: 'join-request',
      inviteCode: ws.inviteCode,
      member: {
        peerId: 'bob',
        alias: 'Bob',
        publicKey: 'bob-key',
        joinedAt: Date.now(),
        role: 'member',
      },
    });

    const joinAccepted = outbound.find((packet) => packet?.type === 'join-accepted');
    expect(joinAccepted).toBeTruthy();
    expect(joinAccepted.snapshot).toBeTruthy();
    expect(joinAccepted.snapshot.type).toBe('workspace-snapshot');
    expect(joinAccepted.snapshot.workspaceId).toBe(ws.id);
    expect(joinAccepted.snapshot.snapshotVersion).toBe(1);
    expect(joinAccepted.snapshot.channels).toHaveLength(1);
    expect(joinAccepted.snapshot.channels[0].id).toBe(channelId);
    expect(joinAccepted.snapshot.channels[0].messageCount).toBe(1);
    expect(joinAccepted.snapshot.channels[0].headHash).toMatch(/^[a-f0-9]{64}$/);
    expect(joinAccepted.snapshot.channels[0].negentropyFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(joinAccepted.snapshot.channels[0].lastMessageAt).toBeGreaterThan(0);

    // Legacy key can still be present for compatibility, but must not carry full history.
    expect(joinAccepted.messageHistory ?? {}).toEqual({});
  });

  test('starts Negentropy sync after join-accepted and applies missing messages', async () => {
    const aliceWm = new WorkspaceManager();
    const bobWm = new WorkspaceManager();
    const aliceMs = new MessageStore();
    const bobMs = new MessageStore();

    const ws = aliceWm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');
    aliceWm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: Date.now(), role: 'member' });

    const channelId = ws.channels[0].id;
    const seed = await aliceMs.createMessage(channelId, 'alice', 'seed-message');
    const added = await aliceMs.addMessage(seed);
    if (!added.success) throw new Error(added.error ?? 'failed to seed message history');

    const joinAccepted = {
      type: 'join-accepted' as const,
      workspace: aliceWm.exportWorkspace(ws.id)!,
      messageHistory: {},
    };

    const bobOutgoingTypes: string[] = [];
    const bobEvents: string[] = [];

    let aliceSync: SyncProtocol;
    let bobSync: SyncProtocol;

    aliceSync = new SyncProtocol(
      aliceWm,
      aliceMs,
      (_peerId, data) => {
        const normalized = normalizeSyncPayload(data);
        queueMicrotask(() => {
          void bobSync.handleMessage('alice', normalized);
        });
        return true;
      },
      () => {},
      'alice',
      undefined,
      { capabilityWaitMs: 50 },
    );

    bobSync = new SyncProtocol(
      bobWm,
      bobMs,
      (_peerId, data) => {
        const normalized = normalizeSyncPayload(data);
        bobOutgoingTypes.push(normalized?.type);
        queueMicrotask(() => {
          void aliceSync.handleMessage('bob', normalized);
        });
        return true;
      },
      (event) => {
        bobEvents.push(event.type);
      },
      'bob',
      undefined,
      { capabilityWaitMs: 50 },
    );

    await bobSync.handleMessage('alice', joinAccepted);

    await waitFor(() => bobOutgoingTypes.includes('negentropy-query'));
    await waitFor(() => bobEvents.includes('sync-complete'));

    expect(bobOutgoingTypes).toContain('negentropy-query');
    expect(bobOutgoingTypes).not.toContain('sync-request');
    expect(bobMs.getMessages(channelId)).toHaveLength(1);
  });
});

describe('Negentropy wire reconciliation (divergent history)', () => {
  test('requests only missing ids during reconciliation', async () => {
    const aliceWm = new WorkspaceManager();
    const bobWm = new WorkspaceManager();
    const aliceMs = new MessageStore();
    const bobMs = new MessageStore();

    const ws = aliceWm.createWorkspace('Wire', 'alice', 'Alice', 'alice-key');
    aliceWm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: Date.now(), role: 'member' });
    bobWm.importWorkspace(JSON.parse(JSON.stringify(aliceWm.exportWorkspace(ws.id)!)));

    const channelId = ws.channels[0].id;

    const sharedId = await makeMessage(aliceMs, channelId, 'alice', 'shared');
    bobMs.forceAdd({ ...aliceMs.getMessages(channelId)[0] });

    await makeMessage(aliceMs, channelId, 'alice', 'alice-only');
    const bobOnlyId = await makeMessage(bobMs, channelId, 'bob', 'bob-only');

    const aliceEvents: string[] = [];
    const aliceOutgoingTypes: string[] = [];
    const aliceRequestedIds: string[][] = [];

    let aliceSync: SyncProtocol;
    let bobSync: SyncProtocol;

    aliceSync = new SyncProtocol(
      aliceWm,
      aliceMs,
      (_peerId, data) => {
        const normalized = normalizeSyncPayload(data);
        aliceOutgoingTypes.push(normalized?.type);
        if (normalized?.type === 'negentropy-request-messages') {
          aliceRequestedIds.push(normalized.ids ?? []);
        }
        queueMicrotask(() => {
          void bobSync.handleMessage('alice', normalized);
        });
        return true;
      },
      (event) => aliceEvents.push(event.type),
      'alice',
      undefined,
      { capabilityWaitMs: 50, negentropyBatchSize: 10 },
    );

    bobSync = new SyncProtocol(
      bobWm,
      bobMs,
      (_peerId, data) => {
        const normalized = normalizeSyncPayload(data);
        queueMicrotask(() => {
          void aliceSync.handleMessage('bob', normalized);
        });
        return true;
      },
      () => {},
      'bob',
      undefined,
      { capabilityWaitMs: 50, negentropyBatchSize: 10 },
    );

    aliceSync.requestSync('bob', ws.id);
    await waitFor(() => aliceEvents.includes('sync-complete'));

    const finalAlice = aliceMs.getMessages(channelId).map((message) => message.id);

    expect(finalAlice).toContain(sharedId);
    expect(finalAlice).toContain(bobOnlyId);
    expect(finalAlice).toHaveLength(3);

    expect(aliceOutgoingTypes).toContain('sync-capabilities');
    expect(aliceOutgoingTypes).toContain('negentropy-query');
    expect(aliceOutgoingTypes).toContain('negentropy-request-messages');
    expect(aliceOutgoingTypes).not.toContain('sync-request');

    expect(aliceRequestedIds).toHaveLength(1);
    expect(aliceRequestedIds[0]).toEqual([bobOnlyId]);
  });
});
