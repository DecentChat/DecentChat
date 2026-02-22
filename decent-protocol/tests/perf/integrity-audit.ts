import type { PlaintextMessage } from '../../src/messages/types';
import type { Workspace } from '../../src/workspace/types';

export interface PeerIntegritySnapshot {
  peerId: string;
  workspace: Workspace;
  channelMessages: Record<string, PlaintextMessage[]>;
}

export interface PersistenceSnapshot {
  count: number;
  lastIds: string[];
}

export interface QueueTransition {
  senderId: string;
  targetId: string;
  before: number;
  after: number;
  flushed: number;
}

interface CheckResult {
  passed: boolean;
  summary: string;
  details: Record<string, unknown>;
}

export interface IntegrityReport {
  passed: boolean;
  checks: {
    messageHistory: CheckResult;
    workspace: CheckResult;
    threads: CheckResult;
    persistence: CheckResult;
    offlineQueue: CheckResult;
  };
}

function toSortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function normalizeWorkspace(workspace: Workspace): string {
  const members = [...workspace.members]
    .map((m) => ({
      peerId: m.peerId,
      alias: m.alias,
      publicKey: m.publicKey,
      role: m.role,
    }))
    .sort((a, b) => a.peerId.localeCompare(b.peerId));

  const channels = [...workspace.channels]
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      createdBy: c.createdBy,
      members: [...c.members].sort(),
    }))
    .sort((a, b) => `${a.type}:${a.name}:${a.id}`.localeCompare(`${b.type}:${b.name}:${b.id}`));

  return JSON.stringify({
    id: workspace.id,
    name: workspace.name,
    createdBy: workspace.createdBy,
    members,
    channels,
  });
}

function auditMessageHistory(peers: PeerIntegritySnapshot[]): CheckResult {
  const allChannelIds = toSortedUnique(
    peers.flatMap((peer) => Object.keys(peer.channelMessages)),
  );
  const duplicates: Record<string, string[]> = {};
  const missingByPeer: Record<string, Record<string, string[]>> = {};
  const extraByPeer: Record<string, Record<string, string[]>> = {};
  const countByPeer: Record<string, Record<string, number>> = {};
  let passed = true;

  for (const channelId of allChannelIds) {
    const canonicalPeer = peers[0];
    const canonical = canonicalPeer.channelMessages[channelId] ?? [];
    const canonicalIds = canonical.map((m) => m.id);
    const canonicalSet = new Set(canonicalIds);

    for (const peer of peers) {
      const ids = (peer.channelMessages[channelId] ?? []).map((m) => m.id);
      const unique = new Set(ids);
      countByPeer[peer.peerId] = countByPeer[peer.peerId] || {};
      countByPeer[peer.peerId][channelId] = ids.length;

      if (unique.size !== ids.length) {
        duplicates[peer.peerId] = duplicates[peer.peerId] || [];
        duplicates[peer.peerId].push(channelId);
        passed = false;
      }

      const missing = canonicalIds.filter((id) => !unique.has(id));
      const extra = ids.filter((id) => !canonicalSet.has(id));

      if (missing.length > 0) {
        missingByPeer[peer.peerId] = missingByPeer[peer.peerId] || {};
        missingByPeer[peer.peerId][channelId] = missing;
        passed = false;
      }
      if (extra.length > 0) {
        extraByPeer[peer.peerId] = extraByPeer[peer.peerId] || {};
        extraByPeer[peer.peerId][channelId] = extra;
        passed = false;
      }

      if (ids.length !== canonicalIds.length) {
        passed = false;
      }
    }
  }

  return {
    passed,
    summary: passed
      ? 'Message/history integrity passed'
      : 'Message/history integrity failed (missing, duplicate, or inconsistent IDs/counts)',
    details: {
      channelsChecked: allChannelIds.length,
      duplicates,
      missingByPeer,
      extraByPeer,
      countByPeer,
    },
  };
}

function auditWorkspace(peers: PeerIntegritySnapshot[]): CheckResult {
  const canonical = normalizeWorkspace(peers[0].workspace);
  const mismatchedPeers: string[] = [];

  for (const peer of peers) {
    if (normalizeWorkspace(peer.workspace) !== canonical) {
      mismatchedPeers.push(peer.peerId);
    }
  }

  const passed = mismatchedPeers.length === 0;
  return {
    passed,
    summary: passed
      ? 'Workspace integrity passed'
      : 'Workspace integrity failed (channels/members diverged after settle)',
    details: {
      mismatchedPeers,
      expectedWorkspaceId: peers[0].workspace.id,
    },
  };
}

function auditThreads(peers: PeerIntegritySnapshot[]): CheckResult {
  const orphanThreadLinks: Array<{ peerId: string; channelId: string; messageId: string; threadId: string }> = [];
  const orphanReplyLinks: Array<{ peerId: string; channelId: string; messageId: string; replyToId: string }> = [];
  const mismatchedLinks: Array<{ peerId: string; channelId: string; messageId: string; threadId: string; replyToId: string }> = [];

  for (const peer of peers) {
    for (const [channelId, messages] of Object.entries(peer.channelMessages)) {
      const ids = new Set(messages.map((m) => m.id));
      for (const message of messages) {
        const replyToId = (message as any).replyToId as string | undefined;
        if (message.threadId && !ids.has(message.threadId)) {
          orphanThreadLinks.push({
            peerId: peer.peerId,
            channelId,
            messageId: message.id,
            threadId: message.threadId,
          });
        }
        if (replyToId && !ids.has(replyToId)) {
          orphanReplyLinks.push({
            peerId: peer.peerId,
            channelId,
            messageId: message.id,
            replyToId,
          });
        }
        if (message.threadId && replyToId && message.threadId !== replyToId) {
          mismatchedLinks.push({
            peerId: peer.peerId,
            channelId,
            messageId: message.id,
            threadId: message.threadId,
            replyToId,
          });
        }
      }
    }
  }

  const passed =
    orphanThreadLinks.length === 0 &&
    orphanReplyLinks.length === 0 &&
    mismatchedLinks.length === 0;

  return {
    passed,
    summary: passed
      ? 'Thread integrity passed'
      : 'Thread integrity failed (broken threadId/replyToId linkage)',
    details: {
      orphanThreadLinks,
      orphanReplyLinks,
      mismatchedLinks,
    },
  };
}

function auditPersistence(
  before: Record<string, PersistenceSnapshot>,
  after: Record<string, PersistenceSnapshot>,
): CheckResult {
  const mismatches: Array<{
    peerId: string;
    beforeCount: number;
    afterCount: number;
    beforeLastIds: string[];
    afterLastIds: string[];
  }> = [];

  for (const peerId of Object.keys(before)) {
    const prev = before[peerId];
    const next = after[peerId];
    if (!next) {
      mismatches.push({
        peerId,
        beforeCount: prev.count,
        afterCount: -1,
        beforeLastIds: prev.lastIds,
        afterLastIds: [],
      });
      continue;
    }
    if (
      prev.count !== next.count ||
      JSON.stringify(prev.lastIds) !== JSON.stringify(next.lastIds)
    ) {
      mismatches.push({
        peerId,
        beforeCount: prev.count,
        afterCount: next.count,
        beforeLastIds: prev.lastIds,
        afterLastIds: next.lastIds,
      });
    }
  }

  const passed = mismatches.length === 0;
  return {
    passed,
    summary: passed
      ? 'Persistence integrity passed'
      : 'Persistence integrity failed after restart/restore',
    details: {
      mismatches,
    },
  };
}

function auditOfflineQueue(queueTransitions: QueueTransition[]): CheckResult {
  const stuck = queueTransitions.filter((q) => q.after > 0);
  const hadQueued = queueTransitions.some((q) => q.before > 0);
  const passed = stuck.length === 0;

  return {
    passed,
    summary: passed
      ? 'Offline queue integrity passed'
      : 'Offline queue integrity failed (some queued messages did not flush)',
    details: {
      transitions: queueTransitions,
      hadQueuedMessages: hadQueued,
      stuckTransitions: stuck,
    },
  };
}

export function runIntegrityAudit(input: {
  peers: PeerIntegritySnapshot[];
  persistenceBefore: Record<string, PersistenceSnapshot>;
  persistenceAfter: Record<string, PersistenceSnapshot>;
  queueTransitions: QueueTransition[];
}): IntegrityReport {
  const messageHistory = auditMessageHistory(input.peers);
  const workspace = auditWorkspace(input.peers);
  const threads = auditThreads(input.peers);
  const persistence = auditPersistence(input.persistenceBefore, input.persistenceAfter);
  const offlineQueue = auditOfflineQueue(input.queueTransitions);

  const passed =
    messageHistory.passed &&
    workspace.passed &&
    threads.passed &&
    persistence.passed &&
    offlineQueue.passed;

  return {
    passed,
    checks: {
      messageHistory,
      workspace,
      threads,
      persistence,
      offlineQueue,
    },
  };
}
