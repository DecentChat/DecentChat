<svelte:options runes={true} />

<script lang="ts">
  import { SeedPhraseManager } from 'decent-protocol';
  import ScreenHeader from '../../components/ScreenHeader.svelte';

  type Props = {
    onBack?: (() => void) | undefined;
    onContinue?: ((payload: { seedPhrase: string; alias: string }) => void | Promise<void>) | undefined;
  };

  const seedPhraseManager = new SeedPhraseManager();

  let { onBack, onContinue }: Props = $props();

  let alias = $state('');
  let seedInput = $state('');
  let submitting = $state(false);

  const normalizedSeed = $derived(seedInput.trim().toLowerCase().replace(/\s+/g, ' '));
  const validation = $derived.by(() => {
    if (!normalizedSeed) return null;
    return seedPhraseManager.validate(normalizedSeed);
  });

  const isValid = $derived(validation?.valid === true);
  const validationMessage = $derived.by(() => {
    if (!normalizedSeed) return 'Paste your 12-word phrase to continue.';
    if (isValid) return 'Seed phrase looks valid.';
    return validation?.error || 'Invalid seed phrase.';
  });

  const canContinue = $derived(isValid && alias.trim().length > 0 && !submitting);

  async function handleContinue(): Promise<void> {
    if (!canContinue) return;

    submitting = true;
    try {
      await onContinue?.({
        seedPhrase: normalizedSeed,
        alias: alias.trim(),
      });
    } finally {
      submitting = false;
    }
  }
</script>

<section class="screen">
  <ScreenHeader title="Import account" onBack={onBack} backLabel="Welcome" />

  <div class="content">
    <label class="field" for="seed-input">
      <span>Seed phrase</span>
      <textarea
        id="seed-input"
        placeholder="twelve words separated by spaces"
        bind:value={seedInput}
        rows="4"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
      ></textarea>
    </label>

    <p class="validation" data-valid={isValid}>{validationMessage}</p>

    <label class="field" for="alias-input">
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

  .field {
    display: grid;
    gap: var(--space-2);
    font-size: 13px;
    color: var(--color-text-muted);
  }

  textarea,
  input {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 10px var(--space-3);
    font-size: 15px;
  }

  textarea {
    resize: vertical;
    min-height: 108px;
    line-height: 1.45;
    font-family: var(--font-system);
  }

  input {
    min-height: 44px;
  }

  .validation {
    margin: 0;
    font-size: 13px;
    line-height: 1.35;
    color: #ff7f7f;
  }

  .validation[data-valid='true'] {
    color: var(--color-success);
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
