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
  }

  interface PeerSelectConfig {
    title: string;
    label: string;
    peers: PeerOption[];
    onSelect: (peerId: string) => void;
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
  interface Props {
    title: string;
    label: string;
    peers: PeerOption[];
    onSelect: (peerId: string) => void;
    onClose: () => void;
  }

  let { title, label, peers, onSelect, onClose }: Props = $props();

  let selectedPeerId = $state('');

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  $effect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  });

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!selectedPeerId) return;
    onSelect(selectedPeerId);
    onClose();
  }

  function selectPeer(peerId: string) {
    selectedPeerId = peerId;
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={handleOverlayClick}>
  <div class="modal">
    <h2>{title}</h2>
    <form onsubmit={handleSubmit}>
      <div class="form-group">
        <label>{label}</label>
        <div class="member-select-list">
          {#each peers as peer (peer.peerId)}
            <div
              class="sidebar-item"
              style="background: var(--surface); margin: 4px 0; border-radius: 6px; color: var(--text); padding: 10px 12px; cursor: pointer; {selectedPeerId === peer.peerId ? 'border: 2px solid var(--accent);' : 'border: 2px solid transparent;'}"
              onclick={() => selectPeer(peer.peerId)}
            >
              <span class="dm-status {peer.statusClass}" title={peer.statusTitle}></span>
              {peer.name} ({peer.peerId.slice(0, 8)})
            </div>
          {/each}
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick={onClose}>Cancel</button>
        <button type="submit" class="btn-primary" disabled={!selectedPeerId}>Confirm</button>
      </div>
    </form>
  </div>
</div>
