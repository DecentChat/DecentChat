import type { SyncDomain } from '../messages/CustodyTypes';
import type {
  ManifestDelta,
  ManifestDiffRequest,
  ManifestDomainVersion,
  SyncManifestSnapshot,
  SyncManifestSummary,
} from './SyncManifest';

export const MANIFEST_STORE_STATE_SCHEMA_VERSION = 1;

export type ManifestDomainState = {
  domain: SyncDomain;
  workspaceId: string;
  channelId?: string;
  version: number;
  itemCount: number;
  checksum?: string;
  lastUpdatedAt: number;
  lastUpdatedBy: string;
};

export type ManifestStoreWorkspaceState = {
  workspaceId: string;
  versions: ManifestDomainState[];
  deltas: ManifestDelta[];
  snapshots: SyncManifestSnapshot[];
};

export type ManifestStoreState = {
  schemaVersion: number;
  workspaces: ManifestStoreWorkspaceState[];
};

type SaveWorkspaceStateFn = (workspaceId: string, state: ManifestStoreWorkspaceState) => Promise<void> | void;
type LoadWorkspaceStateFn = (workspaceId: string) => Promise<ManifestStoreWorkspaceState | null | undefined> | ManifestStoreWorkspaceState | null | undefined;
type DeleteWorkspaceStateFn = (workspaceId: string) => Promise<void> | void;

type DomainState = ManifestDomainState;

type WorkspaceManifestState = {
  versions: Map<string, DomainState>;
  deltas: Map<string, ManifestDelta[]>;
  snapshots: Map<string, SyncManifestSnapshot>;
};

function domainKey(domain: SyncDomain, channelId?: string): string {
  return channelId ? `${domain}:${channelId}` : domain;
}

function normalizeData(data?: Record<string, unknown>): Record<string, unknown> {
  if (!data) return {};
  // Shallow copy is sufficient — IDB structuredClone provides isolation on persist,
  // and we no longer need the expensive JSON.parse(JSON.stringify()) deep clone.
  return { ...data };
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function sanitizeVersionEntry(entry: unknown, fallbackWorkspaceId: string): DomainState | null {
  if (!isRecord(entry)) return null;

  const domain = typeof entry.domain === 'string' ? entry.domain as SyncDomain : null;
  const workspaceId = typeof entry.workspaceId === 'string' && entry.workspaceId.length > 0
    ? entry.workspaceId
    : fallbackWorkspaceId;
  const version = toFiniteNumber(entry.version);
  const itemCount = toFiniteNumber(entry.itemCount);
  const lastUpdatedAt = toFiniteNumber(entry.lastUpdatedAt);
  const lastUpdatedBy = typeof entry.lastUpdatedBy === 'string' ? entry.lastUpdatedBy : null;

  if (!domain || !workspaceId || version === null || itemCount === null || lastUpdatedAt === null || !lastUpdatedBy) {
    return null;
  }

  return {
    domain,
    workspaceId,
    ...(typeof entry.channelId === 'string' ? { channelId: entry.channelId } : {}),
    version,
    itemCount,
    ...(typeof entry.checksum === 'string' ? { checksum: entry.checksum } : {}),
    lastUpdatedAt,
    lastUpdatedBy,
  };
}

function sanitizeDelta(delta: unknown, fallbackWorkspaceId: string): ManifestDelta | null {
  if (!isRecord(delta)) return null;

  const domain = typeof delta.domain === 'string' ? delta.domain as SyncDomain : null;
  const workspaceId = typeof delta.workspaceId === 'string' && delta.workspaceId.length > 0
    ? delta.workspaceId
    : fallbackWorkspaceId;
  const version = toFiniteNumber(delta.version);
  const baseVersion = toFiniteNumber(delta.baseVersion);
  const timestamp = toFiniteNumber(delta.timestamp);
  const opId = typeof delta.opId === 'string' ? delta.opId : null;
  const operation = typeof delta.operation === 'string' ? delta.operation as ManifestDelta['operation'] : null;
  const subject = typeof delta.subject === 'string' ? delta.subject : null;
  const author = typeof delta.author === 'string' ? delta.author : null;

  if (!domain || !workspaceId || version === null || baseVersion === null || timestamp === null || !opId || !operation || !subject || !author) {
    return null;
  }

  return {
    domain,
    workspaceId,
    ...(typeof delta.channelId === 'string' ? { channelId: delta.channelId } : {}),
    version,
    baseVersion,
    opId,
    operation,
    subject,
    data: isRecord(delta.data) ? normalizeData(delta.data) : {},
    timestamp,
    author,
  };
}

function sanitizeSnapshot(snapshot: unknown, fallbackWorkspaceId: string): SyncManifestSnapshot | null {
  if (!isRecord(snapshot)) return null;

  const domain = typeof snapshot.domain === 'string' ? snapshot.domain as SyncDomain : null;
  const workspaceId = typeof snapshot.workspaceId === 'string' && snapshot.workspaceId.length > 0
    ? snapshot.workspaceId
    : fallbackWorkspaceId;
  const version = toFiniteNumber(snapshot.version);
  const basedOnVersion = toFiniteNumber(snapshot.basedOnVersion);
  const createdAt = toFiniteNumber(snapshot.createdAt);
  const createdBy = typeof snapshot.createdBy === 'string' ? snapshot.createdBy : null;
  const snapshotId = typeof snapshot.snapshotId === 'string' ? snapshot.snapshotId : null;

  if (!domain || !workspaceId || version === null || basedOnVersion === null || createdAt === null || !createdBy || !snapshotId) {
    return null;
  }

  const base = {
    domain,
    workspaceId,
    version,
    snapshotId,
    basedOnVersion,
    createdAt,
    createdBy,
    ...(typeof snapshot.checksum === 'string' ? { checksum: snapshot.checksum } : {}),
  } as const;

  if (domain === 'workspace-manifest') {
    if (typeof snapshot.name !== 'string') return null;
    const snapshotVersion = toFiniteNumber(snapshot.snapshotVersion);
    const deltasSince = toFiniteNumber(snapshot.deltasSince);
    if (snapshotVersion === null || deltasSince === null) return null;

    return {
      ...base,
      domain,
      name: snapshot.name,
      ...(typeof snapshot.description === 'string' ? { description: snapshot.description } : {}),
      ...(isRecord(snapshot.policy) ? { policy: deepClone(snapshot.policy) as Record<string, unknown> } : {}),
      snapshotVersion,
      deltasSince,
    };
  }

  if (domain === 'membership') {
    const memberCount = toFiniteNumber(snapshot.memberCount);
    if (memberCount === null || !Array.isArray(snapshot.members)) return null;

    const members = snapshot.members
      .filter((member): member is Record<string, unknown> => isRecord(member) && typeof member.peerId === 'string')
      .map((member) => {
        const role = member.role === 'owner' || member.role === 'admin' || member.role === 'member'
          ? member.role
          : 'member';
        return {
          peerId: member.peerId as string,
          ...(typeof member.alias === 'string' ? { alias: member.alias } : {}),
          role,
          joinedAt: toFiniteNumber(member.joinedAt) ?? 0,
        };
      });

    return {
      ...base,
      domain,
      memberCount,
      members,
    };
  }

  if (domain === 'channel-manifest') {
    const channelCount = toFiniteNumber(snapshot.channelCount);
    if (channelCount === null || !Array.isArray(snapshot.channels)) return null;

    const channels = snapshot.channels
      .filter((channel): channel is Record<string, unknown> => isRecord(channel) && typeof channel.id === 'string')
      .map((channel) => ({
        id: channel.id as string,
        name: typeof channel.name === 'string' ? channel.name : channel.id as string,
        type: typeof channel.type === 'string' ? channel.type : 'channel',
        createdAt: toFiniteNumber(channel.createdAt) ?? 0,
        createdBy: typeof channel.createdBy === 'string' ? channel.createdBy : 'unknown',
      }));

    return {
      ...base,
      domain,
      channelCount,
      channels,
    };
  }

  if (domain === 'channel-message') {
    if (typeof snapshot.channelId !== 'string' || snapshot.channelId.length === 0) return null;
    const messageCount = toFiniteNumber(snapshot.messageCount);
    const minTimestamp = toFiniteNumber(snapshot.minTimestamp);
    const maxTimestamp = toFiniteNumber(snapshot.maxTimestamp);
    if (messageCount === null || minTimestamp === null || maxTimestamp === null || !Array.isArray(snapshot.messageIds)) {
      return null;
    }

    return {
      ...base,
      domain,
      channelId: snapshot.channelId,
      messageCount,
      messageIds: snapshot.messageIds.filter((id): id is string => typeof id === 'string'),
      minTimestamp,
      maxTimestamp,
    };
  }

  return null;
}

function sanitizeWorkspaceState(rawWorkspace: unknown): { workspaceId: string; state: WorkspaceManifestState } | null {
  if (!isRecord(rawWorkspace) || typeof rawWorkspace.workspaceId !== 'string' || rawWorkspace.workspaceId.length === 0) {
    return null;
  }

  const workspaceId = rawWorkspace.workspaceId;
  const versions = new Map<string, DomainState>();
  const deltas = new Map<string, ManifestDelta[]>();
  const snapshots = new Map<string, SyncManifestSnapshot>();

  if (Array.isArray(rawWorkspace.versions)) {
    for (const entry of rawWorkspace.versions) {
      const version = sanitizeVersionEntry(entry, workspaceId);
      if (!version || version.workspaceId !== workspaceId) continue;
      versions.set(domainKey(version.domain, version.channelId), version);
    }
  }

  if (Array.isArray(rawWorkspace.deltas)) {
    // Track seen opIds per domain key for O(1) dedup instead of O(N) .some()
    const seenOpIds = new Map<string, Set<string>>();

    for (const rawDelta of rawWorkspace.deltas) {
      const delta = sanitizeDelta(rawDelta, workspaceId);
      if (!delta || delta.workspaceId !== workspaceId) continue;
      const key = domainKey(delta.domain, delta.channelId);

      let seen = seenOpIds.get(key);
      if (!seen) {
        seen = new Set<string>();
        seenOpIds.set(key, seen);
      }
      if (seen.has(delta.opId)) continue;
      seen.add(delta.opId);

      const existing = deltas.get(key) ?? [];
      existing.push(delta);
      deltas.set(key, existing);
    }

    // Sort once per domain key after all deltas are collected (not per-insert)
    for (const [, domainDeltas] of deltas) {
      domainDeltas.sort((a, b) => a.version - b.version || a.timestamp - b.timestamp || a.opId.localeCompare(b.opId));
    }
  }

  if (Array.isArray(rawWorkspace.snapshots)) {
    for (const rawSnapshot of rawWorkspace.snapshots) {
      const snapshot = sanitizeSnapshot(rawSnapshot, workspaceId);
      if (!snapshot || snapshot.workspaceId !== workspaceId) continue;
      const key = domainKey(snapshot.domain, snapshot.domain === 'channel-message' ? snapshot.channelId : undefined);
      const existing = snapshots.get(key);
      if (!existing || existing.version <= snapshot.version) {
        snapshots.set(key, snapshot);
      }
    }
  }

  if (versions.size === 0 && deltas.size === 0 && snapshots.size === 0) return null;

  return {
    workspaceId,
    state: {
      versions,
      deltas,
      snapshots,
    },
  };
}

export class ManifestStore {
  private readonly workspaces = new Map<string, WorkspaceManifestState>();
  private changeListener: (() => void) | null = null;
  private saveWorkspaceState: SaveWorkspaceStateFn | null = null;
  private loadWorkspaceState: LoadWorkspaceStateFn | null = null;
  private deleteWorkspaceState: DeleteWorkspaceStateFn | null = null;
  private hydratedWorkspaces = new Set<string>();

  setChangeListener(listener: (() => void) | null): void {
    this.changeListener = listener;
  }

  setPersistence(
    saveWorkspaceState: SaveWorkspaceStateFn,
    loadWorkspaceState: LoadWorkspaceStateFn,
    deleteWorkspaceState?: DeleteWorkspaceStateFn,
  ): void {
    this.saveWorkspaceState = saveWorkspaceState;
    this.loadWorkspaceState = loadWorkspaceState;
    this.deleteWorkspaceState = deleteWorkspaceState ?? null;
  }

  async restoreWorkspace(workspaceId: string): Promise<boolean> {
    if (!workspaceId || !this.loadWorkspaceState || this.hydratedWorkspaces.has(workspaceId)) return false;
    this.hydratedWorkspaces.add(workspaceId);

    try {
      const persisted = await this.loadWorkspaceState(workspaceId);
      if (!persisted) return false;
      return this.importWorkspaceState(persisted);
    } catch {
      return false;
    }
  }

  async removeWorkspace(workspaceId: string): Promise<void> {
    this.workspaces.delete(workspaceId);
    this.hydratedWorkspaces.delete(workspaceId);
    if (!this.deleteWorkspaceState) return;
    try {
      await this.deleteWorkspaceState(workspaceId);
    } catch {
      // no-op: persistence cleanup is best effort
    }
  }

  exportWorkspaceState(workspaceId: string): ManifestStoreWorkspaceState | undefined {
    const ws = this.workspaces.get(workspaceId);
    if (!ws) return undefined;

    // Use spread to create shallow copies of each entry.
    // Deep cloning via JSON.parse(JSON.stringify()) is extremely expensive
    // and unnecessary here: the data is plain objects (strings, numbers),
    // and IDB's structuredClone handles isolation on write.
    const versions = [...ws.versions.values()]
      .sort((a, b) => {
        const domainCmp = a.domain.localeCompare(b.domain);
        if (domainCmp !== 0) return domainCmp;
        return (a.channelId ?? '').localeCompare(b.channelId ?? '');
      })
      .map((entry) => ({ ...entry }));

    const deltas = [...ws.deltas.values()]
      .flat()
      .sort((a, b) => {
        const domainCmp = a.domain.localeCompare(b.domain);
        if (domainCmp !== 0) return domainCmp;
        const channelCmp = (a.channelId ?? '').localeCompare(b.channelId ?? '');
        if (channelCmp !== 0) return channelCmp;
        if (a.version !== b.version) return a.version - b.version;
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        return a.opId.localeCompare(b.opId);
      })
      .map((delta) => ({ ...delta, data: delta.data ? { ...delta.data } : {} }));

    const snapshots = [...ws.snapshots.values()]
      .sort((a, b) => {
        const domainCmp = a.domain.localeCompare(b.domain);
        if (domainCmp !== 0) return domainCmp;
        return (('channelId' in a ? a.channelId ?? '' : '')).localeCompare(('channelId' in b ? b.channelId ?? '' : ''));
      })
      .map((snapshot) => ({ ...snapshot }));

    return {
      workspaceId,
      versions,
      deltas,
      snapshots,
    };
  }

  importWorkspaceState(state: unknown): boolean {
    const parsed = sanitizeWorkspaceState(state);
    if (!parsed) return false;
    this.workspaces.set(parsed.workspaceId, parsed.state);
    this.hydratedWorkspaces.add(parsed.workspaceId);
    return true;
  }

  exportState(): ManifestStoreState {
    const workspaces: ManifestStoreWorkspaceState[] = [...this.workspaces.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([workspaceId, ws]) => {
        const versions = [...ws.versions.values()]
          .sort((a, b) => {
            const domainCmp = a.domain.localeCompare(b.domain);
            if (domainCmp !== 0) return domainCmp;
            return (a.channelId ?? '').localeCompare(b.channelId ?? '');
          })
          .map((entry) => ({ ...entry }));

        const deltas = [...ws.deltas.values()]
          .flat()
          .sort((a, b) => {
            const domainCmp = a.domain.localeCompare(b.domain);
            if (domainCmp !== 0) return domainCmp;
            const channelCmp = (a.channelId ?? '').localeCompare(b.channelId ?? '');
            if (channelCmp !== 0) return channelCmp;
            if (a.version !== b.version) return a.version - b.version;
            if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
            return a.opId.localeCompare(b.opId);
          })
          .map((delta) => ({ ...delta, data: delta.data ? { ...delta.data } : {} }));

        const snapshots = [...ws.snapshots.values()]
          .sort((a, b) => {
            const domainCmp = a.domain.localeCompare(b.domain);
            if (domainCmp !== 0) return domainCmp;
            return (('channelId' in a ? a.channelId ?? '' : '')).localeCompare(('channelId' in b ? b.channelId ?? '' : ''));
          })
          .map((snapshot) => ({ ...snapshot }));

        return {
          workspaceId,
          versions,
          deltas,
          snapshots,
        };
      });

    return {
      schemaVersion: MANIFEST_STORE_STATE_SCHEMA_VERSION,
      workspaces,
    };
  }

  importState(state: unknown): void {
    if (!isRecord(state)) return;

    const schemaVersion = toFiniteNumber(state.schemaVersion);
    if (schemaVersion === null || schemaVersion < 1) return;

    const rawWorkspaces = state.workspaces;
    if (!Array.isArray(rawWorkspaces)) return;

    const next = new Map<string, WorkspaceManifestState>();

    for (const rawWorkspace of rawWorkspaces) {
      if (!isRecord(rawWorkspace) || typeof rawWorkspace.workspaceId !== 'string' || rawWorkspace.workspaceId.length === 0) {
        continue;
      }

      const workspaceId = rawWorkspace.workspaceId;
      const versions = new Map<string, DomainState>();
      const deltas = new Map<string, ManifestDelta[]>();
      const snapshots = new Map<string, SyncManifestSnapshot>();

      if (Array.isArray(rawWorkspace.versions)) {
        for (const entry of rawWorkspace.versions) {
          const version = sanitizeVersionEntry(entry, workspaceId);
          if (!version || version.workspaceId !== workspaceId) continue;
          versions.set(domainKey(version.domain, version.channelId), version);
        }
      }

      if (Array.isArray(rawWorkspace.deltas)) {
        for (const rawDelta of rawWorkspace.deltas) {
          const delta = sanitizeDelta(rawDelta, workspaceId);
          if (!delta || delta.workspaceId !== workspaceId) continue;
          const key = domainKey(delta.domain, delta.channelId);
          const existing = deltas.get(key) ?? [];
          if (!existing.some((entry) => entry.opId === delta.opId)) {
            existing.push(delta);
            existing.sort((a, b) => a.version - b.version || a.timestamp - b.timestamp || a.opId.localeCompare(b.opId));
            deltas.set(key, existing);
          }
        }
      }

      if (Array.isArray(rawWorkspace.snapshots)) {
        for (const rawSnapshot of rawWorkspace.snapshots) {
          const snapshot = sanitizeSnapshot(rawSnapshot, workspaceId);
          if (!snapshot || snapshot.workspaceId !== workspaceId) continue;
          const key = domainKey(snapshot.domain, snapshot.domain === 'channel-message' ? snapshot.channelId : undefined);
          const existing = snapshots.get(key);
          if (!existing || existing.version <= snapshot.version) {
            snapshots.set(key, snapshot);
          }
        }
      }

      if (versions.size === 0 && deltas.size === 0 && snapshots.size === 0) continue;

      next.set(workspaceId, {
        versions,
        deltas,
        snapshots,
      });
    }

    if (rawWorkspaces.length > 0 && next.size === 0) {
      // Corrupted payload: keep in-memory state untouched for safety.
      return;
    }

    this.workspaces.clear();
    this.hydratedWorkspaces.clear();
    for (const [workspaceId, ws] of next.entries()) {
      this.workspaces.set(workspaceId, ws);
      this.hydratedWorkspaces.add(workspaceId);
    }
  }

  private notifyChange(workspaceId?: string): void {
    this.persistWorkspaceState(workspaceId);
    if (!this.changeListener) return;
    try {
      this.changeListener();
    } catch {
      // no-op: persistence hooks are best effort
    }
  }

  private persistWorkspaceState(workspaceId?: string): void {
    if (!this.saveWorkspaceState) return;

    const workspaceIds = workspaceId
      ? [workspaceId]
      : [...this.workspaces.keys()];

    for (const id of workspaceIds) {
      const snapshot = this.exportWorkspaceState(id);
      if (!snapshot) continue;
      void Promise.resolve(this.saveWorkspaceState(id, snapshot)).catch(() => {
        // no-op: persistence hooks are best effort
      });
    }
  }

  private ensureWorkspace(workspaceId: string): WorkspaceManifestState {
    const existing = this.workspaces.get(workspaceId);
    if (existing) return existing;
    const created: WorkspaceManifestState = {
      versions: new Map(),
      deltas: new Map(),
      snapshots: new Map(),
    };
    this.workspaces.set(workspaceId, created);
    return created;
  }

  updateDomain(params: {
    domain: SyncDomain;
    workspaceId: string;
    channelId?: string;
    author: string;
    itemCount?: number;
    checksum?: string;
    timestamp?: number;
    opId?: string;
    operation?: ManifestDelta['operation'];
    subject?: string;
    data?: Record<string, unknown>;
  }): ManifestDelta {
    const now = params.timestamp ?? Date.now();
    const ws = this.ensureWorkspace(params.workspaceId);
    const key = domainKey(params.domain, params.channelId);
    const previous = ws.versions.get(key);
    const nextVersion = (previous?.version ?? 0) + 1;

    const state: DomainState = {
      domain: params.domain,
      workspaceId: params.workspaceId,
      ...(params.channelId ? { channelId: params.channelId } : {}),
      version: nextVersion,
      itemCount: params.itemCount ?? previous?.itemCount ?? 0,
      ...(params.checksum ? { checksum: params.checksum } : (previous?.checksum ? { checksum: previous.checksum } : {})),
      lastUpdatedAt: now,
      lastUpdatedBy: params.author,
    };
    ws.versions.set(key, state);

    const delta: ManifestDelta = {
      domain: params.domain,
      workspaceId: params.workspaceId,
      ...(params.channelId ? { channelId: params.channelId } : {}),
      version: nextVersion,
      baseVersion: previous?.version ?? 0,
      opId: params.opId ?? crypto.randomUUID(),
      operation: params.operation ?? 'update',
      subject: params.subject ?? key,
      data: normalizeData(params.data),
      timestamp: now,
      author: params.author,
    };

    const deltas = ws.deltas.get(key) ?? [];
    deltas.push(delta);
    ws.deltas.set(key, deltas);

    this.notifyChange(params.workspaceId);
    return deepClone(delta);
  }

  getVersion(workspaceId: string, domain: SyncDomain, channelId?: string): number {
    const ws = this.workspaces.get(workspaceId);
    if (!ws) return 0;
    return ws.versions.get(domainKey(domain, channelId))?.version ?? 0;
  }

  getSummary(workspaceId: string): SyncManifestSummary {
    const ws = this.workspaces.get(workspaceId);
    if (!ws) {
      return {
        workspaceId,
        generatedAt: Date.now(),
        versions: [],
      };
    }

    const versions: ManifestDomainVersion[] = [...ws.versions.values()]
      .map((entry) => ({
        domain: entry.domain,
        workspaceId: entry.workspaceId,
        ...(entry.channelId ? { channelId: entry.channelId } : {}),
        version: entry.version,
        itemCount: entry.itemCount,
        lastUpdatedAt: entry.lastUpdatedAt,
        lastUpdatedBy: entry.lastUpdatedBy,
        ...(entry.checksum ? { checksum: entry.checksum } : {}),
      }))
      .sort((a, b) => {
        const domainCmp = a.domain.localeCompare(b.domain);
        if (domainCmp !== 0) return domainCmp;
        const aChannel = a.channelId ?? '';
        const bChannel = b.channelId ?? '';
        return aChannel.localeCompare(bChannel);
      });

    const snapshots = [...ws.snapshots.values()].map((snapshot) => ({
      domain: snapshot.domain,
      workspaceId: snapshot.workspaceId,
      ...(snapshot.domain === 'channel-message' && snapshot.channelId ? { channelId: snapshot.channelId } : {}),
      snapshotId: snapshot.snapshotId,
      version: snapshot.version,
      basedOnVersion: snapshot.basedOnVersion,
      createdAt: snapshot.createdAt,
      createdBy: snapshot.createdBy,
    }));

    return {
      workspaceId,
      generatedAt: Date.now(),
      versions,
      ...(snapshots.length > 0 ? { snapshots } : {}),
    };
  }

  buildDiffRequest(workspaceId: string, remote: SyncManifestSummary): ManifestDiffRequest[] {
    const localByKey = new Map<string, ManifestDomainVersion>();
    for (const localVersion of this.getSummary(workspaceId).versions) {
      localByKey.set(domainKey(localVersion.domain, localVersion.channelId), localVersion);
    }

    const requests: ManifestDiffRequest[] = [];
    for (const remoteVersion of remote.versions) {
      const key = domainKey(remoteVersion.domain, remoteVersion.channelId);
      const local = localByKey.get(key);
      const localVersion = local?.version ?? 0;
      if (remoteVersion.version <= localVersion) continue;
      requests.push({
        domain: remoteVersion.domain,
        workspaceId,
        ...(remoteVersion.channelId ? { channelId: remoteVersion.channelId } : {}),
        fromVersion: localVersion,
        toVersion: remoteVersion.version,
      });
    }

    return requests;
  }

  getDeltasSince(params: {
    workspaceId: string;
    domain: SyncDomain;
    channelId?: string;
    fromVersion: number;
    toVersion?: number;
    limit?: number;
  }): ManifestDelta[] {
    const ws = this.workspaces.get(params.workspaceId);
    if (!ws) return [];

    const key = domainKey(params.domain, params.channelId);
    const deltas = ws.deltas.get(key) ?? [];
    const toVersion = params.toVersion ?? Number.MAX_SAFE_INTEGER;
    const limited = deltas
      .filter((delta) => delta.version > params.fromVersion && delta.version <= toVersion)
      .sort((a, b) => a.version - b.version)
      .slice(0, params.limit ?? Number.MAX_SAFE_INTEGER);

    return deepClone(limited);
  }

  applyDelta(delta: ManifestDelta): ManifestDelta {
    const changed = this.applyDeltaInternal(delta);
    if (changed) this.notifyChange(delta.workspaceId);
    return deepClone(delta);
  }

  /**
   * Apply multiple deltas in a batch, only persisting once at the end.
   * This avoids O(N * stateSize) serialization cost from per-delta persistence.
   */
  applyDeltaBatch(deltas: ManifestDelta[]): void {
    const changedWorkspaces = new Set<string>();
    for (const delta of deltas) {
      const changed = this.applyDeltaInternal(delta);
      if (changed) changedWorkspaces.add(delta.workspaceId);
    }
    for (const workspaceId of changedWorkspaces) {
      this.notifyChange(workspaceId);
    }
  }

  private applyDeltaInternal(delta: ManifestDelta): boolean {
    const ws = this.ensureWorkspace(delta.workspaceId);
    const key = domainKey(delta.domain, delta.channelId);
    const existing = ws.deltas.get(key) ?? [];

    let changed = false;
    if (!existing.some((entry) => entry.opId === delta.opId)) {
      // Shallow spread is sufficient — delta data is simple records,
      // and IDB structuredClone provides isolation on persist.
      existing.push({ ...delta, data: delta.data ? { ...delta.data } : {} });
      existing.sort((a, b) => a.version - b.version || a.timestamp - b.timestamp || a.opId.localeCompare(b.opId));
      ws.deltas.set(key, existing);
      changed = true;
    }

    const previous = ws.versions.get(key);
    const currentVersion = previous?.version ?? 0;
    if (delta.version >= currentVersion) {
      const nextState: DomainState = {
        domain: delta.domain,
        workspaceId: delta.workspaceId,
        ...(delta.channelId ? { channelId: delta.channelId } : {}),
        version: delta.version,
        itemCount: Number(delta.data?.itemCount ?? previous?.itemCount ?? 0),
        ...(typeof delta.data?.checksum === 'string'
          ? { checksum: String(delta.data.checksum) }
          : (previous?.checksum ? { checksum: previous.checksum } : {})),
        lastUpdatedAt: delta.timestamp,
        lastUpdatedBy: delta.author,
      };
      ws.versions.set(key, nextState);
      changed = true;
    }

    return changed;
  }

  saveSnapshot(snapshot: SyncManifestSnapshot): void {
    const ws = this.ensureWorkspace(snapshot.workspaceId);
    const key = domainKey(snapshot.domain, snapshot.domain === 'channel-message' ? snapshot.channelId : undefined);
    ws.snapshots.set(key, { ...snapshot });

    const previous = ws.versions.get(key);
    ws.versions.set(key, {
      domain: snapshot.domain,
      workspaceId: snapshot.workspaceId,
      ...(snapshot.domain === 'channel-message' && snapshot.channelId ? { channelId: snapshot.channelId } : {}),
      version: snapshot.version,
      itemCount: this.snapshotItemCount(snapshot),
      ...(snapshot.checksum ? { checksum: snapshot.checksum } : (previous?.checksum ? { checksum: previous.checksum } : {})),
      lastUpdatedAt: snapshot.createdAt,
      lastUpdatedBy: snapshot.createdBy,
    });

    this.notifyChange(snapshot.workspaceId);
  }

  getSnapshot(workspaceId: string, domain: SyncDomain, channelId?: string): SyncManifestSnapshot | null {
    const ws = this.workspaces.get(workspaceId);
    if (!ws) return null;
    const key = domainKey(domain, channelId);
    const snapshot = ws.snapshots.get(key);
    return snapshot ? deepClone(snapshot) : null;
  }

  restoreSnapshot(snapshot: SyncManifestSnapshot, restoredBy: string): ManifestDelta {
    this.saveSnapshot(snapshot);

    return this.updateDomain({
      domain: snapshot.domain,
      workspaceId: snapshot.workspaceId,
      ...(snapshot.domain === 'channel-message' && snapshot.channelId ? { channelId: snapshot.channelId } : {}),
      author: restoredBy,
      itemCount: this.snapshotItemCount(snapshot),
      checksum: snapshot.checksum,
      operation: 'update',
      subject: `snapshot:${snapshot.snapshotId}`,
      data: {
        snapshotId: snapshot.snapshotId,
        restored: true,
        itemCount: this.snapshotItemCount(snapshot),
      },
    });
  }

  private snapshotItemCount(snapshot: SyncManifestSnapshot): number {
    switch (snapshot.domain) {
      case 'workspace-manifest':
        return 1;
      case 'membership':
        return snapshot.memberCount;
      case 'channel-manifest':
        return snapshot.channelCount;
      case 'channel-message':
        return snapshot.messageCount;
      default:
        return 0;
    }
  }
}
