import type { ConnectionStatus } from '../stores/appState';

export type ConnectionBannerState = 'connected' | 'idle' | 'connecting' | 'error';

export function getConnectionBannerState(status: ConnectionStatus): ConnectionBannerState {
  if (status === 'connecting') return 'connecting';
  if (status === 'connected') return 'connected';
  if (status === 'disconnected') return 'error';
  return 'idle';
}
