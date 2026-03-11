import { describe, test, expect } from 'bun:test';
import { TopologyAnomalyDetector } from '../../src/app/topology/TopologyAnomalyDetector';
import type { TopologyMaintenanceEvent, TopologyPeerEvent } from '../../src/app/topology/TopologyTelemetry';

function makeMaintenance(partial: Partial<TopologyMaintenanceEvent> = {}): TopologyMaintenanceEvent {
  return {
    kind: 'topology.maintenance',
    level: 'info',
    ts: partial.ts ?? 0,
    reason: partial.reason ?? 'test',
    workspaceId: partial.workspaceId ?? 'ws-1',
    activeWorkspace: partial.activeWorkspace ?? true,
    partialMeshEnabled: partial.partialMeshEnabled ?? true,
    candidatePeerCount: partial.candidatePeerCount ?? 100,
    desiredPeerCount: partial.desiredPeerCount ?? 8,
    connectedPeerCount: partial.connectedPeerCount ?? 8,
    connectedDesiredPeerCount: partial.connectedDesiredPeerCount ?? 8,
    connectingDesiredPeerCount: partial.connectingDesiredPeerCount ?? 0,
    likelyPeerCount: partial.likelyPeerCount ?? 20,
    coldPeerCount: partial.coldPeerCount ?? 80,
    anchorPeerIds: partial.anchorPeerIds ?? ['peer-a', 'peer-b'],
    explorerPeerIds: partial.explorerPeerIds ?? ['peer-x', 'peer-y'],
    desiredAddedPeerIds: partial.desiredAddedPeerIds ?? [],
    desiredRemovedPeerIds: partial.desiredRemovedPeerIds ?? [],
    reconnectAttemptsThisSweep: partial.reconnectAttemptsThisSweep ?? 0,
    pruneCountThisSweep: partial.pruneCountThisSweep ?? 0,
    safeMinimumRecovery: partial.safeMinimumRecovery ?? false,
    safeMinimumTarget: partial.safeMinimumTarget ?? 3,
    overlapSelectedCount: partial.overlapSelectedCount ?? 0,
    overlapDesiredPeerIds: partial.overlapDesiredPeerIds ?? [],
    selectionDurationMs: partial.selectionDurationMs ?? 5,
    maintenanceDurationMs: partial.maintenanceDurationMs ?? 10,
    desiredBudget: partial.desiredBudget ?? 8,
    hardCap: partial.hardCap ?? 12,
    targetDegree: partial.targetDegree ?? 8,
  };
}

function makePeerEvent(partial: Partial<TopologyPeerEvent> = {}): TopologyPeerEvent {
  return {
    kind: 'topology.peer',
    level: partial.level ?? 'info',
    ts: partial.ts ?? 0,
    workspaceId: partial.workspaceId ?? 'ws-1',
    peerId: partial.peerId ?? 'peer-1',
    event: partial.event ?? 'pruned',
    sharedWorkspaceCount: partial.sharedWorkspaceCount,
    reason: partial.reason,
    score: partial.score,
    connected: partial.connected,
    connecting: partial.connecting,
    ready: partial.ready,
    likelyOnline: partial.likelyOnline,
    disconnectCount: partial.disconnectCount,
    connectedAt: partial.connectedAt,
    lastSyncAt: partial.lastSyncAt,
  };
}

describe('TopologyAnomalyDetector', () => {
  test('detects reconnect storm', () => {
    const detector = new TopologyAnomalyDetector({ emitCooldownMs: 0 });
    detector.observeMaintenance(makeMaintenance({ ts: 1_000, reconnectAttemptsThisSweep: 8 }));
    detector.observeMaintenance(makeMaintenance({ ts: 20_000, reconnectAttemptsThisSweep: 7 }));
    const anomalies = detector.observeMaintenance(makeMaintenance({ ts: 40_000, reconnectAttemptsThisSweep: 6 }));
    expect(anomalies.some((a) => a.anomaly === 'reconnect-storm')).toBe(true);
  });

  test('detects desired-set flapping', () => {
    const detector = new TopologyAnomalyDetector({ emitCooldownMs: 0 });
    detector.observeMaintenance(makeMaintenance({ ts: 1_000, desiredPeerCount: 8, desiredAddedPeerIds: ['a', 'b', 'c'], desiredRemovedPeerIds: ['x', 'y'] }));
    detector.observeMaintenance(makeMaintenance({ ts: 11_000, desiredPeerCount: 8, desiredAddedPeerIds: ['d', 'e', 'f'], desiredRemovedPeerIds: ['a', 'b'] }));
    const anomalies = detector.observeMaintenance(makeMaintenance({ ts: 21_000, desiredPeerCount: 8, desiredAddedPeerIds: ['g', 'h', 'i'], desiredRemovedPeerIds: ['d', 'e'] }));
    expect(anomalies.some((a) => a.anomaly === 'desired-set-flapping')).toBe(true);
  });

  test('detects stuck under target', () => {
    const detector = new TopologyAnomalyDetector({ emitCooldownMs: 0 });
    detector.observeMaintenance(makeMaintenance({ ts: 0, desiredPeerCount: 10, candidatePeerCount: 20, connectedDesiredPeerCount: 4 }));
    const anomalies = detector.observeMaintenance(makeMaintenance({ ts: 5 * 60_000 + 1, desiredPeerCount: 10, candidatePeerCount: 20, connectedDesiredPeerCount: 4 }));
    expect(anomalies.some((a) => a.anomaly === 'stuck-under-target')).toBe(true);
  });

  test('detects being below safe minimum too long', () => {
    const detector = new TopologyAnomalyDetector({ emitCooldownMs: 0 });
    detector.observeMaintenance(makeMaintenance({ ts: 0, connectedPeerCount: 2, safeMinimumTarget: 3 }));
    const anomalies = detector.observeMaintenance(makeMaintenance({ ts: 31_000, connectedPeerCount: 2, safeMinimumTarget: 3 }));
    expect(anomalies.some((a) => a.anomaly === 'below-safe-minimum-too-long')).toBe(true);
  });

  test('detects over-prune recovery loop', () => {
    const detector = new TopologyAnomalyDetector({ emitCooldownMs: 0 });
    detector.observeMaintenance(makeMaintenance({ ts: 0, pruneCountThisSweep: 1 }));
    detector.observeMaintenance(makeMaintenance({ ts: 60_000, safeMinimumRecovery: true }));
    detector.observeMaintenance(makeMaintenance({ ts: 120_000, pruneCountThisSweep: 1 }));
    detector.observeMaintenance(makeMaintenance({ ts: 180_000, safeMinimumRecovery: true }));
    detector.observeMaintenance(makeMaintenance({ ts: 240_000, pruneCountThisSweep: 1 }));
    const anomalies = detector.observeMaintenance(makeMaintenance({ ts: 300_000, safeMinimumRecovery: true }));
    expect(anomalies.some((a) => a.anomaly === 'over-prune-recovery-loop')).toBe(true);
  });

  test('detects explorer rotation happening too often', () => {
    const detector = new TopologyAnomalyDetector({ emitCooldownMs: 0, explorerRotationIntervalMs: 180_000 });
    detector.observeMaintenance(makeMaintenance({ ts: 0, explorerPeerIds: ['peer-x', 'peer-y'] }));
    const anomalies = detector.observeMaintenance(makeMaintenance({ ts: 30_000, explorerPeerIds: ['peer-z', 'peer-y'] }));
    expect(anomalies.some((a) => a.anomaly === 'explorer-rotation-too-frequent')).toBe(true);
  });

  test('detects overlap peers being pruned repeatedly', () => {
    const detector = new TopologyAnomalyDetector({ emitCooldownMs: 0 });
    detector.observePeerEvent(makePeerEvent({ ts: 0, peerId: 'peer-overlap', sharedWorkspaceCount: 2, event: 'pruned' }));
    const anomalies = detector.observePeerEvent(makePeerEvent({ ts: 60_000, peerId: 'peer-overlap', sharedWorkspaceCount: 2, event: 'pruned' }));
    expect(anomalies.some((a) => a.anomaly === 'overlap-peer-pruned-repeatedly')).toBe(true);
  });

  test('detects selection computation becoming too slow', () => {
    const detector = new TopologyAnomalyDetector({ emitCooldownMs: 0 });
    const anomalies = detector.observeMaintenance(makeMaintenance({ ts: 0, candidatePeerCount: 10_000, selectionDurationMs: 150 }));
    expect(anomalies.some((a) => a.anomaly === 'selection-too-slow')).toBe(true);
  });
});
