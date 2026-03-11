import { describe, expect, test } from 'bun:test';
import { MessageStore } from '../../src/messages/MessageStore';
import { SyncProtocol } from '../../src/workspace/SyncProtocol';
import { WorkspaceDeltaProtocol } from '../../src/workspace/WorkspaceDeltaProtocol';
import { WorkspaceManager } from '../../src/workspace/WorkspaceManager';
import type { SyncEvent, WorkspaceShell } from '../../src';

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
  return { wm, ms, events, outbox, sync };
}

describe('WorkspaceDeltaProtocol', () => {
  test('builds and applies a workspace shell', () => {
    const wm = new WorkspaceManager();
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');
    wm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: Date.now(), role: 'member' });
    wm.createChannel(ws.id, 'random', 'alice');

    const delta = new WorkspaceDeltaProtocol(wm);
    const shell = delta.buildWorkspaceShell(ws.id)!;

    expect(shell.memberCount).toBe(2);
    expect(shell.channelCount).toBe(2);
    expect(shell.version).toBe(1);

    const receiver = new WorkspaceManager();
    delta.applyWorkspaceShell(receiver, shell, 'ABCDEFGH');
    const imported = receiver.getWorkspace(ws.id)!;

    expect(imported.shell?.version).toBe(1);
    expect(imported.name).toBe('Team');
    expect(imported.channels).toHaveLength(0);
    expect(imported.members).toHaveLength(0);
  });

  test('applies a channel delta and bumps shell version', () => {
    const sender = new WorkspaceManager();
    const ws = sender.createWorkspace('Team', 'alice', 'Alice', 'alice-key');
    const protocol = new WorkspaceDeltaProtocol(sender);
    const shell = protocol.buildWorkspaceShell(ws.id)!;

    const receiver = new WorkspaceManager();
    protocol.applyWorkspaceShell(receiver, shell, ws.inviteCode);

    const deltaMsg = {
      workspaceId: ws.id,
      baseVersion: 1,
      version: 2,
      checkpointId: 'cp-2',
      ops: [{ op: 'upsert-channel' as const, channel: { ...ws.channels[0] } }],
    };

    const applied = protocol.applyDelta(receiver, deltaMsg);
    expect(applied.applied).toBe(true);
    expect(receiver.getWorkspace(ws.id)?.channels).toHaveLength(1);
    expect(receiver.getWorkspace(ws.id)?.shell?.version).toBe(2);
  });

  test('buffers out-of-order delta until base version exists', () => {
    const wm = new WorkspaceManager();
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');
    const protocol = new WorkspaceDeltaProtocol(wm);
    const shell = protocol.buildWorkspaceShell(ws.id)!;

    const receiver = new WorkspaceManager();
    protocol.applyWorkspaceShell(receiver, shell, ws.inviteCode);

    const outOfOrder = {
      workspaceId: ws.id,
      baseVersion: 2,
      version: 3,
      checkpointId: 'cp-3',
      ops: [{ op: 'update-shell' as const, shellPatch: { description: 'later' } }],
    };
    const inOrder = {
      workspaceId: ws.id,
      baseVersion: 1,
      version: 2,
      checkpointId: 'cp-2',
      ops: [{ op: 'update-shell' as const, shellPatch: { description: 'now' } }],
    };

    const first = protocol.applyDelta(receiver, outOfOrder);
    expect(first.applied).toBe(false);
    expect(first.buffered).toBe(true);

    const second = protocol.applyDelta(receiver, inOrder);
    expect(second.applied).toBe(true);
    expect(receiver.getWorkspace(ws.id)?.shell?.version).toBe(3);
    expect(receiver.getWorkspace(ws.id)?.description).toBe('later');
  });

  test('rejects stale delta with old base version', () => {
    const wm = new WorkspaceManager();
    const ws = wm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');
    const protocol = new WorkspaceDeltaProtocol(wm);
    const shell = protocol.buildWorkspaceShell(ws.id)!;

    const receiver = new WorkspaceManager();
    protocol.applyWorkspaceShell(receiver, shell, ws.inviteCode);
    protocol.applyDelta(receiver, {
      workspaceId: ws.id,
      baseVersion: 1,
      version: 2,
      checkpointId: 'cp-2',
      ops: [{ op: 'update-shell' as const, shellPatch: { description: 'new' } }],
    });

    const stale = protocol.applyDelta(receiver, {
      workspaceId: ws.id,
      baseVersion: 1,
      version: 99,
      checkpointId: 'cp-stale',
      ops: [{ op: 'update-shell' as const, shellPatch: { description: 'stale' } }],
    });

    expect(stale.applied).toBe(false);
    expect(stale.reason).toContain('stale');
  });
});

describe('SyncProtocol shell/delta messages', () => {
  test('responds to workspace-shell-request with workspace-shell-response', async () => {
    const alice = createPeer('alice');
    const ws = alice.wm.createWorkspace('Team', 'alice', 'Alice', 'alice-key');
    alice.wm.addMember(ws.id, { peerId: 'bob', alias: 'Bob', publicKey: 'bob-key', joinedAt: Date.now(), role: 'member' });

    await alice.sync.handleMessage('bob', { type: 'workspace-shell-request', workspaceId: ws.id });

    expect(alice.outbox).toHaveLength(1);
    expect(alice.outbox[0].to).toBe('bob');
    expect(alice.outbox[0].data.sync.type).toBe('workspace-shell-response');
    expect(alice.outbox[0].data.sync.shell.memberCount).toBe(2);
  });

  test('imports workspace shell from workspace-shell-response', async () => {
    const bob = createPeer('bob');
    const shell: WorkspaceShell = {
      id: 'ws-1',
      name: 'Huge Team',
      createdBy: 'alice',
      createdAt: 1,
      version: 4,
      memberCount: 42000,
      channelCount: 9,
    };

    await bob.sync.handleMessage('alice', {
      type: 'workspace-shell-response',
      shell,
      inviteCode: 'ABCDEFGH',
    });

    const ws = bob.wm.getWorkspace('ws-1');
    expect(ws).toBeDefined();
    expect(ws?.shell?.version).toBe(4);
    expect(ws?.name).toBe('Huge Team');
  });
});
