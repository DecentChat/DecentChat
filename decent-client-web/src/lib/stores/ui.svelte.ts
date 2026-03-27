/**
 * UI Store — Reactive Svelte 5 state extracted from UIRenderer private fields.
 *
 * This is the single source of truth for UI state that was previously
 * scattered across UIRenderer's private fields. UIRenderer reads/writes
 * to this store; Svelte components can import directly.
 *
 * Part of the Svelte 5 migration — replaces the mount/unmount prop-passing
 * pattern with reactive stores that components can subscribe to.
 */

import type { Contact, DirectConversation } from '@decentchat/protocol';
import type { HuddleState, HuddleParticipant } from '../../huddle/HuddleManager';

// ── Component ref type ──
export type SvelteComponentRef = Record<string, any> | null;

// ── Huddle state ──
export const huddleUI = $state({
  state: 'inactive' as HuddleState,
  channelId: null as string | null,
  participants: [] as HuddleParticipant[],
  muted: false,
});

// ── Lightbox state ──
export const lightboxUI = $state({
  open: false,
  src: '',
  name: '',
  blobUrl: null as string | null,
});

// ── Activity panel ──
export const activityUI = $state({
  panelOpen: false,
});

// ── Cached data (contacts & direct conversations) ──
export const cachedData = $state({
  contacts: [] as Contact[],
  directConversations: [] as DirectConversation[],
});

// ── Component refs (Svelte mount instances tracked by UIRenderer) ──
export const componentRefs = $state({
  workspaceRail: null as SvelteComponentRef,
  sidebar: null as SvelteComponentRef,
  channelHeader: null as SvelteComponentRef,
  messageList: null as SvelteComponentRef,
  threadList: null as SvelteComponentRef,
  welcome: null as SvelteComponentRef,
  compose: null as SvelteComponentRef,
  threadPanel: null as SvelteComponentRef,
  activityPanel: null as SvelteComponentRef,
  huddleBar: null as SvelteComponentRef,
  searchPanel: null as SvelteComponentRef,
  lightbox: null as SvelteComponentRef,
});
