import { derived, writable } from 'svelte/store';

export type ActiveHuddle = {
  huddleId: string;
  channelId: string;
  participants: string[];
  isMuted: boolean;
};

export type RecentCallType = 'incoming' | 'outgoing' | 'missed';

export type RecentCall = {
  peerId: string;
  peerName: string;
  timestamp: number;
  duration: number;
  type: RecentCallType;
};

export type ConnectionQuality = 'connecting' | 'good' | 'poor';

export type IncomingCall = {
  fromPeerId: string;
  channelId: string;
};

export const activeHuddle = writable<ActiveHuddle | null>(null);
export const recentCalls = writable<RecentCall[]>([]);
export const callConnectionQuality = writable<ConnectionQuality>('connecting');
export const incomingCall = writable<IncomingCall | null>(null);

export const isInCall = derived(activeHuddle, ($activeHuddle) => $activeHuddle !== null);

export function addRecentCall(call: RecentCall): void {
  recentCalls.update((calls) => [call, ...calls].slice(0, 50));
}
