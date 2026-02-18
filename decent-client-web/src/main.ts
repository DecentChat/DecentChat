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
    onSettingsAction: async (action) => {
      if (action === 'generateSeed') {
        const { SeedPhrase } = await import('decent-protocol');
        const mnemonic = SeedPhrase.generate();
        await ctrl.persistentStore.saveSetting('seedPhrase', mnemonic);
      }
    },
  });

  // Give the controller a handle to the UI for push updates
  ctrl.setUI({
    updateSidebar: () => ui.updateSidebar(),
    updateChannelHeader: () => ui.updateChannelHeader(),
    appendMessageToDOM: (msg) => ui.appendMessageToDOM(msg),
    showToast: (message, type) => ui.showToast(message, type),
    renderThreadMessages: () => ui.renderThreadMessages(),
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

    // Restore persisted workspaces / messages
    await ctrl.restoreFromStorage();

    // Wire transport event handlers
    ctrl.setupTransportHandlers();

    // Render initial view
    if (ctrl.workspaceManager.getAllWorkspaces().length === 0) {
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
