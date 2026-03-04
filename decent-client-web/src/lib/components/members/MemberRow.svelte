<!--
  MemberRow.svelte — Single member row in the sidebar member list.
  Replaces the renderMemberRow() function in UIRenderer.
-->
<script lang="ts">
  import { peerColor } from '$lib/utils/peer';

  interface Props {
    peerId: string;
    alias: string;
    isOnline: boolean;
    isMe: boolean;
    role?: string;
    isBot?: boolean;
    statusClass?: string;
    statusTitle?: string;
  }

  let { peerId, alias, isOnline, isMe, role, isBot = false, statusClass = '', statusTitle = 'Offline' }: Props = $props();

  let initial = $derived(alias.charAt(0).toUpperCase());
  let color = $derived(isBot ? '#7c3aed' : peerColor(peerId));
  let avatarContent = $derived(isBot ? '🤖' : initial);
  let presenceClass = $derived(isMe ? 'online' : statusClass);
  let presenceTitle = $derived(isMe ? 'Online' : statusTitle);
</script>

<div class="sidebar-item member-row" data-member-peer-id={peerId} data-testid="member-row">
  <div class="member-avatar-sm{isBot ? ' bot-avatar' : ''}" style="background: {color}">
    {avatarContent}
    <span class="dm-status {presenceClass}" title={presenceTitle}></span>
  </div>
  <div class="member-name-wrapper">
    <div class="member-name-inline">
      <span class="member-name-text">
        {alias}
        {#if isMe}
          <span class="sidebar-item-meta">(you)</span>
        {/if}
      </span>
      {#if isBot}
        <span class="member-role-tag bot">BOT</span>
      {/if}
      {#if role === 'owner'}
        <span class="member-role-tag owner">owner</span>
      {:else if role === 'admin'}
        <span class="member-role-tag admin">admin</span>
      {/if}
    </div>
  </div>
</div>
