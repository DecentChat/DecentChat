<svelte:options runes={true} />

<script lang="ts">
  type Props = {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
    onConfirm?: (() => void | Promise<void>) | undefined;
    onCancel?: (() => void) | undefined;
  };

  let {
    open,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    destructive = false,
    onConfirm,
    onCancel,
  }: Props = $props();

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target !== event.currentTarget) return;
    onCancel?.();
  }
</script>

{#if open}
  <div class="dialog-overlay" role="presentation" onclick={handleBackdropClick}>
    <section class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-message">
      <h2 id="dialog-title">{title}</h2>
      <p id="dialog-message">{message}</p>

      <div class="actions">
        <button type="button" class="cancel" onclick={() => onCancel?.()}>{cancelLabel}</button>
        <button
          type="button"
          class="confirm"
          data-destructive={destructive}
          onclick={() => void onConfirm?.()}
        >
          {confirmLabel}
        </button>
      </div>
    </section>
  </div>
{/if}

<style>
  .dialog-overlay {
    position: fixed;
    inset: 0;
    z-index: 120;
    background: rgba(0, 0, 0, 0.54);
    backdrop-filter: blur(4px);
    display: grid;
    place-items: center;
    padding: var(--space-4);
  }

  .dialog {
    width: min(420px, 100%);
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border);
    background: #17242c;
    box-shadow: 0 18px 42px rgba(0, 0, 0, 0.45);
    padding: var(--space-4);
  }

  h2 {
    margin: 0;
    font-size: 19px;
    letter-spacing: -0.02em;
    color: var(--color-text);
  }

  p {
    margin: var(--space-3) 0 0;
    color: var(--color-text-muted);
    line-height: 1.45;
    font-size: 14px;
  }

  .actions {
    margin-top: var(--space-4);
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  button {
    min-height: 44px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    font-size: 14px;
    font-weight: 700;
    padding: 0 var(--space-3);
  }

  .cancel {
    background: var(--color-surface);
    color: var(--color-text);
  }

  .confirm {
    background: var(--color-accent);
    color: var(--color-badge-text);
    border-color: rgba(108, 92, 231, 0.6);
  }

  .confirm[data-destructive='true'] {
    background: #d04545;
    border-color: rgba(208, 69, 69, 0.75);
    color: #fff;
  }
</style>
