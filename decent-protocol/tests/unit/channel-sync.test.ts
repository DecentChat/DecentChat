/**
 * Channel Sync Tests
 *
 * Bug: Alice creates a new channel → Bob never sees it.
 *
 * Root cause: ChatController.createChannel() created the channel locally but
 * never broadcast a `channel-created` workspace-sync message to peers. And
 * handleSyncMessage() had no handler for that message type.
 *
 * Fix:
 *   1. createChannel() now broadcasts { type: 'workspace-sync', sync: { type: 'channel-created', channel } }
 *      to all connected workspace members.
 *   2. handleSyncMessage() now routes 'channel-created' → handleChannelCreated()
 *      which adds the channel to the local workspace + refreshes the sidebar.
 *
 * These tests verify the protocol-level logic in isolation:
 *   - WorkspaceManager channel creation and deduplication
 *   - Broadcast recipient selection (same as send-side isolation)
 *   - Receive-side application: unknown workspace rejected, duplicate ignored
 *   - Channel fields are preserved through the sync round-trip
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { WorkspaceManager } from '../../src/workspace/WorkspaceManager';
import type { Channel } from '../../src/workspace/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWM() {
  return new WorkspaceManager();
}

interface SimState {
  myPeerId: string;
  activeWorkspaceId: string | null;
  readyPeers: Set<string>;
}

/** Mirror of ChatController.getWorkspaceRecipientPeerIds() */
function getRecipients(state: SimState, wm: WorkspaceManager): string[] {
  const ws = state.activeWorkspaceId ? wm.getWorkspace(state.activeWorkspaceId) : null;
  if (!ws) return [];
  return ws.members
    .map((m: any) => m.peerId)
    .filter((p: string) => p !== state.myPeerId && state.readyPeers.has(p));
}

/** Mirror of ChatController.handleChannelCreated() */
function applyChannelCreated(
  workspaceId: string,
  channel: Channel,
  wm: WorkspaceManager,
): 'added' | 'duplicate' | 'unknown-workspace' {
  const ws = wm.getWorkspace(workspaceId);
  if (!ws) return 'unknown-workspace';
  if (ws.channels.find((c: Channel) => c.id === channel.id)) return 'duplicate';
  ws.channels.push(channel);
  return 'added';
}

/** Build a workspace-sync envelope for channel-created (mirrors ChatController.createChannel broadcast) */
function makeBroadcastEnvelope(workspaceId: string, channel: Channel) {
  return {
    type: 'workspace-sync',
    workspaceId,
    sync: { type: 'channel-created', channel },
  };
}

// ---------------------------------------------------------------------------
// Setup: Alice creates workspace1 with Bob and Carol as members
// ---------------------------------------------------------------------------

let wmAlice: WorkspaceManager;
let wmBob: WorkspaceManager;
let aliceState: SimState;
let WS_ID: string;

const ALICE = 'alice-peer-id';
const BOB   = 'bob-peer-id';
const CAROL = 'carol-peer-id';

beforeEach(() => {
  wmAlice = makeWM();
  wmBob   = makeWM();

  // Alice creates workspace1
  const wsAlice = wmAlice.createWorkspace('workspace1', ALICE, 'Alice', '');
  WS_ID = wsAlice.id;

  // Add Bob and Carol as members via the proper API
  wmAlice.addMember(WS_ID, { peerId: BOB,   alias: 'Bob',   publicKey: '', joinedAt: Date.now(), role: 'member' });
  wmAlice.addMember(WS_ID, { peerId: CAROL, alias: 'Carol', publicKey: '', joinedAt: Date.now(), role: 'member' });
  wmAlice.promoteMember(WS_ID, ALICE, BOB, 'admin');

  // Bob's local copy: deep-clone Alice's workspace so both start identical
  const clone = JSON.parse(JSON.stringify(wmAlice.getWorkspace(WS_ID)!));
  wmBob.importWorkspace(clone);

  aliceState = {
    myPeerId: ALICE,
    activeWorkspaceId: WS_ID,
    readyPeers: new Set([BOB, CAROL]), // both online
  };
});

// ---------------------------------------------------------------------------
// 1. Channel creation — local workspace update
// ---------------------------------------------------------------------------

describe('Channel creation — local state', () => {
  test('createChannel adds channel to workspace', () => {
    const result = wmAlice.createChannel(WS_ID, 'announcements', ALICE);
    expect(result.success).toBe(true);
    expect(result.channel).toBeDefined();
    expect(result.channel!.name).toBe('announcements');
    expect(result.channel!.type).toBe('channel');
  });

  test('created channel includes all workspace members', () => {
    const result = wmAlice.createChannel(WS_ID, 'announcements', ALICE);
    expect(result.channel!.members).toContain(ALICE);
    expect(result.channel!.members).toContain(BOB);
    expect(result.channel!.members).toContain(CAROL);
  });

  test('channel appears in workspace channels list', () => {
    wmAlice.createChannel(WS_ID, 'dev', ALICE);
    const channels = wmAlice.getChannels(WS_ID);
    expect(channels.some((c: Channel) => c.name === 'dev')).toBe(true);
  });

  test('duplicate channel name returns error', () => {
    wmAlice.createChannel(WS_ID, 'general', ALICE);
    const result = wmAlice.createChannel(WS_ID, 'general', ALICE);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already exists/i);
  });

  test('non-member cannot create channel', () => {
    const result = wmAlice.createChannel(WS_ID, 'secret', 'outsider-peer');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not a.*member/i);
  });

  test('channel creation on unknown workspace fails', () => {
    const result = wmAlice.createChannel('no-such-workspace', 'test', ALICE);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Broadcast — who gets the channel-created message?
// ---------------------------------------------------------------------------

describe('Channel creation — broadcast recipients', () => {
  test('both connected peers receive the broadcast', () => {
    const recipients = getRecipients(aliceState, wmAlice);
    expect(recipients).toContain(BOB);
    expect(recipients).toContain(CAROL);
    expect(recipients).not.toContain(ALICE); // don't send to yourself
  });

  test('offline peer is excluded from broadcast', () => {
    aliceState.readyPeers.delete(CAROL); // Carol offline
    const recipients = getRecipients(aliceState, wmAlice);
    expect(recipients).toContain(BOB);
    expect(recipients).not.toContain(CAROL);
  });

  test('no broadcast when no peers are connected', () => {
    aliceState.readyPeers.clear();
    const recipients = getRecipients(aliceState, wmAlice);
    expect(recipients).toHaveLength(0);
  });

  test('outsider peer is excluded from workspace broadcast', () => {
    aliceState.readyPeers.add('outsider-peer'); // connected but not a member
    const recipients = getRecipients(aliceState, wmAlice);
    expect(recipients).not.toContain('outsider-peer');
  });

  test('broadcast envelope has correct structure', () => {
    const result = wmAlice.createChannel(WS_ID, 'design', ALICE);
    const env = makeBroadcastEnvelope(WS_ID, result.channel!);
    expect(env.type).toBe('workspace-sync');
    expect(env.workspaceId).toBe(WS_ID);
    expect(env.sync.type).toBe('channel-created');
    expect(env.sync.channel.name).toBe('design');
    expect(env.sync.channel.id).toBeDefined();
  });

  test('broadcast envelope preserves channel fields', () => {
    const result = wmAlice.createChannel(WS_ID, 'random', ALICE);
    const ch = result.channel!;
    const env = makeBroadcastEnvelope(WS_ID, ch);
    expect(env.sync.channel.id).toBe(ch.id);
    expect(env.sync.channel.workspaceId).toBe(ch.workspaceId);
    expect(env.sync.channel.createdBy).toBe(ALICE);
    expect(env.sync.channel.members).toEqual(ch.members);
  });
});

// ---------------------------------------------------------------------------
// 3. Receive side — Bob applies the channel-created message
// ---------------------------------------------------------------------------

describe('Channel creation — receive side (Bob)', () => {
  test('Bob applies channel-created and sees the new channel', () => {
    const result = wmAlice.createChannel(WS_ID, 'alerts', ALICE);
    const outcome = applyChannelCreated(WS_ID, result.channel!, wmBob);
    expect(outcome).toBe('added');
    const channels = wmBob.getChannels(WS_ID);
    expect(channels.some((c: Channel) => c.name === 'alerts')).toBe(true);
  });

  test('Bob gets the same channel ID Alice created', () => {
    const result = wmAlice.createChannel(WS_ID, 'ops', ALICE);
    applyChannelCreated(WS_ID, result.channel!, wmBob);
    const ch = wmBob.getChannel(WS_ID, result.channel!.id);
    expect(ch).toBeDefined();
    expect(ch!.id).toBe(result.channel!.id);
  });

  test('Bob sees the channel immediately after apply (pre-render)', () => {
    wmAlice.createChannel(WS_ID, 'channel-a', ALICE);
    wmAlice.createChannel(WS_ID, 'channel-b', ALICE);
    for (const ch of wmAlice.getChannels(WS_ID)) {
      applyChannelCreated(WS_ID, ch, wmBob);
    }
    const names = wmBob.getChannels(WS_ID).map((c: Channel) => c.name);
    expect(names).toContain('channel-a');
    expect(names).toContain('channel-b');
  });

  test('receiving the same channel-created twice is a no-op', () => {
    const result = wmAlice.createChannel(WS_ID, 'dedupe-me', ALICE);
    applyChannelCreated(WS_ID, result.channel!, wmBob);
    const outcome2 = applyChannelCreated(WS_ID, result.channel!, wmBob);
    expect(outcome2).toBe('duplicate');
    const channels = wmBob.getChannels(WS_ID).filter((c: Channel) => c.name === 'dedupe-me');
    expect(channels).toHaveLength(1); // not added twice
  });

  test('channel-created for unknown workspace is rejected', () => {
    const result = wmAlice.createChannel(WS_ID, 'orphan', ALICE);
    const outcome = applyChannelCreated('nonexistent-workspace', result.channel!, wmBob);
    expect(outcome).toBe('unknown-workspace');
    // Bob's workspace is unaffected
    expect(wmBob.getChannels(WS_ID).some((c: Channel) => c.name === 'orphan')).toBe(false);
  });

  test('received channel preserves all fields', () => {
    const result = wmAlice.createChannel(WS_ID, 'preserve-me', ALICE);
    applyChannelCreated(WS_ID, result.channel!, wmBob);
    const ch = wmBob.getChannel(WS_ID, result.channel!.id)!;
    expect(ch.name).toBe('preserve-me');
    expect(ch.createdBy).toBe(ALICE);
    expect(ch.type).toBe('channel');
    expect(ch.members).toContain(ALICE);
    expect(ch.members).toContain(BOB);
  });
});

// ---------------------------------------------------------------------------
// 4. Round-trip: Alice creates → broadcasts → Bob receives → Bob's state matches Alice's
// ---------------------------------------------------------------------------

describe('Channel sync round-trip', () => {
  test('Alice and Bob end up with identical channel lists', () => {
    // Alice creates two channels
    const r1 = wmAlice.createChannel(WS_ID, 'engineering', ALICE);
    const r2 = wmAlice.createChannel(WS_ID, 'marketing', ALICE);

    // Simulated broadcast: Bob receives both
    applyChannelCreated(WS_ID, r1.channel!, wmBob);
    applyChannelCreated(WS_ID, r2.channel!, wmBob);

    const aliceChannels = wmAlice.getChannels(WS_ID).map((c: Channel) => c.id).sort();
    const bobChannels   = wmBob.getChannels(WS_ID).map((c: Channel) => c.id).sort();
    expect(bobChannels).toEqual(aliceChannels);
  });

  test('out-of-order delivery still converges to same state', () => {
    const r1 = wmAlice.createChannel(WS_ID, 'first', ALICE);
    const r2 = wmAlice.createChannel(WS_ID, 'second', ALICE);

    // Bob receives second before first (out of order)
    applyChannelCreated(WS_ID, r2.channel!, wmBob);
    applyChannelCreated(WS_ID, r1.channel!, wmBob);

    const names = wmBob.getChannels(WS_ID).map((c: Channel) => c.name);
    expect(names).toContain('first');
    expect(names).toContain('second');
  });

  test('Bob creating a channel syncs back to Alice the same way', () => {
    // Give Bob the active workspace too
    const bobState: SimState = { myPeerId: BOB, activeWorkspaceId: WS_ID, readyPeers: new Set([ALICE]) };
    const result = wmBob.createChannel(WS_ID, 'bob-channel', BOB);

    // Alice receives Bob's broadcast
    const recipients = getRecipients(bobState, wmBob);
    expect(recipients).toContain(ALICE);

    applyChannelCreated(WS_ID, result.channel!, wmAlice);
    expect(wmAlice.getChannels(WS_ID).some((c: Channel) => c.name === 'bob-channel')).toBe(true);
  });

  test('multiple creators, all channels converge on all peers', () => {
    const aliceChannel = wmAlice.createChannel(WS_ID, 'alice-news', ALICE).channel!;
    const bobChannel   = wmBob.createChannel(WS_ID, 'bob-news', BOB).channel!;

    // Cross-apply
    applyChannelCreated(WS_ID, aliceChannel, wmBob);
    applyChannelCreated(WS_ID, bobChannel,   wmAlice);

    const aliceNames = wmAlice.getChannels(WS_ID).map((c: Channel) => c.name);
    const bobNames   = wmBob.getChannels(WS_ID).map((c: Channel) => c.name);

    expect(aliceNames).toContain('alice-news');
    expect(aliceNames).toContain('bob-news');
    expect(bobNames).toContain('alice-news');
    expect(bobNames).toContain('bob-news');
  });
});
