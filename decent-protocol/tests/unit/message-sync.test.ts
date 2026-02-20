/**
 * Tests for message sync on reconnect.
 *
 * Uses real MessageStore + WorkspaceManager with a simple MockTransport
 * to verify the sync request/response flow.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { MessageStore, WorkspaceManager, MessageCRDT } from '../../src';
import type { PlaintextMessage, Transport } from '../../src';

// ---------------------------------------------------------------------------
// MockTransport — minimal in-memory Transport for testing
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
  destroy(): void { this.sent = []; this.connectedPeers.clear(); }
}

// ---------------------------------------------------------------------------
// Simulated ChatController sync methods (mirrors the real implementation)
// ---------------------------------------------------------------------------

interface SyncPeer {
  peerId: string;
  messageStore: MessageStore;
  workspaceManager: WorkspaceManager;
  crdts: Map<string, MessageCRDT>;
  transport: MockTransport;
  activeWorkspaceId: string | null;
  activeChannelId: string | null;
}

function getOrCreateCRDT(peer: SyncPeer, channelId: string): MessageCRDT {
  if (!peer.crdts.has(channelId)) {
    peer.crdts.set(channelId, new MessageCRDT(peer.peerId));
  }
  return peer.crdts.get(channelId)!;
}

async function requestMessageSync(peer: SyncPeer, targetPeerId: string): Promise<void> {
  const wsId = peer.activeWorkspaceId;
  if (!wsId) return;
  const ws = peer.workspaceManager.getWorkspace(wsId);
  if (!ws) return;

  const channelTimestamps: Record<string, number> = {};
  for (const ch of ws.channels) {
    const msgs = peer.messageStore.getMessages(ch.id);
    const last = msgs[msgs.length - 1];
    channelTimestamps[ch.id] = last?.timestamp ?? 0;
  }

  peer.transport.send(targetPeerId, {
    type: 'message-sync-request',
    workspaceId: wsId,
    channelTimestamps,
  });
}

async function handleMessageSyncRequest(peer: SyncPeer, fromPeerId: string, data: any): Promise<void> {
  const wsId = data.workspaceId;
  if (!wsId) return;
  const ws = peer.workspaceManager.getWorkspace(wsId);
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
    workspaceId: wsId,
    messages: allMessages,
  });
}

async function handleMessageSyncResponse(peer: SyncPeer, fromPeerId: string, data: any): Promise<number> {
  const wsId = data.workspaceId;
  if (!wsId) return 0;
  const ws = peer.workspaceManager.getWorkspace(wsId);
  if (!ws) return 0;
  if (!ws.members.some((m: any) => m.peerId === fromPeerId)) return 0;

  const messages: any[] = data.messages || [];
  let added = 0;

  for (const msg of messages) {
    const existing = peer.messageStore.getMessages(msg.channelId);
    if (existing.some(m => m.id === msg.id)) continue;
    if (!ws.channels.some((ch: any) => ch.id === msg.channelId)) continue;

    const newMsg = await peer.messageStore.createMessage(
      msg.channelId, msg.senderId, msg.content, msg.type || 'text', msg.threadId,
    );
    newMsg.id = msg.id;
    newMsg.timestamp = msg.timestamp;
    (newMsg as any).vectorClock = msg.vectorClock;

    const result = await peer.messageStore.addMessage(newMsg);
    if (result.success) {
      const crdt = getOrCreateCRDT(peer, msg.channelId);
      crdt.addMessage({
        id: newMsg.id,
        channelId: newMsg.channelId,
        senderId: newMsg.senderId,
        content: newMsg.content,
        type: (newMsg.type || 'text') as any,
        vectorClock: msg.vectorClock || {},
        wallTime: newMsg.timestamp,
        prevHash: newMsg.prevHash || '',
      });
      added++;
    }
  }

  return added;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSyncPeer(peerId: string): SyncPeer {
  return {
    peerId,
    messageStore: new MessageStore(),
    workspaceManager: new WorkspaceManager(),
    crdts: new Map(),
    transport: new MockTransport(),
    activeWorkspaceId: null,
    activeChannelId: null,
  };
}

function setupWorkspace(peer: SyncPeer, wsName: string): string {
  const ws = peer.workspaceManager.createWorkspace(wsName, peer.peerId, peer.peerId.slice(0, 8), 'pk-' + peer.peerId);
  peer.activeWorkspaceId = ws.id;
  peer.activeChannelId = ws.channels[0]?.id || null;
  return ws.id;
}

/** Add a member to an existing workspace on a peer */
function addMember(peer: SyncPeer, wsId: string, memberPeerId: string): void {
  peer.workspaceManager.addMember(wsId, {
    peerId: memberPeerId,
    alias: memberPeerId.slice(0, 8),
    publicKey: 'pk-' + memberPeerId,
    joinedAt: Date.now(),
    role: 'member',
  });
}

/** Import a workspace to another peer so they share the same workspace ID and channels */
function shareWorkspace(from: SyncPeer, to: SyncPeer): void {
  const ws = from.workspaceManager.getWorkspace(from.activeWorkspaceId!)!;
  const exported = from.workspaceManager.exportWorkspace(ws.id)!;

  // Deep clone to avoid shared references
  const clone = JSON.parse(JSON.stringify(exported));
  to.workspaceManager.importWorkspace(clone);
  to.activeWorkspaceId = clone.id;
  to.activeChannelId = clone.channels[0]?.id || null;

  // Make sure both peers are members of each other's copy
  addMember(from, ws.id, to.peerId);
  addMember(to, clone.id, from.peerId);
}

async function addMessages(peer: SyncPeer, channelId: string, count: number, prefix = 'msg'): Promise<PlaintextMessage[]> {
  const msgs: PlaintextMessage[] = [];
  for (let i = 0; i < count; i++) {
    const msg = await peer.messageStore.createMessage(channelId, peer.peerId, `${prefix}-${i}`);
    await peer.messageStore.addMessage(msg);
    msgs.push(msg);
    // Small delay to ensure different timestamps
    await new Promise(r => setTimeout(r, 2));
  }
  return msgs;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Message sync on reconnect', () => {
  let alice: SyncPeer;
  let bob: SyncPeer;

  beforeEach(() => {
    alice = createSyncPeer('alice');
    bob = createSyncPeer('bob');
  });

  test('requestMessageSync sends correct channelTimestamps', async () => {
    const wsId = setupWorkspace(alice, 'test-ws');
    addMember(alice, wsId, 'bob');
    const ws = alice.workspaceManager.getWorkspace(wsId)!;
    const channelId = ws.channels[0].id;

    // Add some messages
    const msgs = await addMessages(alice, channelId, 3);

    await requestMessageSync(alice, 'bob');

    expect(alice.transport.sent.length).toBe(1);
    const sent = alice.transport.sent[0];
    expect(sent.peerId).toBe('bob');
    expect(sent.data.type).toBe('message-sync-request');
    expect(sent.data.workspaceId).toBe(wsId);
    expect(sent.data.channelTimestamps[channelId]).toBe(msgs[2].timestamp);
  });

  test('sync-request returns only newer messages', async () => {
    setupWorkspace(alice, 'test-ws');
    shareWorkspace(alice, bob);
    const ws = alice.workspaceManager.getWorkspace(alice.activeWorkspaceId!)!;
    const channelId = ws.channels[0].id;

    // Alice has 5 messages
    const msgs = await addMessages(alice, channelId, 5);

    // Bob has only seen the first 2 (simulate by using their timestamps)
    const cutoffTimestamp = msgs[1].timestamp;

    await handleMessageSyncRequest(alice, 'bob', {
      workspaceId: alice.activeWorkspaceId,
      channelTimestamps: { [channelId]: cutoffTimestamp },
    });

    expect(alice.transport.sent.length).toBe(1);
    const response = alice.transport.sent[0].data;
    expect(response.type).toBe('message-sync-response');
    expect(response.messages.length).toBe(3); // msgs 2,3,4
    expect(response.messages[0].content).toBe('msg-2');
    expect(response.messages[2].content).toBe('msg-4');
  });

  test('sync-request returns nothing if up to date', async () => {
    setupWorkspace(alice, 'test-ws');
    shareWorkspace(alice, bob);
    const ws = alice.workspaceManager.getWorkspace(alice.activeWorkspaceId!)!;
    const channelId = ws.channels[0].id;

    const msgs = await addMessages(alice, channelId, 3);
    const latestTimestamp = msgs[2].timestamp;

    await handleMessageSyncRequest(alice, 'bob', {
      workspaceId: alice.activeWorkspaceId,
      channelTimestamps: { [channelId]: latestTimestamp },
    });

    const response = alice.transport.sent[0].data;
    expect(response.messages.length).toBe(0);
  });

  test('sync-response merges missing messages', async () => {
    setupWorkspace(alice, 'test-ws');
    shareWorkspace(alice, bob);
    const ws = alice.workspaceManager.getWorkspace(alice.activeWorkspaceId!)!;
    const channelId = ws.channels[0].id;

    // Alice has 3 messages that Bob doesn't
    const msgs = await addMessages(alice, channelId, 3, 'alice-msg');

    // Build a sync response as if alice sent it
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
    expect(added).toBe(3);

    const bobMsgs = bob.messageStore.getMessages(channelId);
    expect(bobMsgs.length).toBe(3);
    expect(bobMsgs[0].content).toBe('alice-msg-0');
  });

  test('sync-response skips duplicates', async () => {
    setupWorkspace(alice, 'test-ws');
    shareWorkspace(alice, bob);
    const ws = alice.workspaceManager.getWorkspace(alice.activeWorkspaceId!)!;
    const channelId = ws.channels[0].id;

    // Both have the same message
    const msg = await alice.messageStore.createMessage(channelId, 'alice', 'shared-msg');
    await alice.messageStore.addMessage(msg);

    const bobMsg = await bob.messageStore.createMessage(channelId, 'alice', 'shared-msg');
    bobMsg.id = msg.id; // Same ID
    await bob.messageStore.addMessage(bobMsg);

    const syncData = {
      workspaceId: alice.activeWorkspaceId,
      messages: [{
        id: msg.id,
        channelId: msg.channelId,
        senderId: msg.senderId,
        content: msg.content,
        timestamp: msg.timestamp,
        type: msg.type,
        prevHash: msg.prevHash,
      }],
    };

    const added = await handleMessageSyncResponse(bob, 'alice', syncData);
    expect(added).toBe(0);

    const bobMsgs = bob.messageStore.getMessages(channelId);
    expect(bobMsgs.length).toBe(1); // No duplicates
  });

  test('sync limits to 50 messages per channel', async () => {
    setupWorkspace(alice, 'test-ws');
    shareWorkspace(alice, bob);
    const ws = alice.workspaceManager.getWorkspace(alice.activeWorkspaceId!)!;
    const channelId = ws.channels[0].id;

    // Add 60 messages to Alice
    await addMessages(alice, channelId, 60, 'bulk');

    await handleMessageSyncRequest(alice, 'bob', {
      workspaceId: alice.activeWorkspaceId,
      channelTimestamps: { [channelId]: 0 }, // Bob has nothing
    });

    const response = alice.transport.sent[0].data;
    expect(response.messages.length).toBe(50);
  });

  test('sync ignores unknown workspaceId', async () => {
    setupWorkspace(alice, 'test-ws');
    addMember(alice, alice.activeWorkspaceId!, 'bob');

    await handleMessageSyncRequest(alice, 'bob', {
      workspaceId: 'nonexistent-workspace-id',
      channelTimestamps: {},
    });

    // No response sent
    expect(alice.transport.sent.length).toBe(0);
  });

  test('sync rejects non-members', async () => {
    setupWorkspace(alice, 'test-ws');
    // Do NOT add bob as a member
    const ws = alice.workspaceManager.getWorkspace(alice.activeWorkspaceId!)!;
    const channelId = ws.channels[0].id;

    await addMessages(alice, channelId, 3);

    await handleMessageSyncRequest(alice, 'bob', {
      workspaceId: alice.activeWorkspaceId,
      channelTimestamps: { [channelId]: 0 },
    });

    // No response — bob is not a member
    expect(alice.transport.sent.length).toBe(0);
  });

  test('sync-response rejects non-members', async () => {
    setupWorkspace(bob, 'test-ws');
    // alice is NOT a member of bob's workspace

    const added = await handleMessageSyncResponse(bob, 'alice', {
      workspaceId: bob.activeWorkspaceId,
      messages: [{
        id: 'msg-1',
        channelId: 'fake-channel',
        senderId: 'alice',
        content: 'sneaky message',
        timestamp: Date.now(),
        type: 'text',
      }],
    });

    expect(added).toBe(0);
  });
});
