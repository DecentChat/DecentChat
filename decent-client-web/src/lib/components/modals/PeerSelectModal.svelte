<!--
  PeerSelectModal.svelte — Reusable modal for selecting a peer/contact from a list.
  Replaces UIRenderer.showCreateDMModal() and showStartDirectMessageModal().
-->
<script lang="ts" module>
  import { mount, unmount } from 'svelte';

  interface PeerOption {
    peerId: string;
    name: string;
    statusClass: string;
    statusTitle: string;
    disabled?: boolean;
  }

  interface PeerSelectConfig {
    title: string;
    label: string;
    peers: PeerOption[];
    onSelect: (peerId: string) => void;
    searchPeers?: (query: string, limit: number) => Promise<PeerOption[]>;
    searchPlaceholder?: string;
    emptyStateText?: string;
  }

  export function showPeerSelectModal(config: PeerSelectConfig): void {
    const target = document.createElement('div');
    document.body.appendChild(target);

    let instance: Record<string, any> | null = null;
    const cleanup = () => {
      if (instance) { unmount(instance); instance = null; }
      target.remove();
    };

    instance = mount(PeerSelectModal, {
      target,
      props: { ...config, onClose: cleanup },
    });
  }

  import PeerSelectModal from './PeerSelectModal.svelte';
</script>

<script lang="ts">
  import { untrack } from 'svelte';

  interface Props {
    title: string;
    label: string;
    peers: PeerOption[];
    onSelect: (peerId: string) => void;
    searchPeers?: (query: string, limit: number) => Promise<PeerOption[]>;
    searchPlaceholder?: string;
    emptyStateText?: string;
    onClose: () => void;
  }

  const SEARCH_LIMIT = 80;

  let {
    title,
    label,
    peers,
    onSelect,
    searchPeers,
    searchPlaceholder = 'Search by name or peer ID…',
    emptyStateText = 'No matches found',
    onClose,
  }: Props = $props();

  let selectedPeerId = $state('');
  let searchQuery = $state('');
  let visiblePeers = $state(untrack(() => peers));
  let searching = $state(false);

  let searchNonce = 0;

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  function filterLocal(query: string): PeerOption[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return peers;

    return peers.filter((peer) => (
      peer.name.toLowerCase().includes(normalizedQuery)
      || peer.peerId.toLowerCase().startsWith(normalizedQuery)
    ));
  }

  $effect(() => {
    const query = searchQuery.trim();

    if (!searchPeers) {
      visiblePeers = filterLocal(query);
      searching = false;
      return;
    }

    const currentNonce = ++searchNonce;
    if (!query) {
      visiblePeers = peers;
    }
    searching = true;

    void (async () => {
      try {
        const matches = await searchPeers(query, SEARCH_LIMIT);
        if (currentNonce !== searchNonce) return;
        visiblePeers = matches;
      } catch (err) {
        console.error('[PeerSelectModal] search failed', err);
        if (currentNonce !== searchNonce) return;
        visiblePeers = [];
      } finally {
        if (currentNonce === searchNonce) searching = false;
      }
    })();
  });

  $effect(() => {
    const selected = visiblePeers.find((peer) => peer.peerId === selectedPeerId);
    if (!selected || selected.disabled) selectedPeerId = '';
  });

  $effect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  });

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    const selected = visiblePeers.find((peer) => peer.peerId === selectedPeerId);
    if (!selected || selected.disabled) return;
    onSelect(selected.peerId);
    onClose();
  }

  function selectPeer(peer: PeerOption) {
    if (peer.disabled) return;
    selectedPeerId = peer.peerId;
  }
</script>

<div class="modal-overlay" onclick={handleOverlayClick} onkeydown={(e) => e.key === 'Escape' && onClose()} role="presentation">
  <div class="modal">
    <h2>{title}</h2>
    <form onsubmit={handleSubmit}>
      <div class="form-group">
        <label for="peer-search-input">{label}</label>
        <input
          type="text"
          id="peer-search-input"
          class="search-field"
          placeholder={searchPlaceholder}
          bind:value={searchQuery}
          autocomplete="off"
        />
        {#if searching}
          <div style="font-size:12px; color: var(--text-muted); margin-top: 6px;">Searching…</div>
        {/if}
        <div class="member-select-list">
          {#if visiblePeers.length === 0}
            <div class="sidebar-item" style="font-size: 12px; opacity: 0.6;">{emptyStateText}</div>
          {:else}
            {#each visiblePeers as peer (peer.peerId)}
              {@const isSelected = selectedPeerId === peer.peerId}
              {@const isDisabled = peer.disabled === true}
              <button
                type="button"
                class="sidebar-item {isDisabled ? 'dm-disallowed' : ''}"
                style="background: var(--surface); margin: 4px 0; border-radius: 6px; color: var(--text); padding: 10px 12px; cursor: {isDisabled ? 'not-allowed' : 'pointer'}; opacity: {isDisabled ? 0.6 : 1}; {isSelected ? 'border: 2px solid var(--accent);' : 'border: 2px solid transparent;'}"
                onclick={() => selectPeer(peer)}
              >
                <span class="dm-status {peer.statusClass}" title={peer.statusTitle}></span>
                {peer.name} ({peer.peerId.slice(0, 8)})
                {#if isDisabled}
                  <span style="font-size:11px; opacity:0.7; margin-left: 6px;">DM disabled</span>
                {/if}
              </button>
            {/each}
          {/if}
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick={onClose}>Cancel</button>
        <button type="submit" class="btn-primary" disabled={!selectedPeerId}>Confirm</button>
      </div>
    </form>
  </div>
</div>
