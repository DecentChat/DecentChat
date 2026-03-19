/**
 * P2P Chat PWA — Entry Point
 *
 * Thin bootstrap: creates ChatController + UIService, wires them together,
 * then calls init().  All business logic lives in ChatController; all UI
 * state management lives in uiService (writing to Svelte stores).
 */

import './ui/styles/main.css';
import './ui/styles/tooltips.css';

// ─── Single-Tab Lock ─────────────────────────────────────────────────────────
// Prevent multiple tabs from running simultaneously (shared IndexedDB,
// WebRTC peer ID, and signaling connection would cause race conditions).
(() => {
  // Only lock tabs on /app routes — landing page, docs etc. can open freely
  const p = window.location.pathname;
  if (p !== "/app" && !p.startsWith("/app/")) return;
  if (typeof BroadcastChannel === 'undefined') return; // SSR / old browser fallback

  const LOCK_CHANNEL = 'decentchat-tab-lock';
  const TAB_ID = crypto.randomUUID();
  const bc = new BroadcastChannel(LOCK_CHANNEL);

  // Announce presence
  bc.postMessage({ type: 'ping', tabId: TAB_ID });

  bc.onmessage = (e) => {
    if (e.data?.type === 'ping' && e.data.tabId !== TAB_ID) {
      // Another tab just opened — tell it we're already here
      bc.postMessage({ type: 'pong', tabId: TAB_ID });
    }
    if (e.data?.type === 'pong' && e.data.tabId !== TAB_ID) {
      // We received a response — another tab is already running
      showTabBlocker();
    }
  };

  function showTabBlocker() {
    // Stop all scripts from running further
    document.addEventListener('DOMContentLoaded', blockApp);
    if (document.readyState !== 'loading') blockApp();

    function blockApp() {
      document.body.innerHTML = `
        <div style="
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          height: 100vh; background: #1a1a2e; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          text-align: center; padding: 20px;
        ">
          <div style="font-size: 48px; margin-bottom: 16px;">🔒</div>
          <h1 style="font-size: 22px; font-weight: 700; margin: 0 0 12px;">DecentChat is already open</h1>
          <p style="font-size: 14px; color: #999; max-width: 400px; line-height: 1.5; margin: 0 0 24px;">
            DecentChat can only run in one tab at a time to keep your encrypted connections stable.
            Please switch to the other tab, or close it and reload this page.
          </p>
          <button onclick="location.reload()" style="
            padding: 10px 24px; border-radius: 8px; border: none;
            background: #6c5ce7; color: #fff; font-size: 14px; font-weight: 600;
            cursor: pointer;
          ">Reload this tab</button>
        </div>
      `;
      // Prevent any further app initialization
      throw new Error('DecentChat: blocked duplicate tab');
    }
  }
})();
// ─────────────────────────────────────────────────────────────────────────────

import { initTooltips } from './ui/TooltipManager';
import { ChatController } from './app/ChatController';
import { LifecycleReconnectGuard } from './app/LifecycleReconnectGuard';
import { createUIService, type UIService } from './ui/uiService';
import { CommandParser } from './commands/CommandParser';
import { registerCommands } from './commands/registerCommands';
import {
  buildCompanyTemplatePreview,
  getLocalCompanyTemplate,
  listLocalCompanyTemplates,
} from './lib/company-sim/templateCatalog';
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isLikelyStorageInitIssue(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error || '')).toLowerCase();
  const code = (() => {
    if (!error || typeof error !== 'object' || !('code' in error)) return '';
    return String((error as any).code || '').toLowerCase();
  })();

  return code === 'blocked'
    || code === 'timeout'
    || msg.includes('indexeddb')
    || msg.includes('storage')
    || msg.includes('blocked')
    || msg.includes('versionchange')
    || msg.includes('another tab')
    || msg.includes('tabs/windows')
    || msg.includes('timed out opening');
}

async function deleteIndexedDb(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error(`Failed deleting IndexedDB ${name}`));
    req.onblocked = () => reject(new Error(`IndexedDB ${name} is still open in another tab/window`));
  });
}

async function clearLocalAppData(): Promise<void> {
  const dbNames = new Set<string>();

  if (typeof indexedDB.databases === 'function') {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) dbNames.add(db.name);
    }
  }

  // Fallback for browsers without indexedDB.databases() support.
  dbNames.add('decent-protocol');
  dbNames.add('p2p-chat-keys');

  for (const dbName of dbNames) {
    await deleteIndexedDb(dbName);
  }

  localStorage.clear();
  sessionStorage.clear();

  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      await registration.unregister();
    }
  }

  if ('caches' in window) {
    const cacheNames = await caches.keys();
    for (const name of cacheNames) {
      await caches.delete(name);
    }
  }
}

function renderStartupError(error: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const storageIssue = isLikelyStorageInitIssue(err);

  const loading = document.getElementById('loading');
  if (loading) loading.style.display = 'none';

  const app = document.getElementById('app');
  if (!app) return;

  const guidance = storageIssue
    ? 'Local storage could not be opened. This is usually caused by another DecentChat tab/window or a stale IndexedDB connection after an update.'
    : 'DecentChat failed to initialize due to an unexpected startup error.';

  const nextStep = storageIssue
    ? 'First close other DecentChat tabs/windows, then retry. Only clear local data if retry still fails.'
    : 'Try reload first. If it keeps failing, clear local data as a last resort.';

  const safeMessage = escapeHtml(err.message || 'Unknown error');
  const safeStack = escapeHtml(err.stack || String(err));

  app.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;padding:20px;text-align:center;gap:16px;">
      <div style="font-size:64px;">⚠️</div>
      <h1 style="font-size:24px;font-weight:600;margin:0;">Failed to initialize</h1>
      <p style="max-width:640px;opacity:0.8;margin:0;line-height:1.45;">${guidance}</p>
      <p style="max-width:640px;font-size:14px;opacity:0.65;margin:0;line-height:1.45;">${nextStep}</p>
      <p style="max-width:640px;opacity:0.7;margin:0;font-size:13px;">${safeMessage}</p>
      <div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap;justify-content:center;">
        <button id="retry-init-btn" style="padding:12px 24px;background:#6c5ce7;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">Retry</button>
        <button id="clear-storage-btn" style="padding:12px 24px;background:#e74c3c;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600;">Clear Local Data & Reload (Last resort)</button>
      </div>
      <details style="max-width:760px;margin-top:10px;opacity:0.55;font-size:12px;text-align:left;">
        <summary style="cursor:pointer;user-select:none;">Technical details</summary>
        <pre style="margin-top:10px;padding:10px;background:rgba(0,0,0,0.2);border-radius:4px;overflow:auto;white-space:pre-wrap;">${safeStack}</pre>
      </details>
    </div>
  `;

  document.getElementById('retry-init-btn')?.addEventListener('click', () => {
    window.location.reload();
  });

  document.getElementById('clear-storage-btn')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget as HTMLButtonElement;
    const confirmed = window.confirm(
      'This will permanently remove local messages, settings, and cached data on this browser. Continue?',
    );
    if (!confirmed) return;

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Clearing…';

    try {
      await clearLocalAppData();
      window.location.reload();
    } catch (clearError) {
      btn.disabled = false;
      btn.textContent = originalText;
      alert('Failed to clear storage: ' + (clearError as Error).message);
    }
  });
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

  const installCompanyTemplateToWorkspace = async (request: {
    templateId: string;
    workspaceId: string;
    answers: Record<string, string>;
  }) => {
    const template = getLocalCompanyTemplate(request.templateId);
    if (!template) throw new Error(`Unknown template: ${request.templateId}`);

    const workspace = ctrl.workspaceManager.getWorkspace(request.workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${request.workspaceId}`);

    const preview = buildCompanyTemplatePreview(template, request.answers);

    const createdChannelNames: string[] = [];
    const existingChannelNames = new Set((workspace.channels || []).map((channel: any) => String(channel.name || '').toLowerCase()));

    const previousWorkspaceId = state.activeWorkspaceId;
    const previousChannelId = state.activeChannelId;

    state.activeWorkspaceId = workspace.id;

    try {
      if (!state.activeChannelId && workspace.channels?.[0]) {
        state.activeChannelId = workspace.channels[0].id;
      }

      for (const channelName of preview.channelNames) {
        const normalized = channelName.toLowerCase();
        if (existingChannelNames.has(normalized)) continue;

        const created = ctrl.createChannel(channelName);
        if (!created.success || !created.channel) {
          throw new Error(created.error || `Failed to create channel: ${channelName}`);
        }

        existingChannelNames.add(normalized);
        createdChannelNames.push(created.channel.name);
      }
    } finally {
      state.activeWorkspaceId = previousWorkspaceId;
      state.activeChannelId = previousChannelId;
    }

    if (!Array.isArray(workspace.members)) workspace.members = [];

    const createdMemberPeerIds: string[] = [];
    const existingMemberIds = new Set(workspace.members.map((member: any) => member.peerId));
    const managerByRoleId = new Map(preview.members.map((member) => [member.roleId, member.peerId]));

    for (const member of preview.members) {
      if (existingMemberIds.has(member.peerId)) continue;

      const managerPeerId = member.managerRoleId
        ? managerByRoleId.get(member.managerRoleId)
        : undefined;

      workspace.members.push({
        peerId: member.peerId,
        alias: member.alias,
        publicKey: `pk-${member.peerId}`,
        signingPublicKey: `spk-${member.peerId}`,
        identityId: member.peerId,
        devices: [],
        role: 'member',
        isBot: true,
        allowWorkspaceDMs: false,
        companySim: {
          automationKind: 'openclaw-agent',
          roleTitle: member.roleTitle,
          teamId: member.teamId,
          managerPeerId,
        },
      } as any);

      existingMemberIds.add(member.peerId);
      createdMemberPeerIds.push(member.peerId);
    }

    await ctrl.persistWorkspace(workspace.id);

    return {
      templateId: template.id,
      templateLabel: template.label,
      workspaceId: workspace.id,
      workspaceName: preview.workspaceName,
      companyName: preview.companyName,
      createdChannelNames,
      createdMemberPeerIds,
      channelNames: preview.channelNames,
      members: preview.members,
    };
  };

  // Create UI service (owns all DOM manipulation via Svelte stores)
  const ui = createUIService(state, ctrl.workspaceManager, ctrl.messageStore, {
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
    joinWorkspace: (code, alias, peerId, inviteData, options) => ctrl.joinWorkspace(code, alias, peerId, inviteData, options),
    createChannel: (name) => ctrl.createChannel(name),
    createDM: (peerId) => ctrl.createDM(peerId),
    removeWorkspaceMember: (peerId) => ctrl.removeWorkspaceMember(peerId),
    banWorkspaceMember: (peerId, opts) => ctrl.banWorkspaceMember(peerId, opts),
    promoteMember: (peerId, newRole) => ctrl.promoteMember(peerId, newRole),
    demoteMember: (peerId) => ctrl.demoteMember(peerId),
    updateWorkspacePermissions: (permissions) => ctrl.updateWorkspacePermissions(permissions),
    updateWorkspaceInfo: (updates) => ctrl.updateWorkspaceInfo(updates),
    deleteWorkspace: (wsId) => ctrl.deleteWorkspace(wsId),
    leaveWorkspace: (wsId) => ctrl.leaveWorkspace(wsId),
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
    generateInviteURL: (wsId, opts) => ctrl.generateInviteURL(wsId, opts), // returns Promise<string> now
    listWorkspaceInvites: (wsId) => ctrl.listWorkspaceInvites(wsId),
    revokeWorkspaceInvite: (inviteId) => ctrl.revokeInviteById(inviteId),
    addContact: (contact) => ctrl.addContact(contact),
    removeContact: (peerId) => ctrl.removeContact(peerId),
    getContacts: () => ctrl.getContacts(),
    startDirectMessage: (contactPeerId, options) => ctrl.startDirectMessage(contactPeerId, options),
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
    getWorkspaceMemberDirectory: (workspaceId) => ctrl.getWorkspaceMemberDirectory(workspaceId),
    prefetchWorkspaceMemberDirectory: (workspaceId) => ctrl.prefetchWorkspaceMemberDirectory(workspaceId),
    loadMoreWorkspaceMemberDirectory: (workspaceId) => ctrl.loadMoreWorkspaceMemberDirectory(workspaceId),
    getPresenceScopeState: (workspaceId, channelId) => ctrl.getPresenceScopeState(workspaceId, channelId),
    loadMorePresenceScope: (workspaceId, channelId) => ctrl.loadMorePresenceScope(workspaceId, channelId),
    onWorkspaceActivated: (workspaceId) => ctrl.onWorkspaceActivated(workspaceId),
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
    getConnectionStatus: () => ctrl.getConnectionStatus(),
    retryReconnect: () => ctrl.retryReconnectNow(),
    listCompanyTemplates: () => listLocalCompanyTemplates(),
    installCompanyTemplate: async (request) => {
      const result = await installCompanyTemplateToWorkspace(request);
      ui.updateSidebar();
      ui.updateChannelHeader();
      return result;
    },

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

  // Clicking a desktop notification switches to the correct workspace + channel
  ctrl.notifications.onNotificationClick = (channelId) => {
    // Find which workspace owns this channel
    let targetWorkspaceId: string | null = null;
    for (const ws of ctrl.workspaceManager.getAllWorkspaces()) {
      if (ws.channels.some((ch: any) => ch.id === channelId)) {
        targetWorkspaceId = ws.id;
        break;
      }
    }

    if (targetWorkspaceId) {
      // Workspace channel or DM — switch workspace first if needed
      if (targetWorkspaceId !== state.activeWorkspaceId) {
        ui.switchWorkspace(targetWorkspaceId);
      }
      ui.switchChannel(channelId);
    } else {
      // Standalone direct conversation (not inside a workspace)
      ui.switchToDirectConversation(channelId);
    }
  };

  // Give the controller a handle to the UI for push updates
  ctrl.setUI({
    updateSidebar: () => ui.updateSidebar(),
    updateWorkspaceRail: () => ui.updateWorkspaceRail(),
    updateChannelHeader: () => ui.updateChannelHeader(),
    appendMessageToDOM: (msg, animate) => ui.appendMessageToDOM(msg, undefined, animate),
    showToast: (message, type) => ui.showToast(message, type),
    renderThreadMessages: () => {
      ui.renderThreadMessages();
      ctrl.syncReactionsToDOM();
    },
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

  const loadingHint = document.querySelector('#loading .hint') as HTMLElement | null;
  const setLoadingHint = (message: string) => {
    if (loadingHint) loadingHint.textContent = message;
  };

  const initIndexedDbWithRetry = async (
    label: string,
    initFn: () => Promise<void>,
    closeFn?: () => Promise<void> | void,
    retries = 1,
  ): Promise<void> => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await initFn();
        return;
      } catch (error) {
        lastError = error;
        if (!isLikelyStorageInitIssue(error) || attempt >= retries) break;

        setLoadingHint(`${label} is busy in another tab. Close other DecentChat tabs/windows… retrying`);
        try {
          await closeFn?.();
        } catch {
          // best-effort cleanup before retry
        }
        await sleep(900);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Failed to initialize ${label}`);
  };

  try {
    // Initialize storage — PersistentStore is the primary store.
    // Database is kept but no longer initialized here (see task #8 consolidation).

    setLoadingHint('Loading local storage...');

    // Hard route split:
    // - / and non-app routes render landing only (no transport/bootstrap/network)
    // - /app and /join/* run full app bootstrap
    if (!isAppRoute && !isJoinRoute) {
      const landingDefaults: AppSettings = { theme: 'auto', notifications: true };
      await initIndexedDbWithRetry('local storage', () => ctrl.persistentStore.init(), () => ctrl.persistentStore.close(), 1);

      const settings = await ctrl.persistentStore.getSettings<AppSettings>(landingDefaults);
      const myAlias = await ctrl.persistentStore.getSetting('myAlias');
      await ctrl.publicWorkspaceController.restoreFromStorage();
      const savedWorkspaces = await ctrl.persistentStore.getAllWorkspaces();

      for (const ws of savedWorkspaces) {
        try {
          ctrl.workspaceManager.importWorkspace(ws);
          ctrl.publicWorkspaceController.ingestWorkspaceSnapshot(ws);
        } catch {
          // Ignore malformed workspace records on landing path.
        }
      }

      state.myPeerId = (settings as any).myPeerId || '';
      state.myAlias = typeof myAlias === 'string' && myAlias.trim()
        ? myAlias
        : (state.myPeerId ? state.myPeerId.slice(0, 8) : '');

      // Mount AppShell for landing page (it handles welcome view too)
      try {
        const { mount: svelteMount } = await import("svelte");
        const { default: AppShell } = await import("./lib/components/AppShell.svelte");
        const { default: App } = await import("./lib/components/shared/App.svelte");
        const appEl = document.getElementById('app')!;
        svelteMount(AppShell, { target: appEl });
        const svelteRoot = document.createElement("div");
        svelteRoot.id = "svelte-root";
        document.body.appendChild(svelteRoot);
        svelteMount(App, { target: svelteRoot });
      } catch (err) {
        console.warn("[DecentChat] Svelte mount failed on landing:", err);
      }

      ui.renderWelcome();
      (window as any).__appInitialized = true;
      return;
    }

    setLoadingHint('Opening key storage...');
    await initIndexedDbWithRetry('key storage', () => ctrl.keyStore.init(), () => ctrl.keyStore.close(), 1);

    setLoadingHint('Opening message storage...');
    await initIndexedDbWithRetry('message storage', () => ctrl.persistentStore.init(), () => ctrl.persistentStore.close(), 1);

    // Wire offline queue → persistent storage
    ctrl.offlineQueue.setPersistence(
      (peerId, data, meta) => ctrl.persistentStore.enqueueMessage(peerId, data, meta),
      (peerId) => ctrl.persistentStore.getQueuedMessages(peerId),
      (id) => ctrl.persistentStore.dequeueMessage(id),
      (peerId) => ctrl.persistentStore.dequeueAllForPeer(peerId),
      (id, patch) => ctrl.persistentStore.updateQueuedMessage(id, patch),
    );

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

    // === Multi-device key derivation (Phase 3) ===
    // When seed phrase exists, derive device-specific keys from HD tree:
    //   peerId     ← m/3'/device/<deviceIndex> (unique per device)
    //   identityId ← m/0'/identity/0 (stable across all devices)
    // This ensures peerId↔publicKey binding (Phase 1) works correctly.
    const deviceIndex = (settings as any).deviceIndex ?? 0;
    let derivedPeerId: string | null = null;
    let ecdhKeyPair: CryptoKeyPair;
    let ecdsaKeyPair: CryptoKeyPair;

    if (typeof seedPhrase === 'string' && seedPhrase.trim()) {
      try {
        const { SeedPhraseManager, AtRestEncryption } = await import('decent-protocol');
        const seedPhraseManager = new SeedPhraseManager();

        // Derive device-specific keys from HD tree
        const deviceResult = await seedPhraseManager.deriveDeviceKeys(seedPhrase, deviceIndex);
        derivedPeerId = deviceResult.peerId;

        // Use device ECDH key for transport (handshake, shared secrets)
        ecdhKeyPair = deviceResult.deviceKeys.ecdhKeyPair;
        ctrl.cryptoManager.setKeyPair(ecdhKeyPair);
        await ctrl.keyStore.storeECDHKeyPair(ecdhKeyPair);

        // Use device ECDSA key for message signing
        ecdsaKeyPair = deviceResult.deviceKeys.ecdsaKeyPair;
        await ctrl.keyStore.storeECDSAKeyPair(ecdsaKeyPair);

        // identityId from HD identity key (stable across all devices)
        ctrl.myIdentityId = deviceResult.identityId;

        console.log(`[DecentChat] HD device key derivation: device=${deviceIndex}, peerId=${derivedPeerId.slice(0, 8)}…, identityId=${deviceResult.identityId.slice(0, 8)}…`);

        // At-rest encryption from master seed (via legacy deriveAll for the master seed)
        try {
          const { keys: legacyKeys } = await seedPhraseManager.deriveAll(seedPhrase);
          const atRest = new AtRestEncryption();
          await atRest.init(legacyKeys.masterSeed);
          ctrl.persistentStore.setAtRestEncryption(atRest);
          console.log('[DecentChat] At-rest encryption enabled');
        } catch (err) {
          console.warn('[DecentChat] At-rest encryption init failed:', (err as Error).message);
        }
      } catch (err) {
        console.warn('[DecentChat] HD device key derivation failed, falling back to random keys:', (err as Error).message);
        // Fall back to random key generation
        ecdhKeyPair = await ctrl.keyStore.getECDHKeyPair() || await ctrl.cryptoManager.generateKeyPair();
        await ctrl.keyStore.storeECDHKeyPair(ecdhKeyPair);
        ctrl.cryptoManager.setKeyPair(ecdhKeyPair);
        ecdsaKeyPair = await ctrl.keyStore.getECDSAKeyPair() || await ctrl.cryptoManager.generateSigningKeyPair();
        await ctrl.keyStore.storeECDSAKeyPair(ecdsaKeyPair);
        // Compute identityId from random key (legacy fallback)
        const idMgr = new _IdentityManager();
        const spkiBytes = await crypto.subtle.exportKey('spki', ecdhKeyPair.publicKey);
        const spkiBase64 = btoa(String.fromCharCode(...new Uint8Array(spkiBytes)));
        ctrl.myIdentityId = await idMgr.computeIdentityId(spkiBase64);
      }
    } else {
      // No seed phrase — use random keys (legacy behavior)
      ecdhKeyPair = await ctrl.keyStore.getECDHKeyPair() || await ctrl.cryptoManager.generateKeyPair();
      if (!(await ctrl.keyStore.getECDHKeyPair())) {
        await ctrl.keyStore.storeECDHKeyPair(ecdhKeyPair);
      }
      ctrl.cryptoManager.setKeyPair(ecdhKeyPair);
      ecdsaKeyPair = await ctrl.keyStore.getECDSAKeyPair() || await ctrl.cryptoManager.generateSigningKeyPair();
      if (!(await ctrl.keyStore.getECDSAKeyPair())) {
        await ctrl.keyStore.storeECDSAKeyPair(ecdsaKeyPair);
      }
      // Compute identityId from random key (legacy)
      const idMgr = new _IdentityManager();
      const spkiBytes = await crypto.subtle.exportKey('spki', ecdhKeyPair.publicKey);
      const spkiBase64 = btoa(String.fromCharCode(...new Uint8Array(spkiBytes)));
      ctrl.myIdentityId = await idMgr.computeIdentityId(spkiBase64);
    }

    ctrl.myPublicKey = await ctrl.cryptoManager.exportPublicKey(ecdhKeyPair.publicKey);

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

    // ── Svelte bridge: mount Svelte components alongside vanilla DOM ──
    // AppShell.svelte owns the main app layout; App.svelte hosts shared UI (toast, etc.)
    try {
      const { mount } = await import("svelte");
      const { default: App } = await import("./lib/components/shared/App.svelte");
      const { default: AppShell } = await import("./lib/components/AppShell.svelte");
      const { setBridgeController, setBridgeRenderer, syncFromVanilla } = await import("./lib/stores/bridge.svelte");
      setBridgeController(ctrl);
      setBridgeRenderer(ui);
      syncFromVanilla();

      // Mount AppShell into #app (replaces UIRenderer.renderApp() innerHTML)
      const appEl = document.getElementById('app')!;
      mount(AppShell, { target: appEl });

      // Mount shared UI (Toast, SvelteReady) in a separate root
      const svelteRoot = document.createElement("div");
      svelteRoot.id = "svelte-root";
      document.body.appendChild(svelteRoot);
      mount(App, { target: svelteRoot });
      console.log("[DecentChat] Svelte 5 bridge + AppShell initialized");
    } catch (err) {
      console.warn("[DecentChat] Svelte mount failed (non-fatal):", err);
    }

    const previousStoredPeerId = settings.myPeerId || null;
    if (settings.myPeerId !== myPeerId) {
      settings.myPeerId = myPeerId;
      await ctrl.persistentStore.saveSettings(settings);
    }

    // Initialize message protocol
    ctrl.messageProtocol = new (await import('./messages/MessageProtocol')).MessageProtocol(
      ctrl.cryptoManager,
      myPeerId,
    );

    // Wire Double Ratchet + pre-key persistence via PersistentStore
    ctrl.messageProtocol.setPersistence({
      save: (peerId, state) => ctrl.persistentStore.saveRatchetState(peerId, state),
      load: async (peerId) => ctrl.persistentStore.getRatchetState(peerId) ?? null,
      delete: (peerId) => ctrl.persistentStore.deleteRatchetState(peerId),
      savePreKeyBundle: (peerId, bundle) => ctrl.persistentStore.savePreKeyBundle(peerId, bundle),
      loadPreKeyBundle: async (peerId) => (await ctrl.persistentStore.getPreKeyBundle(peerId)) ?? null,
      deletePreKeyBundle: (peerId) => ctrl.persistentStore.deletePreKeyBundle(peerId),
      saveLocalPreKeyState: (ownerPeerId, state) => ctrl.persistentStore.saveLocalPreKeyState(ownerPeerId, state),
      loadLocalPreKeyState: async (ownerPeerId) => (await ctrl.persistentStore.getLocalPreKeyState(ownerPeerId)) ?? null,
      deleteLocalPreKeyState: (ownerPeerId) => ctrl.persistentStore.deleteLocalPreKeyState(ownerPeerId),
    });

    await ctrl.messageProtocol.init(ecdsaKeyPair);
    ctrl.setSigningKeyPair(ecdsaKeyPair);

    // Wire transport event handlers BEFORE restoring storage so onConnect/onDisconnect
    // fire correctly even if a connection completes during the restore phase.
    ctrl.setupTransportHandlers();

    // Restore persisted workspaces / messages
    await ctrl.restoreFromStorage();
    await ctrl.migrateLocalPeerId(previousStoredPeerId, myPeerId);

    // Restore contacts and direct conversations
    await ctrl.restoreContacts();

    // Register this peer in all known workspaces for signaling-server discovery
    ctrl.registerAllWorkspaces();

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
      void ctrl.onWorkspaceActivated(state.activeWorkspaceId);
      const ws = ctrl.workspaceManager.getWorkspace(state.activeWorkspaceId!)!;

      const restoredChannel = lastView?.channelId
        ? ws.channels.find((ch: any) => ch.id === lastView.channelId)
        : null;

      state.activeChannelId = restoredChannel?.id || ws.channels[0]?.id || null;

      // Load persisted messages for all workspace channels (survives page refresh)
      try {
        const channelIds = ws.channels.map((ch: any) => ch.id);
        for (const channelId of channelIds) {
          const persisted = await ctrl.persistentStore.getMessagesByChannel(channelId);
          if (persisted.length > 0) {
            // Use forceAdd to bypass hash chain validation (already validated on first receipt)
            for (const msg of persisted) {
              ctrl.messageStore.forceAdd(msg);
            }
            console.log(`[DecentChat] Restored ${persisted.length} messages for channel ${channelId.slice(0, 8)}`);
          }
        }
      } catch (err) {
        console.warn('[DecentChat] Failed to restore persisted messages:', err);
      }

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
    // Best-effort cleanup so destructive recovery (clear data) is less likely to hit blocked handles.
    try { ctrl.keyStore.close(); } catch {}
    try { await ctrl.persistentStore.close(); } catch {}
    renderStartupError(error);
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
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Initialization timed out while opening local storage. Close other DecentChat tabs/windows and retry.'));
    }, INIT_TIMEOUT);
  });

  try {
    await Promise.race([init(), timeoutPromise]);
  } catch (error) {
    console.error('[DecentChat] Init failed or timed out:', error);
    renderStartupError(error);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
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
