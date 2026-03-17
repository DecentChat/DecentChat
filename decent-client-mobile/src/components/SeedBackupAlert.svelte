<svelte:options runes={true} />

<script lang="ts">
  type Props = {
    onConfirm?: (() => void | Promise<void>) | undefined;
    onRemindLater?: (() => void) | undefined;
  };

  let { onConfirm, onRemindLater }: Props = $props();

  let seedVisible = $state(false);
  let seedPhrase = $state('');
  let firstConfirmation = $state(false);
  let secondConfirmation = $state(false);

  const canConfirm = $derived(firstConfirmation && secondConfirmation);

  function readSeedPhrase(): string {
    if (typeof window === 'undefined') return '';

    try {
      return window.localStorage.getItem('decentchat-seed-phrase')?.trim() || '';
    } catch {
      return '';
    }
  }

  function toggleSeedVisibility(): void {
    if (!seedVisible && !seedPhrase) {
      seedPhrase = readSeedPhrase();
    }

    seedVisible = !seedVisible;
  }

  async function handleConfirm(): Promise<void> {
    if (!canConfirm) return;
    await onConfirm?.();
  }
</script>

<div class="overlay" role="presentation">
  <div
    class="modal"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="seed-backup-title"
    aria-describedby="seed-backup-description"
  >
    <h2 id="seed-backup-title">Back up your seed phrase</h2>
    <p id="seed-backup-description">
      Your seed phrase is the only way to recover your account. If you lose your device and this phrase, your account is gone forever.
    </p>

    <button type="button" class="seed-toggle" onclick={toggleSeedVisibility}>
      {seedVisible ? 'Hide seed phrase' : 'Show seed phrase'}
    </button>

    {#if seedVisible}
      <div class="seed-box" aria-live="polite">
        {#if seedPhrase}
          {seedPhrase}
        {:else}
          Seed phrase unavailable on this device.
        {/if}
      </div>
    {/if}

    <label class="confirm-line" for="backup-confirm-1">
      <input id="backup-confirm-1" type="checkbox" bind:checked={firstConfirmation} />
      <span>Are you sure you've saved your seed phrase somewhere safe?</span>
    </label>

    <label class="confirm-line" for="backup-confirm-2">
      <input id="backup-confirm-2" type="checkbox" bind:checked={secondConfirmation} />
      <span>
        I understand that losing this phrase means losing my account forever. There is no recovery. I won't be asked again.
      </span>
    </label>

    <div class="actions">
      <button type="button" class="later" onclick={() => onRemindLater?.()}>Remind me later</button>
      <button type="button" class="confirm" disabled={!canConfirm} onclick={() => void handleConfirm()}>
        I've written it down
      </button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 140;
    background: rgba(5, 10, 14, 0.82);
    backdrop-filter: blur(5px);
    padding: calc(var(--safe-top) + var(--space-4)) var(--space-4) calc(var(--safe-bottom) + var(--space-4));
    display: grid;
    align-items: center;
  }

  .modal {
    width: min(520px, 100%);
    margin: 0 auto;
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border);
    background: #16232a;
    box-shadow: 0 20px 44px rgba(0, 0, 0, 0.5);
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
  }

  h2 {
    margin: 0;
    font-size: 22px;
    letter-spacing: -0.02em;
  }

  p {
    margin: 0;
    font-size: 14px;
    line-height: 1.45;
    color: var(--color-text-muted);
  }

  .seed-toggle {
    min-height: 42px;
    border-radius: var(--radius-md);
    border: 1px solid rgba(134, 150, 160, 0.42);
    background: var(--color-surface);
    color: var(--color-text);
    font-weight: 650;
    font-size: 14px;
  }

  .seed-box {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: rgba(0, 0, 0, 0.22);
    padding: var(--space-3);
    font-size: 15px;
    line-height: 1.45;
    word-break: break-word;
  }

  .confirm-line {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    font-size: 13px;
    line-height: 1.4;
    color: var(--color-text);
  }

  .confirm-line input {
    width: 18px;
    height: 18px;
    margin-top: 1px;
    accent-color: var(--color-accent);
    flex: 0 0 auto;
  }

  .actions {
    margin-top: var(--space-1);
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .actions button {
    min-height: 46px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    font-size: 14px;
    font-weight: 700;
    padding: 0 var(--space-2);
  }

  .later {
    background: var(--color-surface);
    color: var(--color-text);
  }

  .confirm {
    border: none;
    background: var(--color-accent);
    color: var(--color-badge-text);
  }

  .confirm:disabled {
    opacity: 0.45;
  }
</style>
