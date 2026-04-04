<!--
  ChannelHeader.svelte — Replaces renderChannelHeaderHTML() in UIRenderer.
  Renders the channel header with name, member count, and action buttons.
  Secondary actions are grouped behind an overflow (⋯) menu.
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
    /** When false, hides action buttons (no channel/DM selected). */
    hasActiveChannel?: boolean;
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
    hasActiveChannel = true,
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
  let overflowOpen = $state(false);

  async function loadMorePresenceSample() {
    if (loadingMorePresence || !presence.hasMore) return;
    loadingMorePresence = true;
    try {
      await onLoadMorePresence();
    } finally {
      loadingMorePresence = false;
    }
  }

  function toggleOverflow() {
    overflowOpen = !overflowOpen;
  }

  function closeOverflow() {
    overflowOpen = false;
  }

  function handleOverflowAction(action: () => void) {
    action();
    closeOverflow();
  }

  function handleOverflowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      closeOverflow();
    }
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.overflow-wrapper')) {
      closeOverflow();
    }
  }
</script>

<svelte:document onclick={overflowOpen ? handleClickOutside : undefined} />

<div class="channel-header" data-testid="channel-header">
  <div class="channel-header-left">
    <button class="icon-btn hamburger" id="hamburger-btn" onclick={onHamburger}>☰</button>
    <h2>{channelName}</h2>
    {#if hasActiveChannel && !isDirectMessage && memberCount > 0}
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
  {#if hasActiveChannel}
    <div class="channel-header-right">
      <!-- Primary actions: always visible -->
      <button class="icon-btn" id="search-btn" title="Search messages (Ctrl+F)" onclick={onSearch}>🔍</button>
      <button class="icon-btn" id="settings-btn" title="Settings" onclick={onSettings}>⚙️</button>

      <!-- Overflow menu: secondary actions -->
      {#if !isDirectMessage}
        <div class="overflow-wrapper" onkeydown={handleOverflowKeydown} role="menu" tabindex="-1">
          <button
            class="icon-btn overflow-trigger"
            id="overflow-menu-btn"
            title="More actions"
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            onclick={toggleOverflow}
          >⋯</button>
          {#if overflowOpen}
            <div class="overflow-menu" role="menu">
              <button
                class="overflow-menu-item{isHuddleActive ? ' active' : ''}"
                role="menuitem"
                id="huddle-start-btn"
                onclick={() => handleOverflowAction(onHuddleToggle)}
              >
                <span class="overflow-menu-icon">🎧</span>
                <span>{isHuddleActive ? 'Leave Huddle' : 'Start Huddle'}</span>
              </button>
              <button
                class="overflow-menu-item"
                role="menuitem"
                id="connect-peer-header-btn"
                onclick={() => handleOverflowAction(onConnectPeer)}
              >
                <span class="overflow-menu-icon">🔌</span>
                <span>Connect to peer</span>
              </button>
              <button
                class="overflow-menu-item"
                role="menuitem"
                id="qr-btn"
                onclick={() => handleOverflowAction(onShowQR)}
              >
                <span class="overflow-menu-icon">📱</span>
                <span>QR Code</span>
              </button>
              <button
                class="overflow-menu-item"
                role="menuitem"
                id="invite-btn"
                onclick={() => handleOverflowAction(onInvite)}
              >
                <span class="overflow-menu-icon">🔗</span>
                <span>Invite code</span>
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
