<!--
  ChannelHeader.svelte — Replaces renderChannelHeaderHTML() in UIRenderer.
  Renders the channel header with name, member count, and action buttons.
-->
<script lang="ts">
  interface PresenceSummary {
    onlineCount: number | null;
    sampledOnlineCount: number;
    sampledPeerCount: number;
    hasMore: boolean;
    loadedPages: number;
    activeChannelId?: string;
    updatedAt?: number;
  }

  interface Props {
    // Content
    channelName: string;
    memberCount: number;
    presence: PresenceSummary;
    isDirectMessage: boolean;
    isHuddleActive: boolean;
    // Callbacks
    onHamburger: () => void;
    onHuddleToggle: () => void;
    onConnectPeer: () => void;
    onShowQR: () => void;
    onSearch: () => void;
    onInvite: () => void;
    onSettings: () => void;
    onChannelMembers: () => void;
    onLoadMorePresence: () => Promise<void>;
  }

  let {
    channelName,
    memberCount,
    presence,
    isDirectMessage,
    isHuddleActive,
    onHamburger,
    onHuddleToggle,
    onConnectPeer,
    onShowQR,
    onSearch,
    onInvite,
    onSettings,
    onChannelMembers,
    onLoadMorePresence,
  }: Props = $props();

  let loadingMorePresence = $state(false);

  async function loadMorePresenceSample() {
    if (loadingMorePresence || !presence.hasMore) return;
    loadingMorePresence = true;
    try {
      await onLoadMorePresence();
    } finally {
      loadingMorePresence = false;
    }
  }
</script>

<div class="channel-header" data-testid="channel-header">
  <div class="channel-header-left">
    <button class="icon-btn hamburger" id="hamburger-btn" onclick={onHamburger}>☰</button>
    <h2>{channelName}</h2>
    {#if !isDirectMessage && memberCount > 0}
      <button
        class="member-count"
        id="channel-members-btn"
        title={presence.sampledPeerCount > 0
          ? `View channel members • sampled presence: ${presence.sampledPeerCount}${presence.hasMore ? '+' : ''}`
          : 'View channel members'}
        onclick={onChannelMembers}
      >
        👥 {memberCount}
        {#if presence.onlineCount !== null}
          <span class="member-presence-inline">· 🟢 {presence.onlineCount}</span>
        {/if}
      </button>
      {#if presence.hasMore}
        <button
          class="presence-load-more-btn compact"
          id="header-presence-load-more-btn"
          title="Load more presence samples"
          onclick={loadMorePresenceSample}
          disabled={loadingMorePresence}
        >
          {loadingMorePresence ? '…' : '+'}
        </button>
      {/if}
    {/if}
  </div>
  <div class="channel-header-right">
    {#if !isDirectMessage}
      <button
        class="icon-btn{isHuddleActive ? ' huddle-start-btn active' : ''}"
        id="huddle-start-btn"
        title="Start Huddle"
        onclick={onHuddleToggle}
      >🎧</button>
    {/if}
    <button class="icon-btn" id="connect-peer-header-btn" title="Connect to peer" onclick={onConnectPeer}>🔌</button>
    {#if !isDirectMessage}
      <button class="icon-btn" id="qr-btn" title="QR Code" onclick={onShowQR}>📱</button>
    {/if}
    <button class="icon-btn" id="search-btn" title="Search messages (Ctrl+F)" onclick={onSearch}>🔍</button>
    {#if !isDirectMessage}
      <button class="icon-btn" id="invite-btn" title="Invite code" onclick={onInvite}>🔗</button>
    {/if}
    <button class="icon-btn" id="settings-btn" title="Settings" onclick={onSettings}>⚙️</button>
  </div>
</div>
