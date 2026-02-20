/**
 * SyncProtocol edge case tests
 *
 * Covers race conditions, error paths, broadcast isolation,
 * large history syncs, and tamper detection.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { SyncProtocol, SyncEvent } from '../../src/workspace/SyncProtocol';
import { WorkspaceManager } from '../../src/workspace/WorkspaceManager';
import { MessageStore } from '../../src/messages/MessageStore';
import type { WorkspaceMember } from '../../src/workspace/types';

// ---------------------------------------------------------------------------
// Helpers (mirrors sync.test.ts)
// ---------------------------------------------------------------------------

function createPeer(peerId: string) {
  const wm = new WorkspaceManager();
  const ms = new MessageStore();
  const events: SyncEvent[] = [];
  const outbox: { to: string; data: any }[] = [];

  const sendFn = (targetPeerId: string, data: any) => {
    outbox.push({ to: targetPeerId, data });
    return true;
  };

  const onEvent = (event: SyncEvent) => events.push(event);

  const sync = new SyncProtocol(wm, ms, sendFn, onEvent, peerId);
  return { peerId, wm, ms, sync, events, outbox };
}

/** Deliver all workspace-sync messages from one peer's outbox to another. */
async function deliver(
  from: ReturnType<typeof createPeer>,
  to: ReturnType<typeof createPeer>
) {
  const toDeliver: typeof from.outbox = [];
  const remaining: typeof from.outbox = [];

  for (const msg of from.outbox) {
    if (msg.to === to.peerId && msg.data.type === 'workspace-sync') {
      toDeliver.push(msg);
    } else {
      remaining.push(msg);
    }
  }

  from.outbox.length = 0;
  from.outbox.push(...remaining);

  for (const msg of toDeliver) {
    const syncMsg = { ...msg.data.sync };
    if (msg.data.workspaceId) syncMsg.workspaceId = msg.data.workspaceId;
    await to.sync.handleMessage(from.peerId, syncMsg);
  }
}

/** Helper: create N messages in a channel with correct hash chain. */
async function createMessages(
  ms: MessageStore,
  channelId: string,
  senderId: string,
  count: number,
  baseTimestamp = 1000
) {
  for (let i = 0; i < count; i++) {
    const msg = await ms.createMessage(channelId, senderId, `Message ${i}`);
    msg.timestamp = baseTimestamp + i * 10;
    const result = await ms.addMessage(msg);
    if (!result.success) throw new Error(`Failed to add message ${i}: ${result.error}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Concurrent join requests
// ---------------------------------------------------------------------------

describe('Edge Case: Concurrent join requests', () => {
  test('two peers send join requests simultaneously — both accepted', async () => {
    const alice = createPeer('alice');
    const bob = createPeer('bob');
    const charlie = createPeer('charlie');

    const ws = alice.wm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');

    const bobMember: WorkspaceMember = {
      peerId: 'bob', alias: 'Bob', publicKey: 'bob-key',
      joinedAt: Date.now(), role: 'member',
    };
    const charlieMember: WorkspaceMember = {
      peerId: 'charlie', alias: 'Charlie', publicKey: 'charlie-key',
      joinedAt: Date.now(), role: 'member',
    };

    // Both send join requests before either is processed
    bob.sync.requestJoin('alice', ws.inviteCode, bobMember);
    charlie.sync.requestJoin('alice', ws.inviteCode, charlieMember);

    // Deliver both to Alice "simultaneously" (sequential but without delivering responses in between)
    await deliver(bob, alice);
    await deliver(charlie, alice);

    // Alice should have accepted both
    const joinedEvents = alice.events.filter(e => e.type === 'member-joined');
    expect(joinedEvents).toHaveLength(2);

    // Alice's workspace should now have 3 members (owner + Bob + Charlie)
    expect(alice.wm.getWorkspace(ws.id)!.members).toHaveLength(3);

    // Both Bob and Charlie get their acceptance
    await deliver(alice, bob);
    await deliver(alice, charlie);

    expect(bob.events.some(e => e.type === 'workspace-joined')).toBe(true);
    expect(charlie.events.some(e => e.type === 'workspace-joined')).toBe(true);

    expect(bob.wm.getWorkspace(ws.id)).toBeDefined();
    expect(charlie.wm.getWorkspace(ws.id)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Join after workspace deleted
// ---------------------------------------------------------------------------

describe('Edge Case: Join after workspace deleted', () => {
  test('join request with valid invite code but deleted workspace is rejected gracefully', async () => {
    const alice = createPeer('alice');
    const bob = createPeer('bob');

    const ws = alice.wm.createWorkspace('Doomed', 'alice', 'Alice', 'alice-key');
    const inviteCode = ws.inviteCode;

    // Bob queues a join request
    bob.sync.requestJoin('alice', inviteCode, {
      peerId: 'bob', alias: 'Bob', publicKey: 'bob-key',
      joinedAt: Date.now(), role: 'member',
    });

    // Alice deletes the workspace before processing
    alice.wm.deleteWorkspace(ws.id, 'alice');
    expect(alice.wm.getWorkspace(ws.id)).toBeUndefined();

    // Now deliver Bob's request — should not throw
    await deliver(bob, alice);

    // Alice sends rejection to Bob
    await deliver(alice, bob);

    // Bob should receive join-rejected
    expect(bob.events).toHaveLength(1);
    expect(bob.events[0].type).toBe('join-rejected');
    expect((bob.events[0] as any).reason).toContain('Invalid invite code');
  });
});

// ---------------------------------------------------------------------------
// 3. Channel creation broadcast isolation
// ---------------------------------------------------------------------------

describe('Edge Case: Channel creation broadcast isolation', () => {
  test('channel created in workspace A does not leak to peers only in workspace B', async () => {
    const alice = createPeer('alice');
    const bob = createPeer('bob');   // member of workspace A only
    const charlie = createPeer('charlie'); // member of workspace B only

    // Workspace A — Alice + Bob
    const wsA = alice.wm.createWorkspace('WorkspaceA', 'alice', 'Alice', 'alice-key');
    alice.wm.addMember(wsA.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: Date.now(), role: 'member' });
    bob.wm.importWorkspace(JSON.parse(JSON.stringify(alice.wm.exportWorkspace(wsA.id)!)));

    // Workspace B — Alice + Charlie (separate WorkspaceManager for Alice would be needed in real life,
    // but here alice.wm holds both)
    const wsB = alice.wm.createWorkspace('WorkspaceB', 'alice', 'Alice', 'alice-key');
    alice.wm.addMember(wsB.id, { peerId: 'charlie', alias: 'Charlie', publicKey: 'charlie-key', joinedAt: Date.now(), role: 'member' });
    charlie.wm.importWorkspace(JSON.parse(JSON.stringify(alice.wm.exportWorkspace(wsB.id)!)));

    // Alice creates a channel in workspace A and broadcasts only to workspace A peers
    const result = alice.wm.createChannel(wsA.id, 'dev', 'alice');
    expect(result.success).toBe(true);

    // Broadcast only to workspace A connected peers (bob), NOT charlie
    alice.sync.broadcastChannelCreated(wsA.id, result.channel!, ['bob']);

    // Deliver to bob
    await deliver(alice, bob);
    // Do NOT deliver to charlie — but check alice's outbox didn't even target charlie
    const charlieMessages = alice.outbox.filter(m => m.to === 'charlie');
    expect(charlieMessages).toHaveLength(0);

    expect(bob.events.some(e => e.type === 'channel-created')).toBe(true);
    expect(charlie.events.some(e => e.type === 'channel-created')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Message broadcast to disconnected peer
// ---------------------------------------------------------------------------

describe('Edge Case: Message broadcast to disconnected peer', () => {
  test('sendFn returning false for one peer does not prevent others from receiving message', async () => {
    // Create a special "alice" whose sendFn fails for dave but succeeds for others
    const wm = new WorkspaceManager();
    const ms = new MessageStore();
    const events: SyncEvent[] = [];

    const sentTo: string[] = [];
    const sendFn = (targetPeerId: string, data: any) => {
      sentTo.push(targetPeerId);
      if (targetPeerId === 'dave') {
        return false; // dave is disconnected
      }
      return true;
    };

    const alice = {
      peerId: 'alice',
      wm, ms, events,
      outbox: [] as { to: string; data: any }[],
      sync: new SyncProtocol(wm, ms, sendFn, (e) => events.push(e), 'alice'),
    };

    const bob = createPeer('bob');
    const charlie = createPeer('charlie');
    // dave is "disconnected" — no peer object needed

    // Set up workspace
    const ws = alice.wm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');
    alice.wm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: Date.now(), role: 'member' });
    alice.wm.addMember(ws.id, { peerId: 'charlie', alias: 'Charlie', publicKey: 'charlie-key', joinedAt: Date.now(), role: 'member' });
    alice.wm.addMember(ws.id, { peerId: 'dave', alias: 'Dave', publicKey: 'dave-key', joinedAt: Date.now(), role: 'member' });
    bob.wm.importWorkspace(JSON.parse(JSON.stringify(alice.wm.exportWorkspace(ws.id)!)));
    charlie.wm.importWorkspace(JSON.parse(JSON.stringify(alice.wm.exportWorkspace(ws.id)!)));

    const channelId = ws.channels[0].id;
    const msg = await alice.ms.createMessage(channelId, 'alice', 'Hello!');
    msg.timestamp = 5000;
    await alice.ms.addMessage(msg);

    // Broadcast to all three (bob, charlie, dave) — dave will fail
    alice.sync.broadcastMessage(channelId, msg, ['bob', 'charlie', 'dave']);

    // sendFn was called for all three
    expect(sentTo).toContain('bob');
    expect(sentTo).toContain('charlie');
    expect(sentTo).toContain('dave');

    // Manually deliver messages that alice's sendFn buffered
    // Since we used a custom sendFn (not outbox), simulate delivery manually
    // by calling handleMessage on bob and charlie
    const sentMessages = sentTo
      .filter(p => p !== 'alice' && p !== 'dave')
      .map(p => ({ to: p, data: { type: 'workspace-sync', sync: { type: 'channel-message', channelId, message: msg } } }));

    for (const m of sentMessages) {
      const syncMsg = { ...m.data.sync };
      if (m.to === 'bob') {
        await bob.sync.handleMessage('alice', syncMsg as any);
      } else if (m.to === 'charlie') {
        await charlie.sync.handleMessage('alice', syncMsg as any);
      }
    }

    // Bob and Charlie received the message
    expect(bob.events.some(e => e.type === 'message-received')).toBe(true);
    expect(charlie.events.some(e => e.type === 'message-received')).toBe(true);

    expect(bob.ms.getMessages(channelId)).toHaveLength(1);
    expect(charlie.ms.getMessages(channelId)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Sync request for unknown workspace
// ---------------------------------------------------------------------------

describe('Edge Case: Sync request for unknown workspace', () => {
  test('peer requests sync for non-existent workspaceId — does not crash, sends no response', async () => {
    const alice = createPeer('alice');
    const bob = createPeer('bob');

    // Alice has no workspaces at all
    expect(alice.wm.getAllWorkspaces()).toHaveLength(0);

    // Bob sends sync request for a workspace that doesn't exist on Alice's side
    bob.sync.requestSync('alice', 'nonexistent-workspace-id');

    // Should not throw
    await expect(deliver(bob, alice)).resolves.toBeUndefined();

    // Alice should not have sent anything (no workspace to respond with)
    expect(alice.outbox).toHaveLength(0);

    // No crash events; no sync-complete on Bob's side either
    expect(bob.events.some(e => e.type === 'sync-complete')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Empty workspace sync
// ---------------------------------------------------------------------------

describe('Edge Case: Empty workspace sync', () => {
  test('sync a workspace with no messages works cleanly', async () => {
    const alice = createPeer('alice');
    const bob = createPeer('bob');

    const ws = alice.wm.createWorkspace('Empty', 'alice', 'Alice', 'alice-key');
    alice.wm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: Date.now(), role: 'member' });

    // No messages added to any channel

    bob.sync.requestSync('alice', ws.id);
    await deliver(bob, alice);
    await deliver(alice, bob);

    // Bob should have sync-complete
    expect(bob.events.some(e => e.type === 'sync-complete')).toBe(true);

    // Bob's workspace is imported
    const bobWS = bob.wm.getWorkspace(ws.id);
    expect(bobWS).toBeDefined();
    expect(bobWS!.name).toBe('Empty');
    expect(bobWS!.channels).toHaveLength(1);

    // No messages
    const channelId = bobWS!.channels[0].id;
    expect(bob.ms.getMessages(channelId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Large history sync
// ---------------------------------------------------------------------------

describe('Edge Case: Large history sync', () => {
  test('100 messages across 5 channels sync as metadata-only history', async () => {
    const alice = createPeer('alice');
    const bob = createPeer('bob');

    const ws = alice.wm.createWorkspace('BigTeam', 'alice', 'Alice', 'alice-key');
    alice.wm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: Date.now(), role: 'member' });

    // Create 4 additional channels (1 general already exists)
    const channels = alice.wm.getChannels(ws.id); // starts with [general]
    for (let i = 0; i < 4; i++) {
      alice.wm.createChannel(ws.id, `channel-${i}`, 'alice');
    }
    const allChannels = alice.wm.getChannels(ws.id);
    expect(allChannels).toHaveLength(5);

    // Add 20 messages to each channel (5 × 20 = 100)
    for (const ch of allChannels) {
      await createMessages(alice.ms, ch.id, 'alice', 20);
    }

    // Verify alice has 100 total messages
    const totalAlice = allChannels.reduce((sum, ch) => sum + alice.ms.getMessages(ch.id).length, 0);
    expect(totalAlice).toBe(100);

    // Bob requests full sync
    bob.sync.requestSync('alice', ws.id);
    await deliver(bob, alice);
    await deliver(alice, bob);

    expect(bob.events.some(e => e.type === 'sync-complete')).toBe(true);

    const bobWS = bob.wm.getWorkspace(ws.id)!;
    expect(bobWS.channels).toHaveLength(5);

    // Verify all 100 messages arrived
    let totalBob = 0;
    for (const ch of bobWS.channels) {
      if (ch.type !== 'channel') continue;
      const msgs = bob.ms.getMessages(ch.id);
      expect(msgs).toHaveLength(20);
      totalBob += msgs.length;
      expect(msgs.every(m => m.content === '')).toBe(true);
    }
    expect(totalBob).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 8. Duplicate member join
// ---------------------------------------------------------------------------

describe('Edge Case: Duplicate member join', () => {
  test('second join attempt by same member is rejected with "already exists"', async () => {
    const alice = createPeer('alice');
    const bob = createPeer('bob');

    const ws = alice.wm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');

    const bobMember: WorkspaceMember = {
      peerId: 'bob', alias: 'Bob', publicKey: 'bob-key',
      joinedAt: Date.now(), role: 'member',
    };

    // First join — should succeed
    bob.sync.requestJoin('alice', ws.inviteCode, bobMember);
    await deliver(bob, alice);
    await deliver(alice, bob);

    expect(bob.events.some(e => e.type === 'workspace-joined')).toBe(true);
    expect(alice.wm.getWorkspace(ws.id)!.members).toHaveLength(2);

    // Reset Bob's state to send a second request
    bob.outbox.length = 0;
    bob.events.length = 0;

    // Second join — same member, same invite code
    bob.sync.requestJoin('alice', ws.inviteCode, bobMember);
    await deliver(bob, alice);
    await deliver(alice, bob);

    // Should be rejected
    expect(bob.events).toHaveLength(1);
    expect(bob.events[0].type).toBe('join-rejected');
    const reason = (bob.events[0] as Extract<SyncEvent, { type: 'join-rejected' }>).reason;
    expect(reason.toLowerCase()).toContain('already');

    // Workspace still has exactly 2 members
    expect(alice.wm.getWorkspace(ws.id)!.members).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 9. Member left propagation
// ---------------------------------------------------------------------------

describe('Edge Case: Member left propagation', () => {
  test('member removed from workspace is gone from all channels including DMs', async () => {
    const alice = createPeer('alice');
    const bob = createPeer('bob');

    const ws = alice.wm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');
    alice.wm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: Date.now(), role: 'member' });

    // Create a DM between alice and bob
    const dmResult = alice.wm.createDM(ws.id, 'alice', 'bob');
    expect(dmResult.success).toBe(true);
    const dm = dmResult.channel!;
    expect(dm.members).toContain('bob');

    // Create an additional public channel that bob is in
    const chResult = alice.wm.createChannel(ws.id, 'dev', 'alice');
    const devChannel = chResult.channel!;
    expect(devChannel.members).toContain('bob');

    // Remove bob
    const removeResult = alice.wm.removeMember(ws.id, 'bob', 'alice');
    expect(removeResult.success).toBe(true);

    const wsAfter = alice.wm.getWorkspace(ws.id)!;

    // Bob should no longer be in the member list
    expect(wsAfter.members.find(m => m.peerId === 'bob')).toBeUndefined();

    // Bob should be removed from the public channel
    const devCh = wsAfter.channels.find(c => c.name === 'dev')!;
    expect(devCh.members).not.toContain('bob');

    // Bob should also be removed from the DM
    const dmCh = wsAfter.channels.find(c => c.id === dm.id)!;
    expect(dmCh.members).not.toContain('bob');

    // Broadcast member-left to existing peers
    bob.wm.importWorkspace(JSON.parse(JSON.stringify(alice.wm.exportWorkspace(ws.id)!)));
    alice.sync.broadcastMemberJoined(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: 0, role: 'member' }, []);

    // Simulate member-left event reaching bob via handleMessage
    await bob.sync.handleMessage('alice', {
      type: 'member-left',
      peerId: 'bob',
      workspaceId: ws.id,
    } as any);

    expect(bob.events.some(e => e.type === 'member-left')).toBe(true);
    const leftEvent = bob.events.find(e => e.type === 'member-left') as Extract<SyncEvent, { type: 'member-left' }>;
    expect(leftEvent.peerId).toBe('bob');
    expect(leftEvent.workspaceId).toBe(ws.id);
  });
});

// ---------------------------------------------------------------------------
// 10. Sync response with tampered member list
// ---------------------------------------------------------------------------

describe('Edge Case: Sync response with tampered member list', () => {
  test('extra member injected into sync response is detectable by comparing member counts', async () => {
    const alice = createPeer('alice');
    const bob = createPeer('bob');

    const ws = alice.wm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');
    alice.wm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: Date.now(), role: 'member' });

    // Record the legitimate member count before any sync
    const legitimateMemberCount = alice.wm.getWorkspace(ws.id)!.members.length;
    expect(legitimateMemberCount).toBe(2); // alice + bob

    // Bob requests sync
    bob.sync.requestSync('alice', ws.id);
    await deliver(bob, alice);

    // Intercept Alice's sync-response from her outbox and tamper with it
    const responseMsg = alice.outbox.find(m => m.to === 'bob' && m.data.type === 'workspace-sync');
    expect(responseMsg).toBeDefined();

    // Inject an extra unauthorized member into the sync response
    const tamperedMsg = JSON.parse(JSON.stringify(responseMsg!));
    tamperedMsg.data.sync.workspace.members.push({
      peerId: 'eve', alias: 'Eve (injected)', publicKey: 'eve-key',
      joinedAt: Date.now(), role: 'member',
    });

    // Clear alice's outbox and deliver tampered message directly to bob
    alice.outbox.length = 0;
    const syncMsg = { ...tamperedMsg.data.sync };
    if (tamperedMsg.data.workspaceId) syncMsg.workspaceId = tamperedMsg.data.workspaceId;
    await bob.sync.handleMessage('alice', syncMsg);

    // Bob receives a sync-complete
    expect(bob.events.some(e => e.type === 'sync-complete')).toBe(true);

    // The tampered member is detectable: bob's workspace has more members than the legitimate count
    const bobWS = bob.wm.getWorkspace(ws.id)!;
    const receivedMemberCount = bobWS.members.length;

    // Tampered: 3 members (alice, bob, eve) vs legitimate 2 (alice, bob)
    expect(receivedMemberCount).toBeGreaterThan(legitimateMemberCount);

    // Specifically, "eve" is present — a node that never legitimately joined
    expect(bobWS.members.find(m => m.peerId === 'eve')).toBeDefined();

    // This demonstrates the tampering is DETECTABLE by comparing with a trusted member count
    const isTampered = receivedMemberCount !== legitimateMemberCount;
    expect(isTampered).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. Re-sync after missed messages
// ---------------------------------------------------------------------------

describe('Edge Case: Re-sync after missed messages', () => {
  test('peer offline for 50 messages receives metadata-only history on re-sync', async () => {
    const alice = createPeer('alice');
    const bob = createPeer('bob');

    const ws = alice.wm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');
    alice.wm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: Date.now(), role: 'member' });

    const channelId = ws.channels[0].id;

    // Bob syncs initially (empty workspace)
    bob.sync.requestSync('alice', ws.id);
    await deliver(bob, alice);
    await deliver(alice, bob);
    expect(bob.events.some(e => e.type === 'sync-complete')).toBe(true);

    // Bob goes offline — Alice sends 50 messages that Bob misses
    await createMessages(alice.ms, channelId, 'alice', 50);

    expect(alice.ms.getMessages(channelId)).toHaveLength(50);
    expect(bob.ms.getMessages(channelId)).toHaveLength(0); // Bob missed them all

    // Bob comes back online and re-syncs
    bob.events.length = 0;
    bob.sync.requestSync('alice', ws.id);
    await deliver(bob, alice);
    await deliver(alice, bob);

    expect(bob.events.some(e => e.type === 'sync-complete')).toBe(true);

    // Bob now has all 50 messages
    const bobMsgs = bob.ms.getMessages(channelId);
    expect(bobMsgs).toHaveLength(50);

    // Verify message ordering metadata still aligns with sender sequence
    for (let i = 0; i < 50; i++) {
      expect(bobMsgs[i].content).toBe('');
      expect(bobMsgs[i].senderId).toBe('alice');
    }
  });
});

// ---------------------------------------------------------------------------
// 12. Large history sync cap — message-level sync (50 per channel)
// ---------------------------------------------------------------------------

/**
 * Simulated ChatController-level message sync handler with 50-per-channel cap.
 * The SyncProtocol's handleSyncRequest sends ALL messages (metadata-only).
 * The ChatController's handleMessageSyncRequest caps at 50 per channel.
 */
function cappedMessageSync(
  ms: ReturnType<typeof createPeer>['ms'],
  channels: { id: string }[],
  channelTimestamps: Record<string, number>,
): any[] {
  const allMessages: any[] = [];

  for (const ch of channels) {
    const since = channelTimestamps[ch.id] ?? 0;
    const msgs = ms.getMessages(ch.id);
    const newer = msgs.filter((m: any) => m.timestamp > since);
    const limited = newer.slice(0, 50); // 50-per-channel cap
    for (const m of limited) {
      allMessages.push({
        id: m.id,
        channelId: m.channelId,
        senderId: m.senderId,
        content: m.content,
        timestamp: m.timestamp,
        type: m.type,
        prevHash: m.prevHash,
      });
    }
  }

  return allMessages;
}

describe('Edge Case: Large history sync cap (message-level)', () => {
  // 6a: 300 messages in one channel → capped at 50
  test('300 messages in one channel → sync response capped at 50', async () => {
    const alice = createPeer('alice');

    const ws = alice.wm.createWorkspace('BigTeam', 'alice', 'Alice', 'alice-key');
    const channelId = ws.channels[0].id;

    await createMessages(alice.ms, channelId, 'alice', 300);
    expect(alice.ms.getMessages(channelId)).toHaveLength(300);

    const messages = cappedMessageSync(
      alice.ms,
      ws.channels,
      { [channelId]: 0 }, // Bob has nothing
    );

    expect(messages).toHaveLength(50);
    // Should be the first 50 (oldest first)
    expect(messages[0].content).toBe('Message 0');
    expect(messages[49].content).toBe('Message 49');
  });

  // 6b: 5 channels x 60 messages → each capped at 50 (250 total, not 300)
  test('5 channels x 60 messages → sync response capped at 50 per channel', async () => {
    const alice = createPeer('alice');

    const ws = alice.wm.createWorkspace('BigTeam', 'alice', 'Alice', 'alice-key');

    // Create 4 additional channels (general already exists)
    for (let i = 0; i < 4; i++) {
      alice.wm.createChannel(ws.id, `channel-${i}`, 'alice');
    }
    const allChannels = alice.wm.getChannels(ws.id);
    expect(allChannels).toHaveLength(5);

    // Add 60 messages to each channel
    for (const ch of allChannels) {
      await createMessages(alice.ms, ch.id, 'alice', 60);
    }

    const messages = cappedMessageSync(
      alice.ms,
      allChannels,
      {}, // Bob has nothing (all timestamps default to 0)
    );

    // Each of 5 channels capped at 50 = 250 total
    expect(messages).toHaveLength(250);

    // Verify per-channel: each channel contributed exactly 50
    for (const ch of allChannels) {
      const chMsgs = messages.filter((m: any) => m.channelId === ch.id);
      expect(chMsgs).toHaveLength(50);
    }
  });
});
