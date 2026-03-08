<!--
  MessageItem.svelte — Single message row.
  Replaces the innerHTML generation in appendMessageToDOM().
-->
<script lang="ts">
  import { peerColor, escapeHtml } from '$lib/utils/peer';
  import { formatFileSize, formatTime } from '$lib/utils/format';
  import { renderMarkdown } from '../../../ui/renderMarkdown';
  import { showEmojiPicker } from '../shared/EmojiPicker.svelte';

  interface Attachment {
    id: string;
    name: string;
    type: string;
    size: number;
    thumbnail?: string;
    durationSec?: number;
  }

  interface ThreadReply {
    senderId: string;
    timestamp: number;
  }

  interface Props {
    id: string;
    senderId: string;
    senderName: string;
    content: string;
    timestamp: number;
    type?: string;
    isMine: boolean;
    isBot: boolean;
    isGrouped: boolean;
    inThreadView: boolean;
    isActiveThreadRoot?: boolean;
    attachments?: Attachment[];
    threadReplies?: ThreadReply[];
    status?: string;
    recipientCount?: number;
    ackedCount?: number;
    readCount?: number;
    frequentReactions: string[];
    animate?: boolean;
    // Callbacks
    getPeerAlias: (peerId: string) => string;
    onOpenThread: (messageId: string) => void;
    onToggleReaction: (messageId: string, emoji: string) => void;
    onRememberReaction: (emoji: string) => void;
    onShowMessageInfo: (messageId: string) => void;
    onImageClick?: (name: string, src: string) => void;
  }

  let {
    id,
    senderId,
    senderName,
    content,
    timestamp,
    type = 'text',
    isMine,
    isBot,
    isGrouped,
    inThreadView,
    isActiveThreadRoot = false,
    attachments = [],
    threadReplies = [],
    status = 'pending',
    recipientCount = 0,
    ackedCount = 0,
    readCount = 0,
    frequentReactions,
    animate = false,
    getPeerAlias,
    onOpenThread,
    onToggleReaction,
    onRememberReaction,
    onShowMessageInfo,
    onImageClick,
  }: Props = $props();

  let initial = $derived(senderName.slice(0, 2).toUpperCase());
  let time = $derived(formatTime(timestamp));
  let avatarColor = $derived(isBot ? '#7c3aed' : peerColor(senderId));
  let avatarContent = $derived(isBot ? '🤖' : initial);
  let isSystem = $derived(type === 'system');

  let statusClass = $derived(
    status === 'read' ? 'read' : (status || 'pending')
  );
  let statusSymbol = $derived(
    statusClass === 'read' ? '✓✓' : statusClass === 'delivered' ? '✓✓' : statusClass === 'sent' ? '✓' : '⏳'
  );
  let deliveryTitle = $derived(() => {
    if (statusClass === 'read') return recipientCount > 0 ? `Read (${readCount}/${recipientCount})` : 'Read';
    if (statusClass === 'delivered') return recipientCount > 0 ? `Delivered (${ackedCount}/${recipientCount})` : 'Delivered';
    if (statusClass === 'sent') return recipientCount > 0 ? `Sent (${ackedCount}/${recipientCount} delivered)` : 'Sent';
    return 'Sending…';
  });

  let renderedContent = $derived(renderMarkdown(content));

  // Thread indicator data
  let threadCount = $derived(threadReplies.length);
  let uniqueThreadSenders = $derived(() => {
    const seen = new Set<string>();
    const senders: string[] = [];
    for (const r of threadReplies) {
      if (!seen.has(r.senderId)) {
        seen.add(r.senderId);
        senders.push(r.senderId);
        if (senders.length >= 4) break;
      }
    }
    return senders;
  });

  function handleQuickReact(emoji: string) {
    onRememberReaction(emoji);
    onToggleReaction(id, emoji);
  }

  function handleAddReaction(event: MouseEvent) {
    const btn = event.currentTarget as HTMLElement;
    void showEmojiPicker(btn, (emoji) => {
      onRememberReaction(emoji);
      onToggleReaction(id, emoji);
    });
  }

  function getAttachmentIcon(att: Attachment): string {
    if (att.type === 'video') return '🎬';
    if (att.type === 'voice' || att.type === 'audio') return '🎵';
    if (att.type === 'image') return '🖼️';
    return '📎';
  }
</script>

<div
  class="message {isSystem ? 'system' : ''} {isGrouped ? 'grouped' : ''} {animate ? 'message-new' : ''} {isActiveThreadRoot ? 'thread-root-active' : ''}"
  data-message-id={id}
  data-senderId={senderId}
  data-timestamp={String(timestamp)}
  data-testid="message"
>
  {#if isSystem}
    <div class="message-content">{content}</div>
  {:else}
    <div class="message-avatar{isBot ? ' bot-avatar' : ''}" style="background: {avatarColor}">
      {avatarContent}
    </div>
    <div class="message-body">
      <div class="message-header">
        <span class="message-sender">{senderName}</span>
        {#if isBot}<span class="msg-bot-badge">BOT</span>{/if}
        <span class="message-time">{time}</span>
        {#if isMine}
          <span class="msg-delivery-status {statusClass}" data-message-id={id} title={deliveryTitle()}>
            {statusSymbol}
          </span>
          {#if recipientCount > 0}
            <span class="msg-delivery-detail" data-message-id={id}>
              {statusClass === 'read' ? readCount : ackedCount}/{recipientCount}
            </span>
          {/if}
        {/if}
      </div>
      <div class="message-content markdown-body">
        {@html renderedContent}
      </div>

      {#if attachments.length > 0}
        {#each attachments as att (att.id)}
          {#if att.type === 'image' && att.thumbnail}
            <div class="attachment attachment-image" data-attachment-id={att.id}>
              <img
                src="data:image/jpeg;base64,{att.thumbnail}"
                alt={att.name}
                class="attachment-thumbnail"
                data-attachment-name={att.name}
                data-attachment-id={att.id}
              />
              <div class="attachment-info">
                <span class="attachment-name">{att.name}</span>
                <span class="attachment-size">{formatFileSize(att.size)}</span>
              </div>
            </div>
          {:else if att.type === 'image' && !att.thumbnail}
            <div class="attachment attachment-image attachment-no-preview" data-attachment-id={att.id}>
              <span class="attachment-icon">🖼️</span>
              <div class="attachment-info">
                <span class="attachment-name">{att.name}</span>
                <span class="attachment-size">{formatFileSize(att.size)}</span>
                <span class="attachment-hint">Image — preview unavailable</span>
              </div>
            </div>
          {:else if att.type === 'voice' || att.type === 'audio'}
            <div class="attachment attachment-audio" data-attachment-id={att.id}>
              <span class="attachment-icon">🎵</span>
              <div class="attachment-info">
                <span class="attachment-name">{att.name}</span>
                <span class="attachment-size">{formatFileSize(att.size)}{att.durationSec ? ` · ${Math.round(att.durationSec)}s` : ''}</span>
              </div>
            </div>
          {:else}
            <div class="attachment attachment-file" data-attachment-id={att.id}>
              <span class="attachment-icon">{getAttachmentIcon(att)}</span>
              <div class="attachment-info">
                <span class="attachment-name">{att.name}</span>
                <span class="attachment-size">{formatFileSize(att.size)}</span>
              </div>
            </div>
          {/if}
        {/each}
      {/if}

      {#if !inThreadView}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="message-thread-indicator{threadCount > 0 ? ' has-replies' : ''}"
          data-thread-id={id}
          onclick={() => onOpenThread(id)}
        >
          {#if threadCount > 0}
            <span class="thread-indicator-avatars">
              {#each uniqueThreadSenders() as peerId}
                {@const name = getPeerAlias(peerId)}
                {@const initials = name.slice(0, 2).toUpperCase()}
                <span class="thread-indicator-avatar" style="background:{peerColor(peerId)}" title={name}>{initials}</span>
              {/each}
            </span>
            <span class="thread-indicator-count">{threadCount} {threadCount === 1 ? 'reply' : 'replies'}</span>
          {/if}
        </div>
      {/if}

      <div class="message-reactions" id="reactions-{id}"></div>

      <div class="message-actions-bar{inThreadView ? ' in-thread' : ''}">
        {#each frequentReactions as emoji}
          <button class="quick-react" data-msg-id={id} data-emoji={emoji} onclick={() => handleQuickReact(emoji)}>
            {emoji}
          </button>
        {/each}
        <button class="quick-react-add" data-msg-id={id} title="Add reaction" onclick={handleAddReaction}>
          ➕
        </button>
        <button class="message-thread-btn" data-thread-id={id} title="Reply in thread" onclick={() => onOpenThread(id)}>
          💬 Reply
        </button>
        {#if isMine || inThreadView}
          <button class="message-info-btn" data-message-id={id} title="Message info" onclick={() => onShowMessageInfo(id)}>
            ℹ️ Info
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>
