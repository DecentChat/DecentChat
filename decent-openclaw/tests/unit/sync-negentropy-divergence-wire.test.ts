import { describe, expect, test } from 'bun:test';
import { MessageStore, WorkspaceManager } from '@decentchat/protocol';
import { SyncProtocol } from '../../src/peer/SyncProtocol.ts';

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

describe('Negentropy wire reconciliation (divergent history)', () => {
  test('reconciles divergent sets and requests only missing IDs over wire envelopes', async () => {
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

    const finalAlice = aliceMs.getMessages(channelId).map((m) => m.id);

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
