<!--
  MessageInfoModal.svelte — Shows read/delivery receipt details for a message.
  Replaces UIRenderer.showMessageInfo().
-->
<script lang="ts" module>
  import { mount, unmount } from 'svelte';

  interface ReceiptInfo {
    messageId: string;
    channelId: string;
    recipients: Array<{ peerId: string; name: string; at?: number }>;
    delivered: Array<{ peerId: string; name: string; at?: number }>;
    read: Array<{ peerId: string; name: string; at?: number }>;
    pending: Array<{ peerId: string; name: string; at?: number }>;
  }

  export function showMessageInfoModal(info: ReceiptInfo): void {
    const target = document.createElement('div');
    document.body.appendChild(target);

    let instance: Record<string, any> | null = null;
    const cleanup = () => {
      if (instance) { unmount(instance); instance = null; }
      target.remove();
    };

    instance = mount(MessageInfoModal, {
      target,
      props: { info, onClose: cleanup },
    });
  }

  // Self-referencing default export for mount
  import MessageInfoModal from './MessageInfoModal.svelte';
</script>

<script lang="ts">
  import { escapeHtml } from '$lib/utils/peer';

  interface Props {
    info: ReceiptInfo;
    onClose: () => void;
  }

  let { info, onClose }: Props = $props();

  function fmt(ts?: number): string {
    return ts ? new Date(ts).toLocaleString([], { hour12: false }) : '—';
  }

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
</script>

<div class="modal-overlay message-info-overlay" onclick={handleOverlayClick} onkeydown={(e) => e.key === 'Escape' && onClose()} role="presentation">
  <div class="modal message-info-modal">
    <h3>Message Info</h3>

    {#snippet recipientSection(title: string, items: Array<{ peerId: string; name: string; at?: number }>)}
      <div class="message-info-section">
        <div class="message-info-title">{title} <span class="message-info-count">({items.length})</span></div>
        {#if items.length > 0}
          <ul class="message-info-list">
            {#each items as user}
              <li>
                <span class="name">{user.name}</span>
                <span class="peer">{user.peerId.slice(0, 8)}</span>
                <span class="at">{fmt(user.at)}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="message-info-empty">—</div>
        {/if}
      </div>
    {/snippet}

    {@render recipientSection('Read by', info.read)}
    {@render recipientSection('Delivered to', info.delivered)}
    {@render recipientSection('Pending', info.pending)}

    <div class="message-info-actions">
      <button class="btn-secondary" onclick={onClose}>Close</button>
    </div>
  </div>
</div>
