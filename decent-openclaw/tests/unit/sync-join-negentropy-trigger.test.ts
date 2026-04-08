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

describe('SyncProtocol join-accepted Negentropy trigger', () => {
  test('starts Negentropy sync after join-accepted and emits negentropy-query', async () => {
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
