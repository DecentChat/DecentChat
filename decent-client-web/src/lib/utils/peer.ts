/**
 * Peer utility functions — extracted from UIRenderer for use in Svelte components.
 * These are pure functions or use the bridge to access state.
 */

const PEER_COLORS = [
  '#e01e5a',
  '#2eb67d',
  '#ecb22e',
  '#36c5f0',
  '#611f69',
  '#1264a3',
  '#e57373',
  '#4fc3f7',
];

/** Deterministic color for a peer ID */
export function peerColor(peerId: string): string {
  let hash = 0;
  for (let i = 0; i < peerId.length; i++)
    hash = peerId.charCodeAt(i) + ((hash << 5) - hash);
  return PEER_COLORS[Math.abs(hash) % PEER_COLORS.length];
}

/** Escape HTML to prevent XSS */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
