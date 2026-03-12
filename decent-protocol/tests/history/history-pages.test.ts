import '../setup';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { MessageStore } from '../../src/messages/MessageStore';
import { PersistentStore } from '../../src/storage/PersistentStore';
import { HistoryPageProtocol } from '../../src/history/HistoryPageProtocol';
import { SyncProtocol } from '../../src/workspace/SyncProtocol';
import { WorkspaceManager } from '../../src/workspace/WorkspaceManager';
import type { SyncEvent } from '../../src/workspace/SyncProtocol';

function createPeer(peerId: string) {
  const wm = new WorkspaceManager();
  const ms = new MessageStore();
  const events: SyncEvent[] = [];
  const outbox: { to: string; data: any }[] = [];

  const sendFn = (targetPeerId: string, data: any) => {
    outbox.push({ to: targetPeerId, data });
    return true;
  };

  const sync = new SyncProtocol(wm, ms, sendFn, (event) => events.push(event), peerId);
  return { peerId, wm, ms, events, outbox, sync };
}

async function deliver(from: ReturnType<typeof createPeer>, to: ReturnType<typeof createPeer>) {
  const outgoing = [...from.outbox];
  from.outbox.length = 0;

  for (const packet of outgoing) {
    if (packet.to !== to.peerId || packet.data.type !== 'workspace-sync') continue;
    const syncMsg = { ...packet.data.sync };
    if (packet.data.workspaceId) syncMsg.workspaceId = packet.data.workspaceId;
    await to.sync.handleMessage(from.peerId, syncMsg);
  }
}

async function seedMessages(store: MessageStore, channelId: string, senderId: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const message = await store.createMessage(channelId, senderId, `message-${i}`);
    message.timestamp = 1_000 + i;
    await store.addMessage(message);
    ids.push(message.id);
  }
  return ids;
}

describe('HistoryPageProtocol', () => {
  test('fetches paged history with older cursor traversal and metadata-only payloads', async () => {
    const wm = new WorkspaceManager();
    const ms = new MessageStore();
    const ws = wm.createWorkspace('Paged History', 'alice', 'Alice', 'alice-key');
    const channelId = ws.channels[0]!.id;

    const messageIds = await seedMessages(ms, channelId, 'alice', 6);
    const protocol = new HistoryPageProtocol(ms, wm, () => 42);

    const firstPage = protocol.getHistoryPage(ws.id, channelId, { pageSize: 2, direction: 'older' });
    expect(firstPage.messages.map((message) => message.id)).toEqual(messageIds.slice(-2));
    expect(firstPage.messages.every((message) => message.content === undefined)).toBe(true);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeDefined();

    const secondPage = protocol.getHistoryPage(ws.id, channelId, {
      pageSize: 2,
      direction: 'older',
      cursor: firstPage.nextCursor,
    });

    expect(secondPage.messages.map((message) => message.id)).toEqual(messageIds.slice(-4, -2));
    expect(secondPage.pageId).not.toBe(firstPage.pageId);
    expect(secondPage.generatedAt).toBe(42);
  });

  test('builds replica hints from relay/archive capability advertisements', () => {
    const wm = new WorkspaceManager();
    const ms = new MessageStore();
    const ws = wm.createWorkspace('Replica Hints', 'alice', 'Alice', 'alice-key');
    const channelId = ws.channels[0]!.id;

    ws.peerCapabilities = {
      'relay-peer': { relay: { channels: [channelId] } },
      'archive-peer': { archive: { retentionDays: 365 } },
      'generic-relay': { relay: {} },
    };

    const protocol = new HistoryPageProtocol(ms, wm, () => 99);
    const hints = protocol.buildReplicaHints(ws.id);
    const channelHint = hints.find((hint) => hint.channelId === channelId);

    expect(channelHint).toBeDefined();
    expect(channelHint?.recentReplicaPeerIds).toContain('archive-peer');
    expect(channelHint?.recentReplicaPeerIds).toContain('relay-peer');
    expect(channelHint?.archiveReplicaPeerIds).toContain('archive-peer');
    expect(channelHint?.updatedAt).toBe(99);
  });
});

describe('SyncProtocol history paging', () => {
  test('joins in paged mode and fetches history windows on demand', async () => {
    const alice = createPeer('alice');
    const bob = createPeer('bob');

    const ws = alice.wm.createWorkspace('Big Workspace', 'alice', 'Alice', 'alice-key');
    const channelId = ws.channels[0]!.id;
    await seedMessages(alice.ms, channelId, 'alice', 5);

    bob.sync.requestJoin(
      'alice',
      ws.inviteCode,
      {
        peerId: 'bob',
        alias: 'Bob',
        publicKey: 'bob-key',
        joinedAt: Date.now(),
        role: 'member',
      },
      undefined,
      { historySyncMode: 'paged' },
    );

    await deliver(bob, alice);

    const joinAccepted = alice.outbox.find((packet) => packet.to === 'bob')?.data.sync;
    expect(joinAccepted.type).toBe('join-accepted');
    expect(joinAccepted.messageHistory).toEqual({});
    expect(joinAccepted.historyReplicaHints.length).toBeGreaterThan(0);

    await deliver(alice, bob);

    const joinedEvent = bob.events.find((event) => event.type === 'workspace-joined');
    expect(joinedEvent).toBeDefined();
    expect((joinedEvent as Extract<SyncEvent, { type: 'workspace-joined' }>).messageHistory).toEqual({});

    bob.sync.requestHistoryPage('alice', ws.id, channelId, { pageSize: 2, direction: 'older' });
    await deliver(bob, alice);
    await deliver(alice, bob);

    const historyEvent = bob.events.find((event) => event.type === 'history-page-received');
    expect(historyEvent).toBeDefined();

    const page = (historyEvent as Extract<SyncEvent, { type: 'history-page-received' }>).page;
    expect(page.messages).toHaveLength(2);
    expect(page.messages.every((message) => message.content === undefined)).toBe(true);
    expect(bob.ms.getMessages(channelId)).toHaveLength(2);

    const replicaHintEvent = bob.events.find((event) => event.type === 'history-replica-hints');
    expect(replicaHintEvent).toBeDefined();
  });
});

describe('PersistentStore history page caching', () => {
  let store: PersistentStore;

  beforeEach(async () => {
    store = new PersistentStore({ dbName: `history-pages-${Date.now()}-${Math.random()}` });
    await store.init();
  });

  afterEach(async () => {
    await store.close();
  });

  test('caches history pages and preserves page payload when ref metadata is updated', async () => {
    const page = {
      workspaceId: 'ws-1',
      channelId: 'ch-1',
      pageId: 'older:start:end',
      pageSize: 2,
      direction: 'older' as const,
      tier: 'recent' as const,
      cursor: undefined,
      nextCursor: '0001:msg-1',
      startCursor: '0001:msg-0',
      endCursor: '0001:msg-1',
      hasMore: true,
      generatedAt: 123,
      replicaPeerIds: ['peer-a'],
      messages: [
        {
          id: 'msg-0',
          channelId: 'ch-1',
          senderId: 'alice',
          timestamp: 1,
          type: 'text' as const,
          prevHash: 'genesis',
          status: 'sent' as const,
        },
      ],
    };

    await store.saveHistoryPage(page);
    await store.saveHistoryPageRef({
      workspaceId: page.workspaceId,
      channelId: page.channelId,
      pageId: page.pageId,
      startCursor: page.startCursor,
      endCursor: page.endCursor,
      replicaPeerIds: ['peer-a', 'peer-b'],
    });

    const loadedPage = await store.getHistoryPage(page.workspaceId, page.channelId, page.pageId);
    const loadedRef = await store.getHistoryPageRef(page.workspaceId, page.channelId, page.pageId);
    const loadedPages = await store.getHistoryPages(page.workspaceId, page.channelId);

    expect(loadedPage?.messages).toHaveLength(1);
    expect(loadedPage?.nextCursor).toBe('0001:msg-1');
    expect(loadedRef?.replicaPeerIds).toEqual(['peer-a', 'peer-b']);
    expect(loadedPages).toHaveLength(1);
  });
});
