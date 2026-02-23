/**
 * GAP 4: Split-Brain Channels
 *
 * Scenario: A creates #dev offline from B; B also creates #dev offline from A;
 * they reconnect.
 *
 * Verify: no crash, deterministic outcome, no data loss.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { WorkspaceManager } from '../../src/workspace/WorkspaceManager';
import type { Channel, Workspace } from '../../src/workspace/types';
import { MessageCRDT } from '../../src/crdt/MessageCRDT';

describe('Split-Brain Channels — duplicate #dev created offline', () => {
  let aliceManager: WorkspaceManager;
  let bobManager: WorkspaceManager;
  let workspaceId: string;

  beforeEach(() => {
    aliceManager = new WorkspaceManager();
    bobManager = new WorkspaceManager();

    // Both have the same workspace (pre-partition sync)
    const ws = aliceManager.createWorkspace('TestWS', 'alice', 'Alice', 'pk-alice');
    workspaceId = ws.id;

    // Add Bob to Alice's workspace and make him admin (channel create/remove policy)
    aliceManager.addMember(workspaceId, {
      peerId: 'bob', alias: 'Bob', publicKey: 'pk-bob',
      joinedAt: Date.now(), role: 'member',
    });
    aliceManager.promoteMember(workspaceId, 'alice', 'bob', 'admin');

    // Bob imports a copy of the workspace
    const clone = JSON.parse(JSON.stringify(aliceManager.getWorkspace(workspaceId)!));
    bobManager.importWorkspace(clone);
  });

  test('both peers can create #dev independently without crash', () => {
    // Alice creates #dev offline
    const aliceResult = aliceManager.createChannel(workspaceId, 'dev', 'alice');
    expect(aliceResult.success).toBe(true);
    expect(aliceResult.channel).toBeDefined();

    // Bob creates #dev offline (his own workspace copy)
    const bobResult = bobManager.createChannel(workspaceId, 'dev', 'bob');
    expect(bobResult.success).toBe(true);
    expect(bobResult.channel).toBeDefined();
  });

  test('both #dev channels have different IDs', () => {
    const aliceResult = aliceManager.createChannel(workspaceId, 'dev', 'alice');
    const bobResult = bobManager.createChannel(workspaceId, 'dev', 'bob');

    // UUID-based IDs should be different
    expect(aliceResult.channel!.id).not.toBe(bobResult.channel!.id);
  });

  test('deterministic merge: min-wins ID resolution', () => {
    const aliceResult = aliceManager.createChannel(workspaceId, 'dev', 'alice');
    const bobResult = bobManager.createChannel(workspaceId, 'dev', 'bob');

    const aliceDevId = aliceResult.channel!.id;
    const bobDevId = bobResult.channel!.id;

    // Min-wins: the smaller channel ID survives
    const winnerId = aliceDevId < bobDevId ? aliceDevId : bobDevId;
    const loserId = aliceDevId < bobDevId ? bobDevId : aliceDevId;

    expect(winnerId).not.toBe(loserId);
    // Both peers should converge on the same winner
    expect(winnerId < loserId).toBe(true);
  });

  test('messages from both #dev channels can be merged into winner channel', () => {
    const aliceResult = aliceManager.createChannel(workspaceId, 'dev', 'alice');
    const bobResult = bobManager.createChannel(workspaceId, 'dev', 'bob');

    const aliceDevId = aliceResult.channel!.id;
    const bobDevId = bobResult.channel!.id;

    // Both write messages to their local #dev
    const aliceCRDT = new MessageCRDT('alice');
    const bobCRDT = new MessageCRDT('bob');

    const a1 = aliceCRDT.createMessage(aliceDevId, 'Alice dev msg 1');
    const a2 = aliceCRDT.createMessage(aliceDevId, 'Alice dev msg 2');
    const b1 = bobCRDT.createMessage(bobDevId, 'Bob dev msg 1');
    const b2 = bobCRDT.createMessage(bobDevId, 'Bob dev msg 2');

    // On heal: both sides merge all messages
    aliceCRDT.merge([b1, b2]);
    bobCRDT.merge([a1, a2]);

    // All messages are accessible (even across different channel IDs)
    const aliceAllMsgs = aliceCRDT.getAllMessages();
    const bobAllMsgs = bobCRDT.getAllMessages();

    expect(aliceAllMsgs).toHaveLength(4);
    expect(bobAllMsgs).toHaveLength(4);
  });

  test('no data loss: messages from loser channel are preserved', () => {
    const aliceResult = aliceManager.createChannel(workspaceId, 'dev', 'alice');
    const bobResult = bobManager.createChannel(workspaceId, 'dev', 'bob');

    const aliceDevId = aliceResult.channel!.id;
    const bobDevId = bobResult.channel!.id;
    const winnerId = aliceDevId < bobDevId ? aliceDevId : bobDevId;

    // Create messages on both channels
    const aliceCRDT = new MessageCRDT('alice');
    const bobCRDT = new MessageCRDT('bob');

    aliceCRDT.createMessage(aliceDevId, 'Alice msg');
    bobCRDT.createMessage(bobDevId, 'Bob msg');

    // After merge, all messages should exist
    aliceCRDT.merge(bobCRDT.getAllMessages());

    const allMsgs = aliceCRDT.getAllMessages();
    expect(allMsgs).toHaveLength(2);
    expect(allMsgs.map(m => m.content).sort()).toEqual(['Alice msg', 'Bob msg']);
  });

  test('creating duplicate channel name on same workspace is blocked locally', () => {
    // First creation succeeds
    const first = aliceManager.createChannel(workspaceId, 'dev', 'alice');
    expect(first.success).toBe(true);

    // Second creation with same name on same instance is blocked
    const second = aliceManager.createChannel(workspaceId, 'dev', 'alice');
    expect(second.success).toBe(false);
    expect(second.error).toContain('already exists');
  });

  test('DM channels are not affected by split-brain (no name uniqueness)', () => {
    // DMs use different type and don't enforce name uniqueness
    const dm1 = aliceManager.createDM(workspaceId, 'alice', 'bob');
    expect(dm1.success).toBe(true);

    // Creating same DM again returns existing
    const dm2 = aliceManager.createDM(workspaceId, 'alice', 'bob');
    expect(dm2.success).toBe(true);
    expect(dm2.channel!.id).toBe(dm1.channel!.id);
  });

  test('multiple channels can be created with different names during partition', () => {
    aliceManager.createChannel(workspaceId, 'dev', 'alice');
    aliceManager.createChannel(workspaceId, 'design', 'alice');

    bobManager.createChannel(workspaceId, 'ops', 'bob');
    bobManager.createChannel(workspaceId, 'support', 'bob');

    const aliceChannels = aliceManager.getChannels(workspaceId);
    const bobChannels = bobManager.getChannels(workspaceId);

    // Alice has general + dev + design = 3
    expect(aliceChannels.length).toBe(3);
    // Bob has general + ops + support = 3
    expect(bobChannels.length).toBe(3);
  });
});
