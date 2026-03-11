<!--
  ThreadPanel.svelte — Thread view with messages and compose area.
  Replaces thread-panel DOM + openThread/closeThread/setupThreadResize from UIRenderer.
-->
<script lang="ts">
  import type { PlaintextMessage } from 'decent-protocol';
  import MessageList from '../messages/MessageList.svelte';
  import ComposeArea from '../compose/ComposeArea.svelte';

  interface Props {
    open: boolean;
    threadId: string | null;
    channelId: string | null;
    parentMessage: PlaintextMessage | null;
    replies: PlaintextMessage[];
    myPeerId: string;
    myDisplayName: string;
    frequentReactions: string[];
    scrollTargetMessageId?: string | null;
    scrollTargetNonce?: number;
    // Callbacks
    getThread: (channelId: string, messageId: string) => PlaintextMessage[];
    getPeerAlias: (peerId: string) => string;
    isBot: (senderId: string) => boolean;
    onOpenThread: (messageId: string) => void;
    onToggleReaction: (messageId: string, emoji: string) => void;
    onRememberReaction: (emoji: string) => void;
    onShowMessageInfo: (messageId: string) => void;
    onClose: () => void;
    onSend: (text: string, files: File[]) => Promise<void>;
    getMembers?: () => Array<{ peerId: string; name: string }>;
    searchMembers?: (query: string, limit?: number) => Promise<Array<{ peerId: string; name: string }>>;
    resolveAttachmentImageUrl?: (attachmentId: string) => Promise<string | null>;
  }

  let {
    open,
    threadId,
    channelId,
    parentMessage,
    replies,
    myPeerId,
    myDisplayName,
    frequentReactions,
    scrollTargetMessageId = null,
    scrollTargetNonce = 0,
    getThread,
    getPeerAlias,
    isBot,
    onOpenThread,
    onToggleReaction,
    onRememberReaction,
    onShowMessageInfo,
    onClose,
    onSend,
    getMembers,
    searchMembers,
    resolveAttachmentImageUrl,
  }: Props = $props();

  let panelEl: HTMLDivElement | undefined = $state();
  let handleEl: HTMLDivElement | undefined = $state();

  // Thread resize logic
  $effect(() => {
    if (!open || !panelEl || !handleEl) return;

    // Restore saved width
    const saved = localStorage.getItem('decentchat:threadWidth');
    if (saved) panelEl.style.width = saved;

    let startX = 0;
    let startWidth = 0;

    const onMove = (e: MouseEvent) => {
      if (!panelEl) return;
      const delta = startX - e.clientX;
      const newWidth = Math.min(Math.max(startWidth + delta, 280), window.innerWidth * 0.6);
      panelEl.style.width = `${newWidth}px`;
    };

    const onUp = () => {
      handleEl?.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (panelEl) localStorage.setItem('decentchat:threadWidth', panelEl.style.width);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    const onDown = (e: MouseEvent) => {
      if (!panelEl) return;
      e.preventDefault();
      startX = e.clientX;
      startWidth = panelEl.offsetWidth;
      handleEl?.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };

    handleEl.addEventListener('mousedown', onDown);

    return () => {
      handleEl?.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  });

  let preview = $derived(
    parentMessage
      ? (parentMessage.content.length > 60
          ? parentMessage.content.slice(0, 60) + '…'
          : parentMessage.content)
      : ''
  );
</script>

<div
  bind:this={panelEl}
  class="thread-panel"
  class:hidden={!open}
  class:open={open}
  id="thread-panel"
>
  <div bind:this={handleEl} class="thread-resize-handle" id="thread-resize-handle" title="Drag to resize"></div>
  <div class="thread-header">
    <div class="thread-header-info">
      <h3>💬 Thread</h3>
      <div class="thread-header-preview" style="font-size:12px; opacity:0.6; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
        {preview}
      </div>
    </div>
    <button class="thread-close icon-btn" id="thread-close" onclick={onClose}>✕</button>
  </div>
  <div class="thread-messages" id="thread-messages">
    {#if open && channelId && threadId}
      <MessageList
        messages={replies}
        channelName=""
        activeChannelId={channelId}
        {myPeerId}
        {myDisplayName}
        inThreadView={true}
        threadRoot={parentMessage}
        {frequentReactions}
        {scrollTargetMessageId}
        {scrollTargetNonce}
        {getThread}
        {getPeerAlias}
        {isBot}
        {onOpenThread}
        {onToggleReaction}
        {onRememberReaction}
        {onShowMessageInfo}
        {resolveAttachmentImageUrl}
      />
    {/if}
  </div>
  <div class="thread-compose">
    <ComposeArea
      placeholder="Reply in thread…"
      target="thread"
      {onSend}
      {getMembers}
      {searchMembers}
    />
  </div>
</div>
