/**
 * Bridge Layer — Connects existing vanilla ChatController/UIService state
 * to Svelte's reactivity system.
 *
 * Usage in Svelte components:
 *   import { appState } from '$lib/stores/bridge.svelte';
 *   // Read: appState.activeWorkspaceId
 *   // Write: appState.activeWorkspaceId = 'new-id'
 */

import type { Workspace, PlaintextMessage } from '@decentchat/protocol';

// ── App-wide reactive state ──────────────────────────────────────────────

interface AppState {
  myPeerId: string;
  myAlias: string;
  activeWorkspaceId: string | null;
  activeChannelId: string | null;
  activeDirectConversationId: string | null;
  connectedPeers: Set<string>;
  isOnline: boolean;
}

export const appState: AppState = $state({
  myPeerId: '',
  myAlias: '',
  activeWorkspaceId: null,
  activeChannelId: null,
  activeDirectConversationId: null,
  connectedPeers: new Set(),
  isOnline: false,
});

// ── Vanilla controller reference ─────────────────────────────────────────
// Set once by main.ts after ChatController is created.
// Svelte components call methods through this instead of importing ChatController directly.

let _ctrl: any = null;
let _renderer: any = null;

export function setBridgeController(ctrl: any): void {
  _ctrl = ctrl;
}

export function setBridgeRenderer(renderer: any): void {
  _renderer = renderer;
}

export function getController(): any {
  return _ctrl;
}

export function getRenderer(): any {
  return _renderer;
}

// ── Sync: vanilla state → Svelte stores ──────────────────────────────────
// Call this after any vanilla state mutation to push changes into Svelte reactivity.

export function syncFromVanilla(): void {
  if (!_ctrl) return;
  const state = (window as any).__state;
  if (!state) return;

  appState.myPeerId = state.myPeerId ?? '';
  appState.myAlias = state.myAlias ?? '';
  appState.activeWorkspaceId = state.activeWorkspaceId ?? null;
  appState.activeChannelId = state.activeChannelId ?? null;
  appState.activeDirectConversationId = state.activeDirectConversationId ?? null;
  appState.isOnline = state.connectedPeers?.size > 0;

  if (state.connectedPeers instanceof Set) {
    appState.connectedPeers = new Set(state.connectedPeers);
  }
}

// ── Sync: Svelte stores → vanilla state ──────────────────────────────────
// Call this when Svelte components modify state that vanilla code needs to see.

export function syncToVanilla(): void {
  const state = (window as any).__state;
  if (!state) return;

  state.activeWorkspaceId = appState.activeWorkspaceId;
  state.activeChannelId = appState.activeChannelId;
  state.activeDirectConversationId = appState.activeDirectConversationId;
}
