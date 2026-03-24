type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const normalized = asString(entry).trim();
    if (normalized) out.push(normalized);
  }
  out.sort();
  return out;
}

function encodeField(label: string, value: string): string {
  return `${label}=${encodeURIComponent(value)}`;
}

export function buildWorkspaceStateFingerprint(workspaceId: string, sync: unknown): string {
  const payload = asRecord(sync);

  const channels = Array.isArray(payload.channels)
    ? payload.channels.map((entry) => {
      const channel = asRecord(entry);
      const members = stringList(channel.members).join(',');
      return [
        asString(channel.id).trim(),
        asString(channel.name).trim(),
        asString(channel.type).trim(),
        members,
      ].join('|');
    })
    : [];
  channels.sort();

  const members = Array.isArray(payload.members)
    ? payload.members.map((entry) => {
      const member = asRecord(entry);
      return [
        asString(member.peerId).trim(),
        asString(member.alias).trim(),
        asString(member.role).trim(),
        member.isBot === true ? '1' : '0',
        member.allowWorkspaceDMs === false ? '0' : '1',
      ].join('|');
    })
    : [];
  members.sort();

  const bans = Array.isArray(payload.bans)
    ? payload.bans.map((entry) => {
      const ban = asRecord(entry);
      return [
        asString(ban.peerId).trim(),
        String(Number.isFinite(ban.bannedAt) ? Number(ban.bannedAt) : 0),
      ].join('|');
    })
    : [];
  bans.sort();

  return [
    encodeField('ws', workspaceId),
    encodeField('name', asString(payload.name).trim()),
    encodeField('desc', asString(payload.description).trim()),
    encodeField('invite', asString(payload.inviteCode).trim()),
    encodeField('channels', channels.join(';')),
    encodeField('members', members.join(';')),
    encodeField('bans', bans.join(';')),
  ].join('&');
}

interface SeenEntry {
  fingerprint: string;
  seenAt: number;
}

export class WorkspaceStateSyncDeduper {
  private readonly seen = new Map<string, SeenEntry>();

  constructor(private readonly cooldownMs: number) {}

  shouldProcess(key: string, _peerId: string, fingerprint: string, nowMs = Date.now()): boolean {
    const existing = this.seen.get(key);
    if (
      existing
      && existing.fingerprint === fingerprint
      && nowMs - existing.seenAt < this.cooldownMs
    ) {
      return false;
    }

    this.seen.set(key, { fingerprint, seenAt: nowMs });
    if (this.seen.size > 2048) this.prune(nowMs);
    return true;
  }

  clear(): void {
    this.seen.clear();
  }

  private prune(nowMs: number): void {
    for (const [key, entry] of this.seen) {
      if (nowMs - entry.seenAt >= this.cooldownMs * 4) {
        this.seen.delete(key);
      }
    }
  }
}
