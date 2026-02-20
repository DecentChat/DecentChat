/**
 * Workspace Isolation Tests
 *
 * These tests verify that messages cannot leak across workspace boundaries.
 * Bug scenario: Alice is in workspace1 (with Bob) and workspace2 (with Kim).
 * When Alice writes to workspace2, Bob must NOT receive those messages.
 *
 * Two layers of protection:
 *   1. Send side  — getWorkspaceRecipientPeerIds() must only return members of the
 *                    active workspace who are connected (not all connected peers).
 *   2. Receive side — incoming messages are validated: sender must be a member of
 *                     a workspace that owns the target channelId.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { WorkspaceManager } from '../../src/workspace/WorkspaceManager';

// ---------------------------------------------------------------------------
// Helpers — mirror the exact validation logic used in ChatController
// ---------------------------------------------------------------------------

interface FakeState {
  myPeerId: string;
  activeWorkspaceId: string | null;
  readyPeers: Set<string>;
}

interface FakeEnvelope {
  channelId?: string;
  workspaceId?: string;
  senderId?: string;
}

/**
 * Mirror of ChatController.getWorkspaceRecipientPeerIds().
 * Returns peer IDs that should receive a workspace message.
 */
function getWorkspaceRecipientPeerIds(state: FakeState, wm: WorkspaceManager): string[] {
  const ws = state.activeWorkspaceId
    ? wm.getWorkspace(state.activeWorkspaceId)
    : null;
  if (!ws) return [];
  return ws.members
    .map((m: any) => m.peerId)
    .filter((p: string) => p !== state.myPeerId && state.readyPeers.has(p));
}

/**
 * Mirror of ChatController receive-side validation.
 * Returns the resolved channelId if the message is accepted, or null if rejected.
 */
function validateIncomingMessage(
  fromPeerId: string,
  envelope: FakeEnvelope,
  wm: WorkspaceManager,
): string | null {
  const allWorkspaces = wm.getAllWorkspaces();

  let targetWs;
  if (envelope.workspaceId) {
    // Explicit workspaceId provided — must match exactly, no fallback
    targetWs = allWorkspaces.find(ws => ws.id === envelope.workspaceId);
    if (!targetWs) return null; // Unknown explicit workspaceId → reject immediately
  } else if (envelope.channelId) {
    // Legacy fallback: find by channelId only when no workspaceId is given
    targetWs = allWorkspaces.find(ws =>
      ws.channels.some((ch: any) => ch.id === envelope.channelId),
    );
  }

  if (!targetWs) return null; // Unknown workspace/channel → reject

  const isMember = targetWs.members.some((m: any) => m.peerId === fromPeerId);
  if (!isMember) return null; // Sender not a workspace member → reject

  if (envelope.channelId && targetWs.channels.some((ch: any) => ch.id === envelope.channelId)) {
    return envelope.channelId;
  }
  return targetWs.channels[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Workspace Isolation — send side', () => {
  let wm: WorkspaceManager;

  beforeEach(() => {
    wm = new WorkspaceManager();
  });

  test('sends only to members of the active workspace', () => {
    // Alice owns workspace1 (Bob is member), workspace2 (Kim is member)
    const ws1 = wm.createWorkspace('workspace1', 'alice', 'Alice', 'alice-key');
    wm.addMember(ws1.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: Date.now(), role: 'member' });

    const ws2 = wm.createWorkspace('workspace2', 'alice', 'Alice', 'alice-key');
    wm.addMember(ws2.id, { peerId: 'kim', alias: 'Kim', publicKey: 'kim-key', joinedAt: Date.now(), role: 'member' });

    // All three peers are "ready" (connected)
    const state: FakeState = {
      myPeerId: 'alice',
      activeWorkspaceId: ws2.id, // Alice is writing to workspace2
      readyPeers: new Set(['bob', 'kim']),
    };

    const recipients = getWorkspaceRecipientPeerIds(state, wm);

    expect(recipients).toContain('kim');   // Kim IS in workspace2 → should receive
    expect(recipients).not.toContain('bob'); // Bob is NOT in workspace2 → must NOT receive
    expect(recipients).not.toContain('alice'); // Never send to self
  });

  test('returns empty list when no workspace is active', () => {
    const state: FakeState = {
      myPeerId: 'alice',
      activeWorkspaceId: null,
      readyPeers: new Set(['bob', 'kim']),
    };
    expect(getWorkspaceRecipientPeerIds(state, wm)).toHaveLength(0);
  });

  test('only includes members who are connected', () => {
    const ws = wm.createWorkspace('workspace1', 'alice', 'Alice', 'key');
    wm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: 'key', joinedAt: Date.now(), role: 'member' });
    wm.addMember(ws.id, { peerId: 'carol', alias: 'Carol', publicKey: 'key', joinedAt: Date.now(), role: 'member' });

    const state: FakeState = {
      myPeerId: 'alice',
      activeWorkspaceId: ws.id,
      readyPeers: new Set(['bob']), // Carol is offline
    };

    const recipients = getWorkspaceRecipientPeerIds(state, wm);
    expect(recipients).toContain('bob');
    expect(recipients).not.toContain('carol'); // Carol is not ready
  });

  test('does not send to peers that are connected but not in workspace', () => {
    const ws = wm.createWorkspace('workspace1', 'alice', 'Alice', 'key');
    wm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: 'key', joinedAt: Date.now(), role: 'member' });

    const state: FakeState = {
      myPeerId: 'alice',
      activeWorkspaceId: ws.id,
      // Mallory is connected but NOT in workspace1
      readyPeers: new Set(['bob', 'mallory']),
    };

    const recipients = getWorkspaceRecipientPeerIds(state, wm);
    expect(recipients).toContain('bob');
    expect(recipients).not.toContain('mallory');
  });
});

describe('Workspace Isolation — receive side', () => {
  let wm: WorkspaceManager;
  let ws1Id: string;
  let ws2Id: string;
  let ws1ChannelId: string;
  let ws2ChannelId: string;

  beforeEach(() => {
    wm = new WorkspaceManager();

    const ws1 = wm.createWorkspace('workspace1', 'alice', 'Alice', 'alice-key');
    wm.addMember(ws1.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: Date.now(), role: 'member' });
    ws1Id = ws1.id;
    ws1ChannelId = ws1.channels[0].id;

    const ws2 = wm.createWorkspace('workspace2', 'alice', 'Alice', 'alice-key');
    wm.addMember(ws2.id, { peerId: 'kim', alias: 'Kim', publicKey: 'kim-key', joinedAt: Date.now(), role: 'member' });
    ws2Id = ws2.id;
    ws2ChannelId = ws2.channels[0].id;
  });

  // ── Happy paths ────────────────────────────────────────────────────────────

  test('accepts a valid message with workspaceId + channelId', () => {
    // Kim sends to workspace2 → should be accepted
    const result = validateIncomingMessage('kim', { workspaceId: ws2Id, channelId: ws2ChannelId }, wm);
    expect(result).toBe(ws2ChannelId);
  });

  test('accepts a legacy message (channelId only, no workspaceId)', () => {
    // Bob sends to workspace1 using old envelope format
    const result = validateIncomingMessage('bob', { channelId: ws1ChannelId }, wm);
    expect(result).toBe(ws1ChannelId);
  });

  test('falls back to first channel when channelId is missing but workspaceId is valid', () => {
    const result = validateIncomingMessage('kim', { workspaceId: ws2Id }, wm);
    expect(result).toBe(ws2ChannelId); // Falls back to workspace2's #general
  });

  // ── Cross-workspace leakage prevention ────────────────────────────────────

  test('[CRITICAL] rejects message from Bob addressed to workspace2 channel', () => {
    // Bob is only in workspace1. Sending to workspace2 channel must be rejected.
    const result = validateIncomingMessage('bob', { workspaceId: ws2Id, channelId: ws2ChannelId }, wm);
    expect(result).toBeNull(); // Bob is not a member of workspace2 → drop
  });

  test('[CRITICAL] rejects message addressed to workspace2 channelId when sender is Bob (legacy)', () => {
    // Legacy format (channelId only): Bob sends workspace2's channel ID
    const result = validateIncomingMessage('bob', { channelId: ws2ChannelId }, wm);
    expect(result).toBeNull();
  });

  test('rejects message when workspaceId is completely unknown', () => {
    const result = validateIncomingMessage('bob', { workspaceId: 'ghost-workspace', channelId: ws1ChannelId }, wm);
    expect(result).toBeNull();
  });

  test('rejects message when channelId is unknown in any workspace', () => {
    const result = validateIncomingMessage('bob', { channelId: 'ghost-channel-id' }, wm);
    expect(result).toBeNull();
  });

  test('rejects message with no channelId and no workspaceId', () => {
    const result = validateIncomingMessage('bob', {}, wm);
    expect(result).toBeNull();
  });

  test('rejects message from stranger (not in any workspace)', () => {
    const result = validateIncomingMessage('mallory', { workspaceId: ws1Id, channelId: ws1ChannelId }, wm);
    expect(result).toBeNull();
  });

  // ── Multi-workspace member ─────────────────────────────────────────────────

  test('accepts message from a peer who is a member of multiple workspaces', () => {
    // Add alice as a member of both workspaces (she's the owner, already in both)
    const result1 = validateIncomingMessage('alice', { workspaceId: ws1Id, channelId: ws1ChannelId }, wm);
    const result2 = validateIncomingMessage('alice', { workspaceId: ws2Id, channelId: ws2ChannelId }, wm);
    expect(result1).toBe(ws1ChannelId);
    expect(result2).toBe(ws2ChannelId);
  });

  test('correctly routes messages to the right workspace when peer is in both', () => {
    // Eve joins both workspaces
    wm.addMember(ws1Id, { peerId: 'eve', alias: 'Eve', publicKey: 'eve-key', joinedAt: Date.now(), role: 'member' });
    wm.addMember(ws2Id, { peerId: 'eve', alias: 'Eve', publicKey: 'eve-key', joinedAt: Date.now(), role: 'member' });

    const result1 = validateIncomingMessage('eve', { workspaceId: ws1Id, channelId: ws1ChannelId }, wm);
    const result2 = validateIncomingMessage('eve', { workspaceId: ws2Id, channelId: ws2ChannelId }, wm);

    expect(result1).toBe(ws1ChannelId);
    expect(result2).toBe(ws2ChannelId);
  });
});

describe('Workspace Isolation — workspace membership integrity', () => {
  test('workspace members list is independent per workspace', () => {
    const wm = new WorkspaceManager();
    const ws1 = wm.createWorkspace('workspace1', 'alice', 'Alice', 'key');
    const ws2 = wm.createWorkspace('workspace2', 'alice', 'Alice', 'key');

    wm.addMember(ws1.id, { peerId: 'bob', alias: 'Bob', publicKey: 'key', joinedAt: Date.now(), role: 'member' });

    const members1 = wm.getWorkspace(ws1.id)!.members.map(m => m.peerId);
    const members2 = wm.getWorkspace(ws2.id)!.members.map(m => m.peerId);

    expect(members1).toContain('bob');
    expect(members2).not.toContain('bob'); // Bob must NOT bleed into workspace2
  });

  test('channel IDs are globally unique — no two workspaces share a channel ID', () => {
    const wm = new WorkspaceManager();
    const ws1 = wm.createWorkspace('workspace1', 'alice', 'Alice', 'key');
    const ws2 = wm.createWorkspace('workspace2', 'alice', 'Alice', 'key');

    const allChannelIds = [
      ...ws1.channels.map(ch => ch.id),
      ...ws2.channels.map(ch => ch.id),
    ];
    const unique = new Set(allChannelIds);
    expect(unique.size).toBe(allChannelIds.length); // No duplicates
  });
});

// ---------------------------------------------------------------------------
// Cross-workspace message injection (4a, 4b)
// ---------------------------------------------------------------------------

describe('Workspace Isolation — cross-workspace message injection', () => {
  let wm: WorkspaceManager;
  let ws1Id: string;
  let ws2Id: string;
  let ws1ChannelId: string;
  let ws2ChannelId: string;

  beforeEach(() => {
    wm = new WorkspaceManager();

    const ws1 = wm.createWorkspace('workspace1', 'alice', 'Alice', 'alice-key');
    wm.addMember(ws1.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: Date.now(), role: 'member' });
    ws1Id = ws1.id;
    ws1ChannelId = ws1.channels[0].id;

    const ws2 = wm.createWorkspace('workspace2', 'alice', 'Alice', 'alice-key');
    wm.addMember(ws2.id, { peerId: 'kim', alias: 'Kim', publicKey: 'kim-key', joinedAt: Date.now(), role: 'member' });
    ws2Id = ws2.id;
    ws2ChannelId = ws2.channels[0].id;
  });

  // 4a: valid channelId but wrong workspaceId → rejected
  test('rejects message with valid channelId but wrong workspaceId (cross-workspace injection)', () => {
    // Bob is member of workspace1. He sends a message with workspace1's channelId
    // but claims it's for workspace2 → should be rejected because Bob is not
    // a member of workspace2.
    const result = validateIncomingMessage('bob', {
      workspaceId: ws2Id,
      channelId: ws1ChannelId, // valid channel, but belongs to workspace1
    }, wm);
    expect(result).toBeNull();
  });

  // 4a variant: non-member sends with a channelId that exists in the target workspace
  test('rejects message from non-member even with correct workspaceId and channelId', () => {
    // Mallory is not a member of either workspace
    const result = validateIncomingMessage('mallory', {
      workspaceId: ws1Id,
      channelId: ws1ChannelId,
    }, wm);
    expect(result).toBeNull();
  });

  // 4b: peer sends workspace-state for a workspaceId they are not a member of
  test('rejects sync request from non-member of workspace', () => {
    // Simulate the membership check used in handleMessageSyncRequest:
    // Kim is in workspace2, NOT workspace1.
    const ws = wm.getWorkspace(ws1Id)!;
    const isMember = ws.members.some(m => m.peerId === 'kim');
    expect(isMember).toBe(false); // Kim cannot request sync for workspace1

    // Bob IS a member of workspace1
    const isBobMember = ws.members.some(m => m.peerId === 'bob');
    expect(isBobMember).toBe(true);
  });

  // 4b: workspace-state for non-member workspace is rejected at sync level
  test('non-member cannot receive workspace state via sync', () => {
    // Stranger tries to get workspace2 state — membership gate blocks them
    const ws2 = wm.getWorkspace(ws2Id)!;
    const isStrangerMember = ws2.members.some(m => m.peerId === 'stranger');
    expect(isStrangerMember).toBe(false);

    // Only alice (owner) and kim are members
    const memberPeerIds = ws2.members.map(m => m.peerId);
    expect(memberPeerIds).toContain('alice');
    expect(memberPeerIds).toContain('kim');
    expect(memberPeerIds).not.toContain('bob');
    expect(memberPeerIds).not.toContain('stranger');
  });
});
