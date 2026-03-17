<svelte:options runes={true} />

<script lang="ts">
  import { SeedPhraseManager } from 'decent-protocol';
  import ScreenHeader from '../../components/ScreenHeader.svelte';

  type Props = {
    onBack?: (() => void) | undefined;
    onContinue?: ((payload: { seedPhrase: string; alias: string; isRecovered?: boolean }) => void | Promise<void>) | undefined;
  };

  const seedPhraseManager = new SeedPhraseManager();

  let { onBack, onContinue }: Props = $props();

  let alias = $state('');
  let submitting = $state(false);

  const canContinue = $derived(alias.trim().length > 0 && !submitting);

  function writeLocalStorage(key: string, value: string): void {
    if (typeof window === 'undefined') return;

    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Best effort only.
    }
  }

  function removeLocalStorage(key: string): void {
    if (typeof window === 'undefined') return;

    try {
      window.localStorage.removeItem(key);
    } catch {
      // Best effort only.
    }
  }

  async function handleContinue(): Promise<void> {
    if (!canContinue) return;

    submitting = true;
    try {
      const seedPhrase = seedPhraseManager.generate().mnemonic;

      writeLocalStorage('decentchat-is-recovered', 'false');
      writeLocalStorage('decentchat-seed-backed-up', 'false');
      writeLocalStorage('decentchat-seed-backup-dismissed', '0');
      writeLocalStorage('decentchat-seed-backup-threshold', '100');
      writeLocalStorage('decentchat-messages-sent', '0');
      removeLocalStorage('decentchat-recovery-source-peer');
      removeLocalStorage('decentchat-recovery-signaling');

      await onContinue?.({
        seedPhrase,
        alias: alias.trim(),
        isRecovered: false,
      });
    } finally {
      submitting = false;
    }
  }
</script>

<section class="screen">
  <ScreenHeader title="Create account" onBack={onBack} backLabel="Welcome" />

  <div class="content">
    <p class="hint">Pick a display name. Your account will be created instantly.</p>

    <label class="alias-field" for="alias-input">
      <span>Alias</span>
      <input
        id="alias-input"
        type="text"
        placeholder="How should others see you?"
        bind:value={alias}
        maxlength="32"
      />
    </label>

    <button type="button" class="continue" disabled={!canContinue} onclick={() => void handleContinue()}>
      Continue
    </button>
  </div>
</section>

<style>
  .screen {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--color-bg);
  }

  .content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-4);
    display: grid;
    gap: var(--space-4);
    align-content: start;
  }

  .hint {
    margin: 0;
    font-size: 14px;
    line-height: 1.45;
    color: var(--color-text-muted);
  }

  .alias-field {
    display: grid;
    gap: var(--space-2);
    font-size: 13px;
    color: var(--color-text-muted);
  }

  .alias-field input {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    min-height: 44px;
    padding: 0 var(--space-3);
    font-size: 15px;
    color: var(--color-text);
  }

  .continue {
    min-height: 48px;
    border-radius: var(--radius-md);
    border: none;
    background: var(--color-accent);
    color: var(--color-badge-text);
    font-size: 16px;
    font-weight: 700;
  }

  .continue:disabled {
    opacity: 0.45;
  }
</style>
