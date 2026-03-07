<!--
  MessageList.svelte — Message list with scroll management.
  Replaces renderMessages() + the messages-list DOM manipulation in UIRenderer.
-->
<script lang="ts">
  import type { PlaintextMessage } from 'decent-protocol';
  import MessageItem from './MessageItem.svelte';
  import { peerColor } from '$lib/utils/peer';

  interface Props {
    messages: PlaintextMessage[];
    channelName: string;
    activeChannelId: string | null;
    myPeerId: string;
    myDisplayName: string;
    inThreadView?: boolean;
    threadRoot?: PlaintextMessage | null;
    activeThreadRootId?: string | null;
    frequentReactions: string[];
    // Callbacks
    getThread: (channelId: string, messageId: string) => PlaintextMessage[];
    getPeerAlias: (peerId: string) => string;
    isBot: (senderId: string) => boolean;
    onOpenThread: (messageId: string) => void;
    onToggleReaction: (messageId: string, emoji: string) => void;
    onRememberReaction: (emoji: string) => void;
    onShowMessageInfo: (messageId: string) => void;
    onImageClick?: (name: string, src: string) => void;
  }

  let {
    messages,
    channelName,
    activeChannelId,
    myPeerId,
    myDisplayName,
    inThreadView = false,
    threadRoot = null,
    activeThreadRootId = null,
    frequentReactions,
    getThread,
    getPeerAlias,
    isBot,
    onOpenThread,
    onToggleReaction,
    onRememberReaction,
    onShowMessageInfo,
    onImageClick,
  }: Props = $props();

  // Auto-scroll: find the parent scroll container after mount
  let mounted = $state(false);

  $effect(() => {
    mounted = true;
  });

  // After messages change, scroll the parent container:
  // - Channel view: scroll to bottom (newest messages)
  // - Thread view: scroll to bottom (latest reply)
  // Only scrolls when message count actually changes (not on re-renders).
  // Scroll to bottom on channel switch or new messages.
  // Track message count + channel + thread root to catch thread switches.
  let prevScrollKey = '';

  function scrollToEnd(container: HTMLElement): void {
    container.style.scrollBehavior = 'auto';
    container.scrollTop = container.scrollHeight;
    requestAnimationFrame(() => { container.style.scrollBehavior = ''; });
  }

  $effect(() => {
    if (!mounted) return;
    const len = messages.length;
    const chId = activeChannelId ?? '';
    const threadKey = inThreadView ? (threadRoot?.id ?? '') : '';
    const scope = inThreadView ? 'thread' : 'channel';
    const scrollKey = `${scope}:${chId}:${threadKey}:${len}`;
    if (scrollKey === prevScrollKey) return;
    prevScrollKey = scrollKey;

    requestAnimationFrame(() => {
      const containerId = inThreadView ? 'thread-messages' : 'messages-list';
      const container = document.getElementById(containerId);
      if (!container) return;

      scrollToEnd(container);
    });
  });

  // ResizeObserver: re-scroll when the container resizes (e.g., thread panel
  // opens/closes causing width change → text reflows → height changes).
  // Also handles image loads that change content height.
  $effect(() => {
    if (!mounted || inThreadView) return;
    const container = document.getElementById('messages-list');
    if (!container) return;

    let wasAtBottom = true;
    const ro = new ResizeObserver(() => {
      // Only auto-scroll if user was already near the bottom
      if (wasAtBottom) {
        scrollToEnd(container);
      }
    });
    ro.observe(container);

    // Track if user is near bottom (within 50px) on scroll
    const onScroll = () => {
      wasAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 50;
    };
    container.addEventListener('scroll', onScroll);

    return () => {
      ro.disconnect();
      container.removeEventListener('scroll', onScroll);
    };
  });

  function getSenderName(msg: PlaintextMessage): string {
    const isMine = msg.senderId === myPeerId;
    return isMine ? myDisplayName : ((msg as any).senderName || getPeerAlias(msg.senderId));
  }

  function isGrouped(msg: PlaintextMessage, index: number, list: PlaintextMessage[]): boolean {
    if (index === 0) return false;
    const prev = list[index - 1];
    return prev.senderId === msg.senderId
      && msg.timestamp - prev.timestamp < 300000
      && msg.type !== 'system';
  }

  function getModelLabel(msg: PlaintextMessage): string {
    const assistant = (msg as any).metadata?.assistant as {
      modelLabel?: string;
      modelAlias?: string;
      modelName?: string;
      modelId?: string;
    } | undefined;
    if (!assistant) return '';
    return assistant.modelLabel || assistant.modelAlias || assistant.modelName || (assistant.modelId?.split('/').pop() ?? '');
  }
</script>

<div style="display: contents;">
  {#if !activeChannelId}
    <div class="empty-state">
      <div class="emoji">💬</div>
      <h3>No channel selected</h3>
      <p>Pick a channel from the sidebar</p>
    </div>
  {:else if messages.length === 0 && !threadRoot}
    <div class="empty-state">
      <div class="emoji">✨</div>
      <h3>Welcome to {channelName}!</h3>
      <p>This is the very beginning of the conversation.<br>Messages are end-to-end encrypted and stored locally.</p>
      <p style="margin-top:8px; font-size:12px; color:var(--text-light)">Type <code>/help</code> for commands · <code>Ctrl+K</code> for quick commands</p>
    </div>
  {:else}
    {#if threadRoot}
      <MessageItem
        id={threadRoot.id}
        senderId={threadRoot.senderId}
        senderName={getSenderName(threadRoot)}
        content={threadRoot.content}
        timestamp={threadRoot.timestamp}
        type={threadRoot.type}
        isMine={threadRoot.senderId === myPeerId}
        isBot={isBot(threadRoot.senderId)}
        modelLabel={getModelLabel(threadRoot)}
        isGrouped={false}
        {inThreadView}
        attachments={(threadRoot as any).attachments}
        threadReplies={[]}
        status={(threadRoot as any).status}
        recipientCount={(threadRoot as any).recipientPeerIds?.length ?? 0}
        ackedCount={(threadRoot as any).ackedBy?.length ?? 0}
        readCount={(threadRoot as any).readBy?.length ?? 0}
        {frequentReactions}
        {getPeerAlias}
        {onOpenThread}
        {onToggleReaction}
        {onRememberReaction}
        {onShowMessageInfo}
        {onImageClick}
      />
      <div class="thread-root-separator"><span>Thread</span></div>
    {/if}
    {#each messages as msg, i (msg.id)}
      <MessageItem
        id={msg.id}
        senderId={msg.senderId}
        senderName={getSenderName(msg)}
        content={msg.content}
        timestamp={msg.timestamp}
        type={msg.type}
        isMine={msg.senderId === myPeerId}
        isBot={isBot(msg.senderId)}
        modelLabel={getModelLabel(msg)}
        isGrouped={isGrouped(msg, i, messages)}
        {inThreadView}
        isActiveThreadRoot={!inThreadView && !!activeThreadRootId && msg.id === activeThreadRootId}
        attachments={(msg as any).attachments}
        threadReplies={activeChannelId ? getThread(activeChannelId, msg.id) : []}
        status={(msg as any).status}
        recipientCount={(msg as any).recipientPeerIds?.length ?? 0}
        ackedCount={(msg as any).ackedBy?.length ?? 0}
        readCount={(msg as any).readBy?.length ?? 0}
        {frequentReactions}
        {getPeerAlias}
        {onOpenThread}
        {onToggleReaction}
        {onRememberReaction}
        {onShowMessageInfo}
        {onImageClick}
      />
    {/each}
  {/if}
</div>
