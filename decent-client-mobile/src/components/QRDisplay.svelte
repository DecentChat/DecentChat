<svelte:options runes={true} />

<script lang="ts">
  import * as QRCode from 'qrcode';

  type Props = {
    value: string;
    alt?: string;
    size?: number;
    darkColor?: string;
    lightColor?: string;
    showRawValue?: boolean;
  };

  let {
    value,
    alt = 'QR code',
    size = 280,
    darkColor = '#f2f6f8',
    lightColor = '#0f1b22',
    showRawValue = false,
  }: Props = $props();

  let dataUrl = $state('');
  let error = $state<string | null>(null);

  $effect(() => {
    const qrValue = value?.trim() || '';

    if (!qrValue) {
      dataUrl = '';
      error = null;
      return;
    }

    let cancelled = false;

    void QRCode.toDataURL(qrValue, {
      margin: 1,
      width: size,
      color: {
        dark: darkColor,
        light: lightColor,
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (cancelled) return;
        dataUrl = url;
        error = null;
      })
      .catch(() => {
        if (cancelled) return;
        dataUrl = '';
        error = 'Failed to generate QR code.';
      });

    return () => {
      cancelled = true;
    };
  });
</script>

<div class="qr-display" role="group" aria-label="QR code block">
  {#if dataUrl}
    <img src={dataUrl} alt={alt} />
  {:else}
    <div class="placeholder" role="status">
      {error || 'Generating QR code…'}
    </div>
  {/if}

  {#if showRawValue}
    <textarea readonly value={value}></textarea>
  {/if}
</div>

<style>
  .qr-display {
    display: grid;
    gap: var(--space-3);
  }

  img {
    width: min(100%, 280px);
    aspect-ratio: 1;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: #0f1b22;
    justify-self: center;
    object-fit: contain;
  }

  .placeholder {
    min-height: 220px;
    border-radius: var(--radius-md);
    border: 1px dashed var(--color-border);
    background: rgba(0, 0, 0, 0.16);
    color: var(--color-text-muted);
    display: grid;
    place-items: center;
    text-align: center;
    font-size: 13px;
    padding: var(--space-3);
  }

  textarea {
    width: 100%;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: rgba(0, 0, 0, 0.24);
    color: var(--color-text-muted);
    padding: var(--space-2);
    min-height: 88px;
    font-size: 12px;
    line-height: 1.35;
    resize: none;
  }
</style>
