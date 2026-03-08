/**
 * Mixed-version sync compatibility tests.
 *
 * Intent: simulate diverged clients where one side sends legacy payloads
 * and the other sends additive newer payloads. Sync must not crash and
 * must converge on core workspace/message state.
 */

import { describe, test, expect } from 'bun:test';
import { SyncProtocol, type SyncEvent } from '../../src/workspace/SyncProtocol';
import { WorkspaceManager } from '../../src/workspace/WorkspaceManager';
import { MessageStore } from '../../src/messages/MessageStore';

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

  return { peerId, wm, ms, sync, events, outbox };
}

describe('Mixed-version sync compatibility', () => {
  test('accepts legacy join-accepted payload and normalizes workspace shape', async () => {
    const bob = createPeer('bob'); // receiver (newer code)

    // Simulate old client payload: missing modern optional fields like permissions,
    // workspace settings, vectorClock/attachments in message history.
    const legacyJoinAccepted: any = {
      type: 'join-accepted',
      workspace: {
        id: 'ws-legacy',
        name: 'Legacy Workspace',
        inviteCode: 'ABCDEFGH',
        createdBy: 'alice',
        createdAt: Date.now(),
        members: [
          { peerId: 'alice', alias: 'Alice', publicKey: 'alice-pk', joinedAt: Date.now(), role: 'owner' },
          { peerId: 'bob', alias: 'Bob', publicKey: 'bob-pk', joinedAt: Date.now(), role: 'member' },
        ],
        channels: [
          {
            id: 'ch-general',
            name: 'general',
            type: 'group',
            createdBy: 'alice',
            members: ['alice', 'bob'],
            createdAt: Date.now(),
          },
        ],
      },
      messageHistory: {
        'ch-general': [
          {
            id: 'm-legacy-1',
            channelId: 'ch-general',
            senderId: 'alice',
            timestamp: Date.now(),
            type: 'text',
            // no vectorClock / no attachments
          },
        ],
      },
    };

    await bob.sync.handleMessage('alice', legacyJoinAccepted);

    const ws = bob.wm.getWorkspace('ws-legacy');
    expect(ws).toBeDefined();
    expect(ws!.members).toHaveLength(2);
    expect(ws!.channels).toHaveLength(1);

    // Newer code should normalize missing permissions defaults
    expect(ws!.permissions).toBeDefined();

    const messages = bob.ms.getMessages('ch-general');
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('m-legacy-1');

    // Event emitted as successful workspace join
    expect(bob.events.some(e => e.type === 'workspace-joined')).toBe(true);
  });

  test('accepts additive unknown fields from newer peer without breaking sync', async () => {
    const alice = createPeer('alice');
    const bob = createPeer('bob');

    // Shared workspace baseline for message authorization
    const ws = alice.wm.createWorkspace('Team', 'alice', 'Alice', 'alice-pk');
    alice.wm.addMember(ws.id, {
      peerId: 'bob',
      alias: 'Bob',
      publicKey: 'bob-pk',
      joinedAt: Date.now(),
      role: 'member',
    });

    // Bob imports workspace snapshot (simulates successful prior join)
    bob.wm.importWorkspace(JSON.parse(JSON.stringify(alice.wm.exportWorkspace(ws.id)!)));

    const channelId = ws.channels[0].id;

    // Build a hash-chain-valid message, then enrich with additive unknown fields
    const base = await alice.ms.createMessage(channelId, 'alice', 'hello from newer client');

    const additiveNewPayload: any = {
      type: 'channel-message',
      channelId,
      message: {
        ...base,
        // additive fields a future/newer client might include
        vectorClock: { alice: 7, bob: 2 },
        attachments: [],
        reactions: [{ emoji: '🔥', peerId: 'alice' }],
        editHistory: [{ ts: Date.now(), by: 'alice' }],
        experimentalFlags: { aiSummary: true },
      },
      workspaceId: ws.id,
      protocolHints: { schemaVersion: 99 },
    };

    await bob.sync.handleMessage('alice', additiveNewPayload);

    const msgs = bob.ms.getMessages(channelId);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe(base.id);

    // Core event should still fire (no crash, no rejection)
    expect(bob.events.some(e => e.type === 'message-received')).toBe(true);
  });
});
