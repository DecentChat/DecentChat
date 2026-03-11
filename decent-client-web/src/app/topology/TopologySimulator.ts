import { TopologyAnomalyDetector } from './TopologyAnomalyDetector';
import type { TopologyAnomalyEvent, TopologyMaintenanceEvent } from './TopologyTelemetry';

export interface SimulatedPeer {
  peerId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: number;
  sharedWorkspaceIds?: string[];
  likelyOnline: boolean;
  connected: boolean;
  ready: boolean;
  connecting: boolean;
  disconnectCount: number;
  lastSeenAt: number;
  connectedAt?: number;
  lastSyncAt?: number;
  lastExplorerAt?: number;
}

export interface TopologySimulationTickSummary {
  tick: number;
  ts: number;
  desiredPeerCount: number;
  connectedPeerCount: number;
  connectedDesiredPeerCount: number;
  reconnectAttempts: number;
  pruneCount: number;
  selectionDurationMs: number;
  anomalies: TopologyAnomalyEvent[];
}

export interface TopologySimulationSummary {
  ticks: number;
  maxDesiredPeerCount: number;
  maxSelectionDurationMs: number;
  totalReconnectAttempts: number;
  totalPrunes: number;
  anomalyCounts: Record<string, number>;
  timeBelowSafeMinimumMs: number;
  overlapSelections: number;
  tickSummaries: TopologySimulationTickSummary[];
}

export class TopologySimulator {
  private readonly anomalyDetector: TopologyAnomalyDetector;

  constructor(private readonly controller: any, opts?: { anomalyDetector?: TopologyAnomalyDetector }) {
    this.anomalyDetector = opts?.anomalyDetector ?? new TopologyAnomalyDetector({ emitCooldownMs: 0 });
  }

  runScenario(opts: {
    workspaceId: string;
    peers: SimulatedPeer[];
    ticks: number;
    tickMs: number;
    startTs?: number;
    connectSuccessRate?: number;
    randomSeed?: number;
    mutateTick?: (args: { tick: number; now: number; peers: SimulatedPeer[]; random: () => number }) => void;
  }): TopologySimulationSummary {
    const tickSummaries: TopologySimulationTickSummary[] = [];
    const anomalyCounts = new Map<string, number>();
    let totalReconnectAttempts = 0;
    let totalPrunes = 0;
    let maxDesiredPeerCount = 0;
    let maxSelectionDurationMs = 0;
    let timeBelowSafeMinimumMs = 0;
    let overlapSelections = 0;
    const safeMinimum = this.controller.constructor.PARTIAL_MESH_MIN_SAFE_PEERS ?? 3;
    const startTs = opts.startTs ?? Date.now();
    const random = this.createRng(opts.randomSeed ?? 123456);

    for (let tick = 0; tick < opts.ticks; tick++) {
      const now = startTs + (tick * opts.tickMs);
      opts.mutateTick?.({ tick, now, peers: opts.peers, random });
      this.bindControllerState(opts.workspaceId, opts.peers, now);

      const selectionStartedAt = Date.now();
      const selection = this.controller.selectDesiredPeers(opts.workspaceId, now, { emitTopologyEvents: false });
      const selectionDurationMs = Date.now() - selectionStartedAt;
      maxSelectionDurationMs = Math.max(maxSelectionDurationMs, selectionDurationMs);
      maxDesiredPeerCount = Math.max(maxDesiredPeerCount, selection.desiredPeerIds.length);

      const desiredSet = new Set(selection.desiredPeerIds);
      const connectedSet = new Set(opts.peers.filter((peer) => peer.connected).map((peer) => peer.peerId));
      let reconnectAttempts = 0;
      for (const peer of opts.peers) {
        if (!desiredSet.has(peer.peerId) || peer.connected || !peer.likelyOnline) continue;
        reconnectAttempts += 1;
        if (random() <= (opts.connectSuccessRate ?? 1)) {
          peer.connected = true;
          peer.connecting = false;
          peer.ready = true;
          peer.connectedAt = now;
          peer.lastSyncAt = now;
          peer.lastSeenAt = now;
          connectedSet.add(peer.peerId);
        } else {
          peer.connecting = true;
          peer.disconnectCount += 1;
        }
      }

      const candidates = this.controller.getWorkspacePeerCandidates(opts.workspaceId, now);
      const pruneCandidates = this.controller.selectConservativePrunePeers(candidates, selection, connectedSet, now);
      for (const candidate of pruneCandidates) {
        const peer = opts.peers.find((entry) => entry.peerId === candidate.peerId);
        if (!peer) continue;
        peer.connected = false;
        peer.ready = false;
        peer.connecting = false;
        peer.disconnectCount += 1;
        connectedSet.delete(peer.peerId);
      }

      const connectedDesiredPeerCount = selection.desiredPeerIds.filter((peerId: string) => connectedSet.has(peerId)).length;
      const overlapDesiredPeerIds = selection.desiredPeerIds.filter((peerId: string) => {
        const peer = opts.peers.find((entry) => entry.peerId === peerId);
        return (peer?.sharedWorkspaceIds?.length ?? 0) > 0;
      });
      overlapSelections += overlapDesiredPeerIds.length;
      if (connectedSet.size < safeMinimum) timeBelowSafeMinimumMs += opts.tickMs;

      const maintenanceEvent: TopologyMaintenanceEvent = {
        kind: 'topology.maintenance',
        level: 'info',
        ts: now,
        reason: `simulation-tick-${tick}`,
        workspaceId: opts.workspaceId,
        activeWorkspace: true,
        partialMeshEnabled: true,
        candidatePeerCount: candidates.length,
        desiredPeerCount: selection.desiredPeerIds.length,
        connectedPeerCount: connectedSet.size,
        connectedDesiredPeerCount,
        connectingDesiredPeerCount: selection.desiredPeerIds.filter((peerId: string) => {
          const peer = opts.peers.find((entry) => entry.peerId === peerId);
          return !!peer?.connecting;
        }).length,
        likelyPeerCount: candidates.filter((candidate: any) => candidate.likelyOnline).length,
        coldPeerCount: candidates.filter((candidate: any) => !candidate.likelyOnline).length,
        anchorPeerIds: selection.anchors.map((candidate: any) => candidate.peerId),
        explorerPeerIds: selection.explorers.map((candidate: any) => candidate.peerId),
        desiredAddedPeerIds: [],
        desiredRemovedPeerIds: [],
        reconnectAttemptsThisSweep: reconnectAttempts,
        pruneCountThisSweep: pruneCandidates.length,
        safeMinimumRecovery: connectedDesiredPeerCount < safeMinimum,
        safeMinimumTarget: safeMinimum,
        overlapSelectedCount: overlapDesiredPeerIds.length,
        overlapDesiredPeerIds,
        selectionDurationMs,
        maintenanceDurationMs: selectionDurationMs,
        desiredBudget: selection.budget,
        hardCap: this.controller.computeHardCap(),
        targetDegree: this.controller.computeTargetPeerCount(),
      };

      const anomalies = this.anomalyDetector.observeMaintenance(maintenanceEvent);
      for (const anomaly of anomalies) {
        anomalyCounts.set(anomaly.anomaly, (anomalyCounts.get(anomaly.anomaly) ?? 0) + 1);
      }

      totalReconnectAttempts += reconnectAttempts;
      totalPrunes += pruneCandidates.length;
      tickSummaries.push({
        tick,
        ts: now,
        desiredPeerCount: selection.desiredPeerIds.length,
        connectedPeerCount: connectedSet.size,
        connectedDesiredPeerCount,
        reconnectAttempts,
        pruneCount: pruneCandidates.length,
        selectionDurationMs,
        anomalies,
      });
    }

    return {
      ticks: opts.ticks,
      maxDesiredPeerCount,
      maxSelectionDurationMs,
      totalReconnectAttempts,
      totalPrunes,
      anomalyCounts: Object.fromEntries(anomalyCounts.entries()),
      timeBelowSafeMinimumMs,
      overlapSelections,
      tickSummaries,
    };
  }

  private bindControllerState(workspaceId: string, peers: SimulatedPeer[], now: number): void {
    this.controller.state.activeWorkspaceId = workspaceId;
    this.controller.state.myPeerId = this.controller.state.myPeerId ?? 'me-peer';
    this.controller.state.connectedPeers = new Set<string>(peers.filter((peer) => peer.connected).map((peer) => peer.peerId));
    this.controller.state.readyPeers = new Set<string>(peers.filter((peer) => peer.ready).map((peer) => peer.peerId));
    this.controller.state.connectingPeers = new Set<string>(peers.filter((peer) => peer.connecting).map((peer) => peer.peerId));

    this.controller.transport.getConnectedPeers = () => Array.from(this.controller.state.connectedPeers);
    this.controller.transport.isConnectingToPeer = (peerId: string) => this.controller.state.connectingPeers.has(peerId);

    this.controller.workspaceManager.getWorkspace = (id: string) => {
      if (id !== workspaceId) return null;
      return {
        id,
        members: [
          { peerId: this.controller.state.myPeerId, role: 'owner', joinedAt: now - 60_000 },
          ...peers.map((peer) => ({ peerId: peer.peerId, role: peer.role, joinedAt: peer.joinedAt })),
        ],
      };
    };

    this.controller.workspaceManager.getAllWorkspaces = () => {
      const base = [{
        id: workspaceId,
        members: [
          { peerId: this.controller.state.myPeerId, role: 'owner', joinedAt: now - 60_000 },
          ...peers.map((peer) => ({ peerId: peer.peerId, role: peer.role, joinedAt: peer.joinedAt })),
        ],
      }];
      const overlapWorkspaceIds = new Set(peers.flatMap((peer) => peer.sharedWorkspaceIds ?? []));
      for (const sharedId of overlapWorkspaceIds) {
        base.push({
          id: sharedId,
          members: peers
            .filter((peer) => (peer.sharedWorkspaceIds ?? []).includes(sharedId))
            .map((peer) => ({ peerId: peer.peerId, role: 'member', joinedAt: peer.joinedAt })),
        });
      }
      return base;
    };

    for (const peer of peers) {
      this.controller.peerLastSeenAt.set(peer.peerId, peer.lastSeenAt);
      if (peer.connectedAt) this.controller.peerConnectedAt.set(peer.peerId, peer.connectedAt);
      else this.controller.peerConnectedAt.delete(peer.peerId);
      if (peer.lastSyncAt) this.controller.peerLastSuccessfulSyncAt.set(peer.peerId, peer.lastSyncAt);
      else this.controller.peerLastSuccessfulSyncAt.delete(peer.peerId);
      this.controller.peerDisconnectCount.set(peer.peerId, peer.disconnectCount);
      if (peer.lastExplorerAt) this.controller.peerExplorerLastUsedAt.set(peer.peerId, peer.lastExplorerAt);
    }
  }

  private createRng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }
}
