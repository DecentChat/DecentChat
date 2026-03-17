<svelte:options runes={true} />

<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { AttachmentMeta, PlaintextMessage } from 'decent-protocol';
  import ScreenHeader from '../components/ScreenHeader.svelte';
  import { messages, myPeerId, typingByChannel, workspaces } from '../stores/appState';
  import type { MobileController } from '../app/MobileController';

  type Props = {
    controller: MobileController | null;
    channelId: string;
    onBack?: (() => void) | undefined;
  };

  type RenderItem =
    | {
      type: 'date-divider';
      key: string;
      label: string;
    }
    | {
      type: 'message';
      key: string;
      id: string;
      content: string;
      timestamp: number;
      senderName: string;
      mine: boolean;
      showSender: boolean;
      status?: PlaintextMessage['status'];
      attachments: AttachmentMeta[];
      editedAt?: number;
      deleted?: boolean;
      threadId?: string;
      replyPreview?: string;
    };

  const TYPING_IDLE_MS = 1300;

  let { controller, channelId, onBack }: Props = $props();

  let composerText = $state('');
  let sending = $state(false);
  let attaching = $state(false);
  let messagesEl = $state<HTMLElement | null>(null);
  let editingMessageId = $state<string | null>(null);
  let replyToMessageId = $state<string | null>(null);
  let typingActive = $state(false);
  let typingTimer: ReturnType<typeof setTimeout> | null = null;

  const workspaceForChannel = $derived.by(
    () => $workspaces.find((workspace) => workspace.channels.some((channel) => channel.id === channelId)) ?? null,
  );

  const directConversation = $derived(controller?.getDirectConversation(channelId) ?? null);

  const channelName = $derived.by(() => {
    if (directConversation) {
      return controller?.getPeerDisplayName(directConversation.contactPeerId) || directConversation.contactPeerId.slice(0, 8);
    }

    const channel = workspaceForChannel?.channels.find((item) => item.id === channelId);
    if (!channel) return channelId.slice(0, 8);
    return channel.type === 'dm' ? channel.name : `#${channel.name}`;
  });

  const callPeerId = $derived.by(() => {
    if (directConversation) return directConversation.contactPeerId;

    const channel = workspaceForChannel?.channels.find((item) => item.id === channelId);
    if (channel?.type !== 'dm') return '';

    const peerId = channel.members.find((memberId) => memberId !== $myPeerId);
    return peerId ?? '';
  });

  const channelMessages = $derived($messages[channelId] ?? []);

  const messageById = $derived.by(() => {
    const map = new Map<string, PlaintextMessage>();
    for (const message of channelMessages) {
      map.set(message.id, message);
    }
    return map;
  });

  const typingPeers = $derived(($typingByChannel[channelId] ?? []).filter((peerId) => peerId !== $myPeerId));

  const typingLabel = $derived.by(() => {
    if (typingPeers.length === 0) return '';

    const names = typingPeers.map((peerId) =>
      controller?.getPeerDisplayName(peerId, workspaceForChannel?.id) ?? peerId.slice(0, 8),
    );

    if (names.length === 1) return `${names[0]} is typing…`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
    return `${names[0]}, ${names[1]} +${names.length - 2} are typing…`;
  });

  const groupedMessages: RenderItem[] = $derived.by(() => {
    if (!channelMessages.length) return [];

    const result: RenderItem[] = [];
    let previousDateLabel = '';
    let previousSenderId = '';

    for (const message of channelMessages) {
      const dateLabel = formatDate(message.timestamp);
      if (dateLabel !== previousDateLabel) {
        result.push({
          type: 'date-divider',
          key: `divider-${message.id}`,
          label: dateLabel,
        });
        previousDateLabel = dateLabel;
        previousSenderId = '';
      }

      const mine = message.senderId === $myPeerId;
      const senderName = mine
        ? 'You'
        : (controller?.getPeerDisplayName(message.senderId, workspaceForChannel?.id) ?? message.senderId.slice(0, 8));

      const attachments = ((message as PlaintextMessage & { attachments?: AttachmentMeta[] }).attachments ?? []);
      const editedAt = (message as PlaintextMessage & { editedAt?: number }).editedAt;
      const deleted = (message as PlaintextMessage & { deleted?: boolean }).deleted === true;
      const threadId = message.threadId;

      let replyPreview: string | undefined;
      if (threadId) {
        const root = messageById.get(threadId);
        replyPreview = root?.content?.slice(0, 90) || 'Replying to an earlier message';
      }

      result.push({
        type: 'message',
        key: message.id,
        id: message.id,
        content: message.content,
        timestamp: message.timestamp,
        senderName,
        mine,
        showSender: !mine && message.senderId !== previousSenderId,
        status: message.status,
        attachments,
        editedAt,
        deleted,
        threadId,
        replyPreview,
      });

      previousSenderId = message.senderId;
    }

    return result;
  });

  $effect(() => {
    channelMessages.length;
    typingLabel;

    void tick().then(() => {
      if (!messagesEl) return;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  });

  $effect(() => {
    channelId;
    channelMessages.length;
    void controller?.markChannelRead(channelId);
  });

  onDestroy(() => {
    clearTypingSignal();
  });

  function formatTime(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  }

  function formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();

    const isToday =
      date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate();

    if (isToday) return 'Today';

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    const isYesterday =
      date.getFullYear() === yesterday.getFullYear()
      && date.getMonth() === yesterday.getMonth()
      && date.getDate() === yesterday.getDate();

    if (isYesterday) return 'Yesterday';

    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
    }).format(date);
  }

  function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function statusLabel(status?: PlaintextMessage['status']): string {
    if (status === 'read') return '✓✓';
    if (status === 'delivered') return '✓';
    if (status === 'failed') return '!';
    return '•';
  }

  function armTypingTimeout(): void {
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      if (!typingActive) return;
      typingActive = false;
      controller?.sendTypingIndicator(channelId, false);
      typingTimer = null;
    }, TYPING_IDLE_MS);
  }

  function updateTypingStateForComposer(value: string): void {
    if (!controller) return;

    const hasText = value.trim().length > 0;
    if (!hasText) {
      clearTypingSignal();
      return;
    }

    if (!typingActive) {
      typingActive = true;
      controller.sendTypingIndicator(channelId, true);
    }

    armTypingTimeout();
  }

  function clearTypingSignal(): void {
    if (typingTimer) {
      clearTimeout(typingTimer);
      typingTimer = null;
    }

    if (typingActive) {
      typingActive = false;
      controller?.sendTypingIndicator(channelId, false);
    }
  }

  async function handleSend() {
    const text = composerText.trim();
    if (!text || !controller || sending) return;

    sending = true;
    clearTypingSignal();

    if (editingMessageId) {
      const edited = await controller.editMessage(channelId, editingMessageId, text);
      if (!edited) {
        composerText = text;
      } else {
        composerText = '';
        editingMessageId = null;
      }
      sending = false;
      return;
    }

    composerText = '';
    const sent = await controller.sendMessage(channelId, text, {
      threadId: replyToMessageId ?? undefined,
    });

    if (!sent) {
      composerText = text;
    } else {
      replyToMessageId = null;
    }

    sending = false;
  }

  async function handleAttachmentSend(): Promise<void> {
    if (!controller || attaching) return;
    attaching = true;
    clearTypingSignal();

    try {
      const sent = await controller.pickAndSendAttachment(channelId, replyToMessageId ?? undefined);
      if (sent) {
        replyToMessageId = null;
      }
    } finally {
      attaching = false;
    }
  }

  async function ringPeer(): Promise<void> {
    if (!controller || !callPeerId) return;
    await controller.callManager.ring(callPeerId);
  }

  function openAttachment(attachmentId: string): void {
    controller?.openAttachment(attachmentId);
  }

  function replyToMessage(messageId: string): void {
    editingMessageId = null;
    replyToMessageId = messageId;
  }

  function editMessage(messageId: string, initialContent: string): void {
    replyToMessageId = null;
    editingMessageId = messageId;
    composerText = initialContent;
    void tick().then(() => {
      const input = document.querySelector<HTMLTextAreaElement>('textarea.input');
      input?.focus();
      input?.setSelectionRange(composerText.length, composerText.length);
    });
  }

  async function deleteMessage(messageId: string): Promise<void> {
    if (!controller) return;
    await controller.deleteMessage(channelId, messageId);

    if (editingMessageId === messageId) {
      editingMessageId = null;
      composerText = '';
    }

    if (replyToMessageId === messageId) {
      replyToMessageId = null;
    }
  }

  function cancelComposerMode(): void {
    editingMessageId = null;
    replyToMessageId = null;
    composerText = '';
    clearTypingSignal();
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
      return;
    }

    if (event.key === 'Escape' && (editingMessageId || replyToMessageId)) {
      event.preventDefault();
      cancelComposerMode();
    }
  }
</script>

<section class="chat-detail">
  <ScreenHeader title={channelName} onBack={onBack} backLabel="Chats">
    {#snippet actions()}
      {#if callPeerId}
        <button type="button" aria-label="Call contact" onclick={() => void ringPeer()}>📞</button>
      {/if}
      <button type="button" aria-label="More options">⋯</button>
    {/snippet}
  </ScreenHeader>

  <div
    class="messages"
    role="log"
    aria-label="Conversation messages"
    aria-live="polite"
    bind:this={messagesEl}
  >
    {#if channelMessages.length === 0}
      <p class="empty-hint">No messages yet — say hello 👋</p>
    {:else}
      {#each groupedMessages as item (item.key)}
        {#if item.type === 'date-divider'}
          <div class="date-divider" role="separator">
            <span>{item.label}</span>
          </div>
        {:else}
          <article class="bubble-row" data-mine={item.mine}>
            {#if item.showSender}
              <p class="sender-name">{item.senderName}</p>
            {/if}
            <div class="bubble" data-mine={item.mine}>
              {#if item.replyPreview}
                <p class="reply-preview">↪ {item.replyPreview}</p>
              {/if}

              <p class="bubble-text">{item.content}</p>

              {#if item.attachments.length > 0}
                <div class="attachment-list" aria-label="Message attachments">
                  {#each item.attachments as attachment (attachment.id)}
                    <button
                      type="button"
                      class="attachment"
                      aria-label={`Open attachment ${attachment.name}`}
                      disabled={!controller?.hasAttachmentData(attachment.id)}
                      onclick={() => openAttachment(attachment.id)}
                    >
                      <span>📎 {attachment.name}</span>
                      <small>{formatBytes(attachment.size)}</small>
                    </button>
                  {/each}
                </div>
              {/if}

              <div class="bubble-meta" data-mine={item.mine}>
                {#if item.editedAt}
                  <span class="edited">edited</span>
                {/if}
                <time class="bubble-time">{formatTime(item.timestamp)}</time>
                {#if item.mine}
                  <span class="bubble-status" aria-label={`Message status ${item.status ?? 'sent'}`}>
                    {statusLabel(item.status)}
                  </span>
                {/if}
              </div>
            </div>

            <div class="message-actions" data-mine={item.mine}>
              <button type="button" onclick={() => replyToMessage(item.id)}>Reply</button>
              {#if item.mine && !item.deleted}
                <button type="button" onclick={() => editMessage(item.id, item.content)}>Edit</button>
                <button type="button" class="danger" onclick={() => void deleteMessage(item.id)}>Delete</button>
              {/if}
            </div>
          </article>
        {/if}
      {/each}
    {/if}
  </div>

  {#if typingLabel}
    <p class="typing-indicator" role="status">{typingLabel}</p>
  {/if}

  {#if editingMessageId || replyToMessageId}
    <div class="composer-mode" role="status">
      <p>
        {#if editingMessageId}
          Editing message
        {:else}
          Replying in thread
        {/if}
      </p>
      <button type="button" onclick={cancelComposerMode}>Cancel</button>
    </div>
  {/if}

  <footer class="composer" aria-label="Message composer">
    <button
      type="button"
      class="attach"
      aria-label="Attach media"
      disabled={attaching}
      onclick={() => void handleAttachmentSend()}
    >＋</button>
    <textarea
      class="input"
      placeholder={editingMessageId ? 'Edit your message' : 'Message'}
      aria-label="Message"
      rows="1"
      bind:value={composerText}
      oninput={() => updateTypingStateForComposer(composerText)}
      onkeydown={handleKeyDown}
    ></textarea>
    <button
      type="button"
      class="send"
      aria-label="Send message"
      disabled={!composerText.trim() || sending}
      onclick={() => void handleSend()}
    >↑</button>
  </footer>
</section>

<style>
  .chat-detail {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    background: radial-gradient(circle at top left, #12222a, #0b141a 45%);
  }

  .messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3) var(--space-4);
  }

  .empty-hint {
    margin: auto;
    color: var(--color-text-muted);
    font-size: 14px;
    text-align: center;
    padding: var(--space-5);
  }

  .date-divider {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: var(--space-3) 0;
    color: var(--color-text-muted);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.03em;
  }

  .date-divider::before,
  .date-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--color-divider);
  }

  .bubble-row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    max-width: 86%;
    gap: 4px;
    margin-bottom: 4px;
  }

  .bubble-row[data-mine='true'] {
    align-self: flex-end;
    align-items: flex-end;
  }

  .sender-name {
    margin: 0;
    padding: 0 var(--space-2);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--color-accent);
    text-transform: uppercase;
  }

  .bubble {
    background: var(--color-surface-elevated);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 18px 18px 18px 4px;
    padding: 9px var(--space-3);
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .bubble[data-mine='true'] {
    background: rgba(108, 92, 231, 0.2);
    border-color: rgba(108, 92, 231, 0.38);
    border-radius: 18px 18px 4px 18px;
  }

  .reply-preview {
    margin: 0;
    font-size: 12px;
    color: var(--color-text-muted);
    border-left: 2px solid rgba(255, 255, 255, 0.18);
    padding-left: 8px;
  }

  .bubble-text {
    margin: 0;
    font-size: 15px;
    line-height: 1.42;
    color: var(--color-text);
    word-break: break-word;
    white-space: pre-wrap;
  }

  .attachment-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .attachment {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.04);
    border-radius: 10px;
    color: var(--color-text);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    font-size: 12px;
  }

  .attachment:disabled {
    opacity: 0.45;
  }

  .bubble-meta {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    align-self: flex-end;
  }

  .edited,
  .bubble-time,
  .bubble-status {
    font-size: 10px;
    color: var(--color-text-muted);
    line-height: 1;
  }

  .bubble-status {
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .message-actions {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    padding: 0 4px;
  }

  .message-actions button {
    border: none;
    background: transparent;
    color: var(--color-text-muted);
    font-size: 11px;
    padding: 2px 4px;
  }

  .message-actions .danger {
    color: #ff9f95;
  }

  .typing-indicator {
    margin: 0;
    padding: 4px var(--space-4);
    font-size: 12px;
    color: var(--color-text-muted);
    min-height: 22px;
  }

  .composer-mode {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 6px var(--space-3);
    border-top: 1px solid var(--color-border);
    border-bottom: 1px solid var(--color-border);
    background: rgba(22, 33, 40, 0.95);
  }

  .composer-mode p {
    margin: 0;
    font-size: 12px;
    color: var(--color-text-muted);
  }

  .composer-mode button {
    border: none;
    background: transparent;
    color: var(--color-accent);
    font-size: 12px;
    font-weight: 600;
  }

  .composer {
    display: grid;
    grid-template-columns: var(--tap-target-min) minmax(0, 1fr) var(--tap-target-min);
    gap: var(--space-2);
    align-items: flex-end;
    border-top: 1px solid var(--color-border);
    background: rgba(17, 27, 33, 0.96);
    backdrop-filter: blur(10px);
    padding: var(--space-2) var(--space-3) calc(var(--space-2) + var(--safe-bottom));
  }

  .composer button {
    width: var(--tap-target-min);
    height: var(--tap-target-min);
    min-height: var(--tap-target-min);
    border: none;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--color-text-muted);
    font-size: 23px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    flex-shrink: 0;
  }

  .input {
    min-height: var(--tap-target-min);
    max-height: 120px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-elevated);
    color: var(--color-text);
    padding: 10px var(--space-3);
    font-size: 16px;
    resize: none;
    overflow-y: auto;
    line-height: 1.4;
    font-family: var(--font-system);
  }

  .input::placeholder {
    color: var(--color-text-muted);
  }

  .send {
    background: var(--color-accent) !important;
    color: var(--color-badge-text) !important;
    font-size: 20px !important;
    font-weight: 700;
    transition: opacity 0.15s ease;
  }

  .send:disabled {
    opacity: 0.4;
  }
</style>
