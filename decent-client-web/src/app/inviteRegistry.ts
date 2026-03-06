import type { InviteData } from 'decent-protocol';

export interface WorkspaceInviteRecord {
  inviteId: string;
  inviteCode?: string;
  url?: string;
  createdAt?: number;
  expiresAt?: number;
  inviterId?: string;
  permanent?: boolean;
  revokedAt?: number;
}

export interface WorkspaceInviteView {
  inviteId: string;
  inviteCode?: string;
  url?: string;
  createdAt?: number;
  expiresAt?: number;
  inviterId?: string;
  permanent: boolean | null;
  revoked: boolean;
  revokedAt?: number;
}

export interface WorkspaceInviteLists {
  active: WorkspaceInviteView[];
  revoked: WorkspaceInviteView[];
}

export type WorkspaceInviteRegistry = Record<string, WorkspaceInviteRecord[]>;

function toPositiveNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeRecord(input: any): WorkspaceInviteRecord | null {
  if (!input || typeof input !== 'object') return null;

  const inviteId = toTrimmedString(input.inviteId);
  if (!inviteId) return null;

  const expiresAt = toPositiveNumber(input.expiresAt);
  const permanentFromInput = typeof input.permanent === 'boolean' ? input.permanent : undefined;

  return {
    inviteId,
    inviteCode: toTrimmedString(input.inviteCode),
    url: toTrimmedString(input.url),
    createdAt: toPositiveNumber(input.createdAt),
    expiresAt,
    inviterId: toTrimmedString(input.inviterId),
    permanent: permanentFromInput ?? (expiresAt ? false : undefined),
    revokedAt: toPositiveNumber(input.revokedAt),
  };
}

export function normalizeWorkspaceInviteRegistry(raw: unknown): WorkspaceInviteRegistry {
  const normalized: WorkspaceInviteRegistry = {};
  if (!raw || typeof raw !== 'object') return normalized;

  for (const [workspaceId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;

    const byId = new Map<string, WorkspaceInviteRecord>();

    for (const item of value) {
      const record = normalizeRecord(item);
      if (!record) continue;

      const existing = byId.get(record.inviteId);
      if (!existing) {
        byId.set(record.inviteId, record);
        continue;
      }

      const existingCreatedAt = existing.createdAt || 0;
      const recordCreatedAt = record.createdAt || 0;
      if (recordCreatedAt >= existingCreatedAt) {
        byId.set(record.inviteId, { ...existing, ...record });
      }
    }

    normalized[workspaceId] = Array.from(byId.values()).sort(
      (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    );
  }

  return normalized;
}

export function recordGeneratedInvite(
  registry: WorkspaceInviteRegistry,
  workspaceId: string,
  inviteData: InviteData,
  url: string,
  now = Date.now(),
): WorkspaceInviteRegistry {
  const inviteId = toTrimmedString(inviteData.inviteId);
  if (!inviteId) return registry;

  const createdAt = now;
  const expiresAt = toPositiveNumber(inviteData.expiresAt);
  const nextRecord: WorkspaceInviteRecord = {
    inviteId,
    inviteCode: toTrimmedString(inviteData.inviteCode),
    url: toTrimmedString(url),
    createdAt,
    expiresAt,
    inviterId: toTrimmedString(inviteData.inviterId),
    permanent: expiresAt ? false : true,
  };

  const current = registry[workspaceId] || [];
  const existing = current.find((entry) => entry.inviteId === inviteId);
  const merged: WorkspaceInviteRecord = {
    ...(existing || {}),
    ...nextRecord,
  };

  const filtered = current.filter((entry) => entry.inviteId !== inviteId);
  const nextWorkspaceInvites = [merged, ...filtered].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return {
    ...registry,
    [workspaceId]: nextWorkspaceInvites,
  };
}

export function markInviteRevokedInRegistry(
  registry: WorkspaceInviteRegistry,
  workspaceId: string,
  inviteIdRaw: string,
  revokedAt = Date.now(),
): WorkspaceInviteRegistry {
  const inviteId = toTrimmedString(inviteIdRaw);
  if (!inviteId) return registry;

  const current = registry[workspaceId] || [];
  const existing = current.find((entry) => entry.inviteId === inviteId);
  const revokedRecord: WorkspaceInviteRecord = {
    ...(existing || { inviteId, createdAt: revokedAt }),
    inviteId,
    revokedAt,
  };

  const filtered = current.filter((entry) => entry.inviteId !== inviteId);
  const nextWorkspaceInvites = [revokedRecord, ...filtered].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return {
    ...registry,
    [workspaceId]: nextWorkspaceInvites,
  };
}

export function buildWorkspaceInviteLists(
  registry: WorkspaceInviteRegistry,
  workspaceId: string,
  revokedInviteIds: string[] = [],
): WorkspaceInviteLists {
  const byId = new Map<string, WorkspaceInviteView>();
  const records = registry[workspaceId] || [];

  for (const record of records) {
    byId.set(record.inviteId, {
      inviteId: record.inviteId,
      inviteCode: record.inviteCode,
      url: record.url,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      inviterId: record.inviterId,
      permanent: typeof record.permanent === 'boolean' ? record.permanent : (record.expiresAt ? false : null),
      revoked: !!record.revokedAt,
      revokedAt: record.revokedAt,
    });
  }

  for (const rawId of revokedInviteIds) {
    const inviteId = toTrimmedString(rawId);
    if (!inviteId) continue;

    const existing = byId.get(inviteId);
    if (existing) {
      existing.revoked = true;
      continue;
    }

    byId.set(inviteId, {
      inviteId,
      permanent: null,
      revoked: true,
    });
  }

  const all = Array.from(byId.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return {
    active: all.filter((invite) => !invite.revoked),
    revoked: all.filter((invite) => invite.revoked),
  };
}
