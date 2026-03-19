<!--
  AppShell.svelte — Root app layout component.
  Replaces UIRenderer.renderApp() which generated the app shell HTML
  and manually mounted/unmounted child Svelte components.

  AppShell reads reactive state from shell.svelte.ts store and
  declaratively renders all child components. UIRenderer writes to
  the store when data changes; Svelte reactivity handles re-renders.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { shellData, getShellCallbacks, type ShellCallbacks } from '../stores/shell.svelte';

  // Child components — app layout
  import WorkspaceRail from './layout/WorkspaceRail.svelte';
  import Sidebar from './layout/Sidebar.svelte';
  import ChannelHeader from './layout/ChannelHeader.svelte';
  import MessageList from './messages/MessageList.svelte';
  import ComposeArea from './compose/ComposeArea.svelte';
  import ThreadPanel from './layout/ThreadPanel.svelte';
  import HuddleBar from './layout/HuddleBar.svelte';
  import Lightbox from './shared/Lightbox.svelte';
  import SearchPanel from './layout/SearchPanel.svelte';
  import ActivityPanel from './layout/ActivityPanel.svelte';
  // Welcome screen
  import WelcomePage from './layout/WelcomePage.svelte';

  // Callbacks are set once by UIRenderer before AppShell mounts
  let cb: ShellCallbacks | null = $state(null);

  onMount(() => {
    cb = getShellCallbacks();
    bindAppEvents();
  });

  onDestroy(() => {
    cleanupAppEvents();
  });

  // ── App-level event handlers (from bindAppEvents in MountHelpers) ──

  let cleanupFns: Array<() => void> = [];

  function bindAppEvents() {
    // Thumbnail click -> open lightbox
    const handleThumbnailClick = async (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('attachment-thumbnail')) {
        const img = target as HTMLImageElement;
        const name = img.getAttribute('data-attachment-name') || '';
        const attachmentId = img.getAttribute('data-attachment-id') || undefined;
        await cb?.onImageClick(name, img.src, attachmentId);
      }
    };

    const msgList = document.getElementById('messages-list');
    msgList?.addEventListener('click', handleThumbnailClick);
    cleanupFns.push(() => msgList?.removeEventListener('click', handleThumbnailClick));

    // Drag & drop on messages area
    const messagesArea = document.querySelector('.messages-area') as HTMLElement;
    if (messagesArea) {
      const onDragOver = (e: DragEvent) => {
        e.preventDefault();
        messagesArea.classList.add('drag-active');
      };
      const onDragLeave = (e: DragEvent) => {
        if (!messagesArea.contains(e.relatedTarget as Node)) {
          messagesArea.classList.remove('drag-active');
        }
      };
      const onDrop = (e: DragEvent) => {
        e.preventDefault();
        messagesArea.classList.remove('drag-active');
        const files = Array.from(e.dataTransfer?.files || []);
        if (files.length > 0) {
          const dropTarget = e.target as HTMLElement | null;
          const target: 'main' | 'thread' = dropTarget?.closest?.('#thread-panel') ? 'thread' : 'main';
          addPendingAttachments(files, target);
        }
      };

      messagesArea.addEventListener('dragover', onDragOver);
      messagesArea.addEventListener('dragleave', onDragLeave);
      messagesArea.addEventListener('drop', onDrop);
      cleanupFns.push(() => {
        messagesArea.removeEventListener('dragover', onDragOver);
        messagesArea.removeEventListener('dragleave', onDragLeave);
        messagesArea.removeEventListener('drop', onDrop);
      });
    }

    // Keyboard shortcuts
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (shellData.lightbox.open) { cb?.onCloseLightbox(); return; }
        const autocomplete = document.getElementById('command-autocomplete') || document.getElementById('mention-autocomplete');
        if (autocomplete) { autocomplete.remove(); return; }
        const modal = document.querySelector('.modal-overlay');
        if (modal) { modal.remove(); return; }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const composeInput = document.getElementById('compose-input') as HTMLTextAreaElement;
        if (composeInput) { composeInput.focus(); if (!composeInput.value) composeInput.value = '/'; }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); cb?.onSearch(); }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        cb?.onHamburger();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    cleanupFns.push(() => document.removeEventListener('keydown', onKeyDown));
  }

  function cleanupAppEvents() {
    for (const fn of cleanupFns) fn();
    cleanupFns = [];
  }

  function addPendingAttachments(files: File[], target: 'main' | 'thread') {
    const fileInputId = target === 'thread' ? 'thread-file-input' : 'file-input';
    const fileInput = document.getElementById(fileInputId) as HTMLInputElement | null;
    if (fileInput) {
      const dt = new DataTransfer();
      for (const file of files) dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
</script>

{#if shellData.view === 'welcome'}
  <WelcomePage
    myPeerId={shellData.welcome.myPeerId}
    hasWorkspace={shellData.welcome.hasWorkspace}
    onCreateWorkspace={cb?.onCreateWorkspace ?? (() => {})}
    onJoinWorkspace={cb?.onJoinWorkspace ?? (() => {})}
    onRestoreSeed={cb?.onRestoreSeed ?? (() => {})}
    onInstallAiTeam={cb?.onInstallAiTeam ?? (() => {})}
  />
{:else if shellData.view === 'app'}
  <div class="app-layout">
    <div class="workspace-rail" id="workspace-rail">
      {#if cb}
        <WorkspaceRail
          workspaces={shellData.rail.workspaces}
          activeWorkspaceId={shellData.rail.activeWorkspaceId}
          activityUnread={shellData.rail.activityUnread}
          onSwitchToDMs={cb.onSwitchToDMs}
          onSwitchWorkspace={cb.onSwitchWorkspace}
          onToggleActivity={cb.onToggleActivity}
          onAddWorkspace={cb.onAddWorkspace}
        />
      {/if}
    </div>

    <div class="sidebar" id="sidebar">
      {#if cb && !shellData.activity.panelOpen}
        <Sidebar
          workspaceName={shellData.sidebar.workspaceName}
          workspaces={shellData.rail.workspaces}
          activeWorkspaceId={shellData.rail.activeWorkspaceId}
          channels={shellData.sidebar.channels}
          members={shellData.sidebar.members}
          directConversations={shellData.sidebar.directConversations}
          activeChannelId={shellData.sidebar.activeChannelId}
          activeDirectConversationId={shellData.sidebar.activeDirectConversationId}
          myPeerId={shellData.sidebar.myPeerId}
          connectionBanner={shellData.sidebar.connectionBanner}
          presence={shellData.sidebar.presence}
          getUnreadCount={cb.getUnreadCount}
          getPeerAlias={cb.getPeerAlias}
          getPeerStatusClass={cb.getPeerStatusClass}
          getPeerStatusTitle={cb.getPeerStatusTitle}
          onSwitchToDMs={cb.onSwitchToDMs}
          onSwitchWorkspace={cb.onSwitchWorkspace}
          onAddWorkspace={cb.onAddWorkspace}
          onChannelClick={cb.onChannelClick}
          onMemberClick={cb.onMemberClick}
          onDirectConvClick={cb.onDirectConvClick}
          onAddChannel={cb.onAddChannel}
          onAddAiTeam={cb.onInstallAiTeam}
          onStartDM={cb.onStartDM}
          onAddContact={cb.onAddContact}
          onConnectPeer={cb.onConnectPeer}
          onCopyInvite={cb.onCopyInvite}
          onShowQR={cb.onShowQR}
          onCopyPeerId={cb.onCopyPeerId}
          onWorkspaceSettings={cb.onWorkspaceSettings}
          onWorkspaceMembers={cb.onWorkspaceMembers}
          onWorkspaceInvite={cb.onWorkspaceInvite}
          onWorkspaceNotifications={cb.onWorkspaceNotifications}
          onRetryReconnect={cb.onRetryReconnect}
          onLoadMorePresence={cb.onLoadMorePresence}
        />
      {:else if cb && shellData.activity.panelOpen}
        <ActivityPanel
          items={shellData.activity.items}
          getPeerAlias={cb.getActivityPeerAlias}
          onClose={cb.onCloseActivity}
          onMarkAllRead={cb.onMarkAllRead}
          onMarkRead={cb.onMarkRead}
          onNavigate={cb.onNavigateActivity}
        />
      {/if}
    </div>

    <div class="main-content">
      <div id="channel-header-mount">
        {#if cb}
          <ChannelHeader
            channelName={shellData.header.channelName}
            memberCount={shellData.header.memberCount}
            presence={shellData.header.presence}
            isDirectMessage={shellData.header.isDirectMessage}
            isHuddleActive={shellData.header.isHuddleActive}
            onHamburger={cb.onHamburger}
            onHuddleToggle={cb.onHuddleToggle}
            onConnectPeer={cb.onHeaderConnectPeer}
            onShowQR={cb.onHeaderShowQR}
            onSearch={cb.onSearch}
            onInvite={cb.onInvite}
            onSettings={cb.onSettings}
            onChannelMembers={cb.onChannelMembers}
            onLoadMorePresence={cb.onLoadMorePresence}
          />
        {/if}
      </div>

      <div id="search-mount">
        {#if cb && shellData.search.open}
          <SearchPanel
            myPeerId={shellData.search.myPeerId}
            myAlias={shellData.search.myAlias}
            onSearch={cb.onSearchQuery}
            onScrollToMessage={cb.onScrollToMessage}
            onClose={cb.onCloseSearch}
          />
        {/if}
      </div>

      <div id="huddle-mount">
        {#if cb}
          <HuddleBar
            state={shellData.huddle.state}
            muted={shellData.huddle.muted}
            participants={shellData.huddle.participants}
            onToggleMute={cb.onToggleMute}
            onLeave={cb.onLeaveHuddle}
            onJoin={cb.onJoinHuddle}
          />
        {/if}
      </div>

      <div class="messages-area">
        <div class="messages-pane">
          <div class="messages-list-wrapper">
          <div class="messages-list" id="messages-list">
            {#if cb}
              <MessageList
                messages={shellData.messages.messages}
                channelName={shellData.messages.channelName}
                activeChannelId={shellData.messages.activeChannelId}
                myPeerId={shellData.messages.myPeerId}
                myDisplayName={shellData.messages.myDisplayName}
                activeThreadRootId={shellData.thread.open ? shellData.thread.threadId : null}
                frequentReactions={shellData.messages.frequentReactions}
                scrollTargetMessageId={shellData.messages.scrollTargetMessageId}
                scrollTargetNonce={shellData.messages.scrollTargetNonce}
                getThread={cb.getThread}
                getPeerAlias={cb.getPeerAlias}
                isBot={cb.isBot}
                getCompanySimProfile={cb.getCompanySimProfile}
                onOpenThread={cb.onOpenThread}
                onToggleReaction={cb.onToggleReaction}
                onRememberReaction={cb.onRememberReaction}
                onShowMessageInfo={cb.onShowMessageInfo}
                onImageClick={cb.onImageClick}
                resolveAttachmentImageUrl={cb.resolveAttachmentImageUrl}
              />
            {/if}
          </div>
          </div><!-- /.messages-list-wrapper -->
          <div class="typing-indicator" id="typing-indicator" class:visible={!!shellData.typingText}>
            {shellData.typingText}
          </div>
          <div id="huddle-bar-mount"></div>
          <div id="compose-mount">
            {#if cb}
              <ComposeArea
                placeholder={shellData.compose.placeholder}
                target="main"
                onSend={cb.onSend}
                onTyping={cb.onTyping}
                onStopTyping={cb.onStopTyping}
                getCommandSuggestions={cb.getCommandSuggestions}
                getMembers={cb.getMembers}
                searchMembers={cb.searchMembers}
              />
            {/if}
          </div>
        </div>

        <div id="thread-mount">
          {#if cb}
            <ThreadPanel
              open={shellData.thread.open}
              threadId={shellData.thread.threadId}
              channelId={shellData.thread.channelId}
              parentMessage={shellData.thread.parentMessage}
              replies={shellData.thread.replies}
              myPeerId={shellData.thread.myPeerId}
              myDisplayName={shellData.thread.myDisplayName}
              frequentReactions={shellData.thread.frequentReactions}
              scrollTargetMessageId={shellData.thread.scrollTargetMessageId}
              scrollTargetNonce={shellData.thread.scrollTargetNonce}
              getThread={cb.getThread}
              getPeerAlias={cb.getPeerAlias}
              isBot={cb.isBot}
              getCompanySimProfile={cb.getCompanySimProfile}
              onOpenThread={cb.onOpenThread}
              onToggleReaction={cb.onToggleReaction}
              onRememberReaction={cb.onRememberReaction}
              onShowMessageInfo={cb.onShowMessageInfo}
              onClose={cb.onCloseThread}
              onSend={cb.onThreadSend}
              getMembers={cb.getMembers}
              searchMembers={cb.searchMembers}
              resolveAttachmentImageUrl={cb.resolveAttachmentImageUrl}
            />
          {/if}
        </div>
      </div>
    </div>

    <div id="lightbox-mount">
      {#if cb}
        <Lightbox
          open={shellData.lightbox.open}
          src={shellData.lightbox.src}
          name={shellData.lightbox.name}
          onClose={cb.onCloseLightbox}
        />
      {/if}
    </div>
  </div>
{/if}
