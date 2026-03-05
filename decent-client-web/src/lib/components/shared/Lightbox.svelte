<!--
  Lightbox.svelte — Full-screen image viewer overlay.
  Replaces openLightbox/closeLightbox from UIRenderer.
-->
<script lang="ts">
  interface Props {
    open: boolean;
    src: string;
    name: string;
    onClose: () => void;
  }

  let {
    open,
    src,
    name,
    onClose,
  }: Props = $props();

  $effect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  });
</script>

<div class="lightbox" id="lightbox" style="display:{open ? 'flex' : 'none'}">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="lightbox-backdrop" id="lightbox-backdrop" onclick={onClose}></div>
  <button class="lightbox-close" id="lightbox-close" onclick={onClose}>✕</button>
  <img class="lightbox-img" id="lightbox-img" {src} alt={name} />
  <div class="lightbox-name" id="lightbox-name">{name}</div>
</div>
