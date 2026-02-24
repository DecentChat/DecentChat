import { describe, expect, test } from 'bun:test';
import { MessageStore, WorkspaceManager } from 'decent-protocol';
import { SyncProtocol } from '../../src/peer/SyncProtocol.ts';

function normalizeSyncPayload(raw: any): any {
  if (!raw?.sync) return raw;
  return raw.workspaceId ? { ...raw.sync, workspaceId: raw.workspaceId } : raw.sync;
}

async function waitFor(condition: () => boolean, timeoutMs = 2500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition');
}

async function addMessage(store: MessageStore, channelId: string, senderId: string, text: string): Promise<string> {
  const message = await store.createMessage(channelId, senderId, text);
  const lastTs = store.getMessages(channelId).slice(-1)[0]?.timestamp ?? 0;
  message.timestamp = Math.max(message.timestamp, lastTs + 1);
  const added = await store.addMessage(message);
  if (!added.success) throw new Error(added.error ?? 'failed to add message');
  return message.id;
}

describe('Negentropy multichannel wire reconciliation', () => {
  test('reconciles each channel independently and requests only per-channel missing IDs', async () => {
    const aliceWm = new WorkspaceManager();
    const bobWm = new WorkspaceManager();
    const aliceMs = new MessageStore();
    const bobMs = new MessageStore();

    const ws = aliceWm.createWorkspace('Multi', 'alice', 'Alice', 'alice-key');
    aliceWm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: Date.now(), role: 'member' });

    const general = ws.channels[0];
    const randomCreate = aliceWm.createChannel(ws.id, 'random', 'alice');
    const devCreate = aliceWm.createChannel(ws.id, 'dev', 'alice');
    if (!randomCreate.success || !randomCreate.channel) throw new Error(randomCreate.error ?? 'failed to create random');
    if (!devCreate.success || !devCreate.channel) throw new Error(devCreate.error ?? 'failed to create dev');
    const random = randomCreate.channel;
    const dev = devCreate.channel;

    bobWm.importWorkspace(JSON.parse(JSON.stringify(aliceWm.exportWorkspace(ws.id)!)));

    // Shared messages
    const generalSharedId = await addMessage(aliceMs, general.id, 'alice', 'general-shared');
    bobMs.forceAdd({ ...aliceMs.getMessages(general.id)[0] });

    const randomSharedId = await addMessage(aliceMs, random.id, 'alice', 'random-shared');
    bobMs.forceAdd({ ...aliceMs.getMessages(random.id)[0] });

    // Divergence by channel
    await addMessage(aliceMs, general.id, 'alice', 'general-alice-only');
    const generalBobOnlyId = await addMessage(bobMs, general.id, 'bob', 'general-bob-only');

    await addMessage(aliceMs, random.id, 'alice', 'random-alice-only');
    const randomBobOnlyId = await addMessage(bobMs, random.id, 'bob', 'random-bob-only');

    // Dev channel: identical / no missing on Bob
    await addMessage(aliceMs, dev.id, 'alice', 'dev-shared');
    bobMs.forceAdd({ ...aliceMs.getMessages(dev.id)[0] });

    const aliceEvents: string[] = [];
    const outgoingTypes: string[] = [];
    const requestedByChannel = new Map<string, string[]>();

    let aliceSync: SyncProtocol;
    let bobSync: SyncProtocol;

    aliceSync = new SyncProtocol(
      aliceWm,
      aliceMs,
      (_peerId, data) => {
        const normalized = normalizeSyncPayload(data);
        outgoingTypes.push(normalized?.type);

        if (normalized?.type === 'negentropy-request-messages') {
          requestedByChannel.set(normalized.channelId, normalized.ids ?? []);
        }

        queueMicrotask(() => {
          void bobSync.handleMessage('alice', normalized);
        });
        return true;
      },
      (event) => aliceEvents.push(event.type),
      'alice',
      undefined,
      { capabilityWaitMs: 50, negentropyBatchSize: 5 },
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
      { capabilityWaitMs: 50, negentropyBatchSize: 5 },
    );

    aliceSync.requestSync('bob', ws.id);
    await waitFor(() => aliceEvents.includes('sync-complete'));

    const generalIds = aliceMs.getMessages(general.id).map((m) => m.id);
    const randomIds = aliceMs.getMessages(random.id).map((m) => m.id);
    const devIds = aliceMs.getMessages(dev.id).map((m) => m.id);

    expect(generalIds).toContain(generalSharedId);
    expect(generalIds).toContain(generalBobOnlyId);

    expect(randomIds).toContain(randomSharedId);
    expect(randomIds).toContain(randomBobOnlyId);

    expect(devIds).toHaveLength(1);

    expect(outgoingTypes).toContain('sync-capabilities');
    expect(outgoingTypes).toContain('negentropy-query');
    expect(outgoingTypes).toContain('negentropy-request-messages');
    expect(outgoingTypes).not.toContain('sync-request');

    expect(requestedByChannel.get(general.id)).toEqual([generalBobOnlyId]);
    expect(requestedByChannel.get(random.id)).toEqual([randomBobOnlyId]);
    expect(requestedByChannel.has(dev.id)).toBe(false);
  });
});
