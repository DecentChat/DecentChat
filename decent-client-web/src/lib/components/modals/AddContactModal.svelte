<!--
  AddContactModal.svelte — Modal for adding a contact via URI.
  Replaces UIRenderer.showAddContactModal().
-->
<script lang="ts" module>
  import { mount, unmount } from 'svelte';
  import type { Contact } from 'decent-protocol';
  import { ContactURI } from 'decent-protocol';

  interface AddContactConfig {
    onAdd: (contact: Contact) => Promise<void>;
    onToast: (message: string, type?: string) => void;
  }

  export function showAddContactModal(config: AddContactConfig): void {
    const target = document.createElement('div');
    document.body.appendChild(target);

    let instance: Record<string, any> | null = null;
    const cleanup = () => {
      if (instance) { unmount(instance); instance = null; }
      target.remove();
    };

    instance = mount(AddContactModal, {
      target,
      props: { ...config, onClose: cleanup },
    });
  }

  import AddContactModal from './AddContactModal.svelte';
</script>

<script lang="ts">
  interface Props {
    onAdd: (contact: Contact) => Promise<void>;
    onToast: (message: string, type?: string) => void;
    onClose: () => void;
  }

  let { onAdd, onToast, onClose }: Props = $props();

  let contactUri = $state('');
  let displayNameOverride = $state('');

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  $effect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  });

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    const uri = contactUri.trim();

    if (!ContactURI.isValid(uri)) {
      onToast('Invalid Contact URI', 'error');
      return;
    }

    const parsed = ContactURI.decode(uri);
    const contact: Contact = {
      peerId: parsed.peerId || `contact-${Date.now()}`,
      publicKey: parsed.publicKey,
      displayName: displayNameOverride.trim() || parsed.displayName,
      signalingServers: parsed.signalingServers || [],
      addedAt: Date.now(),
      lastSeen: 0,
    };

    await onAdd(contact);
    onToast(`Added ${contact.displayName} to contacts`, 'success');
    onClose();
  }
</script>

<div class="modal-overlay" onclick={handleOverlayClick} onkeydown={(e) => e.key === 'Escape' && onClose()} role="presentation">
  <div class="modal">
    <h2>Add Contact</h2>
    <form onsubmit={handleSubmit}>
      <div class="form-group">
        <label for="contact-uri-input">Contact URI</label>
        <textarea
          id="contact-uri-input"
          rows="4"
          placeholder="Paste decent://contact?... URI"
          required
          bind:value={contactUri}
        ></textarea>
      </div>
      <div class="form-group">
        <label for="display-name-override">Display Name Override (optional)</label>
        <input
          type="text"
          id="display-name-override"
          placeholder="Override contact name"
          bind:value={displayNameOverride}
        />
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick={onClose}>Cancel</button>
        <button type="submit" class="btn-primary">Add Contact</button>
      </div>
    </form>
  </div>
</div>
