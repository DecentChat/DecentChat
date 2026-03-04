<!--
  Sidebar.svelte — Replaces renderSidebarHTML() in UIRenderer.
  Renders channels, members, DMs, workspace menu.
  Event delegation is preserved via data attributes for backward compatibility.
-->
<script lang="ts">
  import { peerColor, escapeHtml } from '$lib/utils/peer';
  import MemberRow from '../members/MemberRow.svelte';

  interface ChannelInfo {
    id: string;
    name: string;
  }

  interface MemberData {
    peerId: string;
    alias: string;
    isOnline: boolean;
    isMe: boolean;
    role?: string;
    isBot?: boolean;
    statusClass: string;
    statusTitle: string;
  }

  interface DirectConversation {
    id: string;
    contactPeerId: string;
    lastMessageAt: number;
  }

  interface Props {
    workspaceName: string | null;
    channels: ChannelInfo[];
    members: MemberData[];
    directConversations: DirectConversation[];
    activeChannelId: string | null;
    activeDirectConversationId: string | null;
    myPeerId: string;
    getUnreadCount: (id: string) => number;
    getPeerAlias: (peerId: string) => string;
    getPeerStatusClass: (peerId: string) => string;
    getPeerStatusTitle: (peerId: string) => string;
    onChannelClick: (channelId: string) => void;
    onMemberClick: (peerId: string) => void;
    onDirectConvClick: (convId: string) => void;
    onAddChannel: () => void;
    onStartDM: () => void;
    onAddContact: () => void;
    onConnectPeer: () => void;
    onCopyInvite: () => void;
    onShowQR: () => void;
    onCopyPeerId: () => void;
    onWorkspaceSettings: () => void;
    onWorkspaceMembers: () => void;
    onWorkspaceInvite: () => void;
    onWorkspaceNotifications: () => void;
  }

  let {
    workspaceName,
    channels,
    members,
    directConversations,
    activeChannelId,
    activeDirectConversationId,
    myPeerId,
    getUnreadCount,
    getPeerAlias,
    getPeerStatusClass,
    getPeerStatusTitle,
    onChannelClick,
    onMemberClick,
    onDirectConvClick,
    onAddChannel,
    onStartDM,
    onAddContact,
    onConnectPeer,
    onCopyInvite,
    onShowQR,
    onCopyPeerId,
    onWorkspaceSettings,
    onWorkspaceMembers,
    onWorkspaceInvite,
    onWorkspaceNotifications,
  }: Props = $props();

  let isInWorkspace = $derived(workspaceName !== null);
  let onlineMembers = $derived(members.filter(m => m.isOnline));
  let offlineMembers = $derived(members.filter(m => !m.isOnline));
  let sortedConversations = $derived(
    directConversations.slice().sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  );
  let workspaceMenuOpen = $state(false);

  function toggleWorkspaceMenu() {
    workspaceMenuOpen = !workspaceMenuOpen;
  }

  function formatTime(timestamp: number): string {
    if (!timestamp) return 'No messages';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="sidebar-header">
  <img src="/icons/icon-32.png" alt="" class="sidebar-logo" />
  {#if isInWorkspace}
    <button
      class="workspace-menu-trigger"
      id="workspace-menu-trigger"
      title="Workspace menu"
      onclick={toggleWorkspaceMenu}
    >
      <h1>{workspaceName}</h1>
      <span class="workspace-menu-caret">▾</span>
    </button>
  {:else}
    <h1>Workspaces</h1>
  {/if}
  <span class="status-dot"></span>
</div>

{#if isInWorkspace}
  <div class="workspace-menu" id="workspace-menu" style="display:{workspaceMenuOpen ? 'block' : 'none'};">
    <button class="workspace-menu-item" id="workspace-menu-settings"
      onclick={() => { workspaceMenuOpen = false; onWorkspaceSettings(); }}>Workspace settings</button>
    <button class="workspace-menu-item" id="workspace-menu-members"
      onclick={() => { workspaceMenuOpen = false; onWorkspaceMembers(); }}>Members</button>
    <button class="workspace-menu-item" id="workspace-menu-invite"
      onclick={() => { workspaceMenuOpen = false; onWorkspaceInvite(); }}>Invite people</button>
    <button class="workspace-menu-item" id="workspace-menu-notifications"
      onclick={() => { workspaceMenuOpen = false; onWorkspaceNotifications(); }}>Notification prefs</button>
  </div>
{/if}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="sidebar-nav" id="sidebar-nav">
  {#if isInWorkspace}
    <div class="sidebar-section">
      <div class="sidebar-section-header">
        Channels
        <button class="add-btn" id="add-channel-btn" title="Create channel" onclick={onAddChannel}>+</button>
      </div>
      {#each channels as ch (ch.id)}
        {@const unread = getUnreadCount(ch.id)}
        {@const isActive = ch.id === activeChannelId && !activeDirectConversationId}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="sidebar-item {isActive ? 'active' : ''} {unread > 0 ? 'has-unread' : ''}"
          data-channel-id={ch.id}
          onclick={() => onChannelClick(ch.id)}
        >
          <span class="channel-hash">#</span>
          <span>{ch.name}</span>
          {#if unread > 0}
            <span class="unread-badge">{unread > 99 ? '99+' : unread}</span>
          {/if}
        </div>
      {/each}
    </div>

    <div class="sidebar-section" id="workspace-members-section" data-testid="member-list">
      {#if onlineMembers.length > 0}
        <div class="sidebar-section-header member-group-header">Online — {onlineMembers.length}</div>
        <div id="workspace-member-list-online">
          {#each onlineMembers as member (member.peerId)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div onclick={() => onMemberClick(member.peerId)}>
              <MemberRow {...member} />
            </div>
          {/each}
        </div>
      {/if}
      {#if offlineMembers.length > 0}
        <div class="sidebar-section-header member-group-header">Offline — {offlineMembers.length}</div>
        <div id="workspace-member-list-offline" class="members-offline">
          {#each offlineMembers as member (member.peerId)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div onclick={() => onMemberClick(member.peerId)}>
              <MemberRow {...member} />
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <div class="sidebar-section">
      <div class="sidebar-section-header">
        Direct Messages
        <button class="add-btn" id="start-dm-btn" title="Start DM" onclick={onStartDM}>+</button>
      </div>
      <div id="direct-conversation-list" data-testid="direct-conversation-list">
        {#if sortedConversations.length > 0}
          {#each sortedConversations as conv (conv.id)}
            {@const name = getPeerAlias(conv.contactPeerId)}
            {@const isActive = activeDirectConversationId === conv.id}
            {@const unread = getUnreadCount(conv.id)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="sidebar-item {isActive ? 'active' : ''} {unread > 0 ? 'has-unread' : ''}"
              data-direct-conv-id={conv.id}
              data-testid="direct-conversation-item"
              onclick={() => onDirectConvClick(conv.id)}
            >
              <span class="dm-status {getPeerStatusClass(conv.contactPeerId)}" title={getPeerStatusTitle(conv.contactPeerId)}></span>
              <span>{name}</span>
              {#if unread > 0}
                <span class="unread-badge">{unread > 99 ? '99+' : unread}</span>
              {:else}
                <span class="sidebar-item-meta">{formatTime(conv.lastMessageAt)}</span>
              {/if}
            </div>
          {/each}
        {:else}
          <div class="sidebar-item" style="font-size:12px; opacity:0.5;">No direct messages yet</div>
        {/if}
      </div>
    </div>

    <div class="sidebar-section">
      <div class="sidebar-section-header">
        Contacts
        <button class="add-btn" id="add-contact-btn" title="Add Contact" onclick={onAddContact}>+</button>
      </div>
      <div id="contacts-list" data-testid="contacts-list"></div>
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="sidebar-item"
      id="connect-peer-sidebar-btn"
      style="font-size:12px; opacity:0.55; padding-top:6px; padding-bottom:6px;"
      title="Connect to a peer by ID or invite link"
      onclick={onConnectPeer}
    >
      🔌 Connect to peer...
    </div>
  {/if}
</div>

{#if isInWorkspace}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="invite-banner" id="copy-invite" title="Click to copy invite link" onclick={onCopyInvite}>
    Copy invite link
  </div>
{/if}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="invite-banner" id="sidebar-qr-btn" title="Show or scan QR code" style="background: rgba(9, 132, 227, 0.12);" onclick={onShowQR}>
  📱 QR Code
</div>

<div class="sidebar-footer">
  <span class="dm-status online"></span>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <code id="copy-peer-id" title="Click to copy Peer ID" onclick={onCopyPeerId}>
    {myPeerId.slice(0, 20)}...
  </code>
</div>
