import { derived, writable } from 'svelte/store';
import type { Channel, PlaintextMessage, Workspace } from '@decentchat/protocol';

export type ConnectionStatus = 'disconnected' | 'idle' | 'connecting' | 'connected';

const MESSAGES_SENT_STORAGE_KEY = 'decentchat-messages-sent';
const SEED_BACKED_UP_STORAGE_KEY = 'decentchat-seed-backed-up';

function readNumberFromStorage(key: string, fallback = 0): number {
  if (typeof window === 'undefined') return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;

    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function readBooleanFromStorage(key: string, fallback = false): boolean {
  if (typeof window === 'undefined') return fallback;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;

    return raw === 'true';
  } catch {
    return fallback;
  }
}

export function persistMessagesSent(value: number): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(MESSAGES_SENT_STORAGE_KEY, String(Math.max(0, Math.trunc(value))));
  } catch {
    // Best effort only.
  }
}

export function persistSeedBackedUp(value: boolean): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(SEED_BACKED_UP_STORAGE_KEY, value ? 'true' : 'false');
  } catch {
    // Best effort only.
  }
}

export const workspaces = writable<Workspace[]>([]);
export const activeWorkspaceId = writable<string | null>(null);

export const channels = derived<[typeof workspaces, typeof activeWorkspaceId], Channel[]>(
  [workspaces, activeWorkspaceId],
  ([$workspaces, $activeWorkspaceId]) => {
    if (!$activeWorkspaceId) return [];
    const workspace = $workspaces.find((item) => item.id === $activeWorkspaceId);
    return workspace?.channels ?? [];
  },
);

export const messages = writable<Record<string, PlaintextMessage[]>>({});
export const typingByChannel = writable<Record<string, string[]>>({});

export function setTypingForChannel(channelId: string, peerIds: string[]): void {
  typingByChannel.update((current) => ({
    ...current,
    [channelId]: [...new Set(peerIds)],
  }));
}

export function updateTypingForChannel(channelId: string, peerId: string, isTyping: boolean): void {
  typingByChannel.update((current) => {
    const existing = new Set(current[channelId] ?? []);
    if (isTyping) existing.add(peerId);
    else existing.delete(peerId);

    return {
      ...current,
      [channelId]: Array.from(existing),
    };
  });
}

export function removeTypingPeer(peerId: string): void {
  typingByChannel.update((current) => {
    const next: Record<string, string[]> = {};
    for (const [channelId, peers] of Object.entries(current)) {
      next[channelId] = peers.filter((candidate) => candidate !== peerId);
    }
    return next;
  });
}

export const connectionStatus = writable<ConnectionStatus>('disconnected');
export const connectedPeers = writable<string[]>([]);

export const myPeerId = writable<string | null>(null);
export const myAlias = writable('');

export const messagesSent = writable<number>(readNumberFromStorage(MESSAGES_SENT_STORAGE_KEY, 0));
export const seedBackedUp = writable<boolean>(readBooleanFromStorage(SEED_BACKED_UP_STORAGE_KEY, false));
