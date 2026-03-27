import { createLogger } from '@decentchat/protocol';

export type TopologyLogLevel = 'info' | 'debug' | 'warn';

export interface TopologyMaintenanceEvent {
  kind: 'topology.maintenance';
  level: TopologyLogLevel;
  ts: number;
  reason: string;
  workspaceId: string;
  activeWorkspace: boolean;
  partialMeshEnabled: boolean;
  candidatePeerCount: number;
  desiredPeerCount: number;
  connectedPeerCount: number;
  connectedDesiredPeerCount: number;
  connectingDesiredPeerCount: number;
  likelyPeerCount: number;
  coldPeerCount: number;
  anchorPeerIds: string[];
  explorerPeerIds: string[];
  desiredAddedPeerIds: string[];
  desiredRemovedPeerIds: string[];
  reconnectAttemptsThisSweep: number;
  pruneCountThisSweep: number;
  safeMinimumRecovery: boolean;
  safeMinimumTarget: number;
  overlapSelectedCount: number;
  overlapDesiredPeerIds: string[];
  selectionDurationMs: number;
  maintenanceDurationMs: number;
  desiredBudget: number;
  hardCap: number;
  targetDegree: number;
}

export interface TopologyPeerEvent {
  kind: 'topology.peer';
  level: TopologyLogLevel;
  ts: number;
  workspaceId: string;
  peerId: string;
  event:
    | 'selected-anchor'
    | 'selected-core'
    | 'selected-explorer'
    | 'selected-overlap'
    | 'skipped-incumbent-protection'
    | 'connect-attempt'
    | 'connected'
    | 'disconnected'
    | 'pruned'
    | 'sync-succeeded'
    | 'sync-failed';
  reason?: string;
  sharedWorkspaceCount?: number;
  score?: number;
  connected?: boolean;
  connecting?: boolean;
  ready?: boolean;
  likelyOnline?: boolean;
  disconnectCount?: number;
  connectedAt?: number;
  lastSyncAt?: number;
}

export type TopologyAnomalyKind =
  | 'reconnect-storm'
  | 'desired-set-flapping'
  | 'stuck-under-target'
  | 'below-safe-minimum-too-long'
  | 'over-prune-recovery-loop'
  | 'explorer-rotation-too-frequent'
  | 'overlap-peer-pruned-repeatedly'
  | 'selection-too-slow';

export interface TopologyAnomalyEvent {
  kind: 'topology.anomaly';
  level: 'warn';
  ts: number;
  workspaceId: string;
  anomaly: TopologyAnomalyKind;
  metric: string;
  observed: number;
  threshold: number;
  windowMs: number;
  severity: 'low' | 'medium' | 'high';
  suggestedAction: string;
  context?: Record<string, unknown>;
}

export type TopologyEvent = TopologyMaintenanceEvent | TopologyPeerEvent | TopologyAnomalyEvent;

export interface TopologyDebugSnapshot {
  lastMaintenance?: TopologyMaintenanceEvent;
  recentEvents: TopologyEvent[];
  recentAnomalies: TopologyAnomalyEvent[];
}

export function diffPeerSets(previous: string[] = [], next: string[] = []): {
  addedPeerIds: string[];
  removedPeerIds: string[];
} {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  return {
    addedPeerIds: next.filter((peerId) => !previousSet.has(peerId)),
    removedPeerIds: previous.filter((peerId) => !nextSet.has(peerId)),
  };
}

type MaintenanceRecordInput = Omit<TopologyMaintenanceEvent, 'kind' | 'ts' | 'desiredAddedPeerIds' | 'desiredRemovedPeerIds' | 'desiredPeerCount'> & {
  desiredPeerIds: string[];
  previousDesiredPeerIds?: string[];
};

const topologyLogger = createLogger('TopologyTelemetry', 'topology');

export class TopologyTelemetry {
  private readonly maxEvents: number;
  private readonly emitConsole: boolean;
  private readonly events: TopologyEvent[] = [];
  private readonly lastMaintenanceByWorkspace = new Map<string, TopologyMaintenanceEvent>();

  constructor(opts?: { maxEvents?: number; emitConsole?: boolean }) {
    this.maxEvents = Math.max(1, opts?.maxEvents ?? 250);
    this.emitConsole = opts?.emitConsole !== false;
  }

  recordMaintenanceCycle(payload: MaintenanceRecordInput): TopologyMaintenanceEvent {
    const desiredDiff = diffPeerSets(payload.previousDesiredPeerIds ?? [], payload.desiredPeerIds ?? []);
    const event: TopologyMaintenanceEvent = {
      kind: 'topology.maintenance',
      ts: Date.now(),
      level: payload.level,
      reason: payload.reason,
      workspaceId: payload.workspaceId,
      activeWorkspace: payload.activeWorkspace,
      partialMeshEnabled: payload.partialMeshEnabled,
      candidatePeerCount: payload.candidatePeerCount,
      desiredPeerCount: payload.desiredPeerIds.length,
      connectedPeerCount: payload.connectedPeerCount,
      connectedDesiredPeerCount: payload.connectedDesiredPeerCount,
      connectingDesiredPeerCount: payload.connectingDesiredPeerCount,
      likelyPeerCount: payload.likelyPeerCount,
      coldPeerCount: payload.coldPeerCount,
      anchorPeerIds: [...payload.anchorPeerIds],
      explorerPeerIds: [...payload.explorerPeerIds],
      desiredAddedPeerIds: desiredDiff.addedPeerIds,
      desiredRemovedPeerIds: desiredDiff.removedPeerIds,
      reconnectAttemptsThisSweep: payload.reconnectAttemptsThisSweep,
      pruneCountThisSweep: payload.pruneCountThisSweep,
      safeMinimumRecovery: payload.safeMinimumRecovery,
      safeMinimumTarget: payload.safeMinimumTarget,
      overlapSelectedCount: payload.overlapSelectedCount,
      overlapDesiredPeerIds: [...payload.overlapDesiredPeerIds],
      selectionDurationMs: payload.selectionDurationMs,
      maintenanceDurationMs: payload.maintenanceDurationMs,
      desiredBudget: payload.desiredBudget,
      hardCap: payload.hardCap,
      targetDegree: payload.targetDegree,
    };

    this.lastMaintenanceByWorkspace.set(event.workspaceId, event);
    this.push(event);
    return event;
  }

  recordPeerEvent(payload: Omit<TopologyPeerEvent, 'kind' | 'ts'>): TopologyPeerEvent {
    const event: TopologyPeerEvent = {
      kind: 'topology.peer',
      ts: Date.now(),
      ...payload,
    };
    this.push(event);
    return event;
  }

  recordAnomalyEvent(payload: Omit<TopologyAnomalyEvent, 'kind' | 'ts' | 'level'> | TopologyAnomalyEvent): TopologyAnomalyEvent {
    const event: TopologyAnomalyEvent = (payload as TopologyAnomalyEvent).kind === 'topology.anomaly'
      ? { ...(payload as TopologyAnomalyEvent) }
      : {
          kind: 'topology.anomaly',
          level: 'warn',
          ts: Date.now(),
          ...(payload as Omit<TopologyAnomalyEvent, 'kind' | 'ts' | 'level'>),
        };
    this.push(event);
    return event;
  }

  getRecentEvents(limit = this.maxEvents): TopologyEvent[] {
    return this.events.slice(-Math.max(0, limit));
  }

  getRecentAnomalies(workspaceId?: string, limit = this.maxEvents): TopologyAnomalyEvent[] {
    return this.events
      .filter((event): event is TopologyAnomalyEvent => event.kind === 'topology.anomaly')
      .filter((event) => !workspaceId || event.workspaceId === workspaceId)
      .slice(-Math.max(0, limit));
  }

  getLastMaintenance(workspaceId: string): TopologyMaintenanceEvent | undefined {
    return this.lastMaintenanceByWorkspace.get(workspaceId);
  }

  getDebugSnapshot(workspaceId?: string, limit = 25): TopologyDebugSnapshot {
    const recentEvents = workspaceId
      ? this.events.filter((event) => event.workspaceId === workspaceId).slice(-Math.max(0, limit))
      : this.getRecentEvents(limit);
    const recentAnomalies = this.getRecentAnomalies(workspaceId, limit);
    return {
      lastMaintenance: workspaceId
        ? this.lastMaintenanceByWorkspace.get(workspaceId)
        : (() => { const values = Array.from(this.lastMaintenanceByWorkspace.values()); return values[values.length - 1]; })(),
      recentEvents,
      recentAnomalies,
    };
  }

  clear(): void {
    this.events.splice(0, this.events.length);
    this.lastMaintenanceByWorkspace.clear();
  }

  private push(event: TopologyEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }

    if (!this.emitConsole) return;
    const prefix = event.kind === 'topology.maintenance'
      ? '[Topology]'
      : event.kind === 'topology.anomaly'
        ? '[TopologyAnomaly]'
        : '[TopologyPeer]';
    if (event.level === 'warn') topologyLogger.warn(prefix, event);
    else if (event.level === 'debug') topologyLogger.debug(prefix, event);
    else topologyLogger.info(prefix, event);
  }
}
