<!--
  ComposeArea.svelte — Message composition with file attachments, autocomplete, etc.
  Replaces the compose-box DOM + bindAppEvents compose logic from UIRenderer.
-->
<script lang="ts">
  import { showEmojiPicker } from '../shared/EmojiPicker.svelte';

  interface PendingAttachment {
    id: string;
    file: File;
    previewUrl?: string;
  }

  interface CommandSuggestion {
    name: string;
    description: string;
  }

  interface MemberSuggestion {
    peerId: string;
    name: string;
  }

  interface Props {
    placeholder?: string;
    target?: 'main' | 'thread';
    /** Callbacks */
    onSend: (text: string, files: File[]) => Promise<void>;
    onTyping?: () => void;
    onStopTyping?: () => void;
    getCommandSuggestions?: (prefix: string) => CommandSuggestion[];
    getMembers?: () => MemberSuggestion[];
  }

  let {
    placeholder = 'Message...',
    target = 'main',
    onSend,
    onTyping,
    onStopTyping,
    getCommandSuggestions,
    getMembers,
  }: Props = $props();

  // ── State ──
  let inputValue = $state('');
  let pendingAttachments: PendingAttachment[] = $state([]);
  let textareaEl: HTMLTextAreaElement | undefined = $state();
  let fileInputEl: HTMLInputElement | undefined = $state();
  let emojiBtn: HTMLButtonElement | undefined = $state();

  // Autocomplete state
  let commandSuggestions: CommandSuggestion[] = $state([]);
  let commandSelectedIdx = $state(0);
  let mentionSuggestions: MemberSuggestion[] = $state([]);
  let mentionSelectedIdx = $state(0);
  let mentionAtStart = $state(0); // cursor position of the @ char

  let typingTimeout: ReturnType<typeof setTimeout> | undefined;

  // ── Derived ──
  let hasContent = $derived(inputValue.trim().length > 0 || pendingAttachments.length > 0);
  let showCommandAutocomplete = $derived(commandSuggestions.length > 0);
  let showMentionAutocomplete = $derived(mentionSuggestions.length > 0);

  // ── Methods ──
  function autoResize() {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, 200) + 'px';
  }

  function stopTypingNow() {
    clearTimeout(typingTimeout);
    onStopTyping?.();
  }

  async function send() {
    const text = inputValue.trim();
    if (!text && pendingAttachments.length === 0) return;

    const files = pendingAttachments.map(a => a.file);
    
    // Clear immediately for responsiveness
    inputValue = '';
    const cleared = [...pendingAttachments];
    pendingAttachments = [];
    
    // Cleanup preview URLs
    for (const att of cleared) {
      if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
    }

    stopTypingNow();
    
    if (textareaEl) {
      textareaEl.style.height = 'auto';
    }

    await onSend(text, files);
  }

  function addFiles(files: File[]) {
    for (const file of files) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      pendingAttachments = [...pendingAttachments, { id, file, previewUrl }];
    }
  }

  function removeAttachment(id: string) {
    const att = pendingAttachments.find(a => a.id === id);
    if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl);
    pendingAttachments = pendingAttachments.filter(a => a.id !== id);
  }

  function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ── Command autocomplete ──
  function updateCommandAutocomplete() {
    const value = inputValue.trim();
    if (!value.startsWith('/') || value.includes(' ') || !getCommandSuggestions) {
      commandSuggestions = [];
      return;
    }
    const prefix = value.slice(1).toLowerCase();
    commandSuggestions = getCommandSuggestions(prefix).slice(0, 8);
    commandSelectedIdx = 0;
  }

  function selectCommand(cmd: string) {
    inputValue = cmd + ' ';
    commandSuggestions = [];
    textareaEl?.focus();
    // Move cursor to end
    requestAnimationFrame(() => {
      if (textareaEl) {
        textareaEl.selectionStart = textareaEl.selectionEnd = inputValue.length;
      }
    });
  }

  // ── Mention autocomplete ──
  function updateMentionAutocomplete() {
    if (!getMembers) {
      mentionSuggestions = [];
      return;
    }

    const cursorPos = textareaEl?.selectionStart ?? inputValue.length;
    const textBeforeCursor = inputValue.slice(0, cursorPos);
    const mentionMatch = textBeforeCursor.match(/(^|\s)@(\S*)$/);

    if (!mentionMatch) {
      mentionSuggestions = [];
      return;
    }

    const query = mentionMatch[2].toLowerCase();
    mentionAtStart = mentionMatch.index! + mentionMatch[1].length;

    const members = getMembers()
      .filter(m => !query || m.name.toLowerCase().includes(query) || m.peerId.toLowerCase().startsWith(query))
      .slice(0, 8);

    mentionSuggestions = members;
    mentionSelectedIdx = 0;
  }

  function insertMention(name: string) {
    const cursorPos = textareaEl?.selectionStart ?? inputValue.length;
    const textBeforeCursor = inputValue.slice(0, cursorPos);
    const mentionMatch = textBeforeCursor.match(/(^|\s)@(\S*)$/);
    const atStart = mentionMatch ? mentionMatch.index! + mentionMatch[1].length : mentionAtStart;

    const replacement = '@' + name.replace(/\s+/g, '-') + ' ';
    inputValue = inputValue.slice(0, atStart) + replacement + inputValue.slice(cursorPos);
    mentionSuggestions = [];
    
    requestAnimationFrame(() => {
      if (textareaEl) {
        const newPos = atStart + replacement.length;
        textareaEl.selectionStart = textareaEl.selectionEnd = newPos;
        textareaEl.focus();
      }
    });
  }

  // ── Event handlers ──
  function onKeydown(e: KeyboardEvent) {
    // Handle autocomplete navigation first
    if (showCommandAutocomplete) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        commandSelectedIdx = (commandSelectedIdx + 1) % commandSuggestions.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        commandSelectedIdx = (commandSelectedIdx - 1 + commandSuggestions.length) % commandSuggestions.length;
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        selectCommand(commandSuggestions[commandSelectedIdx]?.name ? '/' + commandSuggestions[commandSelectedIdx].name : '');
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        commandSuggestions = [];
        return;
      }
    }

    if (showMentionAutocomplete) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        mentionSelectedIdx = (mentionSelectedIdx + 1) % mentionSuggestions.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        mentionSelectedIdx = (mentionSelectedIdx - 1 + mentionSuggestions.length) % mentionSuggestions.length;
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        insertMention(mentionSuggestions[mentionSelectedIdx]?.name ?? '');
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        mentionSuggestions = [];
        return;
      }
    }

    // Send on Enter (no shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  function onInput() {
    autoResize();
    updateCommandAutocomplete();
    updateMentionAutocomplete();

    // Typing indicator
    onTyping?.();
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(stopTypingNow, 1500);
  }

  function onEmojiClick() {
    if (!emojiBtn) return;
    void showEmojiPicker(emojiBtn, (emoji: string) => {
      inputValue += emoji;
      textareaEl?.focus();
    });
  }

  function onAttachClick() {
    fileInputEl?.click();
  }

  function onFileChange() {
    if (fileInputEl?.files) {
      addFiles(Array.from(fileInputEl.files));
      fileInputEl.value = '';
    }
  }

  // Expose methods for external use (paste handler, drag-drop)
  export function addExternalFiles(files: File[]) {
    addFiles(files);
  }

  export function focus() {
    textareaEl?.focus();
  }

  export function setSlashPrefix() {
    if (textareaEl && !inputValue) {
      inputValue = '/';
      updateCommandAutocomplete();
    }
    textareaEl?.focus();
  }

  export function getValue() {
    return inputValue;
  }

  // Handle clipboard paste for images
  function onPaste(e: ClipboardEvent) {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter(item => item.type.startsWith('image/'));
    if (imageItems.length > 0) {
      e.preventDefault();
      const files: File[] = [];
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
      addFiles(files);
    }
  }

  // Global paste listener (for paste when textarea not focused)
  $effect(() => {
    const handler = (e: Event) => {
      const active = document.activeElement as HTMLElement | null;
      if (active === textareaEl) return; // Already handled by onpaste on textarea

      // Keep paste routing isolated between thread/main composers.
      const eventTarget = e.target as HTMLElement | null;
      const inThreadContext = !!eventTarget?.closest?.('#thread-panel') || !!active?.closest?.('#thread-panel');

      if (target === 'thread') {
        if (!inThreadContext) return;
      } else {
        // Main composer must ignore pastes that originate in thread context.
        if (inThreadContext) return;
      }

      const clipEvent = e as ClipboardEvent;
      const items = Array.from(clipEvent.clipboardData?.items || []);
      const imageItems = items.filter(item => item.type.startsWith('image/'));
      if (imageItems.length > 0) {
        e.preventDefault();
        const files: File[] = [];
        for (const item of imageItems) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
        addFiles(files);
      }
    };

    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  });
</script>

<div class="compose-box">
  {#if pendingAttachments.length > 0}
    <div class="compose-pending has-items">
      {#each pendingAttachments as att (att.id)}
        <div class="pending-attachment" data-pending-id={att.id}>
          {#if att.previewUrl}
            <img class="pending-attachment-thumb" src={att.previewUrl} alt={att.file.name} />
          {:else}
            <span class="pending-attachment-file">📎 {att.file.name}</span>
          {/if}
          <button class="pending-attachment-remove" title="Remove attachment" onclick={() => removeAttachment(att.id)}>✕</button>
        </div>
      {/each}
    </div>
  {/if}
  <div class="compose-inner">
    <input type="file" bind:this={fileInputEl} id={target === 'thread' ? 'thread-file-input' : 'file-input'} style="display:none" multiple onchange={onFileChange} />
    <button class="compose-attach" id={target === 'thread' ? 'thread-attach-btn' : 'attach-btn'} title="Attach file" onclick={onAttachClick}>📎</button>
    <div class="compose-input-wrapper" style="position:relative;flex:1;">
      {#if showCommandAutocomplete}
        <div class="command-autocomplete" id="command-autocomplete">
          {#each commandSuggestions as s, i}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div 
              class="command-suggestion" 
              class:selected={i === commandSelectedIdx}
              data-cmd={'/' + s.name}
              onmousedown={(e) => { e.preventDefault(); selectCommand('/' + s.name); }}
            >
              <span class="cmd-name">/{s.name}</span>
              <span class="cmd-desc">{s.description}</span>
            </div>
          {/each}
        </div>
      {/if}
      {#if showMentionAutocomplete}
        <div class="mention-autocomplete" id="mention-autocomplete">
          {#each mentionSuggestions as m, i}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="mention-option"
              class:selected={i === mentionSelectedIdx}
              data-peer-id={m.peerId}
              data-name={m.name}
              onmousedown={(e) => { e.preventDefault(); insertMention(m.name); }}
            >
              <span class="mention-option-name">{m.name}</span>
              <span class="mention-option-id">{m.peerId.slice(0, 8)}</span>
            </div>
          {/each}
        </div>
      {/if}
      <textarea
        bind:this={textareaEl}
        bind:value={inputValue}
        class="compose-input"
        id={target === 'thread' ? 'thread-input' : 'compose-input'}
        {placeholder}
        rows="1"
        onkeydown={onKeydown}
        oninput={onInput}
        onblur={stopTypingNow}
        onpaste={onPaste}
      ></textarea>
    </div>
    {#if target === 'main'}
      <button bind:this={emojiBtn} class="compose-emoji" id="emoji-btn" title="Emoji" onclick={onEmojiClick}>😊</button>
    {/if}
    <button
      class="compose-send"
      class:active={hasContent}
      id={target === 'thread' ? 'thread-send-btn' : 'send-btn'}
      title="Send"
      onclick={() => void send()}
    >⬆</button>
  </div>
</div>
