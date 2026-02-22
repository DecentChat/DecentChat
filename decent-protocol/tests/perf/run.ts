import '../setup';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessageStore } from '../../src/messages/MessageStore';
import { OfflineQueue } from '../../src/messages/OfflineQueue';
import { PersistentStore } from '../../src/storage/PersistentStore';
import { WorkspaceManager } from '../../src/workspace/WorkspaceManager';
import type { PlaintextMessage } from '../../src/messages/types';
import type { Workspace } from '../../src/workspace/types';
import {
  runIntegrityAudit,
  type PeerIntegritySnapshot,
  type QueueTransition,
  type PersistenceSnapshot,
} from './integrity-audit';

type ScenarioName = 'smoke' | 'reconnect-chaos';

interface RunnerOptions {
  peers: number;
  scenario: ScenarioName;
  checkIntegrity: boolean;
}

interface SimPeer {
  peerId: string;
  dbName: string;
  online: boolean;
  workspaceId: string;
  primaryChannelId: string;
  workspaceManager: WorkspaceManager;
  messageStore: MessageStore;
  queue: OfflineQueue;
  persistentStore: PersistentStore;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function parseArgs(argv: string[]): RunnerOptions {
  let peers = 5;
  let scenario: ScenarioName = 'smoke';
  let checkIntegrity = false;

  for (const arg of argv) {
    if (arg.startsWith('--peers=')) {
      peers = Math.max(2, Number.parseInt(arg.split('=')[1] || '5', 10));
    } else if (arg.startsWith('--scenario=')) {
      const raw = arg.split('=')[1] || 'smoke';
      scenario = raw === 'reconnect' ? 'reconnect-chaos' : (raw as ScenarioName);
    } else if (arg === '--check-integrity') {
      checkIntegrity = true;
    } else if (arg.startsWith('--check-integrity=')) {
      checkIntegrity = (arg.split('=')[1] || '').toLowerCase() !== 'false';
    }
  }

  if (!Number.isFinite(peers) || peers < 2) peers = 2;
  if (scenario !== 'smoke' && scenario !== 'reconnect-chaos') scenario = 'smoke';

  return { peers, scenario, checkIntegrity };
}

function setupQueuePersistence(peer: SimPeer): void {
  peer.queue.setPersistence(
    (targetPeerId, data) => peer.persistentStore.enqueueMessage(targetPeerId, data),
    (targetPeerId) => peer.persistentStore.getQueuedMessages(targetPeerId),
    (id) => peer.persistentStore.dequeueMessage(id),
    (targetPeerId) => peer.persistentStore.dequeueAllForPeer(targetPeerId),
  );
}

async function createPeers(peerCount: number): Promise<SimPeer[]> {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const peers: SimPeer[] = [];
  for (let i = 0; i < peerCount; i++) {
    const peerId = `peer-${i + 1}`;
    const dbName = `perf-${runId}-${peerId}`;
    const persistentStore = new PersistentStore({ dbName });
    await persistentStore.init();
    const peer: SimPeer = {
      peerId,
      dbName,
      online: true,
      workspaceId: '',
      primaryChannelId: '',
      workspaceManager: new WorkspaceManager(),
      messageStore: new MessageStore(),
      queue: new OfflineQueue(),
      persistentStore,
    };
    setupQueuePersistence(peer);
    peers.push(peer);
  }

  const leader = peers[0];
  const workspace = leader.workspaceManager.createWorkspace(
    'perf-workspace',
    leader.peerId,
    leader.peerId,
    `pk-${leader.peerId}`,
  );
  leader.workspaceId = workspace.id;
  leader.primaryChannelId = workspace.channels[0]?.id;
  for (let i = 1; i < peers.length; i++) {
    leader.workspaceManager.addMember(workspace.id, {
      peerId: peers[i].peerId,
      alias: peers[i].peerId,
      publicKey: `pk-${peers[i].peerId}`,
      joinedAt: Date.now(),
      role: 'member',
    });
  }

  await syncWorkspaceFromLeader(peers);
  return peers;
}

function getWorkspace(peer: SimPeer): Workspace {
  const workspace = peer.workspaceManager.getWorkspace(peer.workspaceId);
  if (!workspace) {
    throw new Error(`Missing workspace on ${peer.peerId}`);
  }
  return workspace;
}

async function syncWorkspaceFromLeader(peers: SimPeer[], onlyOnline = false): Promise<void> {
  const leader = peers[0];
  const leaderWorkspace = leader.workspaceManager.exportWorkspace(getWorkspace(leader).id);
  if (!leaderWorkspace) throw new Error('Leader workspace not found');

  for (const peer of peers) {
    if (onlyOnline && !peer.online) continue;
    const cloned = deepClone(leaderWorkspace);
    peer.workspaceManager.importWorkspace(cloned);
    peer.workspaceId = cloned.id;
    peer.primaryChannelId = cloned.channels[0]?.id;
    await peer.persistentStore.saveWorkspace(cloned);
  }
}

async function deliverIncoming(target: SimPeer, message: PlaintextMessage): Promise<void> {
  const existing = target.messageStore.getMessages(message.channelId);
  if (existing.some((m) => m.id === message.id)) return;

  const incoming = deepClone(message);
  const result = await target.messageStore.addMessage(incoming);
  if (!result.success) {
    throw new Error(`Delivery failed on ${target.peerId}: ${result.error}`);
  }
  await target.persistentStore.saveMessage(incoming);
}

async function sendChannelMessage(
  peers: SimPeer[],
  senderId: string,
  channelId: string,
  content: string,
  opts: { threadId?: string; replyToId?: string } = {},
): Promise<PlaintextMessage> {
  const sender = peers.find((p) => p.peerId === senderId);
  if (!sender) throw new Error(`Unknown sender: ${senderId}`);
  if (!sender.online) throw new Error(`Sender offline: ${senderId}`);

  const message = await sender.messageStore.createMessage(
    channelId,
    sender.peerId,
    content,
    'text',
    opts.threadId,
  );
  if (opts.replyToId) {
    (message as any).replyToId = opts.replyToId;
  }

  const senderLast = sender.messageStore.getMessages(channelId).slice(-1)[0];
  if (senderLast && message.timestamp <= senderLast.timestamp) {
    message.timestamp = senderLast.timestamp + 1;
  }

  const sendResult = await sender.messageStore.addMessage(message);
  if (!sendResult.success) {
    throw new Error(`Send failed on ${sender.peerId}: ${sendResult.error}`);
  }
  await sender.persistentStore.saveMessage(message);

  for (const peer of peers) {
    if (peer.peerId === sender.peerId) continue;
    if (peer.online) {
      await deliverIncoming(peer, message);
    } else {
      await sender.queue.enqueue(peer.peerId, deepClone(message));
    }
  }

  return message;
}

async function flushQueuedForTarget(peers: SimPeer[], targetPeerId: string): Promise<QueueTransition[]> {
  const target = peers.find((p) => p.peerId === targetPeerId);
  if (!target) throw new Error(`Unknown target: ${targetPeerId}`);

  const transitions: QueueTransition[] = [];
  const pendingDeliveries: PlaintextMessage[] = [];
  for (const sender of peers) {
    if (sender.peerId === targetPeerId) continue;

    const before = (await sender.persistentStore.getQueuedMessages(targetPeerId)).length;
    const payloads = await sender.queue.flush(targetPeerId);
    pendingDeliveries.push(...(payloads as PlaintextMessage[]));
    const after = (await sender.persistentStore.getQueuedMessages(targetPeerId)).length;
    transitions.push({
      senderId: sender.peerId,
      targetId: targetPeerId,
      before,
      after,
      flushed: payloads.length,
    });
  }

  pendingDeliveries.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return a.id.localeCompare(b.id);
  });
  for (const payload of pendingDeliveries) {
    await deliverIncoming(target, payload);
  }

  return transitions;
}

async function runSmokeScenario(peers: SimPeer[]): Promise<{ queueTransitions: QueueTransition[] }> {
  const channelId = peers[0].primaryChannelId;
  for (let i = 0; i < 10; i++) {
    const sender = peers[i % peers.length];
    await sendChannelMessage(peers, sender.peerId, channelId, `smoke-message-${i}`);
    await sleep(2);
  }

  const root = await sendChannelMessage(peers, peers[0].peerId, channelId, 'thread-root');
  await sleep(2);
  for (let i = 1; i < Math.min(4, peers.length); i++) {
    await sendChannelMessage(peers, peers[i].peerId, channelId, `thread-reply-${i}`, {
      threadId: root.id,
      replyToId: root.id,
    });
    await sleep(2);
  }

  const ws = getWorkspace(peers[0]);
  const channelResult = peers[0].workspaceManager.createChannel(
    ws.id,
    'perf-smoke',
    peers[0].peerId,
  );
  if (!channelResult.success || !channelResult.channel) {
    throw new Error(`Failed to create smoke channel: ${channelResult.error}`);
  }
  await syncWorkspaceFromLeader(peers, false);
  await sendChannelMessage(peers, peers[0].peerId, channelResult.channel.id, 'smoke-secondary-channel');

  return { queueTransitions: [] };
}

async function runReconnectChaosScenario(peers: SimPeer[]): Promise<{ queueTransitions: QueueTransition[] }> {
  const offlinePeers = peers.filter((_, index) => index > 0 && index % 2 === 1);
  const onlinePeers = peers.filter((peer) => !offlinePeers.some((o) => o.peerId === peer.peerId));
  for (const peer of offlinePeers) peer.online = false;

  const ws = getWorkspace(peers[0]);
  const extraChannel = peers[0].workspaceManager.createChannel(
    ws.id,
    'reconnect-chaos',
    peers[0].peerId,
  );
  if (!extraChannel.success || !extraChannel.channel) {
    throw new Error(`Failed to create reconnect channel: ${extraChannel.error}`);
  }
  await syncWorkspaceFromLeader(peers, true);

  const channelId = peers[0].primaryChannelId;
  for (let i = 0; i < 12; i++) {
    const sender = onlinePeers[i % onlinePeers.length];
    await sendChannelMessage(peers, sender.peerId, channelId, `reconnect-message-${i}`);
    await sleep(2);
  }

  const root = await sendChannelMessage(peers, onlinePeers[0].peerId, channelId, 'reconnect-thread-root');
  await sleep(2);
  for (let i = 0; i < Math.min(3, onlinePeers.length); i++) {
    await sendChannelMessage(peers, onlinePeers[i].peerId, channelId, `reconnect-thread-reply-${i}`, {
      threadId: root.id,
      replyToId: root.id,
    });
    await sleep(2);
  }

  const queueTransitions: QueueTransition[] = [];
  for (const peer of offlinePeers) {
    peer.online = true;
    const flushed = await flushQueuedForTarget(peers, peer.peerId);
    queueTransitions.push(...flushed);
  }

  await syncWorkspaceFromLeader(peers, false);
  await sendChannelMessage(peers, peers[0].peerId, extraChannel.channel.id, 'reconnect-secondary-channel');

  return { queueTransitions };
}

async function collectPersistenceSnapshot(peer: SimPeer, lastN = 8): Promise<PersistenceSnapshot> {
  const workspace = getWorkspace(peer);
  const allMessages: PlaintextMessage[] = [];
  for (const channel of workspace.channels) {
    const messages = await peer.persistentStore.getChannelMessages(channel.id);
    allMessages.push(...(messages as PlaintextMessage[]));
  }

  allMessages.sort((a, b) => a.timestamp - b.timestamp);
  return {
    count: allMessages.length,
    lastIds: allMessages.slice(-lastN).map((m) => m.id),
  };
}

async function collectPersistenceSnapshots(peers: SimPeer[]): Promise<Record<string, PersistenceSnapshot>> {
  const snapshots: Record<string, PersistenceSnapshot> = {};
  for (const peer of peers) {
    snapshots[peer.peerId] = await collectPersistenceSnapshot(peer);
  }
  return snapshots;
}

async function restartPersistentStores(peers: SimPeer[]): Promise<void> {
  for (const peer of peers) {
    await peer.persistentStore.close();
    const store = new PersistentStore({ dbName: peer.dbName });
    await store.init();
    peer.persistentStore = store;
    setupQueuePersistence(peer);
  }
}

function collectPeerSnapshots(peers: SimPeer[]): PeerIntegritySnapshot[] {
  return peers.map((peer) => {
    const workspace = getWorkspace(peer);
    const channelMessages: Record<string, PlaintextMessage[]> = {};
    for (const channel of workspace.channels) {
      channelMessages[channel.id] = deepClone(peer.messageStore.getMessages(channel.id));
    }
    return {
      peerId: peer.peerId,
      workspace: deepClone(workspace),
      channelMessages,
    };
  });
}

async function closeAll(peers: SimPeer[]): Promise<void> {
  for (const peer of peers) {
    await peer.persistentStore.close();
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const options = parseArgs(Bun.argv.slice(2));
  const peers = await createPeers(options.peers);

  let queueTransitions: QueueTransition[] = [];
  try {
    if (options.scenario === 'smoke') {
      queueTransitions = (await runSmokeScenario(peers)).queueTransitions;
    } else {
      queueTransitions = (await runReconnectChaosScenario(peers)).queueTransitions;
    }

    const persistenceBefore = await collectPersistenceSnapshots(peers);
    await restartPersistentStores(peers);
    const persistenceAfter = await collectPersistenceSnapshots(peers);

    const integrity = runIntegrityAudit({
      peers: collectPeerSnapshots(peers),
      persistenceBefore,
      persistenceAfter,
      queueTransitions,
    });

    const report = {
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      options,
      metrics: {
        peers: peers.length,
        queueTransitions: queueTransitions.length,
      },
      integrity,
    };

    const here = dirname(fileURLToPath(import.meta.url));
    const artifactDir = resolve(here, '../../../artifacts');
    const artifactPath = resolve(artifactDir, 'perf-report.json');
    await mkdir(artifactDir, { recursive: true });
    await writeFile(artifactPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(`Scenario: ${options.scenario}`);
    console.log(`Peers: ${options.peers}`);
    console.log(`Report: ${artifactPath}`);
    console.log(`Integrity: ${integrity.passed ? 'PASS' : 'FAIL'}`);

    if (options.checkIntegrity && !integrity.passed) {
      process.exitCode = 1;
    }
  } finally {
    await closeAll(peers);
  }
}

await main();
