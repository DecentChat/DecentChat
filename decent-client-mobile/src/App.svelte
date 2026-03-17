<svelte:options runes={true} />

<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { onDestroy, onMount } from 'svelte';

  import TabBar from './components/TabBar.svelte';
  import SwipeBack from './components/SwipeBack.svelte';
  import ConnectionBanner from './components/ConnectionBanner.svelte';
  import ActiveCallOverlay from './components/ActiveCallOverlay.svelte';
  import IncomingCallScreen from './components/IncomingCallScreen.svelte';
  import CallsScreen from './screens/CallsScreen.svelte';
  import ContactsScreen from './screens/ContactsScreen.svelte';
  import ChatsScreen from './screens/ChatsScreen.svelte';
  import ChatDetailScreen from './screens/ChatDetailScreen.svelte';
  import YouScreen from './screens/YouScreen.svelte';
  import WelcomeScreen from './screens/onboarding/WelcomeScreen.svelte';
  import CreateIdentityScreen from './screens/onboarding/CreateIdentityScreen.svelte';
  import ImportIdentityScreen from './screens/onboarding/ImportIdentityScreen.svelte';
  import RecoverAccountScreen from './screens/onboarding/RecoverAccountScreen.svelte';
  import SeedBackupAlert from './components/SeedBackupAlert.svelte';

  import {
    activeWorkspaceId,
    connectedPeers,
    connectionStatus,
    messages,
    messagesSent,
    myAlias,
    myPeerId,
    seedBackedUp,
    workspaces,
  } from './stores/appState';
  import {
    activeHuddle,
    callConnectionQuality,
    incomingCall,
    isInCall,
    recentCalls,
  } from './stores/huddleState';
  import { MobileController } from './app/MobileController';
  import { OnboardingController } from './app/OnboardingController';
  import { getConnectionBannerState } from './app/connectionBanner';

  type TabId = 'chats' | 'contacts' | 'calls' | 'you';
  type ChatNavDirection = 'forward' | 'back';
  type OnboardingStep = 'welcome' | 'create' | 'import' | 'recover';
  type OnboardingState = 'checking' | 'required' | 'ready';

  const tabs = [
    { id: 'chats', label: 'Chats', icon: '💬' },
    { id: 'contacts', label: 'Contacts', icon: '👥' },
    { id: 'calls', label: 'Calls', icon: '📞' },
    { id: 'you', label: 'You', icon: '👤' }
  ] as const;

  const globalRegistry = globalThis as typeof globalThis & {
    __decentChatMobileController?: MobileController;
  };

  const onboardingController = new OnboardingController();

  let activeTab = $state<TabId>('chats');
  let activeChannelId = $state<string | null>(null);
  let chatNavDirection = $state<ChatNavDirection>('forward');
  let controller = $state<MobileController | null>(null);
  let initError = $state<string | null>(null);

  let onboardingState = $state<OnboardingState>('checking');
  let onboardingStep = $state<OnboardingStep>('welcome');
  let onboardingError = $state<string | null>(null);

  const BACKUP_REMIND_BASELINE = 100;
  const BACKUP_REMIND_STEP = 50;
  const MAX_BACKUP_DISMISSALS = 5;

  let isRecoveredAccount = $state(readBooleanFromLocalStorage('decentchat-is-recovered', false));
  let backupDismissed = $state(readNumberFromLocalStorage('decentchat-seed-backup-dismissed', 0));
  let backupReminderThreshold = $state(
    readNumberFromLocalStorage('decentchat-seed-backup-threshold', BACKUP_REMIND_BASELINE),
  );

  const shouldShowSeedBackupAlert = $derived(
    onboardingState === 'ready'
      && !isRecoveredAccount
      && !$seedBackedUp
      && backupDismissed <= MAX_BACKUP_DISMISSALS
      && $messagesSent >= backupReminderThreshold
  );

  const bannerState = $derived(getConnectionBannerState($connectionStatus));

  function readBooleanFromLocalStorage(key: string, fallback = false): boolean {
    if (typeof window === 'undefined') return fallback;

    try {
      const value = window.localStorage.getItem(key);
      if (!value) return fallback;
      return value === 'true';
    } catch {
      return fallback;
    }
  }

  function readNumberFromLocalStorage(key: string, fallback = 0): number {
    if (typeof window === 'undefined') return fallback;

    try {
      const value = window.localStorage.getItem(key);
      if (!value) return fallback;

      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

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

  function getOrCreateController(): MobileController {
    const existing = globalRegistry.__decentChatMobileController;
    if (existing) return existing;

    const created = new MobileController();
    globalRegistry.__decentChatMobileController = created;
    return created;
  }

  async function syncDefaultTab(mobileController: MobileController | null): Promise<void> {
    if (!mobileController) return;
    if (activeTab !== 'chats' && activeTab !== 'contacts') return;

    activeTab = 'chats';
  }

  async function bootstrapFromStoredIdentity(): Promise<void> {
    initError = null;
    onboardingError = null;

    if (!onboardingController.hasIdentity()) {
      onboardingState = 'required';
      return;
    }

    const seedPhrase = onboardingController.getSeedPhrase();
    if (!seedPhrase) {
      onboardingState = 'required';
      return;
    }

    onboardingState = 'checking';

    try {
      const mobileController = getOrCreateController();
      controller = mobileController;
      await mobileController.init({
        seedPhrase,
        alias: onboardingController.getAlias(),
      });

      await syncDefaultTab(mobileController);
      isRecoveredAccount = readBooleanFromLocalStorage('decentchat-is-recovered', false);
      backupDismissed = readNumberFromLocalStorage('decentchat-seed-backup-dismissed', 0);
      backupReminderThreshold = readNumberFromLocalStorage('decentchat-seed-backup-threshold', BACKUP_REMIND_BASELINE);
      messagesSent.set(readNumberFromLocalStorage('decentchat-messages-sent', 0));
      seedBackedUp.set(readBooleanFromLocalStorage('decentchat-seed-backed-up', false));
      onboardingState = 'ready';
    } catch (error) {
      console.error("[App] bootstrap failed:", error);
      const message = (error as Error).message || 'Failed to initialize identity';
      initError = message;
      // Don't carry the error into onboarding — clear stale identity so user gets a fresh start
      onboardingController.clearIdentity();
      onboardingError = null;
      onboardingState = 'required';
    }
  }

  function openChannel(channelId: string): void {
    chatNavDirection = 'forward';
    activeChannelId = channelId;
    void controller?.markChannelRead(channelId);
  }

  function openContactConversation(channelId: string): void {
    activeTab = 'chats';
    openChannel(channelId);
  }

  function closeChannel(): void {
    if (!activeChannelId) return;

    chatNavDirection = 'back';
    activeChannelId = null;
  }

  function handleTabSelect(tabId: string): void {
    activeTab = tabId as TabId;
  }

  function openCreateIdentity(): void {
    onboardingError = null;
    onboardingStep = 'create';
  }

  function openRecoverIdentity(): void {
    onboardingError = null;
    onboardingStep = 'recover';
  }

  function openWelcome(): void {
    onboardingError = null;
    onboardingStep = 'welcome';
  }

  async function completeOnboarding(payload: {
    seedPhrase: string;
    alias: string;
    isRecovered?: boolean;
    sourcePeerId?: string;
    signalingServers?: string[];
  }): Promise<void> {
    onboardingError = null;
    initError = null;

    const recovered = payload.isRecovered === true;

    try {
      onboardingController.importIdentity(payload.seedPhrase, payload.alias);

      writeLocalStorage('decentchat-is-recovered', recovered ? 'true' : 'false');
      isRecoveredAccount = recovered;

      if (recovered) {
        writeLocalStorage('decentchat-seed-backed-up', 'true');
        seedBackedUp.set(true);
      } else {
        seedBackedUp.set(readBooleanFromLocalStorage('decentchat-seed-backed-up', false));
      }

      messagesSent.set(readNumberFromLocalStorage('decentchat-messages-sent', 0));
      backupDismissed = readNumberFromLocalStorage('decentchat-seed-backup-dismissed', 0);
      backupReminderThreshold = readNumberFromLocalStorage('decentchat-seed-backup-threshold', BACKUP_REMIND_BASELINE);

      if (payload.sourcePeerId) {
        writeLocalStorage('decentchat-recovery-source-peer', payload.sourcePeerId);
      } else {
        removeLocalStorage('decentchat-recovery-source-peer');
      }

      if (payload.signalingServers && payload.signalingServers.length > 0) {
        writeLocalStorage('decentchat-recovery-signaling', JSON.stringify(payload.signalingServers));
      } else {
        removeLocalStorage('decentchat-recovery-signaling');
      }

      const mobileController = getOrCreateController();
      controller = mobileController;
      await mobileController.init({
        seedPhrase: payload.seedPhrase,
        alias: payload.alias,
        sourcePeerId: payload.sourcePeerId,
      });

      if (payload.sourcePeerId) {
        mobileController.connectPeer(payload.sourcePeerId);
      }

      await syncDefaultTab(mobileController);
      onboardingState = 'ready';
    } catch (error) {
      console.error('[App] completeOnboarding failed:', error);
      const message = (error as Error).message || 'Failed to save identity';
      onboardingError = message;
      initError = message;
      onboardingState = 'required';
    }
  }

  function resetAppStores(): void {
    workspaces.set([]);
    activeWorkspaceId.set(null);
    messages.set({});

    connectionStatus.set('disconnected');
    connectedPeers.set([]);

    myPeerId.set(null);
    myAlias.set('');

    messagesSent.set(0);
    seedBackedUp.set(false);

    activeHuddle.set(null);
    recentCalls.set([]);
    callConnectionQuality.set('connecting');
    incomingCall.set(null);
  }

  async function handleDeleteAccount(): Promise<void> {
    const mobileController = controller;

    if (mobileController) {
      try {
        const existingWorkspaces = [...mobileController.workspaceManager.getAllWorkspaces()];

        for (const workspace of existingWorkspaces) {
          mobileController.workspaceManager.removeWorkspace(workspace.id);
          await mobileController.persistentStore.deleteWorkspace(workspace.id);
        }

        await mobileController.persistentStore.saveSetting('seedPhrase', null);
        await mobileController.persistentStore.saveSetting('myAlias', null);
        await mobileController.persistentStore.saveSetting('myPeerId', null);
        await mobileController.persistentStore.saveSetting('mobile:activeWorkspaceId', null);
      } catch {
        // Best effort cleanup.
      }

      try {
        await mobileController.destroy();
      } catch {
        // Best effort cleanup.
      }

      if (globalRegistry.__decentChatMobileController === mobileController) {
        delete globalRegistry.__decentChatMobileController;
      }
    }

    onboardingController.clearIdentity();
    removeLocalStorage('decentchat-is-recovered');
    removeLocalStorage('decentchat-seed-backed-up');
    removeLocalStorage('decentchat-seed-backup-dismissed');
    removeLocalStorage('decentchat-seed-backup-threshold');
    removeLocalStorage('decentchat-messages-sent');
    removeLocalStorage('decentchat-recovery-source-peer');
    removeLocalStorage('decentchat-recovery-signaling');
    controller = null;

    isRecoveredAccount = false;
    backupDismissed = 0;
    backupReminderThreshold = BACKUP_REMIND_BASELINE;

    resetAppStores();

    activeTab = 'chats';
    activeChannelId = null;
    chatNavDirection = 'forward';

    onboardingStep = 'welcome';
    onboardingState = 'required';
    initError = null;
    onboardingError = null;
  }

  function handleSeedBackupConfirmed(): void {
    seedBackedUp.set(true);
    writeLocalStorage('decentchat-seed-backed-up', 'true');
  }

  function handleSeedBackupRemindLater(): void {
    backupDismissed += 1;
    backupReminderThreshold = Math.max(
      backupReminderThreshold + BACKUP_REMIND_STEP,
      $messagesSent + BACKUP_REMIND_STEP,
    );

    writeLocalStorage('decentchat-seed-backup-dismissed', String(backupDismissed));
    writeLocalStorage('decentchat-seed-backup-threshold', String(backupReminderThreshold));
  }

  function handleNativeBack(): void {
    if (onboardingState !== 'ready') {
      if (onboardingStep !== 'welcome') {
        onboardingStep = 'welcome';
      }
      return;
    }

    if (activeTab === 'chats' && activeChannelId) {
      closeChannel();
      return;
    }

    if (activeTab !== 'chats') {
      activeTab = 'chats';
    }
  }

  function handleAppState(event: Event): void {
    if (onboardingState !== 'ready') return;

    const payload = event as CustomEvent<{ isActive?: boolean }>;
    if (!payload.detail?.isActive) return;

    void controller?.refresh();
  }

  onMount(() => {
    isRecoveredAccount = readBooleanFromLocalStorage('decentchat-is-recovered', false);
    backupDismissed = readNumberFromLocalStorage('decentchat-seed-backup-dismissed', 0);
    backupReminderThreshold = readNumberFromLocalStorage('decentchat-seed-backup-threshold', BACKUP_REMIND_BASELINE);
    messagesSent.set(readNumberFromLocalStorage('decentchat-messages-sent', 0));
    seedBackedUp.set(readBooleanFromLocalStorage('decentchat-seed-backed-up', false));

    void bootstrapFromStoredIdentity();

    window.addEventListener('native:back-button', handleNativeBack as EventListener);
    window.addEventListener('native:app-state', handleAppState as EventListener);
  });

  onDestroy(() => {
    window.removeEventListener('native:back-button', handleNativeBack as EventListener);
    window.removeEventListener('native:app-state', handleAppState as EventListener);
  });
</script>

<main class="mobile-app" aria-label="DecentChat Mobile">
  {#if onboardingState === 'ready'}
    <ConnectionBanner state={bannerState} />

    {#if initError}
      <div class="init-error" role="status">{initError}</div>
    {/if}

    <section class="screen-host" aria-live="polite">
      {#key activeTab}
        <div class="tab-stage" in:fade={{ duration: 170 }} out:fade={{ duration: 120 }}>
          {#if activeTab === 'calls'}
            <CallsScreen controller={controller} />
          {:else if activeTab === 'contacts'}
            <ContactsScreen controller={controller} onOpenChannel={openContactConversation} />
          {:else if activeTab === 'chats'}
            <div class="chat-stack">
              {#key activeChannelId ?? 'list'}
                {#if activeChannelId}
                  <div
                    class="chat-layer"
                    in:fly={{ x: chatNavDirection === 'forward' ? 56 : -20, duration: 230, opacity: 0.35 }}
                    out:fly={{ x: chatNavDirection === 'forward' ? -20 : 56, duration: 200, opacity: 0.25 }}
                  >
                    <SwipeBack onBack={closeChannel}>
                      <ChatDetailScreen controller={controller} channelId={activeChannelId} onBack={closeChannel} />
                    </SwipeBack>
                  </div>
                {:else}
                  <div
                    class="chat-layer"
                    in:fly={{ x: chatNavDirection === 'back' ? -20 : 0, duration: 210, opacity: 0.55 }}
                    out:fly={{ x: chatNavDirection === 'forward' ? -20 : 20, duration: 180, opacity: 0.4 }}
                  >
                    <ChatsScreen controller={controller} onOpenChannel={openChannel} />
                  </div>
                {/if}
              {/key}
            </div>
          {:else}
            <YouScreen controller={controller} onDeleteAccount={handleDeleteAccount} />
          {/if}
        </div>
      {/key}
    </section>

    <TabBar tabs={[...tabs]} activeTab={activeTab} onSelect={handleTabSelect} />

    {#if $incomingCall && !$isInCall}
      <IncomingCallScreen controller={controller} />
    {/if}

    {#if $isInCall}
      <ActiveCallOverlay controller={controller} />
    {/if}

    {#if shouldShowSeedBackupAlert}
      <SeedBackupAlert onConfirm={handleSeedBackupConfirmed} onRemindLater={handleSeedBackupRemindLater} />
    {/if}
  {:else if onboardingState === 'checking'}
    <section class="identity-loading" aria-live="polite">
      <p>Loading your identity…</p>
    </section>
  {:else}
    <section class="onboarding-host" aria-live="polite">
      {#if onboardingStep === 'welcome'}
        <WelcomeScreen onCreate={openCreateIdentity} onRecover={openRecoverIdentity} />
      {:else if onboardingStep === 'create'}
        <CreateIdentityScreen onBack={openWelcome} onContinue={completeOnboarding} />
      {:else if onboardingStep === 'recover'}
        <RecoverAccountScreen onBack={openWelcome} onContinue={completeOnboarding} />
      {:else}
        <ImportIdentityScreen onBack={openWelcome} onContinue={completeOnboarding} />
      {/if}

      {#if onboardingError}
        <p class="onboarding-error" role="status">{onboardingError}</p>
      {/if}
    </section>
  {/if}
</main>

<style>
  .mobile-app {
    min-height: 100dvh;
    max-width: var(--screen-max-width);
    margin: 0 auto;
    background: var(--color-bg);
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: clip;
    border-left: 1px solid rgba(255, 255, 255, 0.03);
    border-right: 1px solid rgba(255, 255, 255, 0.03);
  }

  .init-error,
  .onboarding-error {
    position: absolute;
    z-index: 61;
    top: calc(var(--safe-top) + 52px);
    right: var(--space-4);
    left: var(--space-4);
    border-radius: var(--radius-md);
    border: 1px solid rgba(209, 95, 87, 0.5);
    background: rgba(209, 95, 87, 0.12);
    color: #ffcbc4;
    padding: var(--space-2) var(--space-3);
    font-size: 12px;
  }

  .screen-host {
    flex: 1;
    min-height: 0;
    position: relative;
    isolation: isolate;
  }

  .tab-stage {
    width: 100%;
    height: 100%;
  }

  .chat-stack {
    width: 100%;
    height: 100%;
    position: relative;
    overflow: hidden;
  }

  .chat-layer {
    width: 100%;
    height: 100%;
    position: absolute;
    inset: 0;
  }

  .onboarding-host {
    flex: 1;
    position: relative;
  }

  .identity-loading {
    flex: 1;
    display: grid;
    place-items: center;
    color: var(--color-text-muted);
    font-size: 14px;
  }

  .identity-loading p {
    margin: 0;
  }
</style>
