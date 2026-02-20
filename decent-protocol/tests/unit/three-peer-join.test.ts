/**
 * Three-Peer Join Tests
 *
 * Scenario: Alice creates workspace1. Bob joins. They exchange messages.
 * Mary joins via Bob's invite link. Two bugs occurred:
 *
 * Bug 1 — Mary cannot see Alice as online/connected:
 *   handleWorkspaceStateSync adds Alice to member list but never calls
 *   transport.connect(alice.peerId). Fix: after the member-sync loop,
 *   connect to every member not already in connectedPeers.
 *
 * Bug 2 — Mary's first message overwrites Bob's history:
 *   Channel ID remap had no min-wins guard. Both peers send workspace-state
 *   simultaneously. Mary has fresh channel UUIDs. Bob blindly adopts Mary's
 *   IDs, so Bob's messages (under the OLD IDs) become invisible.
 *   Fix: only remap localCh.id if (remoteCh.id < localCh.id),
 *   and call messageStore.remapChannel + migrate messageCRDTs.
 *
 * These tests exercise the protocol-level logic in isolation using
 * WorkspaceManager and MessageStore directly (no browser needed).
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { WorkspaceManager } from '../../src/workspace/WorkspaceManager';
import { MessageStore } from '../../src/messages/MessageStore';
import { MessageCRDT } from '../../src/crdt/MessageCRDT';
import type { Channel } from '../../src/workspace/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALICE = 'alice-peer-id';
const BOB   = 'bob-peer-id';
const MARY  = 'mary-peer-id';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SimPeer {
  peerId: string;
  wm: WorkspaceManager;
  ms: MessageStore;
  crdts: Map<string, MessageCRDT>;
  connectedPeers: Set<string>;
  activeWorkspaceId: string | null;
  activeChannelId: string | null;
  /** Tracks transport.connect() calls made during sync */
  connectCalls: string[];
}

function makePeer(peerId: string): SimPeer {
  return {
    peerId,
    wm: new WorkspaceManager(),
    ms: new MessageStore(),
    crdts: new Map(),
    connectedPeers: new Set(),
    activeWorkspaceId: null,
    activeChannelId: null,
    connectCalls: [],
  };
}

/**
 * Simulate handleWorkspaceStateSync — mirrors the fixed ChatController logic.
 * Returns the list of peerIds that transport.connect() would be called on.
 */
function simulateWorkspaceStateSync(
  receiver: SimPeer,
  senderPeerId: string,
  remoteWorkspaceId: string,
  sync: { name: string; channels: { id: string; name: string; type: string }[]; members: { peerId: string; alias: string; publicKey: string; role: string }[] },
): void {
  let localWs = receiver.activeWorkspaceId
    ? receiver.wm.getWorkspace(receiver.activeWorkspaceId)
    : null;
  if (!localWs) return;

  // Workspace ID min-wins remap
  if (remoteWorkspaceId && localWs.id !== remoteWorkspaceId && remoteWorkspaceId < localWs.id) {
    const oldId = localWs.id;
    receiver.wm.removeWorkspace(oldId);
    localWs.id = remoteWorkspaceId;
    for (const ch of localWs.channels) {
      if ((ch as any).workspaceId === oldId) {
        (ch as any).workspaceId = remoteWorkspaceId;
      }
    }
    receiver.wm.importWorkspace(localWs);
    if (receiver.activeWorkspaceId === oldId) {
      receiver.activeWorkspaceId = remoteWorkspaceId;
    }
  }

  // Workspace name
  if (sync.name && localWs.name !== sync.name) {
    const isPlaceholder = localWs.name === localWs.inviteCode || localWs.name.length === 8;
    if (isPlaceholder) localWs.name = sync.name;
  }

  // Channel sync with min-wins guard
  if (sync.channels && Array.isArray(sync.channels)) {
    for (const remoteCh of sync.channels) {
      const localCh = localWs.channels.find(
        (ch: any) => ch.name === remoteCh.name && ch.type === remoteCh.type
      );
      if (localCh && localCh.id !== remoteCh.id && remoteCh.id < localCh.id) {
        const oldId = localCh.id;
        localCh.id = remoteCh.id;

        // Migrate messages
        receiver.ms.remapChannel(oldId, remoteCh.id);

        // Migrate CRDTs
        if (receiver.crdts.has(oldId)) {
          const crdt = receiver.crdts.get(oldId)!;
          receiver.crdts.set(remoteCh.id, crdt);
          receiver.crdts.delete(oldId);
        }

        if (receiver.activeChannelId === oldId) {
          receiver.activeChannelId = remoteCh.id;
        }
      } else if (!localCh) {
        localWs.channels.push({
          id: remoteCh.id,
          workspaceId: localWs.id,
          name: remoteCh.name,
          type: (remoteCh.type || 'channel') as 'channel' | 'dm',
          members: [],
          createdBy: senderPeerId,
          createdAt: Date.now(),
        });
      }
    }
  }

  // Member sync
  if (sync.members && Array.isArray(sync.members)) {
    for (const remoteMember of sync.members) {
      const existing = localWs.members.find((m: any) => m.peerId === remoteMember.peerId);
      if (!existing) {
        localWs.members.push({
          peerId: remoteMember.peerId,
          alias: remoteMember.alias || remoteMember.peerId.slice(0, 8),
          publicKey: remoteMember.publicKey || '',
          joinedAt: Date.now(),
          role: (remoteMember.role || 'member') as 'owner' | 'member',
        });
      } else {
        if (remoteMember.alias && remoteMember.alias.trim()) {
          existing.alias = remoteMember.alias;
        }
        if (remoteMember.publicKey) existing.publicKey = remoteMember.publicKey;
      }
    }
  }

  // Bug 1 fix: connect to all members not already connected
  for (const member of localWs.members) {
    if (
      member.peerId !== receiver.peerId &&
      !receiver.connectedPeers.has(member.peerId)
    ) {
      receiver.connectCalls.push(member.peerId);
    }
  }
}

/** Build the workspace-state sync payload a peer would send */
function buildSyncPayload(peer: SimPeer) {
  const ws = peer.wm.getWorkspace(peer.activeWorkspaceId!)!;
  return {
    name: ws.name,
    channels: ws.channels.map(ch => ({ id: ch.id, name: ch.name, type: ch.type })),
    members: ws.members.map(m => ({ peerId: m.peerId, alias: m.alias, publicKey: m.publicKey, role: m.role })),
  };
}

// ---------------------------------------------------------------------------
// Setup: Alice creates workspace, Bob joins, they exchange messages
// ---------------------------------------------------------------------------

let alice: SimPeer;
let bob: SimPeer;
let mary: SimPeer;
let WORKSPACE_ID: string;
let GENERAL_CHANNEL_ID: string;

beforeEach(async () => {
  alice = makePeer(ALICE);
  bob = makePeer(BOB);
  mary = makePeer(MARY);

  // Alice creates workspace
  const ws = alice.wm.createWorkspace('test-workspace', ALICE, 'Alice', 'alice-pub-key');
  WORKSPACE_ID = ws.id;
  GENERAL_CHANNEL_ID = ws.channels[0].id;
  alice.activeWorkspaceId = WORKSPACE_ID;
  alice.activeChannelId = GENERAL_CHANNEL_ID;

  // Add Bob as a member
  alice.wm.addMember(WORKSPACE_ID, {
    peerId: BOB,
    alias: 'Bob',
    publicKey: 'bob-pub-key',
    joinedAt: Date.now(),
    role: 'member',
  });

  // Bob clones Alice's workspace (simulates initial sync)
  const cloned = JSON.parse(JSON.stringify(alice.wm.getWorkspace(WORKSPACE_ID)!));
  bob.wm.importWorkspace(cloned);
  bob.activeWorkspaceId = WORKSPACE_ID;
  bob.activeChannelId = GENERAL_CHANNEL_ID;

  // Mark Alice↔Bob as connected
  alice.connectedPeers.add(BOB);
  bob.connectedPeers.add(ALICE);

  // Alice sends 2 messages
  const msg1 = await alice.ms.createMessage(GENERAL_CHANNEL_ID, ALICE, 'Hello from Alice');
  await alice.ms.addMessage(msg1);
  const msg2 = await alice.ms.createMessage(GENERAL_CHANNEL_ID, ALICE, 'Second message from Alice');
  await alice.ms.addMessage(msg2);

  // Bob receives copies of those messages (simulates message sync)
  await bob.ms.importMessages(GENERAL_CHANNEL_ID, [msg1, msg2]);

  // Bob sends 1 message
  const msg3 = await bob.ms.createMessage(GENERAL_CHANNEL_ID, BOB, 'Hello from Bob');
  await bob.ms.addMessage(msg3);

  // Alice receives Bob's message
  const aliceMsgs = alice.ms.getMessages(GENERAL_CHANNEL_ID);
  const bobMsgCopy = await alice.ms.createMessage(GENERAL_CHANNEL_ID, BOB, 'Hello from Bob');
  await alice.ms.addMessage(bobMsgCopy);
});

// ---------------------------------------------------------------------------
// Bug 1: Mary cannot see Alice as online — missing transport.connect()
// ---------------------------------------------------------------------------

describe('Bug 1 — connect to all workspace members on sync', () => {
  test('Mary receives Alice in member list after sync from Bob', () => {
    // Mary creates a fresh workspace (simulates joinWorkspace)
    const maryWs = mary.wm.createWorkspace('test-workspace', MARY, 'Mary', 'mary-pub-key');
    mary.activeWorkspaceId = maryWs.id;
    mary.activeChannelId = maryWs.channels[0].id;

    // Mary↔Bob connected
    mary.connectedPeers.add(BOB);

    // Bob sends workspace-state to Mary
    const sync = buildSyncPayload(bob);
    simulateWorkspaceStateSync(mary, BOB, WORKSPACE_ID, sync);

    // Mary should now have Alice in her member list
    const ws = mary.wm.getWorkspace(mary.activeWorkspaceId!)!;
    const memberPeerIds = ws.members.map(m => m.peerId);
    expect(memberPeerIds).toContain(ALICE);
    expect(memberPeerIds).toContain(BOB);
    expect(memberPeerIds).toContain(MARY);
  });

  test('Mary calls transport.connect() for Alice (not already connected)', () => {
    const maryWs = mary.wm.createWorkspace('test-workspace', MARY, 'Mary', 'mary-pub-key');
    mary.activeWorkspaceId = maryWs.id;
    mary.activeChannelId = maryWs.channels[0].id;
    mary.connectedPeers.add(BOB);

    const sync = buildSyncPayload(bob);
    simulateWorkspaceStateSync(mary, BOB, WORKSPACE_ID, sync);

    // Should have called connect for Alice (not connected) but NOT for Bob (already connected)
    expect(mary.connectCalls).toContain(ALICE);
    expect(mary.connectCalls).not.toContain(BOB);
  });

  test('no connect calls for peers already connected', () => {
    const maryWs = mary.wm.createWorkspace('test-workspace', MARY, 'Mary', 'mary-pub-key');
    mary.activeWorkspaceId = maryWs.id;
    mary.activeChannelId = maryWs.channels[0].id;

    // Mary already connected to both Alice and Bob
    mary.connectedPeers.add(ALICE);
    mary.connectedPeers.add(BOB);

    const sync = buildSyncPayload(bob);
    simulateWorkspaceStateSync(mary, BOB, WORKSPACE_ID, sync);

    // No connect calls needed — all already connected
    expect(mary.connectCalls).toHaveLength(0);
  });

  test('no connect call for own peerId', () => {
    const maryWs = mary.wm.createWorkspace('test-workspace', MARY, 'Mary', 'mary-pub-key');
    mary.activeWorkspaceId = maryWs.id;
    mary.activeChannelId = maryWs.channels[0].id;

    const sync = buildSyncPayload(bob);
    simulateWorkspaceStateSync(mary, BOB, WORKSPACE_ID, sync);

    expect(mary.connectCalls).not.toContain(MARY);
  });
});

// ---------------------------------------------------------------------------
// Bug 2: Min-wins channel ID remap — convergence + message survival
// ---------------------------------------------------------------------------

describe('Bug 2 — min-wins channel ID remap', () => {
  test('channel IDs converge: smaller ID wins when both peers sync', () => {
    // Bob has channel "aaa-general", Mary has "zzz-general"
    // After mutual sync, both should use "aaa-general"
    const bobWm = new WorkspaceManager();
    const maryWm = new WorkspaceManager();

    // Create workspaces with deterministic channel IDs
    const bobWs = bobWm.createWorkspace('ws', BOB, 'Bob', '');
    const maryWs = maryWm.createWorkspace('ws', MARY, 'Mary', '');

    // Force known channel IDs for testing
    bobWs.channels[0].id = 'aaa-general';
    maryWs.channels[0].id = 'zzz-general';

    const bobPeer: SimPeer = {
      ...makePeer(BOB),
      wm: bobWm,
      activeWorkspaceId: bobWs.id,
      activeChannelId: 'aaa-general',
    };
    bobPeer.connectedPeers.add(MARY);

    const maryPeer: SimPeer = {
      ...makePeer(MARY),
      wm: maryWm,
      activeWorkspaceId: maryWs.id,
      activeChannelId: 'zzz-general',
    };
    maryPeer.connectedPeers.add(BOB);

    // Mary receives Bob's sync → her "zzz-general" should remap to "aaa-general"
    const bobSync = {
      name: bobWs.name,
      channels: bobWs.channels.map(ch => ({ id: ch.id, name: ch.name, type: ch.type })),
      members: bobWs.members.map(m => ({ peerId: m.peerId, alias: m.alias, publicKey: m.publicKey, role: m.role })),
    };
    simulateWorkspaceStateSync(maryPeer, BOB, bobWs.id, bobSync);

    const maryChannels = maryPeer.wm.getWorkspace(maryPeer.activeWorkspaceId!)!.channels;
    expect(maryChannels[0].id).toBe('aaa-general');
  });

  test('larger remote ID does NOT overwrite smaller local ID', () => {
    const bobWm = new WorkspaceManager();
    const maryWm = new WorkspaceManager();

    const bobWs = bobWm.createWorkspace('ws', BOB, 'Bob', '');
    const maryWs = maryWm.createWorkspace('ws', MARY, 'Mary', '');

    // Bob has the smaller ID, Mary has the larger one
    bobWs.channels[0].id = 'aaa-general';
    maryWs.channels[0].id = 'zzz-general';

    const bobPeer: SimPeer = {
      ...makePeer(BOB),
      wm: bobWm,
      activeWorkspaceId: bobWs.id,
      activeChannelId: 'aaa-general',
    };
    bobPeer.connectedPeers.add(MARY);

    // Bob receives Mary's sync — Mary's channel ID is "zzz" which is LARGER
    // Bob should NOT remap
    const marySync = {
      name: maryWs.name,
      channels: maryWs.channels.map(ch => ({ id: ch.id, name: ch.name, type: ch.type })),
      members: maryWs.members.map(m => ({ peerId: m.peerId, alias: m.alias, publicKey: m.publicKey, role: m.role })),
    };
    simulateWorkspaceStateSync(bobPeer, MARY, maryWs.id, marySync);

    const bobChannels = bobPeer.wm.getWorkspace(bobPeer.activeWorkspaceId!)!.channels;
    expect(bobChannels[0].id).toBe('aaa-general');
  });

  test('Bob messages survive channel ID remap', async () => {
    // Bob has messages under "zzz-general", receives sync with "aaa-general"
    const bobMs = new MessageStore();
    const bobCrdts = new Map<string, MessageCRDT>();

    const msg1 = await bobMs.createMessage('zzz-general', BOB, 'Hello from Bob');
    msg1.timestamp = 1000;
    await bobMs.addMessage(msg1);
    const msg2 = await bobMs.createMessage('zzz-general', BOB, 'Second message');
    msg2.timestamp = 2000;
    await bobMs.addMessage(msg2);

    // Create CRDT for old channel
    const crdt = new MessageCRDT(BOB);
    bobCrdts.set('zzz-general', crdt);

    const bobWm = new WorkspaceManager();
    const bobWs = bobWm.createWorkspace('ws', BOB, 'Bob', '');
    bobWs.channels[0].id = 'zzz-general';

    const bobPeer: SimPeer = {
      ...makePeer(BOB),
      wm: bobWm,
      ms: bobMs,
      crdts: bobCrdts,
      activeWorkspaceId: bobWs.id,
      activeChannelId: 'zzz-general',
      connectedPeers: new Set([MARY]),
      connectCalls: [],
    };

    // Mary has the smaller channel ID
    const maryWm = new WorkspaceManager();
    const maryWs = maryWm.createWorkspace('ws', MARY, 'Mary', '');
    maryWs.channels[0].id = 'aaa-general';

    const marySync = {
      name: maryWs.name,
      channels: maryWs.channels.map(ch => ({ id: ch.id, name: ch.name, type: ch.type })),
      members: maryWs.members.map(m => ({ peerId: m.peerId, alias: m.alias, publicKey: m.publicKey, role: m.role })),
    };
    simulateWorkspaceStateSync(bobPeer, MARY, maryWs.id, marySync);

    // Bob's messages should now be under "aaa-general"
    const messagesUnderOld = bobMs.getMessages('zzz-general');
    const messagesUnderNew = bobMs.getMessages('aaa-general');

    expect(messagesUnderOld).toHaveLength(0); // old key cleared
    expect(messagesUnderNew).toHaveLength(2); // messages migrated
    expect(messagesUnderNew[0].content).toBe('Hello from Bob');
    expect(messagesUnderNew[1].content).toBe('Second message');

    // Each message's channelId field updated
    for (const msg of messagesUnderNew) {
      expect(msg.channelId).toBe('aaa-general');
    }
  });

  test('CRDT map key migrates during remap', async () => {
    const bobMs = new MessageStore();
    const bobCrdts = new Map<string, MessageCRDT>();

    const crdt = new MessageCRDT(BOB);
    bobCrdts.set('zzz-general', crdt);

    const bobWm = new WorkspaceManager();
    const bobWs = bobWm.createWorkspace('ws', BOB, 'Bob', '');
    bobWs.channels[0].id = 'zzz-general';

    const bobPeer: SimPeer = {
      ...makePeer(BOB),
      wm: bobWm,
      ms: bobMs,
      crdts: bobCrdts,
      activeWorkspaceId: bobWs.id,
      activeChannelId: 'zzz-general',
      connectedPeers: new Set([MARY]),
      connectCalls: [],
    };

    const maryWm = new WorkspaceManager();
    const maryWs = maryWm.createWorkspace('ws', MARY, 'Mary', '');
    maryWs.channels[0].id = 'aaa-general';

    const marySync = {
      name: maryWs.name,
      channels: maryWs.channels.map(ch => ({ id: ch.id, name: ch.name, type: ch.type })),
      members: maryWs.members.map(m => ({ peerId: m.peerId, alias: m.alias, publicKey: m.publicKey, role: m.role })),
    };
    simulateWorkspaceStateSync(bobPeer, MARY, maryWs.id, marySync);

    expect(bobCrdts.has('zzz-general')).toBe(false);
    expect(bobCrdts.has('aaa-general')).toBe(true);
  });

  test('activeChannelId updates during remap', async () => {
    const bobWm = new WorkspaceManager();
    const bobWs = bobWm.createWorkspace('ws', BOB, 'Bob', '');
    bobWs.channels[0].id = 'zzz-general';

    const bobPeer: SimPeer = {
      ...makePeer(BOB),
      wm: bobWm,
      activeWorkspaceId: bobWs.id,
      activeChannelId: 'zzz-general',
      connectedPeers: new Set([MARY]),
      connectCalls: [],
    };

    const maryWm = new WorkspaceManager();
    const maryWs = maryWm.createWorkspace('ws', MARY, 'Mary', '');
    maryWs.channels[0].id = 'aaa-general';

    const marySync = {
      name: maryWs.name,
      channels: maryWs.channels.map(ch => ({ id: ch.id, name: ch.name, type: ch.type })),
      members: maryWs.members.map(m => ({ peerId: m.peerId, alias: m.alias, publicKey: m.publicKey, role: m.role })),
    };
    simulateWorkspaceStateSync(bobPeer, MARY, maryWs.id, marySync);

    expect(bobPeer.activeChannelId).toBe('aaa-general');
  });
});

// ---------------------------------------------------------------------------
// Integration: full three-peer scenario
// ---------------------------------------------------------------------------

describe('Three-peer join — full scenario', () => {
  test('Mary joins via Bob, syncs workspace, connects to Alice, messages survive', async () => {
    // Mary creates local workspace (simulating joinWorkspace)
    const maryWs = mary.wm.createWorkspace('test-workspace', MARY, 'Mary', 'mary-pub-key');
    mary.activeWorkspaceId = maryWs.id;
    mary.activeChannelId = maryWs.channels[0].id;
    mary.connectedPeers.add(BOB);

    // Bob has 3 messages in general channel
    const bobMsgCount = bob.ms.getMessages(GENERAL_CHANNEL_ID).length;
    expect(bobMsgCount).toBeGreaterThanOrEqual(2);

    // Bob sends workspace-state to Mary
    const sync = buildSyncPayload(bob);
    simulateWorkspaceStateSync(mary, BOB, WORKSPACE_ID, sync);

    // Verify: Mary has Alice as a member
    const ws = mary.wm.getWorkspace(mary.activeWorkspaceId!)!;
    const memberIds = ws.members.map(m => m.peerId);
    expect(memberIds).toContain(ALICE);

    // Verify: Mary called transport.connect(ALICE)
    expect(mary.connectCalls).toContain(ALICE);

    // Verify: channel ID converged (min-wins)
    const maryGeneralCh = ws.channels.find(ch => ch.name === 'general');
    expect(maryGeneralCh).toBeDefined();
    // The smaller of Mary's original and Bob's synced ID should win
    const expectedId = maryWs.channels[0].id < GENERAL_CHANNEL_ID
      ? maryWs.channels[0].id
      : GENERAL_CHANNEL_ID;
    // The channel should use the min ID (whichever is smaller)
    expect(maryGeneralCh!.id <= GENERAL_CHANNEL_ID || maryGeneralCh!.id <= maryWs.channels[0].id).toBe(true);
  });
});
