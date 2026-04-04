<!--
  Toast.svelte — Drop-in replacement for UIRenderer.showToast()

  Usage from Svelte: import { toast } from '$lib/components/shared/Toast.svelte'
  Usage from vanilla: import { toast } from './lib/components/shared/Toast.svelte'

  The imperative `toast()` function is exported so existing UIRenderer code
  can call it without refactoring every call site.
-->
<script lang="ts" module>
  // ── Imperative API (callable from anywhere) ──
  type ToastType = 'info' | 'error' | 'success';

  interface ToastItem {
    id: number;
    message: string;
    type: ToastType;
    timeout: ReturnType<typeof setTimeout>;
  }

  // Shared reactive state — singleton across all mount points
  let items: ToastItem[] = $state([]);
  let nextId = 0;

  export function toast(message: string, type: ToastType = 'info', duration = 3000): void {
    // Remove any existing toast with the same message to avoid duplicates
    items = items.filter(t => {
      if (t.message === message) {
        clearTimeout(t.timeout);
        return false;
      }
      return true;
    });

    const id = nextId++;
    const timeout = setTimeout(() => {
      items = items.filter(t => t.id !== id);
    }, duration);

    items = [...items, { id, message, type, timeout }];
  }
</script>

<script lang="ts">
  function dismiss(id: number) {
    const item = items.find(t => t.id === id);
    if (item) clearTimeout(item.timeout);
    items = items.filter(t => t.id !== id);
  }
</script>

{#each items as item (item.id)}
  <div
    class="toast {item.type}"
    data-testid="toast"
    role="alert"
  >
    {item.message}
    <button type="button" class="toast-dismiss" aria-label="Dismiss" onclick={() => dismiss(item.id)}>✕</button>
  </div>
{/each}
