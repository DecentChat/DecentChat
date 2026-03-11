import type {
  TopologyAnomalyEvent,
  TopologyMaintenanceEvent,
  TopologyPeerEvent,
} from './TopologyTelemetry';

export class TopologyAnomalyDetector {
  private readonly emitCooldownMs: number;
  private readonly explorerRotationIntervalMs: number;
  private readonly recentAnomalies: TopologyAnomalyEvent[] = [];
  private readonly maintenanceByWorkspace = new Map<string, TopologyMaintenanceEvent[]>();
  private readonly overlapPrunesByWorkspace = new Map<string, Map<string, number[]>>();
  private readonly explorerRotationByWorkspace = new Map<string, number[]>();
  private readonly pruneRecoveryLoopsByWorkspace = new Map<string, number[]>();
  private readonly underTargetSince = new Map<string, number>();
  private readonly belowSafeMinimumSince = new Map<string, number>();
  private readonly lastExplorerSetByWorkspace = new Map<string, string[]>();
  private readonly lastExplorerChangeAtByWorkspace = new Map<string, number>();
  private readonly lastEmittedAt = new Map<string, number>();

  constructor(opts?: { emitCooldownMs?: number; explorerRotationIntervalMs?: number }) {
    this.emitCooldownMs = Math.max(0, opts?.emitCooldownMs ?? 30_000);
    this.explorerRotationIntervalMs = Math.max(1, opts?.explorerRotationIntervalMs ?? 3 * 60 * 1000);
  }

  observeMaintenance(event: TopologyMaintenanceEvent): TopologyAnomalyEvent[] {
    const anomalies: TopologyAnomalyEvent[] = [];
    const history = this.pushMaintenance(event);

    const reconnect60 = history
      .filter((entry) => event.ts - entry.ts <= 60_000)
      .reduce((sum, entry) => sum + entry.reconnectAttemptsThisSweep, 0);
    if (reconnect60 >= 20) {
      const emitted = this.maybeEmit({
        ts: event.ts,
        workspaceId: event.workspaceId,
        anomaly: 'reconnect-storm',
        metric: 'reconnectAttemptsPer60s',
        observed: reconnect60,
        threshold: 20,
        windowMs: 60_000,
        severity: reconnect60 >= 40 ? 'high' : 'medium',
        suggestedAction: 'Inspect signaling reachability, peer flapping, retry cooldowns, and target degree aggressiveness.',
        context: { reason: event.reason },
      });
      if (emitted) anomalies.push(emitted);
    }

    const flapSweeps = history.slice(-3);
    const consecutiveFlap = flapSweeps.length === 3 && flapSweeps.every((entry) => {
      const churn = entry.desiredAddedPeerIds.length + entry.desiredRemovedPeerIds.length;
      return entry.desiredPeerCount > 0 && churn / entry.desiredPeerCount > 0.3;
    });
    const changes5m = history
      .filter((entry) => event.ts - entry.ts <= 5 * 60_000)
      .reduce((sum, entry) => sum + entry.desiredAddedPeerIds.length + entry.desiredRemovedPeerIds.length, 0);
    if (consecutiveFlap || changes5m >= 12) {
      const emitted = this.maybeEmit({
        ts: event.ts,
        workspaceId: event.workspaceId,
        anomaly: 'desired-set-flapping',
        metric: 'desiredSetChangesPer5m',
        observed: changes5m,
        threshold: 12,
        windowMs: 5 * 60_000,
        severity: 'medium',
        suggestedAction: 'Inspect hysteresis threshold, dwell time, explorer cadence, and score instability.',
      });
      if (emitted) anomalies.push(emitted);
    }

    const desiredRatio = event.desiredPeerCount > 0 ? (event.connectedDesiredPeerCount / event.desiredPeerCount) : 1;
    if (event.desiredPeerCount > 0 && event.candidatePeerCount >= event.desiredPeerCount && desiredRatio < 0.6) {
      const since = this.underTargetSince.get(event.workspaceId) ?? event.ts;
      this.underTargetSince.set(event.workspaceId, since);
      const duration = event.ts - since;
      if (duration >= 5 * 60_000) {
        const emitted = this.maybeEmit({
          ts: event.ts,
          workspaceId: event.workspaceId,
          anomaly: 'stuck-under-target',
          metric: 'connectedDesiredRatioDurationMs',
          observed: duration,
          threshold: 5 * 60_000,
          windowMs: 5 * 60_000,
          severity: 'high',
          suggestedAction: 'Inspect connect success rate, signaling health, and candidate liveness heuristics.',
          context: { desiredRatio },
        });
        if (emitted) anomalies.push(emitted);
      }
    } else {
      this.underTargetSince.delete(event.workspaceId);
    }

    if (event.connectedPeerCount < event.safeMinimumTarget) {
      const since = this.belowSafeMinimumSince.get(event.workspaceId) ?? event.ts;
      this.belowSafeMinimumSince.set(event.workspaceId, since);
      const duration = event.ts - since;
      if (duration >= 30_000) {
        const emitted = this.maybeEmit({
          ts: event.ts,
          workspaceId: event.workspaceId,
          anomaly: 'below-safe-minimum-too-long',
          metric: 'timeBelowSafeMinimumMs',
          observed: duration,
          threshold: duration >= 120_000 ? 120_000 : 30_000,
          windowMs: duration >= 120_000 ? 120_000 : 30_000,
          severity: duration >= 120_000 ? 'high' : 'medium',
          suggestedAction: 'Force recovery mode, widen reconnect policy, and inspect partition / offline conditions.',
          context: { connectedPeerCount: event.connectedPeerCount, safeMinimumTarget: event.safeMinimumTarget },
        });
        if (emitted) anomalies.push(emitted);
      }
    } else {
      this.belowSafeMinimumSince.delete(event.workspaceId);
    }

    if (event.safeMinimumRecovery) {
      const pruneRecently = history.some((entry) => entry.ts < event.ts && event.ts - entry.ts <= 10 * 60_000 && entry.pruneCountThisSweep > 0);
      if (pruneRecently) {
        const loopHistory = this.pushTimestamp(this.pruneRecoveryLoopsByWorkspace, event.workspaceId, event.ts, 10 * 60_000);
        if (loopHistory.length >= 3) {
          const emitted = this.maybeEmit({
            ts: event.ts,
            workspaceId: event.workspaceId,
            anomaly: 'over-prune-recovery-loop',
            metric: 'pruneRecoveryLoopsPer10m',
            observed: loopHistory.length,
            threshold: 3,
            windowMs: 10 * 60_000,
            severity: 'medium',
            suggestedAction: 'Reduce pruning aggressiveness and inspect whether valuable incumbents were pruned too eagerly.',
          });
          if (emitted) anomalies.push(emitted);
        }
      }
    }

    const previousExplorers = this.lastExplorerSetByWorkspace.get(event.workspaceId) ?? [];
    const currentExplorers = [...event.explorerPeerIds].sort();
    const changedExplorers = previousExplorers.join('|') !== currentExplorers.join('|');
    if (previousExplorers.length > 0 && changedExplorers) {
      const lastExplorerChangeAt = this.lastExplorerChangeAtByWorkspace.get(event.workspaceId) ?? (history.length > 1 ? history[history.length - 2].ts : event.ts);
      const rotations = this.pushTimestamp(this.explorerRotationByWorkspace, event.workspaceId, event.ts, 10 * 60_000);
      const rotatedTooFast = (event.ts - lastExplorerChangeAt) < (this.explorerRotationIntervalMs / 2);
      if (rotatedTooFast || rotations.length >= 6) {
        const emitted = this.maybeEmit({
          ts: event.ts,
          workspaceId: event.workspaceId,
          anomaly: 'explorer-rotation-too-frequent',
          metric: 'explorerRotationsPer10m',
          observed: rotatedTooFast ? (event.ts - lastExplorerChangeAt) : rotations.length,
          threshold: rotatedTooFast ? (this.explorerRotationIntervalMs / 2) : 6,
          windowMs: rotatedTooFast ? (this.explorerRotationIntervalMs / 2) : 10 * 60_000,
          severity: rotatedTooFast ? 'medium' : 'low',
          suggestedAction: 'Inspect explorer rotation timestamp handling and desired-set churn interactions.',
          context: { previousExplorers, currentExplorers },
        });
        if (emitted) anomalies.push(emitted);
      }
      this.lastExplorerChangeAtByWorkspace.set(event.workspaceId, event.ts);
    } else if (previousExplorers.length === 0 && currentExplorers.length > 0) {
      this.lastExplorerChangeAtByWorkspace.set(event.workspaceId, event.ts);
    }
    this.lastExplorerSetByWorkspace.set(event.workspaceId, currentExplorers);

    const slowThresholds = this.getSelectionThresholds(event.candidatePeerCount);
    if (event.selectionDurationMs > slowThresholds.warnMs) {
      const emitted = this.maybeEmit({
        ts: event.ts,
        workspaceId: event.workspaceId,
        anomaly: 'selection-too-slow',
        metric: 'selectionDurationMs',
        observed: event.selectionDurationMs,
        threshold: slowThresholds.warnMs,
        windowMs: 0,
        severity: event.selectionDurationMs > slowThresholds.failMs ? 'high' : 'medium',
        suggestedAction: 'Profile selection sorting/filtering, reduce repeated scans, and cache overlap counts per sweep.',
        context: { candidatePeerCount: event.candidatePeerCount, failThresholdMs: slowThresholds.failMs },
      });
      if (emitted) anomalies.push(emitted);
    }

    return anomalies;
  }

  observePeerEvent(event: TopologyPeerEvent): TopologyAnomalyEvent[] {
    const anomalies: TopologyAnomalyEvent[] = [];
    if (event.event === 'pruned' && (event.sharedWorkspaceCount ?? 0) > 1) {
      const workspaceMap = this.overlapPrunesByWorkspace.get(event.workspaceId) ?? new Map<string, number[]>();
      this.overlapPrunesByWorkspace.set(event.workspaceId, workspaceMap);
      const perPeer = workspaceMap.get(event.peerId) ?? [];
      perPeer.push(event.ts);
      const peerHistory = perPeer.filter((ts) => event.ts - ts <= 15 * 60_000);
      workspaceMap.set(event.peerId, peerHistory);

      const totalWorkspaceOverlapPrunes = Array.from(workspaceMap.values())
        .flat()
        .filter((ts) => event.ts - ts <= 30 * 60_000).length;

      if (peerHistory.length >= 2 || totalWorkspaceOverlapPrunes >= 3) {
        const emitted = this.maybeEmit({
          ts: event.ts,
          workspaceId: event.workspaceId,
          anomaly: 'overlap-peer-pruned-repeatedly',
          metric: 'overlapPrunes',
          observed: Math.max(peerHistory.length, totalWorkspaceOverlapPrunes),
          threshold: peerHistory.length >= 2 ? 2 : 3,
          windowMs: peerHistory.length >= 2 ? 15 * 60_000 : 30 * 60_000,
          severity: 'high',
          suggestedAction: 'Inspect overlap weighting, prune pool filters, and safe-minimum protection.',
          context: { peerId: event.peerId, sharedWorkspaceCount: event.sharedWorkspaceCount },
        });
        if (emitted) anomalies.push(emitted);
      }
    }
    return anomalies;
  }

  getRecentAnomalies(workspaceId?: string): TopologyAnomalyEvent[] {
    return this.recentAnomalies.filter((anomaly) => !workspaceId || anomaly.workspaceId === workspaceId);
  }

  private pushMaintenance(event: TopologyMaintenanceEvent): TopologyMaintenanceEvent[] {
    const history = this.maintenanceByWorkspace.get(event.workspaceId) ?? [];
    history.push(event);
    const trimmed = history.filter((entry) => event.ts - entry.ts <= 30 * 60_000);
    this.maintenanceByWorkspace.set(event.workspaceId, trimmed);
    return trimmed;
  }

  private pushTimestamp(store: Map<string, number[]>, key: string, ts: number, windowMs: number): number[] {
    const values = store.get(key) ?? [];
    values.push(ts);
    const trimmed = values.filter((value) => ts - value <= windowMs);
    store.set(key, trimmed);
    return trimmed;
  }

  private maybeEmit(payload: Omit<TopologyAnomalyEvent, 'kind' | 'level'>): TopologyAnomalyEvent | null {
    const key = `${payload.workspaceId}:${payload.anomaly}`;
    const last = this.lastEmittedAt.get(key) ?? 0;
    if (payload.ts - last < this.emitCooldownMs) return null;
    this.lastEmittedAt.set(key, payload.ts);
    const anomaly: TopologyAnomalyEvent = {
      kind: 'topology.anomaly',
      level: 'warn',
      ...payload,
    };
    this.recentAnomalies.push(anomaly);
    if (this.recentAnomalies.length > 250) {
      this.recentAnomalies.splice(0, this.recentAnomalies.length - 250);
    }
    return anomaly;
  }

  private getSelectionThresholds(candidatePeerCount: number): { warnMs: number; failMs: number } {
    if (candidatePeerCount >= 10_000) return { warnMs: 120, failMs: 250 };
    if (candidatePeerCount >= 1_000) return { warnMs: 30, failMs: 75 };
    return { warnMs: 10, failMs: 25 };
  }
}
