/**
 * SyncProtocol tests — P2P workspace synchronization
 * 
 * Simulates two peers exchanging sync messages without any network.
 * Each peer has their own WorkspaceManager + MessageStore + SyncProtocol.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { SyncProtocol, SyncEvent } from '../../src/workspace/SyncProtocol';
import { WorkspaceManager } from '../../src/workspace/WorkspaceManager';
import { MessageStore } from '../../src/messages/MessageStore';

/**
 * Creates a simulated peer with its own managers and sync protocol.
 * Messages sent by this peer are captured in `outbox` for manual delivery.
 */
function createPeer(peerId: string) {
  const wm = new WorkspaceManager();
  const ms = new MessageStore();
  const events: SyncEvent[] = [];
  const outbox: { to: string; data: any }[] = [];

  const sendFn = (targetPeerId: string, data: any) => {
    outbox.push({ to: targetPeerId, data });
    return true;
  };

  const onEvent = (event: SyncEvent) => {
    events.push(event);
  };

  const sync = new SyncProtocol(wm, ms, sendFn, onEvent, peerId);

  return { peerId, wm, ms, sync, events, outbox };
}

/**
 * Deliver all messages from one peer's outbox to another peer's sync handler
 */
async function deliver(from: ReturnType<typeof createPeer>, to: ReturnType<typeof createPeer>) {
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

// === Join Flow Tests ===

describe('SyncProtocol - Join Flow', () => {
  let alice: ReturnType<typeof createPeer>;
  let bob: ReturnType<typeof createPeer>;

  beforeEach(() => {
    alice = createPeer('alice');
    bob = createPeer('bob');
  });

  test('complete join flow: request → accept → workspace synced', async () => {
    // Alice creates workspace
    const ws = alice.wm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');

    // Bob sends join request
    bob.sync.requestJoin('alice', ws.inviteCode, {
      peerId: 'bob', alias: 'Bob', publicKey: 'bob-key',
      joinedAt: Date.now(), role: 'member',
    });

    // Deliver Bob's request to Alice
    await deliver(bob, alice);

    // Alice should have processed it and sent acceptance
    expect(alice.events).toHaveLength(1);
    expect(alice.events[0].type).toBe('member-joined');

    // Alice's workspace should now have Bob
    expect(alice.wm.getWorkspace(ws.id)!.members).toHaveLength(2);

    // Deliver Alice's acceptance to Bob
    await deliver(alice, bob);

    // Bob should have the workspace now
    expect(bob.events).toHaveLength(1);
    expect(bob.events[0].type).toBe('workspace-joined');

    const bobWS = bob.wm.getWorkspace(ws.id);
    expect(bobWS).toBeDefined();
    expect(bobWS!.name).toBe('Team');
    expect(bobWS!.members).toHaveLength(2);
    expect(bobWS!.channels).toHaveLength(1);
    expect(bobWS!.channels[0].name).toBe('general');
  });

  test('join with invalid invite code is rejected', async () => {
    alice.wm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');

    bob.sync.requestJoin('alice', 'WRONGCODE', {
      peerId: 'bob', alias: 'Bob', publicKey: 'bob-key',
      joinedAt: Date.now(), role: 'member',
    });

    await deliver(bob, alice);
    await deliver(alice, bob);

    // Bob should get rejection
    expect(bob.events).toHaveLength(1);
    expect(bob.events[0].type).toBe('join-rejected');
    expect((bob.events[0] as any).reason).toContain('Invalid invite code');
  });

  test('join syncs message history', async () => {
    const ws = alice.wm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');
    const channelId = ws.channels[0].id;

    // Alice sends some messages
    for (let i = 0; i < 3; i++) {
      const msg = await alice.ms.createMessage(channelId, 'alice', `Message ${i}`);
      msg.timestamp = 1000 + i * 100;
      await alice.ms.addMessage(msg);
    }

    // Bob joins
    bob.sync.requestJoin('alice', ws.inviteCode, {
      peerId: 'bob', alias: 'Bob', publicKey: 'bob-key',
      joinedAt: Date.now(), role: 'member',
    });

    await deliver(bob, alice);
    await deliver(alice, bob);

    // Bob should have the messages
    const bobMessages = bob.ms.getMessages(channelId);
    expect(bobMessages).toHaveLength(3);
    // Sync history intentionally omits plaintext content.
    expect(bobMessages[0].content).toBe('');
    expect(bobMessages[2].content).toBe('');
    expect(bobMessages[0].senderId).toBe('alice');
    expect(bobMessages[2].prevHash).toBeDefined();
  });

  test('duplicate join is rejected', async () => {
    const ws = alice.wm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');

    // Bob joins first time
    bob.sync.requestJoin('alice', ws.inviteCode, {
      peerId: 'bob', alias: 'Bob', publicKey: 'bob-key',
      joinedAt: Date.now(), role: 'member',
    });
    await deliver(bob, alice);
    await deliver(alice, bob);

    // Bob tries to join again
    bob.outbox.length = 0;
    bob.events.length = 0;

    bob.sync.requestJoin('alice', ws.inviteCode, {
      peerId: 'bob', alias: 'Bob', publicKey: 'bob-key',
      joinedAt: Date.now(), role: 'member',
    });
    await deliver(bob, alice);
    await deliver(alice, bob);

    expect(bob.events).toHaveLength(1);
    expect(bob.events[0].type).toBe('join-rejected');
  });
});

// === Broadcasting Tests ===

describe('SyncProtocol - Broadcasting', () => {
  let alice: ReturnType<typeof createPeer>;
  let bob: ReturnType<typeof createPeer>;
  let charlie: ReturnType<typeof createPeer>;

  beforeEach(() => {
    alice = createPeer('alice');
    bob = createPeer('bob');
    charlie = createPeer('charlie');

    // Set up workspace with all three members
    const ws = alice.wm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');
    alice.wm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: Date.now(), role: 'member' });
    alice.wm.addMember(ws.id, { peerId: 'charlie', alias: 'Charlie', publicKey: 'charlie-key', joinedAt: Date.now(), role: 'member' });

    // Clone workspace to Bob and Charlie
    bob.wm.importWorkspace(JSON.parse(JSON.stringify(alice.wm.exportWorkspace(ws.id)!)));
    charlie.wm.importWorkspace(JSON.parse(JSON.stringify(alice.wm.exportWorkspace(ws.id)!)));
  });

  test('broadcasts member joined to all peers', async () => {
    const ws = alice.wm.getAllWorkspaces()[0];
    const newMember = { peerId: 'dave', alias: 'Dave', publicKey: 'dave-key', joinedAt: Date.now(), role: 'member' as const };

    alice.sync.broadcastMemberJoined(ws.id, newMember, ['bob', 'charlie']);

    expect(alice.outbox).toHaveLength(2);
    expect(alice.outbox[0].to).toBe('bob');
    expect(alice.outbox[1].to).toBe('charlie');

    // Deliver to Bob
    await deliver(alice, bob);
    expect(bob.events).toHaveLength(1);
    expect(bob.events[0].type).toBe('member-joined');
  });

  test('broadcasts channel creation', async () => {
    const ws = alice.wm.getAllWorkspaces()[0];
    const result = alice.wm.createChannel(ws.id, 'random', 'alice');

    alice.sync.broadcastChannelCreated(ws.id, result.channel!, ['bob', 'charlie']);

    // Deliver to both
    await deliver(alice, bob);
    await deliver(alice, charlie);

    expect(bob.events.some(e => e.type === 'channel-created')).toBe(true);
    expect(charlie.events.some(e => e.type === 'channel-created')).toBe(true);
  });

  test('broadcasts message to workspace peers', async () => {
    const ws = alice.wm.getAllWorkspaces()[0];
    const channelId = ws.channels[0].id;

    const msg = await alice.ms.createMessage(channelId, 'alice', 'Hello everyone!');
    msg.timestamp = 5000;
    await alice.ms.addMessage(msg);

    alice.sync.broadcastMessage(channelId, msg, ['bob', 'charlie']);

    expect(alice.outbox).toHaveLength(2);

    // Deliver to Bob
    await deliver(alice, bob);

    // Wait for async addMessage
    await new Promise(r => setTimeout(r, 10));

    expect(bob.events.some(e => e.type === 'message-received')).toBe(true);
    const bobMsgs = bob.ms.getMessages(channelId);
    expect(bobMsgs).toHaveLength(1);
    expect(bobMsgs[0].content).toBe('Hello everyone!');
  });

  test('does not broadcast to self', async () => {
    const ws = alice.wm.getAllWorkspaces()[0];
    const newMember = { peerId: 'dave', alias: 'Dave', publicKey: 'dave-key', joinedAt: Date.now(), role: 'member' as const };

    alice.sync.broadcastMemberJoined(ws.id, newMember, ['alice', 'bob']);

    // Should only send to bob, not to self
    expect(alice.outbox).toHaveLength(1);
    expect(alice.outbox[0].to).toBe('bob');
  });
});

// === Sync Request/Response Tests ===

describe('SyncProtocol - Full Sync', () => {
  test('peer requests and receives full workspace sync', async () => {
    const alice = createPeer('alice');
    const bob = createPeer('bob');

    // Alice has workspace with messages
    const ws = alice.wm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');
    alice.wm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: Date.now(), role: 'member' });
    alice.wm.createChannel(ws.id, 'dev', 'alice');

    const channels = alice.wm.getChannels(ws.id);
    for (const ch of channels) {
      for (let i = 0; i < 2; i++) {
        const msg = await alice.ms.createMessage(ch.id, 'alice', `${ch.name} msg ${i}`);
        msg.timestamp = 1000 + i * 100;
        await alice.ms.addMessage(msg);
      }
    }

    // Bob requests sync
    bob.sync.requestSync('alice', ws.id);
    await deliver(bob, alice);
    await deliver(alice, bob);

    // Bob should have everything
    expect(bob.events.some(e => e.type === 'sync-complete')).toBe(true);

    const bobWS = bob.wm.getWorkspace(ws.id)!;
    expect(bobWS.name).toBe('Team');
    expect(bobWS.channels).toHaveLength(2); // general + dev

    for (const ch of bobWS.channels) {
      const msgs = bob.ms.getMessages(ch.id);
      expect(msgs).toHaveLength(2);
    }
  });

  test('sync imports metadata-only history even if original plaintext was tampered', async () => {
    const alice = createPeer('alice');
    const bob = createPeer('bob');

    const ws = alice.wm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');
    const channelId = ws.channels[0].id;

    // Build legitimate chain
    for (let i = 0; i < 3; i++) {
      const msg = await alice.ms.createMessage(channelId, 'alice', `Msg ${i}`);
      msg.timestamp = 1000 + i * 100;
      await alice.ms.addMessage(msg);
    }

    // Tamper with Alice's messages before sync
    const msgs = alice.ms.getMessages(channelId);
    msgs[1].content = 'TAMPERED BY ALICE';

    // Bob requests sync
    bob.sync.requestSync('alice', ws.id);
    await deliver(bob, alice);
    await deliver(alice, bob);

    // Metadata-only sync does not include plaintext content, so it cannot validate content tampering.
    const bobMsgs = bob.ms.getMessages(channelId);
    expect(bobMsgs).toHaveLength(3);
    expect(bobMsgs.every((m) => m.content === '')).toBe(true);
  });
});

// === Three-Peer Scenarios ===

describe('SyncProtocol - Three Peers', () => {
  test('new member joins and gets full state from any existing member', async () => {
    const alice = createPeer('alice');
    const bob = createPeer('bob');
    const charlie = createPeer('charlie');

    // Alice creates workspace, Bob joins via Alice
    const ws = alice.wm.createWorkspace('Team', 'alice', 'Alice', 'key');

    bob.sync.requestJoin('alice', ws.inviteCode, {
      peerId: 'bob', alias: 'Bob', publicKey: 'bob-key',
      joinedAt: Date.now(), role: 'member',
    });
    await deliver(bob, alice);
    await deliver(alice, bob);

    // Alice adds messages
    const channelId = ws.channels[0].id;
    const msg = await alice.ms.createMessage(channelId, 'alice', 'Hello team');
    msg.timestamp = 5000;
    await alice.ms.addMessage(msg);

    // Now Charlie joins via Bob (not Alice!)
    // But Bob needs the message first
    bob.sync.requestSync('alice', ws.id);
    await deliver(bob, alice);
    await deliver(alice, bob);

    // Charlie joins via Bob
    charlie.sync.requestJoin('bob', ws.inviteCode, {
      peerId: 'charlie', alias: 'Charlie', publicKey: 'charlie-key',
      joinedAt: Date.now(), role: 'member',
    });
    await deliver(charlie, bob);
    await deliver(bob, charlie);

    // Charlie should have workspace + messages
    const charlieWS = charlie.wm.getWorkspace(ws.id);
    expect(charlieWS).toBeDefined();
    expect(charlieWS!.members.length).toBeGreaterThanOrEqual(2);

    const charlieMsgs = charlie.ms.getMessages(channelId);
    expect(charlieMsgs).toHaveLength(1);
    expect(charlieMsgs[0].content).toBe('');
  });
});
