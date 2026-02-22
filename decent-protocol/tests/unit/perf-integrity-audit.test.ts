import { describe, expect, test } from 'bun:test';
import type { PlaintextMessage } from '../../src/messages/types';
import type { Workspace } from '../../src/workspace/types';
import {
  runIntegrityAudit,
  type PeerIntegritySnapshot,
  type PersistenceSnapshot,
  type QueueTransition,
} from '../perf/integrity-audit';

function makeWorkspace(): Workspace {
  return {
    id: 'ws-1',
    name: 'Perf Test',
    inviteCode: 'ABCDEFGH',
    createdBy: 'peer-1',
    createdAt: 1,
    members: [
      { peerId: 'peer-1', alias: 'peer-1', publicKey: 'k1', joinedAt: 1, role: 'owner' },
      { peerId: 'peer-2', alias: 'peer-2', publicKey: 'k2', joinedAt: 2, role: 'member' },
    ],
    channels: [
      {
        id: 'ch-1',
        workspaceId: 'ws-1',
        name: 'general',
        type: 'channel',
        members: ['peer-1', 'peer-2'],
        createdBy: 'peer-1',
        createdAt: 1,
      },
    ],
  };
}

function makeMessage(id: string, timestamp: number, threadId?: string): PlaintextMessage {
  return {
    id,
    channelId: 'ch-1',
    senderId: 'peer-1',
    timestamp,
    content: id,
    type: 'text',
    threadId,
    prevHash: 'hash',
    status: 'sent',
  };
}

function baseInput(overrides: {
  peers?: PeerIntegritySnapshot[];
  before?: Record<string, PersistenceSnapshot>;
  after?: Record<string, PersistenceSnapshot>;
  queue?: QueueTransition[];
} = {}) {
  const workspace = makeWorkspace();
  const messages = [makeMessage('m1', 1), makeMessage('m2', 2), makeMessage('m3', 3, 'm1')];
  (messages[2] as any).replyToId = 'm1';

  const peers: PeerIntegritySnapshot[] = overrides.peers ?? [
    {
      peerId: 'peer-1',
      workspace,
      channelMessages: { 'ch-1': messages },
    },
    {
      peerId: 'peer-2',
      workspace: JSON.parse(JSON.stringify(workspace)),
      channelMessages: { 'ch-1': JSON.parse(JSON.stringify(messages)) },
    },
  ];

  const before = overrides.before ?? {
    'peer-1': { count: 3, lastIds: ['m2', 'm3'] },
    'peer-2': { count: 3, lastIds: ['m2', 'm3'] },
  };
  const after = overrides.after ?? {
    'peer-1': { count: 3, lastIds: ['m2', 'm3'] },
    'peer-2': { count: 3, lastIds: ['m2', 'm3'] },
  };
  const queue = overrides.queue ?? [
    { senderId: 'peer-1', targetId: 'peer-2', before: 2, after: 0, flushed: 2 },
  ];

  return {
    peers,
    persistenceBefore: before,
    persistenceAfter: after,
    queueTransitions: queue,
  };
}

describe('perf integrity audit', () => {
  test('passes when all integrity checks are satisfied', () => {
    const report = runIntegrityAudit(baseInput());
    expect(report.passed).toBe(true);
    expect(report.checks.messageHistory.passed).toBe(true);
    expect(report.checks.workspace.passed).toBe(true);
    expect(report.checks.threads.passed).toBe(true);
    expect(report.checks.persistence.passed).toBe(true);
    expect(report.checks.offlineQueue.passed).toBe(true);
  });

  test('fails message/history integrity on duplicate IDs', () => {
    const badPeers = baseInput().peers;
    badPeers[1].channelMessages['ch-1'].push(makeMessage('m3', 4));
    const report = runIntegrityAudit(baseInput({ peers: badPeers }));
    expect(report.checks.messageHistory.passed).toBe(false);
    expect(report.passed).toBe(false);
  });

  test('fails thread integrity on orphan link', () => {
    const badPeers = baseInput().peers;
    (badPeers[1].channelMessages['ch-1'][2] as any).replyToId = 'missing-parent';
    const report = runIntegrityAudit(baseInput({ peers: badPeers }));
    expect(report.checks.threads.passed).toBe(false);
  });

  test('fails persistence integrity when count or tail IDs drift after restart', () => {
    const report = runIntegrityAudit(
      baseInput({
        after: {
          'peer-1': { count: 2, lastIds: ['m1', 'm2'] },
          'peer-2': { count: 3, lastIds: ['m2', 'm3'] },
        },
      }),
    );
    expect(report.checks.persistence.passed).toBe(false);
  });

  test('fails offline queue integrity when queued data remains', () => {
    const report = runIntegrityAudit(
      baseInput({
        queue: [{ senderId: 'peer-1', targetId: 'peer-2', before: 2, after: 1, flushed: 1 }],
      }),
    );
    expect(report.checks.offlineQueue.passed).toBe(false);
  });
});
