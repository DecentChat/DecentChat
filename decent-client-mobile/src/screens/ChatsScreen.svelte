<svelte:options runes={true} />

<script lang="ts">
  import type { Contact, DirectConversation } from 'decent-protocol';
  import ScreenHeader from '../components/ScreenHeader.svelte';
  import { messages, myPeerId, workspaces } from '../stores/appState';
  import type { MobileController } from '../app/MobileController';

  type Props = {
    controller: MobileController | null;
    onOpenChannel?: ((channelId: string) => void) | undefined;
  };

  type ConversationPreview = {
    id: string;
    kind: 'dm' | 'channel';
    name: string;
    subtitle?: string;
    preview: string;
    time: string;
    avatar: string;
    unreadCount: number;
    lastTimestamp: number;
    peerId?: string;
  };

  const REFRESH_THRESHOLD = 74;
  const MAX_PULL = 130;

  let { controller, onOpenChannel }: Props = $props();

  let listEl = $state<HTMLElement | null>(null);
  let canPull = $state(false);
  let isTouching = $state(false);
  let startY = $state(0);
  let startX = $state(0);
  let pullOffset = $state(0);
  let refreshing = $state(false);

  let directConversations = $state<DirectConversation[]>([]);
  let contacts = $state<Contact[]>([]);

  let composerOpen = $state(false);
  let contactPickerOpen = $state(false);
  let creatingWorkspace = $state(false);
  let workspaceName = $state('');

  const refreshProgress = $derived(Math.min(pullOffset / REFRESH_THRESHOLD, 1));
  const indicatorVisible = $derived(refreshing || pullOffset > 2);
  const indicatorReady = $derived(refreshing || pullOffset >= REFRESH_THRESHOLD);

  const dmPreviews = $derived.by<ConversationPreview[]>(() =>
    directConversations.map((conversation) => {
      const channelMessages = $messages[conversation.id] ?? [];
      const lastMessage = channelMessages[channelMessages.length - 1];
      const contact = contacts.find((item) => item.peerId === conversation.contactPeerId) || null;
      const displayName = contact?.displayName || controller?.getPeerDisplayName(conversation.contactPeerId) || conversation.contactPeerId.slice(0, 8);
      const unreadCount = channelMessages.filter(
        (message) => message.senderId !== $myPeerId && message.status !== 'read',
      ).length;

      const lastTimestamp = Math.max(conversation.lastMessageAt || 0, lastMessage?.timestamp ?? 0);

      return {
        id: conversation.id,
        kind: 'dm',
        peerId: conversation.contactPeerId,
        name: displayName,
        preview: lastMessage?.content || 'No messages yet',
        time: lastMessage ? formatTimestamp(lastMessage.timestamp) : '',
        avatar: displayName.trim() ? displayName.trim().slice(0, 1).toUpperCase() : '?',
        unreadCount,
        lastTimestamp,
      };
    }),
  );

  const workspacePreviews = $derived.by<ConversationPreview[]>(() => {
    const previews: ConversationPreview[] = [];

    for (const workspace of $workspaces) {
      for (const channel of workspace.channels) {
        const channelMessages = $messages[channel.id] ?? [];
        const lastMessage = channelMessages[channelMessages.length - 1];
        const unreadCount = channelMessages.filter(
          (message) => message.senderId !== $myPeerId && message.status !== 'read',
        ).length;

        previews.push({
          id: channel.id,
          kind: 'channel',
          name: `#${channel.name}`,
          subtitle: workspace.name,
          preview: lastMessage?.content || 'No messages yet',
          time: lastMessage ? formatTimestamp(lastMessage.timestamp) : '',
          avatar: '#',
          unreadCount,
          lastTimestamp: lastMessage?.timestamp ?? 0,
        });
      }
    }

    return previews;
  });

  const conversations = $derived.by<ConversationPreview[]>(() =>
    [...dmPreviews, ...workspacePreviews].sort((a, b) => b.lastTimestamp - a.lastTimestamp),
  );

  const totalUnreadCount = $derived(conversations.reduce((sum, item) => sum + item.unreadCount, 0));

  const availableContacts = $derived(
    [...contacts].sort((a, b) => a.displayName.localeCompare(b.displayName)),
  );

  $effect(() => {
    controller;
    $messages;
    void refreshDirectData();
  });

  async function refreshDirectData(): Promise<void> {
    if (!controller) {
      directConversations = [];
      contacts = [];
      return;
    }

    directConversations = await controller.listDirectConversations();
    contacts = await controller.listContacts();
  }

  function openChannel(channelId: string): void {
    composerOpen = false;
    contactPickerOpen = false;
    onOpenChannel?.(channelId);
  }

  function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    return new Intl.DateTimeFormat(undefined, isToday
      ? { hour: '2-digit', minute: '2-digit' }
      : { month: 'short', day: 'numeric' }).format(date);
  }

  async function startDirectMessage(contact: Contact): Promise<void> {
    if (!controller) return;

    const conversation = await controller.startDirectMessage(contact.peerId);
    if (!conversation) return;

    await refreshDirectData();
    openChannel(conversation.id);
  }

  async function createWorkspaceFromComposer(): Promise<void> {
    const name = workspaceName.trim();
    if (!name || !controller || creatingWorkspace) return;

    creatingWorkspace = true;

    try {
      const workspace = await controller.createWorkspace(name);
      workspaceName = '';
      composerOpen = false;

      const firstChannelId = workspace?.channels[0]?.id;
      if (firstChannelId) {
        openChannel(firstChannelId);
      }
    } finally {
      creatingWorkspace = false;
    }
  }

  function handleTouchStart(event: TouchEvent): void {
    if (refreshing || event.touches.length !== 1) return;

    const topReached = (listEl?.scrollTop ?? 0) <= 0;
    if (!topReached) {
      canPull = false;
      return;
    }

    const touch = event.touches[0];
    canPull = true;
    isTouching = true;
    startY = touch.clientY;
    startX = touch.clientX;
  }

  function handleTouchMove(event: TouchEvent): void {
    if (!canPull || !isTouching || event.touches.length !== 1 || refreshing) return;

    const touch = event.touches[0];
    const deltaY = touch.clientY - startY;
    const deltaX = Math.abs(touch.clientX - startX);

    if (deltaY <= 0) {
      pullOffset = 0;
      return;
    }

    if (deltaX > deltaY * 0.9) {
      canPull = false;
      pullOffset = 0;
      return;
    }

    event.preventDefault();

    const eased = Math.min(MAX_PULL, deltaY * 0.42);
    pullOffset = eased;
  }

  function handleTouchEnd(): void {
    if (!canPull && !isTouching) return;

    canPull = false;
    isTouching = false;

    if (pullOffset >= REFRESH_THRESHOLD) {
      void triggerRefresh();
      return;
    }

    pullOffset = 0;
  }

  async function triggerRefresh(): Promise<void> {
    if (refreshing) return;

    refreshing = true;
    pullOffset = 54;

    const startedAt = Date.now();

    try {
      await controller?.refresh();
      await refreshDirectData();
    } catch {
      // Best-effort refresh only.
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed < 520) {
      await new Promise<void>((resolve) => setTimeout(resolve, 520 - elapsed));
    }

    refreshing = false;
    pullOffset = 0;
  }
</script>

<section class="screen">
  <ScreenHeader
    title="Chats"
    subtitle={totalUnreadCount > 0 ? `${totalUnreadCount} unread` : 'All conversations'}
    largeTitle={true}
  />

  <div
    class="chat-list-shell"
    role="presentation"
    ontouchstart={handleTouchStart}
    ontouchmove={handleTouchMove}
    ontouchend={handleTouchEnd}
    ontouchcancel={handleTouchEnd}
  >
    <div
      class="pull-indicator"
      data-visible={indicatorVisible}
      data-ready={indicatorReady}
      data-refreshing={refreshing}
      style:opacity={indicatorVisible ? Math.min(1, 0.35 + refreshProgress * 0.75) : 0}
      style:transform={`translateY(${Math.max(-16, pullOffset - 38)}px)`}
    >
      <span class="spinner" aria-hidden="true"></span>
      <span>{refreshing ? 'Refreshing…' : indicatorReady ? 'Release to refresh' : 'Pull to refresh'}</span>
    </div>

    <div
      class="chat-list"
      data-animating={!isTouching}
      style:transform={`translateY(${pullOffset}px)`}
      bind:this={listEl}
      role="list"
    >
      {#if conversations.length === 0}
        <p class="empty-state">No conversations yet. Start a DM or create a workspace.</p>
      {:else}
        {#each conversations as conversation (conversation.id)}
          <button type="button" class="conversation-row" onclick={() => openChannel(conversation.id)}>
            <div class="avatar" data-kind={conversation.kind} aria-hidden="true">{conversation.avatar}</div>

            <div class="content">
              <div class="top-row">
                <p class="name">{conversation.name}</p>
                <time>{conversation.time}</time>
              </div>

              <div class="bottom-row">
                <p class="preview">{conversation.preview}</p>
                {#if conversation.unreadCount > 0}
                  <span class="badge" aria-label={`${conversation.unreadCount} unread messages`}>{conversation.unreadCount}</span>
                {/if}
              </div>

              {#if conversation.kind === 'channel' && conversation.subtitle}
                <p class="workspace-name">{conversation.subtitle}</p>
              {/if}
            </div>
          </button>
        {/each}
      {/if}
    </div>
  </div>

  <button
    class="fab"
    type="button"
    aria-label="New chat"
    onclick={() => {
      composerOpen = !composerOpen;
      contactPickerOpen = false;
    }}
  >
    New chat
  </button>

  {#if composerOpen}
    <div class="composer-sheet" role="dialog" aria-label="New chat actions">
      <button type="button" class="sheet-action" onclick={() => (contactPickerOpen = !contactPickerOpen)}>
        Start new DM
      </button>

      {#if contactPickerOpen}
        {#if availableContacts.length === 0}
          <p class="sheet-empty">No contacts yet. Add someone in the Contacts tab.</p>
        {:else}
          <div class="contact-picker">
            {#each availableContacts as contact (contact.peerId)}
              <button type="button" class="sheet-contact" onclick={() => void startDirectMessage(contact)}>
                <span class="sheet-contact-avatar" aria-hidden="true">{contact.displayName.slice(0, 1).toUpperCase()}</span>
                <span>{contact.displayName}</span>
              </button>
            {/each}
          </div>
        {/if}
      {/if}

      <form class="workspace-form" onsubmit={(event) => {
        event.preventDefault();
        void createWorkspaceFromComposer();
      }}>
        <label for="new-workspace-name">Create workspace</label>
        <input
          id="new-workspace-name"
          type="text"
          placeholder="Workspace name"
          bind:value={workspaceName}
        />
        <button type="submit" disabled={!workspaceName.trim() || creatingWorkspace}>
          {creatingWorkspace ? 'Creating…' : 'Create workspace'}
        </button>
      </form>
    </div>
  {/if}
</section>

<style>
  .screen {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--color-bg);
    position: relative;
  }

  .chat-list-shell {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    background: var(--color-bg);
  }

  .pull-indicator {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    z-index: 5;
    height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    color: var(--color-text-muted);
    font-size: 12px;
    font-weight: 600;
    pointer-events: none;
    transition: opacity 0.2s ease, transform 0.2s ease;
  }

  .pull-indicator[data-ready='true'] {
    color: var(--color-accent);
  }

  .chat-list {
    height: 100%;
    overflow-y: auto;
    background: var(--color-bg);
    will-change: transform;
    padding-bottom: calc(var(--tabbar-height) + var(--space-6) + var(--safe-bottom));
  }

  .chat-list[data-animating='true'] {
    transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-right-color: transparent;
  }

  .pull-indicator[data-refreshing='true'] .spinner {
    animation: spin 0.85s linear infinite;
  }

  .conversation-row {
    width: 100%;
    border: none;
    border-bottom: 1px solid var(--color-divider);
    background: transparent;
    min-height: 74px;
    padding: var(--space-3) var(--space-4);
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr);
    gap: var(--space-3);
    text-align: left;
  }

  .conversation-row:active {
    background: rgba(255, 255, 255, 0.05);
  }

  .avatar {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: linear-gradient(145deg, #2a3d47, #1d2a31);
    color: #d7dce0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .avatar[data-kind='channel'] {
    border-radius: var(--radius-md);
    font-size: 22px;
  }

  .content {
    min-width: 0;
    display: grid;
    align-content: center;
    gap: 2px;
  }

  .top-row,
  .bottom-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .name,
  .preview,
  .workspace-name,
  time {
    margin: 0;
  }

  .name {
    color: var(--color-text);
    font-size: 17px;
    line-height: 1.25;
    font-weight: 590;
    letter-spacing: -0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  time {
    color: var(--color-text-muted);
    font-size: 12px;
    flex-shrink: 0;
  }

  .preview {
    color: var(--color-text-muted);
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .workspace-name {
    color: var(--color-text-muted);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    min-width: 22px;
    height: 22px;
    padding: 0 7px;
    border-radius: var(--radius-pill);
    background: var(--color-accent);
    color: var(--color-badge-text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    flex-shrink: 0;
  }

  .empty-state {
    margin: 0;
    padding: var(--space-5);
    color: var(--color-text-muted);
    font-size: 14px;
    line-height: 1.45;
  }

  .fab {
    position: absolute;
    right: var(--space-4);
    bottom: calc(var(--tabbar-height) + var(--space-4) + var(--safe-bottom));
    border: none;
    border-radius: var(--radius-pill);
    min-height: 48px;
    padding: 0 var(--space-5);
    background: var(--color-accent);
    color: var(--color-badge-text);
    font-size: 15px;
    font-weight: 700;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.32);
    z-index: 15;
  }

  .composer-sheet {
    position: absolute;
    right: var(--space-4);
    bottom: calc(var(--tabbar-height) + var(--space-4) + var(--safe-bottom) + 56px);
    width: min(320px, calc(100% - (var(--space-4) * 2)));
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    box-shadow: 0 16px 34px rgba(0, 0, 0, 0.32);
    padding: var(--space-3);
    display: grid;
    gap: var(--space-3);
    z-index: 16;
  }

  .sheet-action,
  .workspace-form button,
  .sheet-contact {
    min-height: 42px;
    border-radius: var(--radius-md);
    border: none;
    font-size: 14px;
    font-weight: 700;
    padding: 0 var(--space-3);
  }

  .sheet-action,
  .sheet-contact {
    background: var(--color-surface-elevated);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    text-align: left;
  }

  .sheet-empty {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 13px;
  }

  .contact-picker {
    display: grid;
    gap: var(--space-2);
    max-height: 180px;
    overflow-y: auto;
  }

  .sheet-contact {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  .sheet-contact-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: linear-gradient(145deg, #2a3d47, #1d2a31);
    color: var(--color-text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .workspace-form {
    display: grid;
    gap: var(--space-2);
  }

  .workspace-form label {
    color: var(--color-text-muted);
    font-size: 12px;
  }

  .workspace-form input {
    min-height: 42px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-elevated);
    color: var(--color-text);
    padding: 0 var(--space-3);
    font-size: 14px;
  }

  .workspace-form button {
    background: var(--color-accent);
    color: var(--color-badge-text);
  }

  .workspace-form button:disabled {
    opacity: 0.45;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
