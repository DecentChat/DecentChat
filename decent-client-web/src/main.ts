/**
 * P2P Chat PWA — Entry Point
 *
 * Thin bootstrap: creates ChatController + UIRenderer, wires them together,
 * then calls init().  All business logic lives in ChatController; all DOM
 * rendering lives in UIRenderer.
 */

import './ui/styles/main.css';
import './ui/styles/tooltips.css';

import { initTooltips } from './ui/TooltipManager';
import { ChatController } from './app/ChatController';
import { LifecycleReconnectGuard } from './app/LifecycleReconnectGuard';
import { UIRenderer } from './ui/UIRenderer';
import { CommandParser } from './commands/CommandParser';
import { registerCommands } from './commands/registerCommands';
import type { AppSettings } from './storage/types';
import { SeedPhraseManager as _SeedPhraseManager, IdentityManager as _IdentityManager } from 'decent-protocol';
const _spm = new _SeedPhraseManager();

function hydrateTitleTooltips(root: ParentNode = document): void {
  const elements = root.querySelectorAll<HTMLElement>('[title]');

  elements.forEach((el) => {
    const title = el.getAttribute('title');
    if (!title) return;

    if (!el.hasAttribute('data-tooltip')) {
      el.setAttribute('data-tooltip', title);
    }

    // Keep text available for assistive tech even after removing native browser tooltip.
    if (!el.hasAttribute('aria-label') && !el.getAttribute('aria-labelledby')) {
      el.setAttribute('aria-label', title);
    }

    // Remove native tooltip so only our styled tooltip is shown.
    el.removeAttribute('title');
  });
}

function initTitleTooltipObserver(): void {
  hydrateTitleTooltips();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
        if (mutation.attributeName === 'title' || mutation.attributeName === 'data-tooltip') {
          hydrateTitleTooltips(mutation.target.parentElement || document);
        }
        continue;
      }

      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;

          if (node.hasAttribute('title')) {
            hydrateTitleTooltips(node.parentElement || document);
          } else if (node.querySelector('[title]')) {
            hydrateTitleTooltips(node);
          }
        });
      }
    }
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['title', 'data-tooltip'],
  });
}

// ---------------------------------------------------------------------------
// Shared application state (passed by reference to both modules)
// ---------------------------------------------------------------------------

export interface AppState {
  myPeerId: string;
  myAlias: string;
  /** Per-workspace display name overrides; falls back to myAlias */
  workspaceAliases: Record<string, string>;
  connectedPeers: Set<string>;
  /** Peers where a connect() call is in flight but the connection isn't open yet */
  connectingPeers: Set<string>;
  readyPeers: Set<string>;
  activeWorkspaceId: string | null;
  activeChannelId: string | null;
  activeThreadId: string | null;
  threadOpen: boolean;
  sidebarOpen: boolean;
  /** When viewing a standalone DM (not a workspace DM), this is set */
  activeDirectConversationId: string | null;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  const state: AppState = {
    myPeerId: '',
    myAlias: '',
    workspaceAliases: {},
    connectedPeers: new Set(),
    connectingPeers: new Set(),
    readyPeers: new Set(),
    activeWorkspaceId: null,
    activeChannelId: null,
    activeThreadId: null,
    threadOpen: false,
    sidebarOpen: false,
    activeDirectConversationId: null,
  };

  // Create controller (owns all protocol instances)
  const ctrl = new ChatController(state);

  // Create command parser
  const commandParser = new CommandParser();
  registerCommands(commandParser, ctrl, state);

  // Create renderer (owns all DOM manipulation)
  const ui = new UIRenderer(state, ctrl.workspaceManager, ctrl.messageStore, {
    sendMessage: async (content, threadId) => {
      if (commandParser.isCommand(content)) {
        const result = await commandParser.execute(content);
        if (result.handled) {
          const output = result.error
            ? `❌ ${result.error}`
            : result.output || 'Done.';
          // Show as system message locally
          const msg = await ctrl.messageStore.createMessage(
            state.activeChannelId || 'system',
            'system',
            output,
            'system',
          );
          ctrl.messageStore.addMessage(msg);
          ui.appendMessageToDOM(msg, undefined, true);
          return;
        }
      }
      // If we're in a standalone direct conversation, use the direct message path
      if (state.activeDirectConversationId) {
        return ctrl.sendDirectMessage(state.activeDirectConversationId, content, threadId);
      }
      return ctrl.sendMessage(content, threadId);
    },
    sendAttachment: (file, text, threadId) => ctrl.sendAttachment(file, text, threadId),
    resolveAttachmentImageUrl: (attachmentId) => ctrl.resolveAttachmentImageUrl(attachmentId),
    connectPeer: (peerId) => ctrl.connectPeer(peerId),
    createWorkspace: (name, alias) => ctrl.createWorkspace(name, alias),
    joinWorkspace: (code, alias, peerId, inviteData) => ctrl.joinWorkspace(code, alias, peerId, inviteData),
    createChannel: (name) => ctrl.createChannel(name),
    createDM: (peerId) => ctrl.createDM(peerId),
    removeWorkspaceMember: (peerId) => ctrl.removeWorkspaceMember(peerId),
    promoteMember: (peerId, newRole) => ctrl.promoteMember(peerId, newRole),
    demoteMember: (peerId) => ctrl.demoteMember(peerId),
    updateWorkspacePermissions: (permissions) => ctrl.updateWorkspacePermissions(permissions),
    updateWorkspaceInfo: (updates) => ctrl.updateWorkspaceInfo(updates),
    deleteWorkspace: (wsId) => ctrl.deleteWorkspace(wsId),
    persistWorkspace: (wsId) => ctrl.persistWorkspace(wsId),
    persistSetting: (key, value) => ctrl.persistSetting(key, value),
    getCommandSuggestions: (prefix) => commandParser.autocomplete(prefix).map(c => ({
      name: c.name,
      description: c.description,
    })),
    broadcastTyping: () => ctrl.broadcastTyping(),
    broadcastStopTyping: () => ctrl.broadcastStopTyping(),
    toggleReaction: (msgId, emoji) => ctrl.toggleReaction(msgId, emoji),
    getSettings: async () => ctrl.persistentStore.getSettings({}),
    generateInviteURL: (wsId) => ctrl.generateInviteURL(wsId),
    addContact: (contact) => ctrl.addContact(contact),
    removeContact: (peerId) => ctrl.removeContact(peerId),
    getContacts: () => ctrl.getContacts(),
    startDirectMessage: (contactPeerId) => ctrl.startDirectMessage(contactPeerId),
    getDirectConversations: () => ctrl.getDirectConversations(),
    onSettingsAction: async (action) => {
      if (action === 'generateSeed') {
        const { SeedPhraseManager } = await import('decent-protocol');
        const seedPhrase = new SeedPhraseManager();
        const { mnemonic } = seedPhrase.generate();
        // Save to standalone key (used by peer ID derivation on startup)
        await ctrl.persistentStore.saveSetting('seedPhrase', mnemonic);
        // Also persist within app-settings so SettingsPanel.getSettings() sees it
        const existingSettings = await ctrl.persistentStore.getSettings<any>({});
        await ctrl.persistentStore.saveSettings({ ...existingSettings, seedPhrase: mnemonic });
      }
    },
    onQRContactScanned: async (data) => {
      // Add the contact
      await ctrl.addContact({
        peerId: data.peerId || `qr-${Date.now()}`,
        publicKey: data.publicKey,
        displayName: data.displayName,
        signalingServers: data.signalingServers || [],
        addedAt: Date.now(),
        lastSeen: 0,
      });
      ui.refreshContactsCache();
      ui.updateSidebar();
      // Auto-connect if we have a peer ID
      if (data.peerId) {
        ctrl.connectPeer(data.peerId);
        ui.showToast(`Connecting to ${data.displayName}...`);
      }
    },
    getMyPublicKey: () => ctrl.myPublicKey,
    getAllWorkspaces: () => ctrl.workspaceManager.getAllWorkspaces(),
    setWorkspaceAlias: (wsId, alias) => ctrl.setWorkspaceAlias(wsId, alias),
    getUnreadCount: (channelId) => ctrl.notifications.getUnreadCount(channelId),
    getActivityItems: () => ctrl.getActivityItems(),
    getActivityUnreadCount: () => ctrl.getActivityUnreadCount(),
    markActivityRead: (id) => ctrl.markActivityRead(id),
    markAllActivityRead: () => ctrl.markAllActivityRead(),
    markThreadActivityRead: (channelId, threadId) => ctrl.markThreadActivityRead(channelId, threadId),
    setFocusedChannel: (channelId) => ctrl.notifications.setFocusedChannel(channelId),
    markChannelRead: (channelId) => ctrl.notifications.markRead(channelId),
    onChannelViewed: (channelId) => ctrl.onChannelViewed(channelId),
    getDisplayNameForPeer: (peerId) => ctrl.getDisplayNameForPeer(peerId),
    getMessageReceiptInfo: (messageId) => ctrl.getMessageReceiptInfo(messageId),

    // Identity restore / transfer
    getCurrentSeed: () => ctrl.persistentStore.getSetting('seedPhrase') as Promise<string | null>,
    validateSeed: (mnemonic) => {
      const result = _spm.validate(mnemonic);
      return result.valid ? null : (result.error ?? 'Invalid phrase');
    },
    startHuddle: (channelId) => ctrl.startHuddle(channelId),
    joinHuddle: (channelId) => ctrl.joinHuddle(channelId),
    leaveHuddle: () => ctrl.leaveHuddle(),
    toggleHuddleMute: () => ctrl.toggleHuddleMute(),
    onSeedRestored: async (mnemonic) => {
      await ctrl.persistentStore.saveSetting('seedPhrase', mnemonic);
      // Also persist within app-settings for consistency
      const existingSettings = await ctrl.persistentStore.getSettings<any>({});
      await ctrl.persistentStore.saveSettings({ ...existingSettings, seedPhrase: mnemonic });
      // Clear stored peer ID so it gets re-derived from new seed on reload
      await ctrl.persistentStore.saveSetting('myPeerId', null);
      window.location.reload();
    },
  });

  // Clicking a desktop notification switches to that channel
  ctrl.notifications.onNotificationClick = (channelId) => {
    // Find workspace that owns this channel and activate it first
    for (const ws of ctrl.workspaceManager.getAllWorkspaces()) {
      if (ws.channels.some((ch: any) => ch.id === channelId)) {
        state.activeWorkspaceId = ws.id;
        break;
      }
    }
    ui.switchChannel(channelId);
    ui.renderApp(); // re-render to reflect workspace change if needed
  };

  // Give the controller a handle to the UI for push updates
  ctrl.setUI({
    updateSidebar: () => ui.updateSidebar(),
    updateWorkspaceRail: () => ui.updateWorkspaceRail(),
    updateChannelHeader: () => ui.updateChannelHeader(),
    appendMessageToDOM: (msg, animate) => ui.appendMessageToDOM(msg, undefined, animate),
    showToast: (message, type) => ui.showToast(message, type),
    renderThreadMessages: () => ui.renderThreadMessages(),
    renderMessages: () => {
      ui.renderMessages();
      ctrl.syncReactionsToDOM();
    },
    renderApp: () => ui.renderApp(),
    updateThreadIndicator: (parentMessageId, channelId) =>
      ui.updateThreadIndicator(parentMessageId, channelId),
    updateMessageStatus: (messageId, status) =>
      ui.updateMessageStatus(messageId, status),
    updateStreamingMessage: (messageId, content) =>
      ui.updateStreamingMessage(messageId, content),
    finalizeStreamingMessage: (messageId) =>
      ui.finalizeStreamingMessage(messageId),
    onHuddleStateChange: (state, channelId) =>
      ui.onHuddleStateChange(state, channelId),
    onHuddleParticipantsChange: (participants) =>
      ui.onHuddleParticipantsChange(participants),
  });

  // Wire typing indicator
  ctrl.presence.onTypingChanged = (channelId, typingPeers) => {
    if (channelId !== state.activeChannelId) return;
    const text = ctrl.presence.formatTypingText(
      typingPeers.filter(p => p !== state.myPeerId),
      (peerId) => ctrl.getMyAliasForWorkspace === undefined
        ? peerId.slice(0, 8)
        : (() => {
            if (!state.activeWorkspaceId) return peerId.slice(0, 8);
            const ws = ctrl.workspaceManager.getWorkspace(state.activeWorkspaceId);
            const member = ws?.members.find((m: any) => m.peerId === peerId);
            return member?.alias || peerId.slice(0, 8);
          })(),
    );
    ui.updateTypingIndicator(text);
  };

  // Don't request notification permission automatically (browser security restriction)
  // User can enable via Settings or we'll ask on first message
  // ctrl.notifications.requestPermission();

  // Route intent (decided BEFORE heavy app bootstrap)
  const path = window.location.pathname;
  const isAppRoute = path === '/app' || path.startsWith('/app/');
  const isJoinRoute = /^\/join\/[A-Za-z0-9]+/.test(path);

  try {
    // Initialize storage — PersistentStore is the primary store.
    // Database is kept but no longer initialized here (see task #8 consolidation).

    // Update loading hint
    const loadingHint = document.querySelector('#loading .hint') as HTMLElement;
    if (loadingHint) loadingHint.textContent = 'Loading storage...';

    // Hard route split:
    // - / and non-app routes render landing only (no transport/bootstrap/network)
    // - /app and /join/* run full app bootstrap
    if (!isAppRoute && !isJoinRoute) {
      const landingDefaults: AppSettings = { theme: 'auto', notifications: true };
      await ctrl.persistentStore.init();

      const settings = await ctrl.persistentStore.getSettings<AppSettings>(landingDefaults);
      const myAlias = await ctrl.persistentStore.getSetting('myAlias');
      const savedWorkspaces = await ctrl.persistentStore.getAllWorkspaces();

      for (const ws of savedWorkspaces) {
        try {
          ctrl.workspaceManager.importWorkspace(ws);
        } catch {
          // Ignore malformed workspace records on landing path.
        }
      }

      state.myPeerId = (settings as any).myPeerId || '';
      state.myAlias = typeof myAlias === 'string' && myAlias.trim()
        ? myAlias
        : (state.myPeerId ? state.myPeerId.slice(0, 8) : '');

      ui.renderWelcome();
      (window as any).__appInitialized = true;
      return;
    }

    await ctrl.keyStore.init();
    await ctrl.persistentStore.init();

    // Wire offline queue → persistent storage
    ctrl.offlineQueue.setPersistence(
      (peerId, data) => ctrl.persistentStore.enqueueMessage(peerId, data),
      (peerId) => ctrl.persistentStore.getQueuedMessages(peerId),
      (id) => ctrl.persistentStore.dequeueMessage(id),
      (peerId) => ctrl.persistentStore.dequeueAllForPeer(peerId),
      (id, patch) => ctrl.persistentStore.updateQueuedMessage(id, patch),
    );

    // Generate / load crypto keys
    let ecdhKeyPair = await ctrl.keyStore.getECDHKeyPair();
    if (!ecdhKeyPair) {
      ecdhKeyPair = await ctrl.cryptoManager.generateKeyPair();
      await ctrl.keyStore.storeECDHKeyPair(ecdhKeyPair);
    } else {
      // Ensure CryptoManager uses the stored key pair (not a new random one)
      ctrl.cryptoManager.setKeyPair(ecdhKeyPair);
    }

    let ecdsaKeyPair = await ctrl.keyStore.getECDSAKeyPair();
    if (!ecdsaKeyPair) {
      ecdsaKeyPair = await ctrl.cryptoManager.generateSigningKeyPair();
      await ctrl.keyStore.storeECDSAKeyPair(ecdsaKeyPair);
    }

    ctrl.myPublicKey = await ctrl.cryptoManager.exportPublicKey(ecdhKeyPair.publicKey);

    // Compute canonical identityId from public key (SPKI hash)
    const spkiBytes = await crypto.subtle.exportKey('spki', ecdhKeyPair.publicKey);
    const spkiBase64 = btoa(String.fromCharCode(...new Uint8Array(spkiBytes)));
    const idMgr = new _IdentityManager();
    ctrl.myIdentityId = await idMgr.computeIdentityId(spkiBase64);

    // Bootstrap transport + peer ID
    const settingsDefaults: AppSettings = { theme: 'auto', notifications: true };
    const settings = await ctrl.persistentStore.getSettings<AppSettings>(settingsDefaults);

    // Apply lightweight visual preferences on boot
    const showReconnect = !!(settings as any).showLiveReconnectActivity;
    document.body.classList.toggle('show-reconnect-activity', showReconnect);
    (window as any).__DECENT_SHOW_RECONNECT_ACTIVITY = showReconnect;

    let seedPhrase = await ctrl.persistentStore.getSetting('seedPhrase');

    // Auto-generate seed phrase if none exists — ensures deterministic peer ID from the start
    if (!seedPhrase || (typeof seedPhrase === 'string' && !seedPhrase.trim())) {
      try {
        const { SeedPhraseManager } = await import('decent-protocol');
        const spm = new SeedPhraseManager();
        const { mnemonic } = spm.generate();
        await ctrl.persistentStore.saveSetting('seedPhrase', mnemonic);
        const existingSettings = await ctrl.persistentStore.getSettings<any>({});
        await ctrl.persistentStore.saveSettings({ ...existingSettings, seedPhrase: mnemonic });
        seedPhrase = mnemonic;
        console.log('[DecentChat] Auto-generated seed phrase for new identity');
      } catch (err) {
        console.warn('[DecentChat] Failed to auto-generate seed phrase:', (err as Error).message);
      }
    }

    let derivedPeerId: string | null = null;
    if (typeof seedPhrase === 'string' && seedPhrase.trim()) {
      try {
        const { SeedPhraseManager, AtRestEncryption } = await import('decent-protocol');
        const seedPhraseManager = new SeedPhraseManager();
        // Single PBKDF2 call — returns both peer ID and key material (fix #3)
        const { peerId, keys } = await seedPhraseManager.deriveAll(seedPhrase);
        derivedPeerId = peerId;

        // T3.5: Derive at-rest encryption key from master seed (reuses same PBKDF2 result)
        // Important: peer ID derivation success should not depend on at-rest encryption init.
        try {
          const atRest = new AtRestEncryption();
          await atRest.init(keys.masterSeed);
          ctrl.persistentStore.setAtRestEncryption(atRest);
          console.log('[DecentChat] At-rest encryption enabled');
        } catch (err) {
          console.warn('[DecentChat] At-rest encryption init failed; continuing with derived peer ID:', (err as Error).message);
        }
      } catch (err) {
        console.warn('[DecentChat] Failed to derive peer ID from seed phrase, falling back:', (err as Error).message);
      }
    }

    // DEP-003: derived ID is canonical whenever a seed phrase exists.
    // When a seed phrase exists, we MUST use the derived peer ID — don't let transport override it.
    const preferredPeerId = derivedPeerId || settings.myPeerId;
    let myPeerId: string = preferredPeerId || crypto.randomUUID();

    const initDelaysMs = [0, 800, 2000, 5000, 10_000];
    let initError: Error | null = null;
    for (let attempt = 0; attempt < initDelaysMs.length; attempt++) {
      if (attempt > 0) {
        await sleep(initDelaysMs[attempt]);
      }
      try {
        // Call transport.init() but don't use the returned ID if we have a derived peer ID.
        // The derived peer ID from seed is canonical and must not change.
        const transportId = attempt === 0
          ? await ctrl.transport.init(myPeerId)
          : await ctrl.recreateTransportAndInit(myPeerId, `startup-retry-${attempt}`);
        
        // Only use transport-returned ID if we don't have a seed-derived ID.
        // This ensures seed-based identity is stable across restarts.
        if (!derivedPeerId) {
          myPeerId = transportId;
        }
        initError = null;
        break;
      } catch (err) {
        initError = err as Error;
        console.warn(
          `[DecentChat] Transport init attempt ${attempt + 1}/${initDelaysMs.length} failed:`,
          initError.message,
        );
      }
    }
    if (initError) {
      // Signaling server unavailable — work offline with a deterministic/local ID.
      console.warn('[DecentChat] Signaling server unavailable, working offline:', initError.message);
    }

    state.myPeerId = myPeerId;
    state.myAlias = myPeerId.slice(0, 8);

    // Reload reaction usage now that peerId is known (localStorage key depends on it)
    ui.reloadReactionUsage();

    // Initialize huddle (voice calling) — needs myPeerId
    ctrl.initHuddle();

    // Expose for testing
    if (typeof window !== 'undefined') {
      (window as any).__ctrl = ctrl;
      (window as any).__transport = ctrl.transport;
      (window as any).__state = state;
    }

    if (settings.myPeerId !== myPeerId) {
      settings.myPeerId = myPeerId;
      await ctrl.persistentStore.saveSettings(settings);
    }

    // Initialize message protocol
    ctrl.messageProtocol = new (await import('./messages/MessageProtocol')).MessageProtocol(
      ctrl.cryptoManager,
      myPeerId,
    );
    await ctrl.messageProtocol.init(ecdsaKeyPair);
    ctrl.setSigningKeyPair(ecdsaKeyPair);

    // Wire Double Ratchet state persistence via PersistentStore
    ctrl.messageProtocol.setPersistence({
      save: (peerId, state) => ctrl.persistentStore.saveRatchetState(peerId, state),
      load: (peerId) => ctrl.persistentStore.getRatchetState(peerId),
      delete: (peerId) => ctrl.persistentStore.deleteRatchetState(peerId),
    });

    // Wire transport event handlers BEFORE restoring storage so onConnect/onDisconnect
    // fire correctly even if a connection completes during the restore phase.
    ctrl.setupTransportHandlers();

    // Restore persisted workspaces / messages
    await ctrl.restoreFromStorage();

    // Restore contacts and direct conversations
    await ctrl.restoreContacts();

    // Pre-mark all known workspace members as "connecting" so the sidebar's
    // amber pulsing dot is visible from the very first render (not a grey→green jump).
    // The dots will transition to green when WebRTC handshakes complete.
    for (const ws of ctrl.workspaceManager.getAllWorkspaces()) {
      for (const member of ws.members) {
        if (member.peerId !== state.myPeerId) {
          state.connectingPeers.add(member.peerId);
        }
      }
    }

    // Check for /join/CODE invite URL
    const joinMatch = path.match(/^\/join\/([A-Za-z0-9]+)/);
    let pendingInvite: { code: string; peerId: string; name: string; inviteData?: import('decent-protocol').InviteData } | null = null;

    if (joinMatch) {
      // Try to parse as full web invite URL
      try {
        const { InviteURI } = await import('decent-protocol');
        const fullUrl = window.location.href;
        const inviteData = InviteURI.decode(fullUrl);
        pendingInvite = {
          code: inviteData.inviteCode,
          peerId: inviteData.peerId || '',
          name: inviteData.workspaceName || '',
          inviteData, // DEP-002: Include full invite data
        };
      } catch {
        // Fallback to manual parsing
        pendingInvite = {
          code: joinMatch[1],
          peerId: new URLSearchParams(window.location.search).get('peer') || '',
          name: new URLSearchParams(window.location.search).get('name') || '',
        };
      }

      // Store invite in sessionStorage BEFORE clearing URL (survives reload)
      sessionStorage.setItem('pendingInvite', JSON.stringify(pendingInvite));
      window.history.replaceState({}, '', '/');
      console.log('[DecentChat] Invite link detected:', pendingInvite.code, pendingInvite.name);
    } else {
      // Check if we have a stored invite from a previous reload
      const stored = sessionStorage.getItem('pendingInvite');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.code) {
            pendingInvite = parsed;
            console.log('[DecentChat] Restored invite from session:', parsed.code);
          }
        } catch {}
      }
    }

    if (pendingInvite) {
      // Clear stored invite
      sessionStorage.removeItem('pendingInvite');
      // Invite link — show welcome screen with join modal
      ui.renderWelcome();
      ui.showJoinWithInvite(pendingInvite!.code, pendingInvite!.peerId, pendingInvite!.name, pendingInvite!.inviteData);
    } else if (!isAppRoute) {
      // Landing page is always reachable at /
      ui.renderWelcome();
    } else if (ctrl.workspaceManager.getAllWorkspaces().length === 0) {
      ui.renderWelcome();
    } else {
      const allWorkspaces = ctrl.workspaceManager.getAllWorkspaces();
      const lastView = (settings as any)?.['ui:lastView'] as {
        workspaceId?: string | null;
        channelId?: string | null;
        threadId?: string | null;
        threadOpen?: boolean;
      } | undefined;

      const restoredWorkspace = lastView?.workspaceId
        ? ctrl.workspaceManager.getWorkspace(lastView.workspaceId)
        : null;

      state.activeWorkspaceId = restoredWorkspace?.id || allWorkspaces[0].id;
      const ws = ctrl.workspaceManager.getWorkspace(state.activeWorkspaceId!)!;

      const restoredChannel = lastView?.channelId
        ? ws.channels.find((ch: any) => ch.id === lastView.channelId)
        : null;

      state.activeChannelId = restoredChannel?.id || ws.channels[0]?.id || null;

      ui.renderApp();

      // Restore open thread if it still exists in the restored channel.
      if (lastView?.threadOpen && lastView.threadId && state.activeChannelId) {
        const threadExists = ctrl.messageStore
          .getMessages(state.activeChannelId)
          .some((m: any) => m.id === lastView.threadId);
        if (threadExists) {
          ui.openThread(lastView.threadId);
        }
      }

      // Tell NotificationManager which channel is currently focused on startup
      if (state.activeChannelId) {
        ctrl.notifications.setFocusedChannel(state.activeChannelId);
        void ctrl.onChannelViewed(state.activeChannelId);
      }
    }

    // If user clicked Create/Join on landing page, bootstrap full app first,
    // then open the intended modal on /app. This avoids landing-mode networkless
    // races (workspace created without active transport).
    if (isAppRoute && ctrl.workspaceManager.getAllWorkspaces().length === 0) {
      const pendingWelcomeAction = sessionStorage.getItem('decent:welcomeAction');
      if (pendingWelcomeAction === 'create' || pendingWelcomeAction === 'join') {
        sessionStorage.removeItem('decent:welcomeAction');
        if (pendingWelcomeAction === 'create') ui.showCreateWorkspaceModal();
        else ui.showJoinWorkspaceModal();
      }
    }

    // Mark app as fully initialised — the controllerchange handler uses this
    // to decide whether to reload (safe after init) or skip (mid-startup reload
    // would cause a double-registration race with the PeerJS signaling server).
    (window as any).__appInitialized = true;

    // Refresh/reload lifecycle hardening:
    // - Ensure old sockets are torn down on real unload so peer ID is released promptly.
    // - Bootstrap reconnect on pageshow/visibility/load in case browser restored a stale runtime.
    const reconnectGuard = new LifecycleReconnectGuard({
      windowTarget: window,
      documentTarget: document,
      getExpectedPeers: () => ctrl.getExpectedWorkspacePeerCount(),
      getConnectedPeers: () => ctrl.transport.getConnectedPeers().length,
      runPeerMaintenanceNow: (reason) => ctrl.runPeerMaintenanceNow(reason),
      reinitializeTransportIfStuck: (reason) => ctrl.reinitializeTransportIfStuck(reason),
      isOnline: () => navigator.onLine,
    });
    let tornDown = false;
    reconnectGuard.start();

    const teardownForUnload = () => {
      if (tornDown) return;
      tornDown = true;
      reconnectGuard.stop();
      document.removeEventListener('visibilitychange', onVisibilityLifecycle, true);
      window.removeEventListener('beforeunload', onBeforeUnload, true);
      window.removeEventListener('pagehide', onPageHide, true);
      try { ctrl.stopPEXBroadcasts(); } catch {}
      try { ctrl.transport.destroy(); } catch {}
    };

    const onVisibilityLifecycle = () => {
      if (document.visibilityState === 'hidden') {
        if (typeof ctrl.transport.setHeartbeatEnabled === 'function') {
          ctrl.transport.setHeartbeatEnabled(false);
        }
        return;
      }
      if (typeof ctrl.transport.setHeartbeatEnabled === 'function') {
        ctrl.transport.setHeartbeatEnabled(true);
      }
    };

    const onBeforeUnload = () => {
      teardownForUnload();
    };

    const onPageHide = (event: Event) => {
      const pageEvent = event as PageTransitionEvent;
      if (!pageEvent.persisted) {
        teardownForUnload();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityLifecycle, { capture: true });
    window.addEventListener('beforeunload', onBeforeUnload, { capture: true });
    window.addEventListener('pagehide', onPageHide, { capture: true });

    reconnectGuard.scheduleCheck('load');

  } catch (error) {
    console.error('[DecentChat] Initialization failed:', error);
    
    // Show error screen with storage reset option
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'none';
    
    const app = document.getElementById('app')!;
    app.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;padding:20px;text-align:center;gap:20px;">
        <div style="font-size:64px;">⚠️</div>
        <h1 style="font-size:24px;font-weight:600;margin:0;">Failed to initialize</h1>
        <p style="max-width:500px;opacity:0.7;margin:0;">
          ${(error as Error).message || 'Unknown error'}
        </p>
        <p style="max-width:500px;font-size:14px;opacity:0.6;margin:0;">
          This usually happens after an update when storage format changes. 
          Clearing local data will reset the app to a fresh state.
        </p>
        <div style="display:flex;gap:12px;margin-top:12px;">
          <button id="clear-storage-btn" style="padding:12px 24px;background:#e74c3c;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">
            Clear Local Data & Reload
          </button>
          <button onclick="location.reload()" style="padding:12px 24px;background:#6c5ce7;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">
            Retry
          </button>
        </div>
        <details style="max-width:600px;margin-top:20px;opacity:0.5;font-size:12px;text-align:left;">
          <summary style="cursor:pointer;user-select:none;">Technical details</summary>
          <pre style="margin-top:10px;padding:10px;background:rgba(0,0,0,0.2);border-radius:4px;overflow:auto;white-space:pre-wrap;">${(error as Error).stack || error}</pre>
        </details>
      </div>
    `;
    
    // Clear storage handler
    document.getElementById('clear-storage-btn')?.addEventListener('click', async () => {
      try {
        // Clear IndexedDB
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
          if (db.name) indexedDB.deleteDatabase(db.name);
        }
        
        // Clear localStorage
        localStorage.clear();
        
        // Clear sessionStorage
        sessionStorage.clear();
        
        // Unregister service workers
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const registration of registrations) {
            await registration.unregister();
          }
        }
        
        // Clear cache
        if ('caches' in window) {
          const cacheNames = await caches.keys();
          for (const name of cacheNames) {
            await caches.delete(name);
          }
        }
        
        // Reload
        location.reload();
      } catch (err) {
        alert('Failed to clear storage: ' + (err as Error).message);
      }
    });
  }
}

// Wait for both DOM and stylesheets to load before initializing
// This prevents "Layout was forced before page was fully loaded" warning
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initTitleTooltipObserver();
    initTooltips();
    // Small delay to ensure CSS is applied before layout calculations
    requestAnimationFrame(() => {
      initWithTimeout();
    });
  });
} else {
  // DOM already loaded
  initTitleTooltipObserver();
  initTooltips();
  requestAnimationFrame(() => {
    initWithTimeout();
  });
}

// Wrapper that adds a timeout to detect stuck initialization
async function initWithTimeout() {
  const INIT_TIMEOUT = 30000; // 30 seconds
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('Initialization timed out after 30 seconds. This usually means storage is corrupted or a background operation is stuck.'));
    }, INIT_TIMEOUT);
  });
  
  try {
    await Promise.race([init(), timeoutPromise]);
  } catch (error) {
    console.error('[DecentChat] Init failed or timed out:', error);
    
    // The error handler in init() will show the UI, but if we timeout
    // before init() catches the error, we need to handle it here
    const loading = document.getElementById('loading');
    if (loading && loading.style.display !== 'none') {
      // Still showing loading screen, manually trigger error UI
      const event = new CustomEvent('init-error', { detail: error });
      window.dispatchEvent(event);
      
      // Show error inline
      const hint = loading.querySelector('.hint') as HTMLElement;
      if (hint) {
        hint.innerHTML = `
          <div style="color:#e74c3c;margin-top:20px;">
            ⚠️ ${(error as Error).message}
            <br><br>
            <button onclick="location.reload()" style="padding:8px 16px;background:#6c5ce7;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-right:8px;">Retry</button>
            <button onclick="if(confirm('Clear all local data and start fresh?')){indexedDB.databases().then(dbs=>dbs.forEach(db=>db.name&&indexedDB.deleteDatabase(db.name)));localStorage.clear();location.reload();}" style="padding:8px 16px;background:#e74c3c;color:#fff;border:none;border-radius:4px;cursor:pointer;">Clear Data</button>
          </div>
        `;
      }
    }
  }
}

// ─── Service Worker / PWA toggle ─────────────────────────────────────────────
const SW_RELOAD_SEEN_KEY = 'dc-sw-reload-seen-build';
const CURRENT_BUILD_ID = `${__APP_VERSION__}:${__COMMIT_HASH__}`;

if ('serviceWorker' in navigator && !__PWA_ENABLED__) {
  // Dev mode: make sure previously installed SW is removed so deploys are instant.
  navigator.serviceWorker.getRegistrations()
    .then(async (regs) => {
      for (const reg of regs) await reg.unregister();
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      }
    })
    .catch(() => {});
}

if ('serviceWorker' in navigator && __PWA_ENABLED__) {
  let pendingReloadBuildId: string | null = null;

  const maybeReloadForBuild = (buildId: unknown) => {
    if (typeof buildId !== 'string' || !buildId.trim()) return;
    if (buildId === CURRENT_BUILD_ID) return;
    if (sessionStorage.getItem(SW_RELOAD_SEEN_KEY) === buildId) return;

    pendingReloadBuildId = buildId;
    if ((window as any).__appInitialized) {
      sessionStorage.setItem(SW_RELOAD_SEEN_KEY, buildId);
      window.location.reload();
    }
  };

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'DC_SW_ACTIVATED') {
      maybeReloadForBuild(event.data.buildId);
    }
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (pendingReloadBuildId && (window as any).__appInitialized) {
      sessionStorage.setItem(SW_RELOAD_SEEN_KEY, pendingReloadBuildId);
      window.location.reload();
    }
  });

  navigator.serviceWorker.ready.then(reg => {
    // Keep old behavior where update polling can nudge the registration.
    reg.update().catch(() => {});
  });
}

// Wire AutoUpdater — polls /version.json every 5 min as a backup mechanism.
// If server has a newer version.json but SW hasn't picked it up yet, nudge it.
if (typeof __APP_VERSION__ !== 'undefined' && __PWA_ENABLED__) {
  import('./updater/AutoUpdater').then(({ AutoUpdater }) => {
    const updater = new AutoUpdater(__APP_VERSION__, {
      checkIntervalMs: 5 * 60 * 1000,
      onUpdateAvailable: () => {
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistration().then(reg => reg?.update());
        }
      },
    });
    updater.start();
  });
}
