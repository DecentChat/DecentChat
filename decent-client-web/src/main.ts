/**
 * P2P Chat PWA — Entry Point
 *
 * Thin bootstrap: creates ChatController + UIRenderer, wires them together,
 * then calls init().  All business logic lives in ChatController; all DOM
 * rendering lives in UIRenderer.
 */

import './ui/styles/main.css';

import { ChatController } from './app/ChatController';
import { UIRenderer } from './ui/UIRenderer';
import { CommandParser } from './commands/CommandParser';
import { registerCommands } from './commands/registerCommands';
import type { AppSettings } from './storage/types';

// ---------------------------------------------------------------------------
// Shared application state (passed by reference to both modules)
// ---------------------------------------------------------------------------

export interface AppState {
  myPeerId: string;
  myAlias: string;
  connectedPeers: Set<string>;
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
  const state: AppState = {
    myPeerId: '',
    myAlias: '',
    connectedPeers: new Set(),
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
          ui.appendMessageToDOM(msg);
          return;
        }
      }
      // If we're in a standalone direct conversation, use the direct message path
      if (state.activeDirectConversationId) {
        return ctrl.sendDirectMessage(state.activeDirectConversationId, content, threadId);
      }
      return ctrl.sendMessage(content, threadId);
    },
    sendAttachment: (file, text) => ctrl.sendAttachment(file, text),
    connectPeer: (peerId) => ctrl.connectPeer(peerId),
    createWorkspace: (name, alias) => ctrl.createWorkspace(name, alias),
    joinWorkspace: (code, alias, peerId) => ctrl.joinWorkspace(code, alias, peerId),
    createChannel: (name) => ctrl.createChannel(name),
    createDM: (peerId) => ctrl.createDM(peerId),
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
        await ctrl.persistentStore.saveSetting('seedPhrase', mnemonic);
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
  });

  // Give the controller a handle to the UI for push updates
  ctrl.setUI({
    updateSidebar: () => ui.updateSidebar(),
    updateChannelHeader: () => ui.updateChannelHeader(),
    appendMessageToDOM: (msg) => ui.appendMessageToDOM(msg),
    showToast: (message, type) => ui.showToast(message, type),
    renderThreadMessages: () => ui.renderThreadMessages(),
    renderApp: () => ui.renderApp(),
  });

  // Wire typing indicator
  ctrl.presence.onTypingChanged = (channelId, typingPeers) => {
    if (channelId !== state.activeChannelId) return;
    const text = ctrl.presence.formatTypingText(
      typingPeers.filter(p => p !== state.myPeerId),
      (peerId) => peerId.slice(0, 8),
    );
    ui.updateTypingIndicator(text);
  };

  // Request notification permission
  ctrl.notifications.requestPermission();

  try {
    // Initialize storage — PersistentStore is the primary store.
    // Database is kept but no longer initialized here (see task #8 consolidation).
    await ctrl.keyStore.init();
    await ctrl.persistentStore.init();

    // Wire offline queue → persistent storage
    ctrl.offlineQueue.setPersistence(
      (peerId, data) => ctrl.persistentStore.enqueueMessage(peerId, data),
      (peerId) => ctrl.persistentStore.getQueuedMessages(peerId),
      (id) => ctrl.persistentStore.dequeueMessage(id),
      (peerId) => ctrl.persistentStore.dequeueAllForPeer(peerId),
    );

    // Generate / load crypto keys
    let ecdhKeyPair = await ctrl.keyStore.getECDHKeyPair();
    if (!ecdhKeyPair) {
      ecdhKeyPair = await ctrl.cryptoManager.generateKeyPair();
      await ctrl.keyStore.storeECDHKeyPair(ecdhKeyPair);
    }

    let ecdsaKeyPair = await ctrl.keyStore.getECDSAKeyPair();
    if (!ecdsaKeyPair) {
      ecdsaKeyPair = await ctrl.cryptoManager.generateSigningKeyPair();
      await ctrl.keyStore.storeECDSAKeyPair(ecdsaKeyPair);
    }

    ctrl.myPublicKey = await ctrl.cryptoManager.exportPublicKey(ecdhKeyPair.publicKey);

    // Bootstrap transport + peer ID
    const settingsDefaults: AppSettings = { theme: 'auto', notifications: true };
    const settings = await ctrl.persistentStore.getSettings<AppSettings>(settingsDefaults);

    let myPeerId: string;
    try {
      myPeerId = await ctrl.transport.init(settings.myPeerId);
    } catch (err) {
      // Signaling server unavailable — work offline with a local ID
      console.warn('[DecentChat] Signaling server unavailable, working offline:', (err as Error).message);
      myPeerId = settings.myPeerId || crypto.randomUUID();
      // Schedule retry
      const retryConnect = () => {
        ctrl.transport.init(myPeerId).then(() => {
          console.log('[DecentChat] Reconnected to signaling server');
          ctrl.setupTransportHandlers();
          ui.showToast('Connected to signaling server ✓', 'success');
        }).catch(() => {
          setTimeout(retryConnect, 15000);
        });
      };
      setTimeout(retryConnect, 10000);
    }

    state.myPeerId = myPeerId;
    state.myAlias = myPeerId.slice(0, 8);

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

    // Wire Double Ratchet state persistence via PersistentStore
    ctrl.messageProtocol.setPersistence({
      save: (peerId, state) => ctrl.persistentStore.saveRatchetState(peerId, state),
      load: (peerId) => ctrl.persistentStore.getRatchetState(peerId),
      delete: (peerId) => ctrl.persistentStore.deleteRatchetState(peerId),
    });

    // Restore persisted workspaces / messages
    await ctrl.restoreFromStorage();

    // Restore contacts and direct conversations
    await ctrl.restoreContacts();

    // Wire transport event handlers
    ctrl.setupTransportHandlers();

    // Check for /join/CODE invite URL
    const joinMatch = window.location.pathname.match(/^\/join\/([A-Za-z0-9]+)/);
    let pendingInvite = joinMatch ? {
      code: joinMatch[1],
      peerId: new URLSearchParams(window.location.search).get('peer') || '',
      name: new URLSearchParams(window.location.search).get('name') || '',
    } : null;

    if (pendingInvite) {
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
            (pendingInvite as any) = parsed;
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
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        ui.showJoinWithInvite(pendingInvite!.code, pendingInvite!.peerId, pendingInvite!.name);
      }, 100);
    } else if (ctrl.workspaceManager.getAllWorkspaces().length === 0) {
      ui.renderWelcome();
    } else {
      state.activeWorkspaceId = ctrl.workspaceManager.getAllWorkspaces()[0].id;
      const ws = ctrl.workspaceManager.getWorkspace(state.activeWorkspaceId!)!;
      state.activeChannelId = ws.channels[0]?.id || null;
      ui.renderApp();
    }
  } catch (error) {
    document.getElementById('app')!.innerHTML = `
      <div class="welcome-screen">
        <h1>⚠️ Error</h1>
        <p>${(error as Error).message}</p>
      </div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch(console.error);
});

// Service Worker update detection — show non-intrusive toast
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then(registration => {
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New version ready — show toast with reload button (don't auto-reload!)
          const toast = document.createElement('div');
          toast.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;padding:12px 20px;background:#6c5ce7;color:#fff;border-radius:8px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);cursor:pointer;display:flex;align-items:center;gap:8px;';
          toast.innerHTML = '🐙 Update available! <u>Click to reload</u>';
          toast.addEventListener('click', () => window.location.reload());
          document.body.appendChild(toast);
          // Auto-dismiss after 30s
          setTimeout(() => toast.remove(), 30000);
        }
      });
    });
  });
}
