<!--
  EmojiPickerImpl.svelte — The actual emoji picker rendering component.
-->
<script lang="ts">
  import { computePosition, flip, shift, offset } from '@floating-ui/dom';

  const EMOJI_CATEGORIES: Record<string, string[]> = {
    '😀 Smileys': [
      '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊',
      '😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋',
      '😛','😜','🤪','😝','🤑','🤗','🤭','🫢','🤫','🤔',
      '🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄',
      '😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕',
      '🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸',
      '😎','🤓','🧐','😕','🫤','😟','🙁','😮','😯','😲',
      '😳','🥺','🥹','😦','😧','😨','😰','😥','😢','😭',
      '😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡',
      '😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺',
    ],
    '👋 Gestures': [
      '👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌',
      '🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉',
      '👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛',
      '🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💪',
    ],
    '❤️ Hearts': [
      '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔',
      '❤️🔥','❤️🩹','💕','💞','💓','💗','💖','💘','💝','💟',
    ],
    '🎉 Objects': [
      '🎉','🎊','🎈','🎁','🏆','🥇','🏅','⭐','🌟','✨',
      '💫','🔥','💥','🎯','💡','📌','📎','🔗','🔒','🔑',
      '🗝️','🛡️','⚔️','🏴‍☠️','🚀','✈️','🌍','🌈','☀️','🌙',
    ],
    '👍 Reactions': [
      '👍','👎','❤️','😂','😮','😢','😡','🎉','🤔','👀',
      '🔥','💯','✅','❌','⚡','🙏','💪','🫡','🤝','👏',
    ],
  };

  interface Props {
    anchor: HTMLElement;
    onselect: (emoji: string) => void;
    onclose: () => void;
  }

  let { anchor, onselect, onclose }: Props = $props();

  let containerEl: HTMLDivElement | undefined = $state();
  let searchQuery = $state('');

  // Position the picker using floating-ui after mount
  $effect(() => {
    if (!containerEl) return;

    const isMobile = window.innerWidth <= 768;
    if (isMobile) return; // CSS handles mobile positioning

    // Desktop: use floating-ui
    containerEl.style.position = 'fixed';
    containerEl.style.top = '0';
    containerEl.style.left = '0';

    computePosition(anchor, containerEl, {
      placement: 'top-start',
      middleware: [
        offset(8),
        flip({ fallbackPlacements: ['top-end', 'bottom-start', 'bottom-end'] }),
        shift({ padding: 8 }),
      ],
    }).then(({ x, y }) => {
      if (containerEl) {
        containerEl.style.left = `${x}px`;
        containerEl.style.top = `${y}px`;
      }
    });
  });

  // Focus search input after mount
  $effect(() => {
    if (containerEl) {
      const input = containerEl.querySelector('.emoji-search-input') as HTMLInputElement;
      input?.focus();
    }
  });

  // Close on outside click
  $effect(() => {
    const handler = (e: MouseEvent) => {
      if (containerEl && !containerEl.contains(e.target as Node)) {
        onclose();
      }
    };
    // Delay to avoid immediate close
    const timer = setTimeout(() => {
      document.addEventListener('click', handler);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handler);
    };
  });

  // Close on Escape
  $effect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onclose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  });

  function handleEmojiClick(emoji: string) {
    onselect(emoji);
  }

  function isVisible(emoji: string): boolean {
    if (!searchQuery) return true;
    return emoji.includes(searchQuery.toLowerCase());
  }

  function isCategoryVisible(emojis: string[]): boolean {
    if (!searchQuery) return true;
    return emojis.some(e => isVisible(e));
  }
</script>

<div class="emoji-picker" data-testid="emoji-picker" bind:this={containerEl}>
  <div class="emoji-picker-search">
    <input
      type="text"
      placeholder="Search emoji..."
      class="emoji-search-input"
      bind:value={searchQuery}
    />
  </div>
  <div class="emoji-picker-categories">
    {#each Object.entries(EMOJI_CATEGORIES) as [name, emojis]}
      {#if isCategoryVisible(emojis)}
        <div class="emoji-category">
          <div class="emoji-category-name">{name}</div>
          <div class="emoji-grid">
            {#each emojis as emoji}
              {#if isVisible(emoji)}
                <button
                  class="emoji-btn"
                  data-emoji={emoji}
                  onclick={() => handleEmojiClick(emoji)}
                >
                  {emoji}
                </button>
              {/if}
            {/each}
          </div>
        </div>
      {/if}
    {/each}
  </div>
</div>
