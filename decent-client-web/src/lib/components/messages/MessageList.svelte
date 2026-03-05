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

  // After messages change, scroll the parent container to bottom
  $effect(() => {
    if (!mounted) return;
    const _len = messages.length; // track dependency
    requestAnimationFrame(() => {
      // The parent scroll container is the messages-list or thread-messages div
      const container = document.getElementById(inThreadView ? 'thread-messages' : 'messages-list');
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    });
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
        isGrouped={isGrouped(msg, i, messages)}
        {inThreadView}
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
