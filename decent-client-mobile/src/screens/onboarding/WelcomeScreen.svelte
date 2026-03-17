<svelte:options runes={true} />

<script lang="ts">
  import logoUrl from '../../assets/logo.svg';

  type Props = {
    onCreate?: (() => void) | undefined;
    onRecover?: (() => void) | undefined;
  };

  let { onCreate, onRecover }: Props = $props();
</script>

<section class="welcome-screen" aria-label="Welcome to DecentChat">
  <div class="hero">
    <div class="logo" aria-hidden="true">
      <img src={logoUrl} alt="" />
    </div>
    <h1>DecentChat</h1>
    <p>Private peer-to-peer chat. End-to-end encrypted. No central server controlling your messages.</p>
  </div>

  <div class="actions">
    <button type="button" class="primary" onclick={() => onCreate?.()}>Get started</button>
    <button type="button" class="secondary" onclick={() => onRecover?.()}>I have an account</button>
  </div>
</section>

<style>
  .welcome-screen {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: var(--space-6);
    padding: calc(var(--safe-top) + 52px) var(--space-5) calc(var(--space-5) + var(--safe-bottom));
    background:
      radial-gradient(circle at 18% 10%, rgba(108, 92, 231, 0.18), transparent 48%),
      radial-gradient(circle at 88% 92%, rgba(108, 92, 231, 0.16), transparent 52%),
      var(--color-bg);
  }

  .hero {
    flex: 1;
    display: grid;
    align-content: center;
    justify-items: center;
    text-align: center;
    gap: var(--space-4);
  }

  .logo {
    width: 96px;
    height: 96px;
    border-radius: 28px;
    background: linear-gradient(145deg, rgba(108, 92, 231, 0.18), rgba(90, 75, 209, 0.16));
    box-shadow: 0 16px 34px rgba(0, 0, 0, 0.36);
    display: grid;
    place-items: center;
    padding: 10px;
  }

  .logo img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  h1 {
    margin: 0;
    font-size: 34px;
    letter-spacing: -0.03em;
    line-height: 1.1;
  }

  p {
    margin: 0;
    max-width: 320px;
    color: var(--color-text-muted);
    font-size: 15px;
    line-height: 1.5;
  }

  .actions {
    display: grid;
    gap: var(--space-3);
  }

  .actions button {
    width: 100%;
    min-height: 48px;
    border-radius: var(--radius-md);
    font-size: 16px;
    font-weight: 700;
    letter-spacing: -0.01em;
    border: 1px solid transparent;
  }

  .primary {
    background: var(--color-accent);
    color: var(--color-badge-text);
    box-shadow: 0 12px 24px rgba(108, 92, 231, 0.24);
  }

  .secondary {
    background: transparent;
    color: var(--color-text);
    border-color: rgba(134, 150, 160, 0.38);
  }
</style>
