<!--
  MemberRow.svelte — Reusable sidebar row for workspace members and direct conversations.
-->
<script lang="ts">
  import { peerColor } from '$lib/utils/peer';

  interface CompanyProfile {
    automationKind?: string;
    roleTitle?: string;
    teamId?: string;
    managerPeerId?: string;
    avatarUrl?: string;
  }

  interface Props {
    peerId: string;
    alias: string;
    isOnline: boolean;
    isMe: boolean;
    role?: string;
    isBot?: boolean;
    companySim?: CompanyProfile;
    statusClass?: string;
    statusTitle?: string;
    isActive?: boolean;
    unreadCount?: number;
    metaText?: string;
    disabled?: boolean;
    title?: string;
    onClick?: () => void;
    directConversationId?: string;
    testId?: string;
  }

  let {
    peerId,
    alias,
    isOnline,
    isMe,
    role,
    isBot = false,
    companySim = undefined,
    statusClass = '',
    statusTitle = 'Offline',
    isActive = false,
    unreadCount = 0,
    metaText = '',
    disabled = false,
    title = '',
    onClick,
    directConversationId,
    testId = 'member-row',
  }: Props = $props();

  let initial = $derived(alias.charAt(0).toUpperCase());
  let avatarUrl = $derived(companySim?.avatarUrl);
  let color = $derived(avatarUrl ? 'transparent' : (isBot ? '#7c3aed' : peerColor(peerId)));
  let avatarContent = $derived(avatarUrl ? '' : (isBot ? '🤖' : initial));
  let presenceClass = $derived(isMe ? 'online' : statusClass);
  let presenceTitle = $derived(isMe ? 'Online' : statusTitle);
  let isCompanyAgent = $derived(companySim?.automationKind === 'openclaw-agent');
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="sidebar-item member-row"
  class:active={isActive}
  class:has-unread={unreadCount > 0}
  class:dm-disallowed={disabled}
  data-member-peer-id={directConversationId ? undefined : peerId}
  data-direct-conv-id={directConversationId}
  data-testid={testId}
  {title}
  onclick={onClick}
>
  <div class="member-avatar-sm{isBot ? ' bot-avatar' : ''}{isCompanyAgent ? ' company-agent-avatar' : ''}" style="background: {color}">
    {#if avatarUrl}
      <img src={avatarUrl} alt={alias} class="member-avatar-image" />
    {:else}
      {avatarContent}
    {/if}
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
      {#if isCompanyAgent}
        <span class="member-role-tag company-agent">AGENT</span>
      {/if}
      {#if companySim?.roleTitle}
        <span class="member-company-role" title={companySim.roleTitle}>
          {companySim.roleTitle.split(/\s+/)[0]}
        </span>
      {/if}
      {#if isBot && !isCompanyAgent}
        <span class="member-role-tag bot">BOT</span>
      {/if}
      {#if role === 'owner'}
        <span class="member-role-tag owner">owner</span>
      {:else if role === 'admin'}
        <span class="member-role-tag admin">admin</span>
      {/if}
    </div>
  </div>
  {#if unreadCount > 0 || metaText}
    <div class="member-meta-trailing">
      {#if unreadCount > 0}
        <span class="unread-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
      {:else if metaText}
        <span class="sidebar-item-meta">{metaText}</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .member-company-role {
    font-size: 0.7em;
    opacity: 0.7;
    margin-left: 0.3em;
  }

  .company-agent-avatar {
    position: relative;
  }

  .member-avatar-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
  }
</style>
