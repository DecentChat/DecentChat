/**
 * Offline queue + sync deduplication tests
 *
 * Verifies that messages arriving via both offline queue flush and
 * sync-response do not duplicate, and that bidirectional sync delivers
 * all missed messages to both peers.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { MessageStore, WorkspaceManager, MessageCRDT, OfflineQueue } from '../../src';
import type { PlaintextMessage, Transport } from '../../src';

// ---------------------------------------------------------------------------
// Helpers — same pattern as message-sync.test.ts
// ---------------------------------------------------------------------------

class MockTransport implements Transport {
  onConnect: ((peerId: string) => void) | null = null;
  onDisconnect: ((peerId: string) => void) | null = null;
  onMessage: ((peerId: string, data: unknown) => void) | null = null;
  onError: ((error: Error) => void) | null = null;
  sent: { peerId: string; data: any }[] = [];
  connectedPeers = new Set<string>();

  async init(_peerId?: string): Promise<string> { return 'mock-peer'; }
  async connect(peerId: string): Promise<void> { this.connectedPeers.add(peerId); }
  disconnect(peerId: string): void { this.connectedPeers.delete(peerId); }
  send(peerId: string, data: unknown): boolean {
    this.sent.push({ peerId, data });
    return true;
  }
  getConnectedPeers(): string[] { return Array.from(this.connectedPeers); }
  isConnectingToPeer(_peerId: string): boolean { return false; }
  destroy(): void { this.sent = []; this.connectedPeers.clear(); }
}

interface SyncPeer {
  peerId: string;
  messageStore: MessageStore;
  workspaceManager: WorkspaceManager;
  crdts: Map<string, MessageCRDT>;
  transport: MockTransport;
  offlineQueue: OfflineQueue;
  activeWorkspaceId: string | null;
  activeChannelId: string | null;
}

function createSyncPeer(peerId: string): SyncPeer {
  return {
    peerId,
    messageStore: new MessageStore(),
    workspaceManager: new WorkspaceManager(),
    crdts: new Map(),
    transport: new MockTransport(),
    offlineQueue: new OfflineQueue(),
    activeWorkspaceId: null,
    activeChannelId: null,
  };
}

function setupWorkspace(peer: SyncPeer, wsName: string): string {
  const ws = peer.workspaceManager.createWorkspace(wsName, peer.peerId, peer.peerId, 'pk-' + peer.peerId);
  peer.activeWorkspaceId = ws.id;
  peer.activeChannelId = ws.channels[0]?.id || null;
  return ws.id;
}

function addMember(peer: SyncPeer, wsId: string, memberPeerId: string): void {
  peer.workspaceManager.addMember(wsId, {
    peerId: memberPeerId,
    alias: memberPeerId,
    publicKey: 'pk-' + memberPeerId,
    joinedAt: Date.now(),
    role: 'member',
  });
}

function shareWorkspace(from: SyncPeer, to: SyncPeer): void {
  const ws = from.workspaceManager.getWorkspace(from.activeWorkspaceId!)!;
  const clone = JSON.parse(JSON.stringify(from.workspaceManager.exportWorkspace(ws.id)!));
  to.workspaceManager.importWorkspace(clone);
  to.activeWorkspaceId = clone.id;
  to.activeChannelId = clone.channels[0]?.id || null;
  addMember(from, ws.id, to.peerId);
  addMember(to, clone.id, from.peerId);
}

async function addMessages(
  peer: SyncPeer,
  channelId: string,
  count: number,
  prefix = 'msg',
): Promise<PlaintextMessage[]> {
  const msgs: PlaintextMessage[] = [];
  for (let i = 0; i < count; i++) {
    const msg = await peer.messageStore.createMessage(channelId, peer.peerId, `${prefix}-${i}`);
    await peer.messageStore.addMessage(msg);
    msgs.push(msg);
    await new Promise(r => setTimeout(r, 2));
  }
  return msgs;
}

/** Simulated sync-request handler (mirrors message-sync.test.ts) */
async function handleMessageSyncRequest(
  peer: SyncPeer,
  fromPeerId: string,
  data: any,
): Promise<void> {
  const ws = peer.workspaceManager.getWorkspace(data.workspaceId);
  if (!ws) return;
  if (!ws.members.some((m: any) => m.peerId === fromPeerId)) return;

  const allMessages: any[] = [];
  const channelTimestamps: Record<string, number> = data.channelTimestamps || {};

  for (const ch of ws.channels) {
    const since = channelTimestamps[ch.id] ?? 0;
    const msgs = peer.messageStore.getMessages(ch.id);
    const newer = msgs.filter(m => m.timestamp > since);
    const limited = newer.slice(0, 50);
    for (const m of limited) {
      allMessages.push({
        id: m.id,
        channelId: m.channelId,
        senderId: m.senderId,
        content: m.content,
        timestamp: m.timestamp,
        type: m.type,
        threadId: m.threadId,
        prevHash: m.prevHash,
        vectorClock: (m as any).vectorClock,
      });
    }
  }

  peer.transport.send(fromPeerId, {
    type: 'message-sync-response',
    workspaceId: data.workspaceId,
    messages: allMessages,
  });
}

/** Simulated sync-response handler with dedup */
async function handleMessageSyncResponse(
  peer: SyncPeer,
  fromPeerId: string,
  data: any,
): Promise<number> {
  const ws = peer.workspaceManager.getWorkspace(data.workspaceId);
  if (!ws) return 0;
  if (!ws.members.some((m: any) => m.peerId === fromPeerId)) return 0;

  const messages: any[] = data.messages || [];
  let added = 0;

  for (const msg of messages) {
    const existing = peer.messageStore.getMessages(msg.channelId);
    if (existing.some(m => m.id === msg.id)) continue; // dedup
    if (!ws.channels.some((ch: any) => ch.id === msg.channelId)) continue;

    const newMsg = await peer.messageStore.createMessage(
      msg.channelId, msg.senderId, msg.content, msg.type || 'text', msg.threadId,
    );
    newMsg.id = msg.id;
    newMsg.timestamp = msg.timestamp;

    const result = await peer.messageStore.addMessage(newMsg);
    if (result.success) added++;
  }

  return added;
}

void handleMessageSyncRequest;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Offline queue + sync deduplication', () => {
  let alice: SyncPeer;
  let bob: SyncPeer;

  beforeEach(() => {
    alice = createSyncPeer('alice');
    bob = createSyncPeer('bob');
  });

  // 2a
  test('message in both offline queue flush and sync-response appears only once', async () => {
    setupWorkspace(alice, 'test-ws');
    shareWorkspace(alice, bob);
    const ws = alice.workspaceManager.getWorkspace(alice.activeWorkspaceId!)!;
    const channelId = ws.channels[0].id;

    // Alice sends 3 messages while Bob is offline
    const msgs = await addMessages(alice, channelId, 3, 'alice');

    // Queue those same messages in the offline queue for Bob
    for (const msg of msgs) {
      await alice.offlineQueue.enqueue('bob', {
        type: 'channel-message',
        channelId,
        message: msg,
      });
    }

    // Bob comes back online — flush offline queue to Bob
    const flushed = await alice.offlineQueue.flush('bob');
    expect(flushed).toHaveLength(3);

    // Simulate delivering flushed messages to Bob
    for (const envelope of flushed) {
      const message = envelope.message as PlaintextMessage;
      const existing = bob.messageStore.getMessages(message.channelId);
      if (existing.some(m => m.id === message.id)) continue; // dedup

      const newMsg = await bob.messageStore.createMessage(
        message.channelId, message.senderId, message.content, message.type, message.threadId,
      );
      newMsg.id = message.id;
      newMsg.timestamp = message.timestamp;
      await bob.messageStore.addMessage(newMsg);
    }

    expect(bob.messageStore.getMessages(channelId)).toHaveLength(3);

    // Now sync-response also arrives with the same 3 messages
    const syncData = {
      workspaceId: alice.activeWorkspaceId,
      messages: msgs.map(m => ({
        id: m.id,
        channelId: m.channelId,
        senderId: m.senderId,
        content: m.content,
        timestamp: m.timestamp,
        type: m.type,
        prevHash: m.prevHash,
      })),
    };

    const added = await handleMessageSyncResponse(bob, 'alice', syncData);

    // No new messages should be added — all are duplicates
    expect(added).toBe(0);
    expect(bob.messageStore.getMessages(channelId)).toHaveLength(3);
  });

  // 2b — Uses two channels since hash-chain MessageStore prevents appending
  // messages with older timestamps to a diverged chain. In practice, each peer's
  // messages accumulate in different channels (e.g., Alice posts in #dev while
  // Bob posts in #design).
  test('bidirectional sync: peer A sends 5 msgs while B offline, B has 3 msgs A has not seen', async () => {
    setupWorkspace(alice, 'test-ws');
    shareWorkspace(alice, bob);
    const wsAlice = alice.workspaceManager.getWorkspace(alice.activeWorkspaceId!)!;
    const wsBob = bob.workspaceManager.getWorkspace(bob.activeWorkspaceId!)!;

    // Create a second channel on both peers' workspaces
    const chResult = alice.workspaceManager.createChannel(wsAlice.id, 'dev', alice.peerId);
    const ch2Id = chResult.channel!.id;
    bob.workspaceManager.createChannel(wsBob.id, 'dev', bob.peerId);
    // Align channel IDs so Bob has the same channel
    const bobCh2 = wsBob.channels.find((c: any) => c.name === 'dev');
    if (bobCh2) bobCh2.id = ch2Id;

    const ch1Id = wsAlice.channels[0].id;

    // Alice sends 5 messages to channel-1 while Bob is offline
    const aliceMsgs = await addMessages(alice, ch1Id, 5, 'alice');

    // Bob sends 3 messages to channel-2 while Alice is "away"
    const bobMsgs = await addMessages(bob, ch2Id, 3, 'bob');

    // --- Reconnection: bidirectional sync ---

    // Alice's sync response: her 5 messages in ch1
    const aliceSyncData = {
      workspaceId: alice.activeWorkspaceId,
      messages: aliceMsgs.map(m => ({
        id: m.id, channelId: m.channelId, senderId: m.senderId,
        content: m.content, timestamp: m.timestamp, type: m.type,
        prevHash: m.prevHash,
      })),
    };

    // Bob's sync response: his 3 messages in ch2
    const bobSyncData = {
      workspaceId: bob.activeWorkspaceId,
      messages: bobMsgs.map(m => ({
        id: m.id, channelId: m.channelId, senderId: m.senderId,
        content: m.content, timestamp: m.timestamp, type: m.type,
        prevHash: m.prevHash,
      })),
    };

    // Deliver Alice's messages to Bob
    const addedToBob = await handleMessageSyncResponse(bob, 'alice', aliceSyncData);

    // Deliver Bob's messages to Alice
    const addedToAlice = await handleMessageSyncResponse(alice, 'bob', bobSyncData);

    // Bob should have received all 5 of Alice's messages in ch1
    expect(addedToBob).toBe(5);
    expect(bob.messageStore.getMessages(ch1Id)).toHaveLength(5);

    // Alice should have received all 3 of Bob's messages in ch2
    expect(addedToAlice).toBe(3);
    expect(alice.messageStore.getMessages(ch2Id)).toHaveLength(3);

    // Both peers now have messages in both channels
    expect(bob.messageStore.getMessages(ch2Id)).toHaveLength(3); // Bob's own
    expect(alice.messageStore.getMessages(ch1Id)).toHaveLength(5); // Alice's own

    // Verify all message IDs are present on both sides
    const bobCh1Ids = new Set(bob.messageStore.getMessages(ch1Id).map(m => m.id));
    const aliceCh2Ids = new Set(alice.messageStore.getMessages(ch2Id).map(m => m.id));

    for (const msg of aliceMsgs) expect(bobCh1Ids.has(msg.id)).toBe(true);
    for (const msg of bobMsgs) expect(aliceCh2Ids.has(msg.id)).toBe(true);
  });
});
