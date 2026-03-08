<!--
  SearchPanel.svelte — Message search overlay.
  Replaces showSearchPanel() from UIRenderer.
-->
<script lang="ts">
  interface SearchResult {
    message: {
      id: string;
      senderId: string;
      timestamp: number;
    };
    highlight: string;
  }

  interface Props {
    myPeerId: string;
    myAlias: string;
    onSearch: (query: string) => SearchResult[];
    onScrollToMessage: (messageId: string) => void;
    onClose: () => void;
  }

  let {
    myPeerId,
    myAlias,
    onSearch,
    onScrollToMessage,
    onClose,
  }: Props = $props();

  let query = $state('');
  let results: SearchResult[] = $state([]);
  let inputEl: HTMLInputElement | undefined = $state();

  $effect(() => {
    inputEl?.focus();
  });

  function handleInput() {
    if (query.trim().length < 2) {
      results = [];
      return;
    }
    results = onSearch(query.trim());
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    onClose();
    e.preventDefault();
    e.stopPropagation();
  }

  function handleResultClick(messageId: string) {
    onScrollToMessage(messageId);
  }

  function getSenderName(senderId: string): string {
    return senderId === myPeerId
      ? (myAlias || 'You')
      : senderId.slice(0, 8);
  }
</script>

<div class="search-panel" id="search-overlay">
  <div class="search-input-row">
    <input
      bind:this={inputEl}
      bind:value={query}
      type="text"
      placeholder="Search messages..."
      class="search-field"
      id="search-input"
      oninput={handleInput}
      onkeydown={handleKeydown}
    />
    <button class="icon-btn" id="search-close" onclick={onClose}>✕</button>
  </div>
  <div class="search-results" id="search-results">
    {#if query.trim().length < 2}
      <div class="search-hint">Type at least 2 characters...</div>
    {:else if results.length === 0}
      <div class="search-hint">No results found</div>
    {:else}
      {#each results as r (r.message.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="search-result" data-msg-id={r.message.id} onclick={() => handleResultClick(r.message.id)}>
          <div class="search-result-header">
            <span class="search-result-sender">{getSenderName(r.message.senderId)}</span>
            <span class="search-result-time">{new Date(r.message.timestamp).toLocaleString()}</span>
          </div>
          <div class="search-result-text">{r.highlight}</div>
        </div>
      {/each}
    {/if}
  </div>
</div>
