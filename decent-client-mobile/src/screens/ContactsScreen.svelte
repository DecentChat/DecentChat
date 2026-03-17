<svelte:options runes={true} />

<script lang="ts">
  import { ContactURI, type Contact } from 'decent-protocol';
  import ScreenHeader from '../components/ScreenHeader.svelte';
  import QRDisplay from '../components/QRDisplay.svelte';
  import QRScanner from '../components/QRScanner.svelte';
  import { connectedPeers } from '../stores/appState';
  import type { MobileController } from '../app/MobileController';

  type Props = {
    controller: MobileController | null;
    onOpenChannel?: ((channelId: string) => void) | undefined;
  };

  type AddMode = 'menu' | 'qr' | 'scan' | 'paste';

  let { controller, onOpenChannel }: Props = $props();

  let contacts = $state<Contact[]>([]);
  let addPanelOpen = $state(false);
  let addMode = $state<AddMode>('menu');
  let contactUriInput = $state('');
  let myContactUri = $state('');
  let inFlight = $state(false);
  let feedback = $state<{ kind: 'success' | 'error' | 'info'; message: string } | null>(null);

  const onlinePeers = $derived(new Set($connectedPeers));

  $effect(() => {
    controller;
    void refreshContacts();
  });

  async function refreshContacts(): Promise<void> {
    if (!controller) {
      contacts = [];
      myContactUri = '';
      return;
    }

    contacts = await controller.listContacts();
    myContactUri = controller.getMyContactURI() ?? '';
  }

  function avatarLabel(contact: Contact): string {
    const trimmed = contact.displayName?.trim() || contact.peerId;
    return trimmed ? trimmed.slice(0, 1).toUpperCase() : '?';
  }

  function avatarHue(seed: string): number {
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % 360;
  }

  async function openContactConversation(contact: Contact): Promise<void> {
    if (!controller) return;

    const conversation = await controller.startDirectMessage(contact.peerId);
    if (!conversation) return;

    onOpenChannel?.(conversation.id);
  }

  function openAddPanel(): void {
    addPanelOpen = true;
    addMode = 'menu';
    feedback = null;
    contactUriInput = '';
    myContactUri = controller?.getMyContactURI() ?? '';
  }

  function closeAddPanel(): void {
    addPanelOpen = false;
    addMode = 'menu';
    feedback = null;
    inFlight = false;
    contactUriInput = '';
  }

  function showMyQrCode(): void {
    addMode = 'qr';
    feedback = null;
  }

  function showQrScanner(): void {
    addMode = 'scan';
    feedback = null;
  }

  function showPasteInput(prefill = ''): void {
    addMode = 'paste';
    contactUriInput = prefill;
    feedback = null;
  }

  function openPastePanel(): void {
    openAddPanel();
    showPasteInput();
  }

  async function copyInviteLink(): Promise<void> {
    if (!myContactUri) {
      feedback = { kind: 'error', message: 'Contact URI is not ready yet.' };
      return;
    }

    try {
      await navigator.clipboard.writeText(myContactUri);
      feedback = { kind: 'success', message: 'Invite link copied.' };
    } catch {
      feedback = { kind: 'error', message: 'Failed to copy invite link.' };
    }
  }

  async function shareInviteLink(): Promise<void> {
    if (!myContactUri) {
      feedback = { kind: 'error', message: 'Contact URI is not ready yet.' };
      return;
    }

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'DecentChat contact invite',
          text: `Add me on DecentChat:\n${myContactUri}`,
        });
        feedback = { kind: 'success', message: 'Invite shared.' };
        return;
      } catch {
        // Fallback to clipboard below.
      }
    }

    await copyInviteLink();
  }

  async function addContactFromUri(rawUri: string): Promise<boolean> {
    const uri = rawUri.trim();
    if (!uri || !controller || inFlight) return false;

    inFlight = true;
    feedback = null;

    try {
      const parsed = ContactURI.decode(uri);
      if (!parsed.peerId) {
        throw new Error('Contact URI must include peer ID');
      }

      await controller.addContact({
        peerId: parsed.peerId,
        publicKey: parsed.publicKey,
        displayName: parsed.displayName || parsed.peerId.slice(0, 8),
        signalingServers: parsed.signalingServers ?? [],
        addedAt: Date.now(),
        lastSeen: Date.now(),
      });

      contactUriInput = '';
      feedback = { kind: 'success', message: 'Contact added.' };
      await refreshContacts();
      return true;
    } catch (error) {
      feedback = { kind: 'error', message: (error as Error).message || 'Failed to add contact.' };
      return false;
    } finally {
      inFlight = false;
    }
  }

  async function addContactFromInput(): Promise<void> {
    await addContactFromUri(contactUriInput);
  }

  async function handleScannedValue(value: string): Promise<void> {
    const added = await addContactFromUri(value);
    if (added) {
      addMode = 'menu';
    }
  }
</script>

<section class="screen">
  <ScreenHeader title="Contacts" subtitle={contacts.length > 0 ? `${contacts.length} saved` : 'Add your first friend'} largeTitle={true}>
    {#snippet actions()}
      <button type="button" aria-label="Add friend" onclick={openAddPanel}>＋</button>
    {/snippet}
  </ScreenHeader>

  <div class="content" role="list">
    {#if contacts.length === 0}
      <section class="empty-state">
        <p class="emoji" aria-hidden="true">👥</p>
        <p class="title">Add your first friend</p>
        <p class="hint">Use a contact URI or scan a QR code to start direct messages.</p>
        <div class="actions">
          <button type="button" class="primary" onclick={openAddPanel}>Add friend</button>
          <button type="button" class="secondary" onclick={openPastePanel}>Paste contact URI</button>
        </div>
      </section>
    {:else}
      {#each contacts as contact (contact.peerId)}
        <button type="button" class="contact-row" onclick={() => void openContactConversation(contact)}>
          <div
            class="avatar"
            style:background={`linear-gradient(145deg, hsl(${avatarHue(contact.peerId)} 38% 38%), hsl(${avatarHue(contact.peerId)} 44% 24%))`}
            aria-hidden="true"
          >
            {avatarLabel(contact)}
          </div>

          <div class="meta">
            <p class="name">{contact.displayName}</p>
            <p class="peer-id">{contact.peerId.slice(0, 10)}…</p>
          </div>

          <span class="status" data-online={onlinePeers.has(contact.peerId)} aria-label={onlinePeers.has(contact.peerId) ? 'Online' : 'Offline'}></span>
        </button>
      {/each}
    {/if}
  </div>

  {#if addPanelOpen}
    <div class="panel-backdrop" role="presentation" onclick={closeAddPanel}></div>
    <div class="add-panel" role="dialog" aria-label="Add friend panel">
      <header>
        <h3>Add friend</h3>
        <button type="button" aria-label="Close" onclick={closeAddPanel}>✕</button>
      </header>

      {#if addMode === 'menu'}
        <div class="option-list">
          <button type="button" onclick={showMyQrCode}>Show my QR code</button>
          <button type="button" onclick={showQrScanner}>Scan friend's QR code</button>
          <button type="button" onclick={() => void shareInviteLink()}>Share invite link</button>
          <button type="button" onclick={() => showPasteInput()}>Paste contact URI</button>
        </div>
      {:else if addMode === 'qr'}
        <div class="qr-block">
          <QRDisplay value={myContactUri} alt="Your contact QR code" showRawValue={true} />
          <div class="row-actions">
            <button type="button" class="secondary" onclick={() => void copyInviteLink()}>Copy invite link</button>
            <button type="button" class="secondary" onclick={() => (addMode = 'menu')}>Back</button>
          </div>
        </div>
      {:else if addMode === 'scan'}
        <div class="scan-block">
          <QRScanner
            active={addPanelOpen && addMode === 'scan'}
            onScan={(value) => void handleScannedValue(value)}
            onError={(message) => {
              feedback = { kind: 'error', message };
            }}
            scanHint="Scan a DecentChat contact QR"
          />
          <div class="row-actions">
            <button type="button" class="secondary" onclick={() => showPasteInput()}>Paste URI instead</button>
            <button type="button" class="secondary" onclick={() => (addMode = 'menu')}>Back</button>
          </div>
        </div>
      {:else}
        <div class="paste-block">
          <label for="contact-uri-input">Paste contact URI</label>
          <textarea
            id="contact-uri-input"
            rows="4"
            placeholder="decent://contact?..."
            bind:value={contactUriInput}
          ></textarea>
          <div class="row-actions">
            <button type="button" class="primary" disabled={!contactUriInput.trim() || inFlight} onclick={() => void addContactFromInput()}>
              {inFlight ? 'Adding…' : 'Add contact'}
            </button>
            <button type="button" class="secondary" onclick={() => (addMode = 'menu')}>Back</button>
          </div>
        </div>
      {/if}

      {#if feedback}
        <p class="feedback" data-kind={feedback.kind}>{feedback.message}</p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .screen {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--color-bg);
    position: relative;
  }

  .content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: calc(var(--tabbar-height) + var(--space-4) + var(--safe-bottom));
  }

  .contact-row {
    width: 100%;
    border: none;
    border-bottom: 1px solid var(--color-divider);
    background: transparent;
    min-height: 72px;
    padding: var(--space-3) var(--space-4);
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr) 16px;
    gap: var(--space-3);
    align-items: center;
    text-align: left;
  }

  .contact-row:active {
    background: rgba(255, 255, 255, 0.05);
  }

  .avatar {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--color-text);
    font-size: 21px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .meta {
    min-width: 0;
    display: grid;
    gap: 4px;
  }

  .name,
  .peer-id {
    margin: 0;
  }

  .name {
    color: var(--color-text);
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .peer-id {
    color: var(--color-text-muted);
    font-size: 12px;
    letter-spacing: 0.01em;
  }

  .status {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.16);
    justify-self: end;
  }

  .status[data-online='true'] {
    background: var(--color-online);
    box-shadow: 0 0 0 4px rgba(0, 184, 148, 0.22);
  }

  .empty-state {
    margin: var(--space-5) var(--space-4) 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    padding: var(--space-5) var(--space-4);
    display: grid;
    gap: var(--space-3);
    text-align: center;
  }

  .emoji,
  .title,
  .hint {
    margin: 0;
  }

  .emoji {
    font-size: 34px;
  }

  .title {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .hint {
    color: var(--color-text-muted);
    font-size: 14px;
    line-height: 1.45;
  }

  .actions {
    margin-top: var(--space-1);
    display: grid;
    gap: var(--space-2);
  }

  .actions button,
  .add-panel button,
  .add-panel textarea {
    width: 100%;
    border-radius: var(--radius-md);
    font-size: 14px;
  }

  .actions button,
  .add-panel button {
    min-height: 44px;
    border: 1px solid transparent;
    font-weight: 700;
  }

  .primary {
    background: var(--color-accent);
    color: var(--color-badge-text);
  }

  .secondary {
    background: var(--color-surface);
    color: var(--color-text);
    border-color: var(--color-border) !important;
  }

  .panel-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(5, 10, 14, 0.62);
    z-index: 70;
  }

  .add-panel {
    position: fixed;
    left: var(--space-4);
    right: var(--space-4);
    bottom: calc(var(--tabbar-height) + var(--safe-bottom) + var(--space-3));
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    box-shadow: 0 18px 38px rgba(0, 0, 0, 0.36);
    padding: var(--space-3);
    display: grid;
    gap: var(--space-3);
    z-index: 71;
  }

  .add-panel header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .add-panel h3 {
    margin: 0;
    font-size: 18px;
    letter-spacing: -0.01em;
  }

  .add-panel header button {
    width: 36px;
    min-height: 36px;
    border: 1px solid var(--color-border);
    border-radius: 50%;
    background: transparent;
    color: var(--color-text-muted);
    font-size: 16px;
    padding: 0;
  }

  .option-list {
    display: grid;
    gap: var(--space-2);
  }

  .option-list button {
    text-align: left;
    background: var(--color-surface-elevated);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    padding: 0 var(--space-3);
  }

  .option-list button:disabled {
    opacity: 0.45;
  }

  .qr-block,
  .scan-block,
  .paste-block {
    display: grid;
    gap: var(--space-2);
  }

  .paste-block label {
    color: var(--color-text-muted);
    font-size: 13px;
  }

  .paste-block textarea {
    min-height: 88px;
    border: 1px solid var(--color-border);
    background: rgba(0, 0, 0, 0.22);
    color: var(--color-text);
    padding: var(--space-2);
    resize: vertical;
    font-family: var(--font-system);
  }

  .row-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .feedback {
    margin: 0;
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    font-size: 13px;
  }

  .feedback[data-kind='success'] {
    background: rgba(0, 184, 148, 0.14);
    border: 1px solid rgba(0, 184, 148, 0.46);
    color: #8ff3d6;
  }

  .feedback[data-kind='error'] {
    background: rgba(209, 95, 87, 0.12);
    border: 1px solid rgba(209, 95, 87, 0.52);
    color: #ffcbc4;
  }

  .feedback[data-kind='info'] {
    background: rgba(108, 92, 231, 0.12);
    border: 1px solid rgba(108, 92, 231, 0.44);
    color: #d2ccff;
  }
</style>
