<!--
  ChannelMembersModal.svelte — Shows channel member list.
  Replaces UIRenderer.showChannelMembersModal().
-->
<script lang="ts" module>
  import { mount, unmount } from 'svelte';

  interface ChannelMembersConfig {
    channelName: string;
    members: Array<{
      peerId: string;
      name: string;
      isOnline: boolean;
      isYou: boolean;
      isBot: boolean;
      color: string;
    }>;
  }

  export function showChannelMembersModal(config: ChannelMembersConfig): void {
    const target = document.createElement('div');
    document.body.appendChild(target);

    let instance: Record<string, any> | null = null;
    const cleanup = () => {
      if (instance) { unmount(instance); instance = null; }
      target.remove();
    };

    instance = mount(ChannelMembersModal, {
      target,
      props: { ...config, onClose: cleanup },
    });
  }

  import ChannelMembersModal from './ChannelMembersModal.svelte';
</script>

<script lang="ts">
  import { escapeHtml } from '$lib/utils/peer';

  interface Props {
    channelName: string;
    members: Array<{
      peerId: string;
      name: string;
      isOnline: boolean;
      isYou: boolean;
      isBot: boolean;
      color: string;
    }>;
    onClose: () => void;
  }

  let { channelName, members, onClose }: Props = $props();

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

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={handleOverlayClick}>
  <div class="modal">
    <h2>Channel Members · #{channelName}</h2>
    <form onsubmit={(e) => { e.preventDefault(); onClose(); }}>
      <div class="form-group" style="margin-bottom: 8px;">
        <div style="font-size: 13px; color: var(--text-muted);">{members.length} member{members.length === 1 ? '' : 's'}</div>
      </div>
      <div class="members-list">
        {#each members as member (member.peerId)}
          <div class="member-row">
            <div class="member-info">
              <div class="member-avatar{member.isBot ? ' bot-avatar' : ''}" style="background:{member.color}">
                {member.isBot ? '🤖' : member.name.charAt(0).toUpperCase()}
              </div>
              <div class="member-details">
                <div class="member-name-line">
                  <span class="member-name">{member.name}</span>
                  {#if member.isYou}<span class="you-badge">you</span>{/if}
                </div>
                <span class="member-status {member.isOnline ? 'online' : 'offline'}">
                  {member.isOnline ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>
          </div>
        {/each}
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick={onClose}>Close</button>
      </div>
    </form>
  </div>
</div>
