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
    submitClassName?: string;
    cancelClassName?: string;
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
    submitClassName = '',
    cancelClassName = '',
    onsubmit,
    onclose,
    bindOverlay,
    children,
  }: Props = $props();

  // Unique IDs to avoid collisions when multiple modals are mounted
  const uid = Math.random().toString(36).slice(2, 8);
  const titleId = `modal-title-${uid}`;
  const formId = `modal-form-${uid}`;

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

<div
  class="modal-overlay"
  data-testid="modal-overlay"
  bind:this={overlayEl}
  onclick={handleOverlayClick}
  onkeydown={(e) => e.key === 'Escape' && close()}
  role="presentation"
>
  <div class="modal" data-testid="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <button type="button" class="modal-close-button" aria-label={`Close ${title} dialog`} onclick={close}>×</button>
    <h2 id={titleId}>{title}</h2>
    {#if children}
      <form id={formId} onsubmit={handleSubmit}>
        {@render children()}
        <div class="modal-actions">
          <button type="button" class={`btn-secondary ${cancelClassName}`.trim()} onclick={close}>{cancelLabel}</button>
          <button type="submit" class={`btn-primary ${submitClassName}`.trim()}>{submitLabel}</button>
        </div>
      </form>
    {:else}
      <form id={formId} onsubmit={handleSubmit}>
        {@html bodyHTML}
        <div class="modal-actions">
          <button type="button" class={`btn-secondary ${cancelClassName}`.trim()} onclick={close}>{cancelLabel}</button>
          <button type="submit" class={`btn-primary ${submitClassName}`.trim()}>{submitLabel}</button>
        </div>
      </form>
    {/if}
  </div>
</div>
