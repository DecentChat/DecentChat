/**
 * Workspace, Channel, DM, and Thread tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { WorkspaceManager } from '../../src/workspace/WorkspaceManager';
import { MessageStore } from '../../src/messages/MessageStore';
import { GENESIS_HASH } from '../../src/crypto/HashChain';

describe('WorkspaceManager', () => {
  let wm: WorkspaceManager;

  beforeEach(() => {
    wm = new WorkspaceManager();
  });

  // === Workspace CRUD ===

  test('creates workspace with owner and #general channel', () => {
    const ws = wm.createWorkspace('Test Team', 'alice', 'Alice', 'alice-pubkey');

    expect(ws.name).toBe('Test Team');
    expect(ws.createdBy).toBe('alice');
    expect(ws.members).toHaveLength(1);
    expect(ws.members[0].peerId).toBe('alice');
    expect(ws.members[0].role).toBe('owner');
    expect(ws.channels).toHaveLength(1);
    expect(ws.channels[0].name).toBe('general');
    expect(ws.inviteCode.length).toBe(8);
  });

  test('retrieves workspace by id', () => {
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'key');
    const retrieved = wm.getWorkspace(ws.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe('Team');
  });

  test('lists all workspaces', () => {
    wm.createWorkspace('Team 1', 'alice', 'Alice', 'key');
    wm.createWorkspace('Team 2', 'alice', 'Alice', 'key');
    expect(wm.getAllWorkspaces()).toHaveLength(2);
  });

  test('owner can delete workspace', () => {
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'key');
    expect(wm.deleteWorkspace(ws.id, 'alice')).toBe(true);
    expect(wm.getWorkspace(ws.id)).toBeUndefined();
  });

  test('non-owner cannot delete workspace', () => {
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'key');
    expect(wm.deleteWorkspace(ws.id, 'bob')).toBe(false);
    expect(wm.getWorkspace(ws.id)).toBeDefined();
  });

  // === Member Management ===

  test('adds member to workspace', () => {
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'key');
    const result = wm.addMember(ws.id, {
      peerId: 'bob', alias: 'Bob', publicKey: 'bob-key',
      joinedAt: Date.now(), role: 'member',
    });

    expect(result.success).toBe(true);
    expect(wm.getWorkspace(ws.id)!.members).toHaveLength(2);
  });

  test('new member is added to all public channels', () => {
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'key');
    wm.createChannel(ws.id, 'random', 'alice');

    wm.addMember(ws.id, {
      peerId: 'bob', alias: 'Bob', publicKey: 'bob-key',
      joinedAt: Date.now(), role: 'member',
    });

    const channels = wm.getChannels(ws.id);
    for (const ch of channels) {
      expect(ch.members).toContain('bob');
    }
  });

  test('rejects duplicate member', () => {
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'key');
    const result = wm.addMember(ws.id, {
      peerId: 'alice', alias: 'Alice2', publicKey: 'key2',
      joinedAt: Date.now(), role: 'member',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
  });

  test('owner can remove member', () => {
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'key');
    wm.addMember(ws.id, {
      peerId: 'bob', alias: 'Bob', publicKey: 'key',
      joinedAt: Date.now(), role: 'member',
    });

    const result = wm.removeMember(ws.id, 'bob', 'alice');
    expect(result.success).toBe(true);
    expect(wm.getWorkspace(ws.id)!.members).toHaveLength(1);
  });

  test('non-owner cannot remove member', () => {
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'key');
    wm.addMember(ws.id, {
      peerId: 'bob', alias: 'Bob', publicKey: 'key',
      joinedAt: Date.now(), role: 'member',
    });

    const result = wm.removeMember(ws.id, 'bob', 'bob'); // bob tries to remove himself via owner action
    expect(result.success).toBe(false);
  });

  test('cannot remove owner', () => {
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'key');
    const result = wm.removeMember(ws.id, 'alice', 'alice');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot remove owner');
  });

  test('removed member is removed from all channels', () => {
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'key');
    wm.addMember(ws.id, {
      peerId: 'bob', alias: 'Bob', publicKey: 'key',
      joinedAt: Date.now(), role: 'member',
    });
    wm.createChannel(ws.id, 'random', 'alice');

    wm.removeMember(ws.id, 'bob', 'alice');

    for (const ch of wm.getChannels(ws.id)) {
      expect(ch.members).not.toContain('bob');
    }
  });

  // === Channel Management ===

  test('creates channel in workspace', () => {
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'key');
    const result = wm.createChannel(ws.id, 'random', 'alice');

    expect(result.success).toBe(true);
    expect(result.channel!.name).toBe('random');
    expect(result.channel!.type).toBe('channel');
    expect(wm.getChannels(ws.id)).toHaveLength(2); // general + random
  });

  test('rejects duplicate channel name', () => {
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'key');
    wm.createChannel(ws.id, 'random', 'alice');
    const result = wm.createChannel(ws.id, 'random', 'alice');

    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
  });

  test('non-member cannot create channel', () => {
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'key');
    const result = wm.createChannel(ws.id, 'hacker-channel', 'eve');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Not a workspace member');
  });

  // === DM Management ===

  test('creates DM between two members', () => {
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'key');
    wm.addMember(ws.id, {
      peerId: 'bob', alias: 'Bob', publicKey: 'key',
      joinedAt: Date.now(), role: 'member',
    });

    const result = wm.createDM(ws.id, 'alice', 'bob');

    expect(result.success).toBe(true);
    expect(result.channel!.type).toBe('dm');
    expect(result.channel!.members).toHaveLength(2);
    expect(result.channel!.members).toContain('alice');
    expect(result.channel!.members).toContain('bob');
  });

  test('returns existing DM if already created', () => {
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'key');
    wm.addMember(ws.id, {
      peerId: 'bob', alias: 'Bob', publicKey: 'key',
      joinedAt: Date.now(), role: 'member',
    });

    const dm1 = wm.createDM(ws.id, 'alice', 'bob');
    const dm2 = wm.createDM(ws.id, 'bob', 'alice'); // Same pair, different order

    expect(dm1.channel!.id).toBe(dm2.channel!.id);
  });

  test('lists DMs for a member', () => {
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'key');
    wm.addMember(ws.id, {
      peerId: 'bob', alias: 'Bob', publicKey: 'key',
      joinedAt: Date.now(), role: 'member',
    });
    wm.addMember(ws.id, {
      peerId: 'charlie', alias: 'Charlie', publicKey: 'key',
      joinedAt: Date.now(), role: 'member',
    });

    wm.createDM(ws.id, 'alice', 'bob');
    wm.createDM(ws.id, 'alice', 'charlie');

    const aliceDMs = wm.getDMs(ws.id, 'alice');
    expect(aliceDMs).toHaveLength(2);

    const bobDMs = wm.getDMs(ws.id, 'bob');
    expect(bobDMs).toHaveLength(1);
  });

  test('DMs are not visible to non-participants', () => {
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'key');
    wm.addMember(ws.id, {
      peerId: 'bob', alias: 'Bob', publicKey: 'key',
      joinedAt: Date.now(), role: 'member',
    });
    wm.addMember(ws.id, {
      peerId: 'eve', alias: 'Eve', publicKey: 'key',
      joinedAt: Date.now(), role: 'member',
    });

    wm.createDM(ws.id, 'alice', 'bob');

    const eveDMs = wm.getDMs(ws.id, 'eve');
    expect(eveDMs).toHaveLength(0);
  });

  // === Invite System ===

  test('validates correct invite code', () => {
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'key');
    const found = wm.validateInviteCode(ws.inviteCode);

    expect(found).toBeDefined();
    expect(found!.id).toBe(ws.id);
  });

  test('rejects invalid invite code', () => {
    wm.createWorkspace('Team', 'alice', 'Alice', 'key');
    const found = wm.validateInviteCode('INVALID0');

    expect(found).toBeUndefined();
  });

  // === Sync ===

  test('exports and imports workspace', () => {
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'key');
    wm.addMember(ws.id, {
      peerId: 'bob', alias: 'Bob', publicKey: 'key',
      joinedAt: Date.now(), role: 'member',
    });
    wm.createChannel(ws.id, 'random', 'alice');

    const exported = wm.exportWorkspace(ws.id);
    expect(exported).toBeDefined();

    // Import into a new manager (simulates sync to another peer)
    const wm2 = new WorkspaceManager();
    wm2.importWorkspace(exported!);

    const imported = wm2.getWorkspace(ws.id);
    expect(imported).toBeDefined();
    expect(imported!.name).toBe('Team');
    expect(imported!.members).toHaveLength(2);
    expect(imported!.channels).toHaveLength(2); // general + random
  });
});

// === Channel-Scoped Messaging with Integrity ===

describe('Channel Messaging with Integrity', () => {
  let store: MessageStore;

  beforeEach(() => {
    store = new MessageStore();
  });

  test('messages in different channels have independent hash chains', async () => {
    const msg1 = await store.createMessage('ch-general', 'alice', 'Hello general');
    msg1.timestamp = 1000;
    await store.addMessage(msg1);

    const msg2 = await store.createMessage('ch-random', 'alice', 'Hello random');
    msg2.timestamp = 1001;
    await store.addMessage(msg2);

    // Both first messages should have genesis hash
    expect(store.getMessages('ch-general')[0].prevHash).toBe(GENESIS_HASH);
    expect(store.getMessages('ch-random')[0].prevHash).toBe(GENESIS_HASH);

    // Both chains should be valid independently
    expect((await store.verifyChannel('ch-general')).valid).toBe(true);
    expect((await store.verifyChannel('ch-random')).valid).toBe(true);
  });

  test('tampering in one channel does not affect another', async () => {
    // Build two channels
    for (let i = 0; i < 3; i++) {
      const msg = await store.createMessage('ch-1', 'alice', `Ch1 msg ${i}`);
      msg.timestamp = 1000 + i * 100;
      await store.addMessage(msg);
    }

    for (let i = 0; i < 3; i++) {
      const msg = await store.createMessage('ch-2', 'bob', `Ch2 msg ${i}`);
      msg.timestamp = 1000 + i * 100;
      await store.addMessage(msg);
    }

    // Tamper with ch-1
    const ch1Messages = store.getMessages('ch-1').map(m => ({ ...m }));
    ch1Messages[1].content = 'TAMPERED';
    const importResult = await store.importMessages('ch-1-tampered', ch1Messages);
    expect(importResult.success).toBe(false);

    // ch-2 should still be valid
    expect((await store.verifyChannel('ch-2')).valid).toBe(true);
  });

  test('thread messages maintain channel hash chain', async () => {
    const parent = await store.createMessage('ch-1', 'alice', 'Start discussion');
    parent.timestamp = 1000;
    await store.addMessage(parent);

    const reply1 = await store.createMessage('ch-1', 'bob', 'Thread reply 1', 'text', parent.id);
    reply1.timestamp = 2000;
    await store.addMessage(reply1);

    const mainMsg = await store.createMessage('ch-1', 'charlie', 'Back to main channel');
    mainMsg.timestamp = 3000;
    await store.addMessage(mainMsg);

    const reply2 = await store.createMessage('ch-1', 'alice', 'Thread reply 2', 'text', parent.id);
    reply2.timestamp = 4000;
    await store.addMessage(reply2);

    // Full channel chain valid
    expect((await store.verifyChannel('ch-1')).valid).toBe(true);
    expect(store.getMessages('ch-1')).toHaveLength(4);

    // Thread filter works
    const thread = store.getThread('ch-1', parent.id);
    expect(thread).toHaveLength(2);
    expect(thread[0].content).toBe('Thread reply 1');
    expect(thread[1].content).toBe('Thread reply 2');
  });
});

// === Multi-peer Workspace Scenarios ===

describe('Multi-Peer Scenarios', () => {
  let wm: WorkspaceManager;

  beforeEach(() => {
    wm = new WorkspaceManager();
  });

  test('full workflow: create workspace → invite → channels → DMs', () => {
    // Alice creates workspace
    const ws = wm.createWorkspace('Startup Team', 'alice', 'Alice', 'alice-key');

    // Bob joins
    wm.addMember(ws.id, {
      peerId: 'bob', alias: 'Bob', publicKey: 'bob-key',
      joinedAt: Date.now(), role: 'member',
    });

    // Charlie joins
    wm.addMember(ws.id, {
      peerId: 'charlie', alias: 'Charlie', publicKey: 'charlie-key',
      joinedAt: Date.now(), role: 'member',
    });

    // Bob gets admin role, then both owner/admin create channels
    wm.promoteMember(ws.id, 'alice', 'bob', 'admin');
    wm.createChannel(ws.id, 'engineering', 'alice');
    wm.createChannel(ws.id, 'random', 'bob');

    // Create DMs
    wm.createDM(ws.id, 'alice', 'bob');
    wm.createDM(ws.id, 'bob', 'charlie');

    // Verify state
    const workspace = wm.getWorkspace(ws.id)!;
    expect(workspace.members).toHaveLength(3);
    expect(wm.getChannels(ws.id)).toHaveLength(3); // general, engineering, random
    expect(wm.getDMs(ws.id, 'alice')).toHaveLength(1);
    expect(wm.getDMs(ws.id, 'bob')).toHaveLength(2);
    expect(wm.getDMs(ws.id, 'charlie')).toHaveLength(1);

    // All channels have all members
    for (const ch of wm.getChannels(ws.id)) {
      expect(ch.members).toContain('alice');
      expect(ch.members).toContain('bob');
      expect(ch.members).toContain('charlie');
    }
  });

  test('member removal cascades to channels and DMs', () => {
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'key');
    wm.addMember(ws.id, {
      peerId: 'bob', alias: 'Bob', publicKey: 'key',
      joinedAt: Date.now(), role: 'member',
    });
    wm.addMember(ws.id, {
      peerId: 'charlie', alias: 'Charlie', publicKey: 'key',
      joinedAt: Date.now(), role: 'member',
    });

    wm.createChannel(ws.id, 'project', 'alice');
    wm.createDM(ws.id, 'alice', 'bob');

    // Remove bob
    wm.removeMember(ws.id, 'bob', 'alice');

    // Bob should be removed from all channels
    for (const ch of wm.getChannels(ws.id)) {
      expect(ch.members).not.toContain('bob');
    }

    // Workspace should have 2 members
    expect(wm.getWorkspace(ws.id)!.members).toHaveLength(2);
  });

  test('workspace sync between peers preserves full state', () => {
    // Alice's manager
    const aliceWM = new WorkspaceManager();
    const ws = aliceWM.createWorkspace('Team', 'alice', 'Alice', 'alice-key');
    aliceWM.addMember(ws.id, {
      peerId: 'bob', alias: 'Bob', publicKey: 'bob-key',
      joinedAt: Date.now(), role: 'member',
    });
    aliceWM.createChannel(ws.id, 'dev', 'alice');
    aliceWM.createDM(ws.id, 'alice', 'bob');

    // Export from Alice
    const exported = aliceWM.exportWorkspace(ws.id)!;

    // Import to Bob's manager
    const bobWM = new WorkspaceManager();
    bobWM.importWorkspace(JSON.parse(JSON.stringify(exported))); // Deep clone

    // Verify Bob has full state
    const bobWS = bobWM.getWorkspace(ws.id)!;
    expect(bobWS.name).toBe('Team');
    expect(bobWS.members).toHaveLength(2);
    expect(bobWM.getChannels(ws.id)).toHaveLength(2); // general + dev
    expect(bobWM.getDMs(ws.id, 'bob')).toHaveLength(1);
  });
});
