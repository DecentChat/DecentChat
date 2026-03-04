<!--
  EmojiPicker.svelte — Drop-in replacement for EmojiPicker.ts
  
  Provides the same imperative API: show(anchor, onSelect)
  Uses @floating-ui/dom for positioning, same as original.
-->
<script lang="ts" module>
  import { mount, unmount } from 'svelte';
  import { computePosition, flip, shift, offset } from '@floating-ui/dom';

  // Singleton instance management
  let currentInstance: { cleanup: () => void } | null = null;

  /**
   * Show the emoji picker anchored to an element.
   * Matches the old EmojiPicker.show() signature.
   */
  export async function showEmojiPicker(
    anchor: HTMLElement,
    onSelect: (emoji: string) => void,
  ): Promise<void> {
    // Close any existing picker
    closeEmojiPicker();

    const target = document.createElement('div');
    document.body.appendChild(target);

    let component: Record<string, any> | null = null;

    const cleanup = () => {
      if (component) {
        unmount(component);
        component = null;
      }
      target.remove();
      currentInstance = null;
    };

    component = mount(EmojiPickerImpl, {
      target,
      props: {
        anchor,
        onselect: (emoji: string) => {
          onSelect(emoji);
          cleanup();
        },
        onclose: cleanup,
      },
    });

    currentInstance = { cleanup };
  }

  export function closeEmojiPicker(): void {
    currentInstance?.cleanup();
    currentInstance = null;
  }
</script>

<script lang="ts">
  import EmojiPickerImpl from './EmojiPickerImpl.svelte';
</script>
