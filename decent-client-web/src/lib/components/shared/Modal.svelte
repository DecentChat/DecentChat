<!--
  Modal.svelte — Drop-in replacement for UIRenderer.showModal()

  Provides both:
  1. Declarative Svelte usage: <Modal title="..." onsubmit={...}>...</Modal>
  2. Imperative API: showModal(title, bodyHTML, onSubmit) — matches UIRenderer signature
-->
<script lang="ts" module>
  import { mount, unmount } from 'svelte';

  /**
   * Imperative showModal() — matches the old UIRenderer.showModal() signature exactly.
   * Creates a temporary Svelte modal, returns the overlay element for compatibility.
   */
  export function showModal(
    title: string,
    bodyHTML: string,
    onSubmit: (form: HTMLFormElement) => boolean | void | Promise<boolean | void>,
    options?: {
      submitLabel?: string;
      cancelLabel?: string;
    },
  ): HTMLDivElement {
    const target = document.createElement('div');
    document.body.appendChild(target);

    let overlayEl: HTMLDivElement | null = null;
    let componentInstance: Record<string, any> | null = null;

    const cleanup = () => {
      if (componentInstance) {
        unmount(componentInstance);
        componentInstance = null;
      }
      target.remove();
    };

    componentInstance = mount(ModalImpl, {
      target,
      props: {
        title,
        bodyHTML,
        submitLabel: options?.submitLabel,
        cancelLabel: options?.cancelLabel,
        onsubmit: onSubmit,
        onclose: cleanup,
        bindOverlay: (el: HTMLDivElement) => { overlayEl = el; },
      },
    });

    // Return overlay element for backward compatibility
    // (some callers store the reference to manually remove it)
    return overlayEl || target as any;
  }
</script>

<script lang="ts">
  import ModalImpl from './ModalImpl.svelte';
</script>
