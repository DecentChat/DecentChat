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
    joinWorkspace: (code, alias, peerId, inviteData) => ctrl.joinWorkspace(code, alias, peerId, inviteData),
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

  // Don't request notification permission automatically (browser security restriction)
  // User can enable via Settings or we'll ask on first message
  // ctrl.notifications.requestPermission();

  try {
    // Initialize storage — PersistentStore is the primary store.
    // Database is kept but no longer initialized here (see task #8 consolidation).
    
    // Update loading hint
    const loadingHint = document.querySelector('#loading .hint') as HTMLElement;
    const updateHint = (text: string) => {
      if (loadingHint) loadingHint.textContent = text;
      console.log(`[Init] ${text}`);
    };
    
    updateHint('Initializing key store...');
    await ctrl.keyStore.init();
    
    updateHint('Opening database...');
    await ctrl.persistentStore.init();

    // Wire offline queue → persistent storage
    updateHint('Connecting storage layers...');
    ctrl.offlineQueue.setPersistence(
      (peerId, data) => ctrl.persistentStore.enqueueMessage(peerId, data),
      (peerId) => ctrl.persistentStore.getQueuedMessages(peerId),
      (id) => ctrl.persistentStore.dequeueMessage(id),
      (peerId) => ctrl.persistentStore.dequeueAllForPeer(peerId),
    );

    // Generate / load crypto keys
    updateHint('Loading encryption keys...');
    let ecdhKeyPair = await ctrl.keyStore.getECDHKeyPair();
    if (!ecdhKeyPair) {
      updateHint('Generating new encryption keys...');
      ecdhKeyPair = await ctrl.cryptoManager.generateKeyPair();
      await ctrl.keyStore.storeECDHKeyPair(ecdhKeyPair);
    }

    let ecdsaKeyPair = await ctrl.keyStore.getECDSAKeyPair();
    if (!ecdsaKeyPair) {
      updateHint('Generating signing keys...');
      ecdsaKeyPair = await ctrl.cryptoManager.generateSigningKeyPair();
      await ctrl.keyStore.storeECDSAKeyPair(ecdsaKeyPair);
    }

    ctrl.myPublicKey = await ctrl.cryptoManager.exportPublicKey(ecdhKeyPair.publicKey);

    // Bootstrap transport + peer ID
    updateHint('Loading settings...');
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
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        ui.showJoinWithInvite(pendingInvite!.code, pendingInvite!.peerId, pendingInvite!.name, pendingInvite!.inviteData);
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
    // Small delay to ensure CSS is applied before layout calculations
    requestAnimationFrame(() => {
      initWithTimeout();
    });
  });
} else {
  // DOM already loaded
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
