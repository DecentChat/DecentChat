<!--
  ModalImpl.svelte — The actual modal rendering component.
  Used by both the imperative showModal() API and declarative usage.
-->
<script lang="ts">
  interface Props {
    title: string;
    bodyHTML?: string;
    submitLabel?: string;
    cancelLabel?: string;
    onsubmit?: (form: HTMLFormElement) => boolean | void | Promise<boolean | void>;
    onclose?: () => void;
    bindOverlay?: (el: HTMLDivElement) => void;
    children?: import('svelte').Snippet;
  }

  let {
    title,
    bodyHTML = '',
    submitLabel = 'Confirm',
    cancelLabel = 'Cancel',
    onsubmit,
    onclose,
    bindOverlay,
    children,
  }: Props = $props();

  let overlayEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (overlayEl && bindOverlay) {
      bindOverlay(overlayEl);
    }
  });

  // Focus first input after mount
  $effect(() => {
    if (overlayEl) {
      setTimeout(() => {
        const input = overlayEl?.querySelector('input') as HTMLInputElement | null;
        input?.focus();
      }, 50);
    }
  });

  // Escape key handler
  $effect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  });

  function close() {
    overlayEl?.remove();
    onclose?.();
  }

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === overlayEl) close();
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const shouldClose = await onsubmit?.(form);
    if (shouldClose !== false) {
      close();
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="modal-overlay"
  data-testid="modal-overlay"
  bind:this={overlayEl}
  onclick={handleOverlayClick}
>
  <div class="modal" data-testid="modal">
    <h2>{title}</h2>
    {#if children}
      <form id="modal-form" onsubmit={handleSubmit}>
        {@render children()}
        <div class="modal-actions">
          <button type="button" class="btn-secondary" onclick={close}>{cancelLabel}</button>
          <button type="submit" class="btn-primary">{submitLabel}</button>
        </div>
      </form>
    {:else}
      <form id="modal-form" onsubmit={handleSubmit}>
        {@html bodyHTML}
        <div class="modal-actions">
          <button type="button" class="btn-secondary" onclick={close}>{cancelLabel}</button>
          <button type="submit" class="btn-primary">{submitLabel}</button>
        </div>
      </form>
    {/if}
  </div>
</div>
