/**
 * UIRenderer — All HTML rendering and DOM manipulation for the P2P Chat app.
 *
 * Takes app state (by reference) and callbacks for actions that require
 * business logic (send, connect, create workspace, etc.).
 */

import type { WorkspaceManager, MessageStore } from 'decent-protocol';
import { EmojiPicker } from './EmojiPicker';
import { MessageSearch } from './MessageSearch';
import { SettingsPanel } from './SettingsPanel';
import { QRCodeManager } from './QRCodeManager';
import { QUICK_REACTIONS } from './ReactionManager';
import { ContactURI, InviteURI } from 'decent-protocol';
import type { PlaintextMessage, Contact, ContactURIData, DirectConversation } from 'decent-protocol';
import type { AppState } from '../main';

// ---------------------------------------------------------------------------
// Callback interfaces
// ---------------------------------------------------------------------------

export interface UICallbacks {
  /** Send a chat message (optionally in a thread) */
  sendMessage: (content: string, threadId?: string) => Promise<void>;
  /** Send a file attachment with optional text */
  sendAttachment: (file: File, text?: string) => Promise<void>;
  /** Initiate a WebRTC connection to a peer */
  connectPeer: (peerId: string) => void;
  /** Create a new workspace and return it */
  createWorkspace: (name: string, alias: string) => import('decent-protocol').Workspace;
  /** Initiate join flow (connect to a peer with invite code) */
  joinWorkspace: (code: string, alias: string, peerId: string, inviteData?: import('decent-protocol').InviteData) => void;
  /** Create a channel inside the active workspace */
  createChannel: (name: string) => { success: boolean; channel?: import('decent-protocol').Channel; error?: string };
  /** Open a DM channel */
  createDM: (peerId: string) => { success: boolean; channel?: import('decent-protocol').Channel };
  /** Persist workspace state */
  persistWorkspace: (wsId: string) => Promise<void>;
  /** Persist a key-value setting */
  persistSetting: (key: string, value: unknown) => Promise<void>;
  /** Get command autocomplete suggestions */
  getCommandSuggestions?: (prefix: string) => Array<{ name: string; description: string }>;
  /** Broadcast typing indicator */
  broadcastTyping?: () => void;
  /** Broadcast stop typing */
  broadcastStopTyping?: () => void;
  /** Toggle reaction on a message */
  toggleReaction?: (messageId: string, emoji: string) => void;
  /** Get settings for settings panel */
  getSettings?: () => Promise<any>;
  /** Generate full invite URL for a workspace */
  generateInviteURL?: (workspaceId: string) => string;
  /** Settings panel action (e.g. generateSeed) */
  onSettingsAction?: (action: string) => void | Promise<void>;
  /** Handle scanned QR contact — add to contacts and optionally connect */
  onQRContactScanned?: (data: ContactURIData) => void;
  /** Get user's public key for QR code generation */
  getMyPublicKey?: () => string;
  /** Add a contact */
  addContact?: (contact: Contact) => Promise<void>;
  /** Remove a contact */
  removeContact?: (peerId: string) => Promise<void>;
  /** Get all contacts */
  getContacts?: () => Promise<Contact[]>;
  /** Start a standalone DM with a contact */
  startDirectMessage?: (contactPeerId: string) => Promise<DirectConversation>;
  /** Get all standalone direct conversations */
  getDirectConversations?: () => Promise<DirectConversation[]>;
  /** Get all workspaces for the workspace switcher */
  getAllWorkspaces?: () => Array<import('decent-protocol').Workspace>;
  /** Set a per-workspace display name alias */
  setWorkspaceAlias?: (wsId: string, alias: string) => void;
  /** Get unread message count for a channel */
  getUnreadCount?: (channelId: string) => number;
  /** Notify the notification system which channel is currently active */
  setFocusedChannel?: (channelId: string | null) => void;
  /** Mark a channel as fully read */
  markChannelRead?: (channelId: string) => void;
  /** Resolve best display name for a peer — checks contacts, workspace members, fallback */
  getDisplayNameForPeer?: (peerId: string) => string;
  /** Get current seed phrase (for transfer QR) */
  getCurrentSeed?: () => Promise<string | null>;
  /** Validate a seed phrase — returns error string or null if valid */
  validateSeed?: (mnemonic: string) => string | null;
  /** Called when user restores identity from seed phrase */
  onSeedRestored?: (mnemonic: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// UIRenderer
// ---------------------------------------------------------------------------

export class UIRenderer {
  private emojiPicker = new EmojiPicker();
  private messageSearch: MessageSearch;
  private settingsPanel: SettingsPanel | null = null;
  private qrCodeManager: QRCodeManager;

  /** Cached contacts for synchronous sidebar rendering */
  private cachedContacts: Contact[] = [];
  /** Cached direct conversations for synchronous sidebar rendering */
  private cachedDirectConversations: DirectConversation[] = [];

  constructor(
    private state: AppState,
    private workspaceManager: WorkspaceManager,
    private messageStore: MessageStore,
    private callbacks: UICallbacks,
  ) {
    this.messageSearch = new MessageSearch(messageStore);
    this.qrCodeManager = new QRCodeManager({
      onContactScanned: (data) => this.callbacks.onQRContactScanned?.(data),
      onSeedRestored: (mnemonic) => this.callbacks.onSeedRestored?.(mnemonic),
      validateSeed: (mnemonic) => this.callbacks.validateSeed?.(mnemonic) ?? null,
      showToast: (msg, type) => this.showToast(msg, type),
    });
    this.refreshContactsCache();
  }

  private tracePrefix(): string {
    const alias = (this.state.myAlias || '').trim();
    if (/^alice$/i.test(alias)) return '[TRACE Alice]';
    if (/^bob$/i.test(alias)) return '[TRACE Bob]';
    return `[TRACE ${alias || this.state.myPeerId.slice(0, 8)}]`;
  }

  /** Refresh the cached contacts/conversations from the async stores */
  async refreshContactsCache(): Promise<void> {
    const [contacts, conversations] = await Promise.all([
      this.callbacks.getContacts?.() || Promise.resolve([]),
      this.callbacks.getDirectConversations?.() || Promise.resolve([]),
    ]);
    this.cachedContacts = contacts;
    this.cachedDirectConversations = conversations
      .slice()
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }

  // =========================================================================
  // Welcome screen
  // =========================================================================

  private hideLoading(): void {
    const loading = document.getElementById('loading');
    if (loading) {
      loading.style.opacity = '0';
      setTimeout(() => loading.remove(), 300);
    }
  }

  renderWelcome(): void {
    this.hideLoading();
    const app = document.getElementById('app')!;
    app.innerHTML = `
      <div class="landing-page">

        <!-- ── Sticky Nav ── -->
        <nav class="landing-nav">
          <div class="landing-nav-inner">
            <div class="landing-nav-brand">
              <img src="/icons/logo-v2-light.png" alt="Deci" class="landing-nav-logo" />
              <span class="landing-nav-name">DecentChat</span>
            </div>
            <div class="landing-nav-actions">
              <button class="btn-secondary btn-sm" id="join-ws-btn-nav">Join workspace</button>
              <button class="btn-primary btn-sm" id="create-ws-btn-nav">Launch App →</button>
            </div>
          </div>
        </nav>

        <!-- ── Hero ── -->
        <section class="lp-hero">
          <div class="lp-hero-inner">
            <div class="lp-hero-badge">🔒 100% private · No servers · No accounts</div>
            <h1 class="lp-hero-title">Chat that belongs<br>to <em>you</em>.</h1>
            <p class="lp-hero-sub">
              WhatsApp stores your data. Telegram stores your data. Slack stores your data.
              <strong>DecentChat stores nothing.</strong> Messages go directly between people — encrypted, peer-to-peer, serverless.
            </p>
            <div class="lp-hero-actions">
              <button class="btn-primary btn-lg" id="create-ws-btn">Start Chatting Free →</button>
              <button class="btn-secondary btn-lg" id="join-ws-btn">Join with Invite Code</button>
            </div>
            <p class="lp-hero-note">No signup · No phone number · Works in your browser</p>
          </div>
          <div class="lp-hero-mascot">
            <img src="/icons/logo-v2-light.png" alt="Deci the DecentChat mascot" class="hero-deci" />
          </div>
        </section>

        <!-- ── Problem banner ── -->
        <section class="lp-problem">
          <div class="lp-container">
            <div class="lp-problem-grid">
              <div class="lp-problem-item">
                <span class="lp-problem-icon">📡</span>
                <strong>WhatsApp</strong> — owned by Meta, messages on their servers
              </div>
              <div class="lp-problem-item">
                <span class="lp-problem-icon">🕵️</span>
                <strong>Telegram</strong> — not E2E by default, cloud stored
              </div>
              <div class="lp-problem-item">
                <span class="lp-problem-item-highlight">✅</span>
                <strong>DecentChat</strong> — zero servers, zero data collected
              </div>
            </div>
          </div>
        </section>

        <!-- ── How it works ── -->
        <section class="lp-how">
          <div class="lp-container">
            <h2 class="lp-section-title">How it works</h2>
            <p class="lp-section-sub">Three steps. No servers involved.</p>
            <div class="lp-steps">
              <div class="lp-step">
                <div class="lp-step-num">1</div>
                <div class="lp-step-content">
                  <h3>Generate your identity</h3>
                  <p>A 12-word seed phrase is created right in your browser. Like a crypto wallet — no email, no phone, no verification. You own it forever.</p>
                </div>
              </div>
              <div class="lp-step-arrow">→</div>
              <div class="lp-step">
                <div class="lp-step-num">2</div>
                <div class="lp-step-content">
                  <h3>Create or join a workspace</h3>
                  <p>Create a workspace and share an invite link. Your contacts connect directly to your device via WebRTC. No server reads your messages.</p>
                </div>
              </div>
              <div class="lp-step-arrow">→</div>
              <div class="lp-step">
                <div class="lp-step-num">3</div>
                <div class="lp-step-content">
                  <h3>Chat with total privacy</h3>
                  <p>Messages are encrypted before leaving your device using Signal's Double Ratchet. Even the signaling server — the only server that exists — never sees your content.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ── Features ── -->
        <section class="lp-features">
          <div class="lp-container">
            <h2 class="lp-section-title">Everything you need.<br>Nothing you don't.</h2>
            <div class="lp-features-grid">
              <div class="lp-feature-card">
                <div class="lp-feature-icon">🔒</div>
                <h3>Double Ratchet E2E</h3>
                <p>Same encryption protocol as Signal. Keys rotate with every single message — past messages stay private forever, even if keys are compromised.</p>
              </div>
              <div class="lp-feature-card">
                <div class="lp-feature-icon">🌐</div>
                <h3>True P2P — No Server</h3>
                <p>WebRTC peer-to-peer data channels. A tiny signaling server helps peers find each other, then disappears. Like BitTorrent, but for private chat.</p>
              </div>
              <div class="lp-feature-card">
                <div class="lp-feature-icon">🔑</div>
                <h3>Seed Phrase Identity</h3>
                <p>12 words = your permanent identity. Works on any device. Back it up on paper. No company, no cloud, no way to lock you out of your own account.</p>
              </div>
              <div class="lp-feature-card">
                <div class="lp-feature-icon">💬</div>
                <h3>Full-Featured Chat</h3>
                <p>Workspaces, channels, DMs, threads, reactions, file sharing, search, slash commands — everything Slack has, with none of the surveillance.</p>
              </div>
              <div class="lp-feature-card">
                <div class="lp-feature-icon">📱</div>
                <h3>Install Anywhere</h3>
                <p>Progressive Web App — install from any browser on any device. iOS, Android, desktop. No app store, no permissions you didn't ask for.</p>
              </div>
              <div class="lp-feature-card">
                <div class="lp-feature-icon">⚡</div>
                <h3>Offline-First Sync</h3>
                <p>Messages queue when offline and sync when peers reconnect using CRDTs and Negentropy set reconciliation. No message ever gets lost.</p>
              </div>
            </div>
          </div>
        </section>

        <!-- ── Comparison ── -->
        <section class="lp-compare">
          <div class="lp-container">
            <h2 class="lp-section-title">The honest comparison</h2>
            <div class="lp-compare-table">
              <div class="lp-compare-header">
                <span>Feature</span>
                <span>WhatsApp / Telegram</span>
                <span class="lp-compare-us">DecentChat 🐙</span>
              </div>
              <div class="lp-compare-row">
                <span>Messages stored on servers</span>
                <span class="bad">✓ Yes</span>
                <span class="good">✗ Never</span>
              </div>
              <div class="lp-compare-row">
                <span>Requires phone / email</span>
                <span class="bad">✓ Required</span>
                <span class="good">✗ None needed</span>
              </div>
              <div class="lp-compare-row">
                <span>End-to-end encrypted by default</span>
                <span class="mid">⚠️ Partial</span>
                <span class="good">✓ Always</span>
              </div>
              <div class="lp-compare-row">
                <span>Can be legally subpoenaed</span>
                <span class="bad">✓ Yes</span>
                <span class="good">Nothing to hand over</span>
              </div>
              <div class="lp-compare-row">
                <span>Survives company going bust</span>
                <span class="bad">✗ App dies too</span>
                <span class="good">✓ Protocol lives forever</span>
              </div>
              <div class="lp-compare-row">
                <span>Forward secrecy</span>
                <span class="mid">⚠️ Sometimes</span>
                <span class="good">✓ Every message</span>
              </div>
            </div>
          </div>
        </section>

        <!-- ── Tech stack ── -->
        <section class="lp-tech">
          <div class="lp-container">
            <h2 class="lp-section-title">Built on proven technology</h2>
            <div class="lp-tech-pills">
              <span class="lp-tech-pill">Signal's Double Ratchet</span>
              <span class="lp-tech-pill">WebRTC P2P</span>
              <span class="lp-tech-pill">BIP39 Seed Phrases</span>
              <span class="lp-tech-pill">AES-GCM-256</span>
              <span class="lp-tech-pill">ECDH P-256</span>
              <span class="lp-tech-pill">CRDTs + Vector Clocks</span>
              <span class="lp-tech-pill">Negentropy Set Sync</span>
              <span class="lp-tech-pill">IndexedDB Persistence</span>
              <span class="lp-tech-pill">Service Worker PWA</span>
            </div>
          </div>
        </section>

        <!-- ── Final CTA ── -->
        <section class="lp-final-cta">
          <div class="lp-container">
            <img src="/icons/logo-v2-light.png" alt="Deci" class="lp-cta-mascot" />
            <h2>Your conversations.<br>Your keys. Your rules.</h2>
            <p>Start in 10 seconds. No signup. No credit card. No catch.</p>
            <div class="lp-hero-actions" style="justify-content:center; margin-top: 24px;">
              <button class="btn-primary btn-lg" id="create-ws-btn-2">Start Chatting Free →</button>
              <button class="btn-secondary btn-lg" id="join-ws-btn-2">Join with Invite Code</button>
            </div>
            <p class="lp-restore-hint">
              Already have an account?
              <button class="restore-link-btn" id="restore-identity-btn">Restore from seed phrase →</button>
            </p>
          </div>
        </section>

        <!-- ── Footer ── -->
        <footer class="lp-footer">
          <div class="lp-container">
            <div class="lp-footer-inner">
              <div class="lp-footer-brand">
                <img src="/icons/logo-v2-light.png" alt="Deci" style="width:24px;height:24px;margin-right:8px;" />
                <strong>DecentChat</strong>
              </div>
              <p class="lp-footer-note">Open protocol · No tracking · No ads · Built with ❤️ and WebRTC</p>
              <p class="lp-footer-peer">Your anonymous ID: <code id="welcome-peer-id" title="Click to copy">${this.state.myPeerId.slice(0, 20)}…</code></p>
            </div>
          </div>
        </footer>

      </div>
    `;

    document.getElementById('create-ws-btn')!.addEventListener('click', () => this.showCreateWorkspaceModal());
    document.getElementById('create-ws-btn-2')!.addEventListener('click', () => this.showCreateWorkspaceModal());
    document.getElementById('create-ws-btn-nav')!.addEventListener('click', () => this.showCreateWorkspaceModal());
    document.getElementById('join-ws-btn')!.addEventListener('click', () => this.showJoinWorkspaceModal());
    document.getElementById('join-ws-btn-2')!.addEventListener('click', () => this.showJoinWorkspaceModal());
    document.getElementById('join-ws-btn-nav')!.addEventListener('click', () => this.showJoinWorkspaceModal());
    document.getElementById('welcome-peer-id')!.addEventListener('click', () => {
      navigator.clipboard.writeText(this.state.myPeerId);
      this.showToast('Peer ID copied!');
    });
    document.getElementById('restore-identity-btn')!.addEventListener('click', () => {
      this.qrCodeManager.showRestoreSeed();
    });
  }

  // =========================================================================
  // Main app layout
  // =========================================================================

  renderApp(): void {
    this.hideLoading();
    const app = document.getElementById('app')!;
    app.innerHTML = `
      <div class="app-layout">
        <div class="workspace-rail" id="workspace-rail">
          ${this.renderWorkspaceRailHTML()}
        </div>
        <div class="sidebar" id="sidebar">
          ${this.renderSidebarHTML()}
        </div>
        <div class="main-content">
          ${this.renderChannelHeaderHTML()}
          <div class="messages-area">
            <div class="messages-pane">
              <div class="messages-list" id="messages-list"></div>
              <div class="typing-indicator" id="typing-indicator"></div>
              <div class="compose-box">
                <div class="compose-inner">
                  <input type="file" id="file-input" style="display:none" multiple />
                  <button class="compose-attach" id="attach-btn" title="Attach file">📎</button>
                  <textarea class="compose-input" id="compose-input" placeholder="${this.getComposePlaceholder()}" rows="1"></textarea>
                  <button class="compose-emoji" id="emoji-btn" title="Emoji">😊</button>
                  <button class="compose-send" id="send-btn" title="Send">⬆</button>
                </div>
              </div>
            </div>
            <div class="thread-panel hidden" id="thread-panel">
              <div class="thread-resize-handle" id="thread-resize-handle" title="Drag to resize"></div>
              <div class="thread-header">
                <div class="thread-header-info">
                  <h3>💬 Thread</h3>
                  <div class="thread-header-preview" style="font-size:12px; opacity:0.6; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"></div>
                </div>
                <button class="thread-close icon-btn" id="thread-close">✕</button>
              </div>
              <div class="thread-messages" id="thread-messages"></div>
              <div class="thread-compose">
                <div class="compose-inner">
                  <textarea class="compose-input" id="thread-input" placeholder="Reply in thread…" rows="1"></textarea>
                  <button class="compose-send" id="thread-send-btn">⬆</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindAppEvents();
    this.renderMessages();
  }

  // =========================================================================
  // Workspace rail (left icon strip like Discord/Slack)
  // =========================================================================

  renderWorkspaceRailHTML(): string {
    const allWorkspaces = this.callbacks.getAllWorkspaces?.() || [];
    const isInDMs = this.state.activeWorkspaceId === null;

    const dmIcon = `
      <div class="ws-rail-icon ${isInDMs ? 'active' : ''}" id="ws-rail-dms" title="Direct Messages">
        DM
      </div>
      <div class="ws-rail-divider"></div>
    `;

    const wsIcons = allWorkspaces.map(ws => {
      const isActive = ws.id === this.state.activeWorkspaceId && !isInDMs;
      const initial = ws.name.slice(0, 2).toUpperCase();
      return `
        <div class="ws-rail-icon ${isActive ? 'active' : ''}" data-ws-id="${ws.id}" title="${this.escapeHtml(ws.name)}">
          ${this.escapeHtml(initial)}
        </div>`;
    }).join('');

    return `
      ${dmIcon}
      ${wsIcons}
      <div class="ws-rail-icon ws-rail-add" id="ws-rail-add" title="Create or join workspace">
        +
      </div>
    `;
  }

  private bindWorkspaceRailEvents(): void {
    document.getElementById('ws-rail-dms')?.addEventListener('click', () => {
      this.state.activeWorkspaceId = null;
      if (!this.state.activeDirectConversationId) {
        this.state.activeChannelId = null;
      }
      this.refreshContactsCache().catch(() => {});
      this.updateSidebar();
      this.updateWorkspaceRail();
      this.updateChannelHeader();
      this.renderMessages();
    });

    document.querySelectorAll('.ws-rail-icon[data-ws-id]').forEach(el => {
      el.addEventListener('click', () => {
        const wsId = (el as HTMLElement).dataset.wsId!;
        this.switchWorkspace(wsId);
      });
    });

    document.getElementById('ws-rail-add')?.addEventListener('click', () => {
      this.showCreateWorkspaceModal();
    });
  }

  switchWorkspace(workspaceId: string): void {
    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (!ws) return;

    this.state.activeWorkspaceId = workspaceId;
    this.state.activeDirectConversationId = null;
    this.state.activeChannelId = ws.channels[0]?.id || null;
    this.closeThread();
    this.refreshContactsCache();
    this.updateSidebar();
    this.updateWorkspaceRail();
    this.updateChannelHeader();
    this.renderMessages();
    this.updateComposePlaceholder();
  }

  updateWorkspaceRail(): void {
    const rail = document.getElementById('workspace-rail');
    if (!rail) return;
    rail.innerHTML = this.renderWorkspaceRailHTML();
    this.bindWorkspaceRailEvents();
  }

  // =========================================================================
  // Sidebar & channel header HTML generators
  // =========================================================================

  renderSidebarHTML(): string {
    const isDMView = this.state.activeWorkspaceId === null;
    const ws = this.state.activeWorkspaceId
      ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)
      : null;
    const channels = ws ? this.workspaceManager.getChannels(ws.id) : [];
    const dms = ws ? this.workspaceManager.getDMs(ws.id, this.state.myPeerId) : [];

    // Build contacts section
    const contactsHTML = this.cachedContacts.map(c => {
      const isOnline = this.state.readyPeers.has(c.peerId);
      return `
        <div class="sidebar-item contact-card" data-contact-peer-id="${c.peerId}" data-testid="contact-card" title="${this.escapeHtml(c.peerId)}">
          <span class="dm-status ${isOnline ? 'online' : ''}"></span>
          <span>${this.escapeHtml(c.displayName)}</span>
        </div>`;
    }).join('');

    // Build standalone direct messages section
    const sortedDirectConversations = this.cachedDirectConversations
      .slice()
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    const directDMsHTML = sortedDirectConversations.map(conv => {
      const name = this.getPeerAlias(conv.contactPeerId);
      const isOnline = this.state.readyPeers.has(conv.contactPeerId);
      const isActive = this.state.activeDirectConversationId === conv.id;
      const unreadDM = this.callbacks.getUnreadCount?.(conv.id) || 0;
      const meta = conv.lastMessageAt
        ? new Date(conv.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'No messages';
      return `
        <div class="sidebar-item ${isActive ? 'active' : ''} ${unreadDM > 0 ? 'has-unread' : ''}" data-direct-conv-id="${conv.id}" data-testid="direct-conversation-item">
          <span class="dm-status ${isOnline ? 'online' : ''}"></span>
          <span>${this.escapeHtml(name)}</span>
          ${unreadDM > 0
            ? `<span class="unread-badge">${unreadDM > 99 ? '99+' : unreadDM}</span>`
            : `<span class="sidebar-item-meta">${this.escapeHtml(meta)}</span>`
          }
        </div>`;
    }).join('');

    return `
      <div class="sidebar-header">
        <img src="/icons/icon-32.png" alt="" class="sidebar-logo" />
        <h1>${ws ? this.escapeHtml(ws.name) : 'Direct Messages'}</h1>
        <span class="status-dot"></span>
      </div>
      <div class="sidebar-tabs">
        <button id="nav-workspaces-btn" class="${!isDMView ? 'active' : ''}" data-testid="workspaces-tab">Workspaces</button>
        <button id="nav-dms-btn" class="${isDMView ? 'active' : ''}" data-testid="dms-tab">DMs</button>
      </div>
      <div class="sidebar-nav" id="sidebar-nav">
        <div class="sidebar-section">
          <div class="sidebar-section-header">
            Contacts
            <button class="add-btn" id="add-contact-btn" title="Add contact">+</button>
          </div>
          ${contactsHTML || '<div class="sidebar-item" style="font-size:12px; opacity:0.5;">No contacts yet</div>'}
        </div>
        <div class="sidebar-section">
          <div class="sidebar-section-header">
            Direct Messages
            <button class="add-btn" id="start-dm-btn" title="Start DM">+</button>
          </div>
          <div id="direct-conversation-list" data-testid="direct-conversation-list">
            ${directDMsHTML || '<div class="sidebar-item" style="font-size:12px; opacity:0.5;">No direct messages yet</div>'}
          </div>
          ${!isDMView ? dms.map(dm => {
            const otherPeerId = dm.members.find((m: string) => m !== this.state.myPeerId) || '???';
            const isOnline = this.state.readyPeers.has(otherPeerId);
            const unreadWsDM = this.callbacks.getUnreadCount?.(dm.id) || 0;
            const isActiveDM = dm.id === this.state.activeChannelId && !this.state.activeDirectConversationId;
            return `
              <div class="sidebar-item ${isActiveDM ? 'active' : ''} ${unreadWsDM > 0 ? 'has-unread' : ''}" data-channel-id="${dm.id}">
                <span class="dm-status ${isOnline ? 'online' : ''}"></span>
                <span>${this.escapeHtml(this.getPeerAlias(otherPeerId))}</span>
                ${unreadWsDM > 0 ? `<span class="unread-badge">${unreadWsDM > 99 ? '99+' : unreadWsDM}</span>` : ''}
              </div>
            `;
          }).join('') : ''}
        </div>
        ${ws && !isDMView ? `
        <div class="sidebar-section">
          <div class="sidebar-section-header">
            Channels
            <button class="add-btn" id="add-channel-btn" title="Create channel">+</button>
          </div>
          ${channels.map(ch => {
            const unreadCh = this.callbacks.getUnreadCount?.(ch.id) || 0;
            const isActiveCh = ch.id === this.state.activeChannelId && !this.state.activeDirectConversationId;
            return `
            <div class="sidebar-item ${isActiveCh ? 'active' : ''} ${unreadCh > 0 ? 'has-unread' : ''}" data-channel-id="${ch.id}">
              <span class="channel-hash">#</span>
              <span>${this.escapeHtml(ch.name)}</span>
              ${unreadCh > 0 ? `<span class="unread-badge">${unreadCh > 99 ? '99+' : unreadCh}</span>` : ''}
            </div>`;
          }).join('')}
        </div>
        <div class="sidebar-section" data-testid="ws-direct-messages-section">
          <div class="sidebar-section-header">
            Direct Messages
            <button class="add-btn" id="start-ws-dm-btn" title="Start DM">+</button>
          </div>
          ${this.cachedDirectConversations.length > 0
            ? this.cachedDirectConversations.map(conv => {
                const dmName = this.getPeerAlias(conv.contactPeerId);
                const isOnlineDM = this.state.readyPeers.has(conv.contactPeerId);
                const isActiveDMConv = this.state.activeDirectConversationId === conv.id;
                const unreadDMConv = this.callbacks.getUnreadCount?.(conv.id) || 0;
                return `
                <div class="sidebar-item ${isActiveDMConv ? 'active' : ''} ${unreadDMConv > 0 ? 'has-unread' : ''}" data-direct-conv-id="${conv.id}" data-testid="ws-direct-conversation-item">
                  <span class="dm-status ${isOnlineDM ? 'online' : ''}"></span>
                  <span>${this.escapeHtml(dmName)}</span>
                  ${unreadDMConv > 0 ? `<span class="unread-badge">${unreadDMConv > 99 ? '99+' : unreadDMConv}</span>` : ''}
                </div>`;
              }).join('')
            : '<div class="sidebar-item" style="font-size:12px; opacity:0.5;">No direct messages yet</div>'
          }
        </div>
        ` : ''}
        <div class="sidebar-section">
          <div class="sidebar-section-header">Members</div>
          <div class="sidebar-item" id="connect-peer-btn" style="color: var(--sidebar-text); opacity: 0.8;">
            + Connect to peer...
          </div>
          ${(ws ? ws.members : []).filter((m: any) => m.peerId !== this.state.myPeerId).map((m: any) => {
            const isOnline = this.state.readyPeers.has(m.peerId);
            const name = this.getPeerAlias(m.peerId);
            return `
              <div class="sidebar-item member-row" data-member-peer-id="${m.peerId}">
                <span class="dm-status ${isOnline ? 'online' : ''}"></span>
                <span class="member-name">${this.escapeHtml(name)}</span>
                <button class="member-dm-btn" data-peer-id="${m.peerId}" title="Send direct message">✉</button>
              </div>
            `;
          }).join('')}
          ${Array.from(this.state.connectedPeers)
            .filter(peerId => !ws?.members.some((m: any) => m.peerId === peerId))
            .map(peerId => `
              <div class="sidebar-item" style="font-size:13px;">
                <span class="dm-status ${this.state.readyPeers.has(peerId) ? 'online' : ''}"></span>
                ${this.escapeHtml(this.getPeerAlias(peerId))}
              </div>
            `).join('')}
        </div>
      </div>
      ${ws ? `
        <div class="invite-banner" id="copy-invite" title="Click to copy invite link">
          Copy invite link
        </div>
      ` : ''}
      <div class="invite-banner" id="sidebar-qr-btn" title="Show or scan QR code" style="background: rgba(9, 132, 227, 0.12);">
        📱 QR Code
      </div>
      <div class="sidebar-footer">
        <span class="dm-status online"></span>
        <code id="copy-peer-id" title="Click to copy Peer ID">${this.state.myPeerId.slice(0, 20)}...</code>
      </div>
    `;
  }

  renderChannelHeaderHTML(): string {
    // Check if we're in a standalone direct conversation
    if (this.state.activeDirectConversationId) {
      const conv = this.cachedDirectConversations.find(c => c.id === this.state.activeDirectConversationId);
      const name = conv ? this.getPeerAlias(conv.contactPeerId) : 'Direct Message';

      return `
        <div class="channel-header">
          <div class="channel-header-left">
            <button class="icon-btn hamburger" id="hamburger-btn">☰</button>
            <h2>${this.escapeHtml(name)}</h2>
          </div>
          <div class="channel-header-right">
            <button class="icon-btn" id="search-btn" title="Search messages (Ctrl+F)">🔍</button>
            <button class="icon-btn" id="settings-btn" title="Settings">⚙️</button>
          </div>
        </div>
      `;
    }

    const ws = this.state.activeWorkspaceId
      ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)
      : null;
    const channel =
      this.state.activeChannelId && ws
        ? this.workspaceManager.getChannel(ws.id, this.state.activeChannelId)
        : null;

    const name = channel
      ? channel.type === 'dm'
        ? channel.name
        : `# ${channel.name}`
      : 'Select a channel';
    const memberCount = channel ? channel.members.length : 0;

    return `
      <div class="channel-header">
        <div class="channel-header-left">
          <button class="icon-btn hamburger" id="hamburger-btn">☰</button>
          <h2>${this.escapeHtml(name)}</h2>
          ${memberCount > 0 ? `<span class="member-count">👥 ${memberCount}</span>` : ''}
        </div>
        <div class="channel-header-right">
          <button class="icon-btn" id="qr-btn" title="QR Code">📱</button>
          <button class="icon-btn" id="search-btn" title="Search messages (Ctrl+F)">🔍</button>
          <button class="icon-btn" id="invite-btn" title="Invite code">🔗</button>
          <button class="icon-btn" id="settings-btn" title="Settings">⚙️</button>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // Messages
  // =========================================================================

  renderMessages(): void {
    const list = document.getElementById('messages-list')!;
    list.innerHTML = '';

    if (!this.state.activeChannelId) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="emoji">💬</div>
          <h3>No channel selected</h3>
          <p>Pick a channel from the sidebar</p>
        </div>`;
      return;
    }

    const messages = this.messageStore.getMessages(this.state.activeChannelId);

    if (messages.length === 0) {
      let channelName = 'the channel';
      if (this.state.activeDirectConversationId) {
        const conv = this.cachedDirectConversations.find(c => c.id === this.state.activeDirectConversationId);
        channelName = conv ? this.getPeerAlias(conv.contactPeerId) : 'this conversation';
      } else {
        const ws = this.state.activeWorkspaceId
          ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)
          : null;
        const channel = ws
          ? this.workspaceManager.getChannel(ws.id, this.state.activeChannelId!)
          : null;
        channelName = channel ? (channel.type === 'dm' ? channel.name : '#' + channel.name) : 'the channel';
      }
      list.innerHTML = `
        <div class="empty-state">
          <div class="emoji">✨</div>
          <h3>Welcome to ${channelName}!</h3>
          <p>This is the very beginning of the conversation.<br>Messages are end-to-end encrypted and stored locally.</p>
          <p style="margin-top:8px; font-size:12px; color:var(--text-light)">Type <code>/help</code> for commands · <code>Ctrl+K</code> for quick commands</p>
        </div>`;
      return;
    }

    const mainMessages = messages.filter((m: PlaintextMessage) => !m.threadId);
    for (const msg of mainMessages) {
      this.appendMessageToDOM(msg);
    }
  }

  appendMessageToDOM(msg: PlaintextMessage, container?: HTMLElement): void {
    console.log(this.tracePrefix(), 'appendMessageToDOM', {
      id: msg.id,
      content: msg.content,
      channelId: msg.channelId,
    });
    const list = container || document.getElementById('messages-list');
    if (!list) {
      console.error('[DecentChat] messages-list element not found! Cannot render message:', msg.id);
      return;
    }

    const emptyState = list.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const isMine = msg.senderId === this.state.myPeerId;
    const myDisplayName = (this.state.activeWorkspaceId && this.state.workspaceAliases?.[this.state.activeWorkspaceId])
      || this.state.myAlias
      || 'You';
    const senderName = isMine ? myDisplayName : this.getPeerAlias(msg.senderId);
    const initial = senderName.slice(0, 2).toUpperCase();
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const prevMsg = list.lastElementChild as HTMLElement | null;
    const prevSender = prevMsg?.dataset?.senderId;
    const prevTime = parseInt(prevMsg?.dataset?.timestamp || '0');
    const isGrouped =
      prevSender === msg.senderId &&
      msg.timestamp - prevTime < 300000 &&
      msg.type !== 'system';

    const threadReplies = this.state.activeChannelId
      ? this.messageStore.getThread(this.state.activeChannelId, msg.id)
      : [];

    const div = document.createElement('div');
    div.className = `message ${msg.type === 'system' ? 'system' : ''} ${isGrouped ? 'grouped' : ''}`;
    div.dataset.messageId = msg.id;
    div.dataset.senderId = msg.senderId;
    div.dataset.timestamp = String(msg.timestamp);

    if (msg.type === 'system') {
      div.innerHTML = `<div class="message-content">${this.escapeHtml(msg.content)}</div>`;
    } else {
      div.innerHTML = `
        <div class="message-avatar" style="background: ${this.peerColor(msg.senderId)}">${this.escapeHtml(initial)}</div>
        <div class="message-body">
          <div class="message-header">
            <span class="message-sender">${this.escapeHtml(senderName)}</span>
            <span class="message-time">${time}</span>
          </div>
          <div class="message-content">${this.escapeHtml(msg.content)}</div>
          ${this.renderAttachments((msg as any).attachments)}
          <div class="message-thread-indicator${threadReplies.length > 0 ? ' has-replies' : ''}" data-thread-id="${msg.id}">
            ${threadReplies.length > 0 ? this.renderThreadIndicatorContent(threadReplies) : ''}
          </div>
          <div class="message-reactions" id="reactions-${msg.id}"></div>
          <div class="message-actions-bar">
            ${QUICK_REACTIONS.slice(0, 4).map(e => `<button class="quick-react" data-msg-id="${msg.id}" data-emoji="${e}">${e}</button>`).join('')}
            <button class="message-thread-btn" data-thread-id="${msg.id}" title="Reply in thread">💬</button>
          </div>
        </div>
      `;

      div.querySelector('.message-thread-btn')?.addEventListener('click', () =>
        this.openThread(msg.id),
      );
      div.querySelector('.message-thread-indicator')?.addEventListener('click', () =>
        this.openThread(msg.id),
      );
      div.querySelectorAll('.quick-react').forEach(btn => {
        btn.addEventListener('click', () => {
          const msgId = (btn as HTMLElement).dataset.msgId!;
          const emoji = (btn as HTMLElement).dataset.emoji!;
          this.callbacks.toggleReaction?.(msgId, emoji);
        });
      });
    }

    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
  }

  renderThreadMessages(): void {
    const container = document.getElementById('thread-messages')!;
    container.innerHTML = '';

    if (!this.state.activeChannelId || !this.state.activeThreadId) return;

    const allMsgs = this.messageStore.getMessages(this.state.activeChannelId);
    const parent = allMsgs.find((m: PlaintextMessage) => m.id === this.state.activeThreadId);
    if (parent) this.appendMessageToDOM(parent, container);

    const replies = this.messageStore.getThread(
      this.state.activeChannelId,
      this.state.activeThreadId,
    );
    for (const reply of replies) this.appendMessageToDOM(reply, container);
  }

  // =========================================================================
  // Thread open/close
  // =========================================================================

  openThread(messageId: string): void {
    this.state.activeThreadId = messageId;
    this.state.threadOpen = true;
    const panel = document.getElementById('thread-panel')!;
    panel.classList.remove('hidden');
    panel.classList.add('open'); // needed for mobile slide-in

    // Update thread header with parent message preview
    const parentEl = panel.querySelector('.thread-header h3');
    if (parentEl && this.state.activeChannelId) {
      const parent = this.messageStore.getMessages(this.state.activeChannelId)
        .find((m: PlaintextMessage) => m.id === messageId);
      if (parent) {
        const preview = parent.content.length > 60
          ? parent.content.slice(0, 60) + '…'
          : parent.content;
        parentEl.textContent = `💬 Thread`;
        const sub = panel.querySelector('.thread-header-preview') as HTMLElement | null;
        if (sub) {
          sub.textContent = preview;
        }
      }
    }

    this.renderThreadMessages();

    // Focus the thread input
    setTimeout(() => {
      (document.getElementById('thread-input') as HTMLTextAreaElement)?.focus();
    }, 100);
  }

  closeThread(): void {
    this.state.activeThreadId = null;
    this.state.threadOpen = false;
    const panel = document.getElementById('thread-panel');
    panel?.classList.add('hidden');
    panel?.classList.remove('open'); // remove mobile slide-in class
  }

  /** Wire up the left-edge drag handle for resizing the thread panel (Slack-style). */
  private setupThreadResize(): void {
    const handle = document.getElementById('thread-resize-handle');
    const panel  = document.getElementById('thread-panel');
    if (!handle || !panel) return;

    // Restore saved width
    const saved = localStorage.getItem('decentchat:threadWidth');
    if (saved) panel.style.width = saved;

    let startX = 0;
    let startWidth = 0;

    const onMove = (e: MouseEvent) => {
      const delta = startX - e.clientX; // dragging left = wider
      const newWidth = Math.min(Math.max(startWidth + delta, 280), window.innerWidth * 0.6);
      panel.style.width = `${newWidth}px`;
    };

    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('decentchat:threadWidth', panel.style.width);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = panel.offsetWidth;
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // =========================================================================
  // Mobile sidebar helpers
  // =========================================================================

  openMobileSidebar(): void {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    sidebar.classList.add('open');

    // Inject backdrop overlay — tapping it closes the sidebar
    const existing = document.getElementById('mobile-sidebar-overlay');
    if (existing) return; // Already open

    const overlay = document.createElement('div');
    overlay.id = 'mobile-sidebar-overlay';
    overlay.className = 'mobile-overlay';
    overlay.addEventListener('click', () => this.closeMobileSidebar());
    // Also close on touch start for faster response on mobile
    overlay.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.closeMobileSidebar();
    }, { passive: false });
    document.body.appendChild(overlay);
  }

  closeMobileSidebar(): void {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('mobile-sidebar-overlay')?.remove();
  }

  /**
   * Update the thread reply indicator on the parent message in the main list.
   * Called when a new thread reply arrives from a peer.
   */
  updateThreadIndicator(parentMessageId: string, channelId: string): void {
    const parentDiv = document.querySelector(`[data-message-id="${parentMessageId}"]`);
    if (!parentDiv) return;

    const replies = this.messageStore.getThread(channelId, parentMessageId);
    const indicator = parentDiv.querySelector('.message-thread-indicator') as HTMLElement | null;

    if (indicator) {
      if (replies.length > 0) {
        indicator.classList.add('has-replies');
        indicator.innerHTML = this.renderThreadIndicatorContent(replies);
      } else {
        indicator.classList.remove('has-replies');
        indicator.innerHTML = '';
      }
    }
  }

  /**
   * Render the Slack-style thread indicator content (avatars + reply count + last reply time).
   */
  private renderThreadIndicatorContent(replies: import('decent-protocol').PlaintextMessage[]): string {
    const count = replies.length;
    if (count === 0) return '';

    // Unique senders (up to 4 avatars)
    const seen = new Set<string>();
    const uniqueSenders: string[] = [];
    for (const r of replies) {
      if (!seen.has(r.senderId)) {
        seen.add(r.senderId);
        uniqueSenders.push(r.senderId);
        if (uniqueSenders.length >= 4) break;
      }
    }

    const avatarsHTML = uniqueSenders.map(peerId => {
      const name = this.getPeerAlias(peerId);
      const initials = name.slice(0, 2).toUpperCase();
      const color = this.peerColor(peerId);
      return `<span class="thread-indicator-avatar" style="background:${color}" title="${this.escapeHtml(name)}">${this.escapeHtml(initials)}</span>`;
    }).join('');

    // Last reply relative time
    const lastReply = replies[replies.length - 1];
    const relTime = this.relativeTime(lastReply.timestamp);

    return `
      <span class="thread-indicator-avatars">${avatarsHTML}</span>
      <span class="thread-indicator-count">${count} ${count === 1 ? 'reply' : 'replies'}</span>
      <span class="thread-indicator-time">${relTime}</span>
    `;
  }

  /** Format a timestamp as a short relative time string */
  private relativeTime(ts: number): string {
    const diffMs = Date.now() - ts;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return `${Math.floor(diffH / 24)}d ago`;
  }

  // =========================================================================
  // Channel switching
  // =========================================================================

  switchChannel(channelId: string): void {
    this.state.activeChannelId = channelId;
    this.state.activeDirectConversationId = null;
    this.callbacks.setFocusedChannel?.(channelId);
    this.callbacks.markChannelRead?.(channelId);
    this.closeThread();
    this.updateSidebar();
    this.updateChannelHeader();
    this.renderMessages();
    this.updateComposePlaceholder();
    this.closeMobileSidebar();
  }

  /** Switch to a standalone direct conversation */
  switchToDirectConversation(conversationId: string): void {
    this.state.activeDirectConversationId = conversationId;
    this.state.activeChannelId = conversationId; // channelId = conversationId for message routing
    this.state.activeWorkspaceId = null;
    this.callbacks.setFocusedChannel?.(conversationId);
    this.callbacks.markChannelRead?.(conversationId);
    this.closeThread();
    this.updateSidebar();
    this.updateChannelHeader();
    this.renderMessages();
    this.updateComposePlaceholder();
    this.closeMobileSidebar();
  }

  private updateComposePlaceholder(): void {
    const input = document.getElementById('compose-input') as HTMLTextAreaElement;
    if (!input) return;

    // Standalone direct conversation
    if (this.state.activeDirectConversationId) {
      const conv = this.cachedDirectConversations.find(c => c.id === this.state.activeDirectConversationId);
      input.placeholder = conv ? `Message ${this.getPeerAlias(conv.contactPeerId)}` : 'Message contact';
      return;
    }

    const ws = this.state.activeWorkspaceId
      ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)
      : null;
    const channel =
      this.state.activeChannelId && ws
        ? this.workspaceManager.getChannel(ws.id, this.state.activeChannelId)
        : null;

    if (channel) {
      input.placeholder =
        channel.type === 'dm' ? `Message ${channel.name}` : `Message #${channel.name}`;
    }
  }

  // =========================================================================
  // DOM update helpers
  // =========================================================================

  updateSidebar(): void {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    this.refreshContactsCache()
      .catch(() => {})
      .finally(() => {
        sidebar.innerHTML = this.renderSidebarHTML();
        this.bindSidebarEvents();
      });
  }

  updateChannelHeader(): void {
    const header = document.querySelector('.channel-header');
    if (!header) return;
    const temp = document.createElement('div');
    temp.innerHTML = this.renderChannelHeaderHTML();
    header.replaceWith(temp.firstElementChild!);
    this.bindChannelHeaderEvents();
  }

  // =========================================================================
  // Event binding
  // =========================================================================

  private bindAppEvents(): void {
    const input = document.getElementById('compose-input') as HTMLTextAreaElement;
    const sendBtn = document.getElementById('send-btn')!;

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.callbacks.sendMessage(input.value);
        input.value = '';
        this.autoResizeTextarea(input);
      }
    });

    input.addEventListener('input', () => {
      this.autoResizeTextarea(input);
      sendBtn.classList.toggle('active', input.value.trim().length > 0);
      this.handleCommandAutocomplete(input);
    });

    sendBtn.addEventListener('click', () => {
      this.callbacks.sendMessage(input.value);
      input.value = '';
      this.autoResizeTextarea(input);
    });

    // Emoji picker
    const emojiBtn = document.getElementById('emoji-btn');
    emojiBtn?.addEventListener('click', () => {
      void this.emojiPicker.show(emojiBtn, (emoji) => {
        input.value += emoji;
        input.focus();
      });
    });

    // Typing indicator (send on input, stop on send/blur)
    let typingTimeout: any;
    input.addEventListener('input', () => {
      this.callbacks.broadcastTyping?.();
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => this.callbacks.broadcastStopTyping?.(), 3000);
    });

    // File attachment
    const attachBtn = document.getElementById('attach-btn');
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    attachBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', () => {
      if (fileInput.files) {
        for (const file of Array.from(fileInput.files)) {
          this.callbacks.sendAttachment(file, input.value || undefined);
        }
        input.value = '';
        fileInput.value = '';
      }
    });

    const threadInput = document.getElementById('thread-input') as HTMLTextAreaElement;
    const threadSendBtn = document.getElementById('thread-send-btn')!;

    threadInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.callbacks.sendMessage(threadInput.value, this.state.activeThreadId || undefined);
        threadInput.value = '';
      }
    });

    threadSendBtn?.addEventListener('click', () => {
      this.callbacks.sendMessage(threadInput.value, this.state.activeThreadId || undefined);
      threadInput.value = '';
    });

    document.getElementById('thread-close')?.addEventListener('click', () => this.closeThread());

    this.setupThreadResize();

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Escape: close thread panel, close modals, remove autocomplete
      if (e.key === 'Escape') {
        document.getElementById('command-autocomplete')?.remove();
        document.querySelector('.modal-overlay')?.remove();
        if (this.state.threadOpen) this.closeThread();
      }

      // Ctrl/Cmd + K: focus compose and type /
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const composeInput = document.getElementById('compose-input') as HTMLTextAreaElement;
        if (composeInput) {
          composeInput.focus();
          if (!composeInput.value) composeInput.value = '/';
          this.handleCommandAutocomplete(composeInput);
        }
      }

      // Ctrl/Cmd + F: search messages
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        this.showSearchPanel();
      }

      // Ctrl/Cmd + Shift + M: toggle sidebar on mobile
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        const sidebar = document.getElementById('sidebar');
        sidebar?.classList.contains('open') ? this.closeMobileSidebar() : this.openMobileSidebar();
      }
    });

    document.getElementById('sidebar-nav')?.addEventListener('click', (e) => {
      const directConvItem = (e.target as HTMLElement).closest('.sidebar-item[data-direct-conv-id]') as HTMLElement;
      if (directConvItem) {
        this.switchToDirectConversation(directConvItem.dataset.directConvId!);
        return;
      }
      const item = (e.target as HTMLElement).closest('.sidebar-item[data-channel-id]') as HTMLElement;
      if (item) this.switchChannel(item.dataset.channelId!);
    });

    this.bindSidebarActionEvents();
    this.bindChannelHeaderEvents();
    this.bindWorkspaceRailEvents();
  }

  private bindSidebarEvents(): void {
    document.getElementById('sidebar-nav')?.addEventListener('click', (e) => {
      // Member DM button — start a direct conversation with a workspace member
      const dmBtn = (e.target as HTMLElement).closest('.member-dm-btn') as HTMLElement;
      if (dmBtn) {
        e.stopPropagation();
        const peerId = dmBtn.dataset.peerId!;
        this.startMemberDM(peerId);
        return;
      }

      // Contact card click — open/start a DM with that contact
      const contactCard = (e.target as HTMLElement).closest('.contact-card[data-contact-peer-id]') as HTMLElement;
      if (contactCard) {
        const peerId = contactCard.dataset.contactPeerId!;
        this.startMemberDM(peerId);
        return;
      }

      // Member row click — open/start a DM with that member
      const memberRow = (e.target as HTMLElement).closest('.member-row[data-member-peer-id]') as HTMLElement;
      if (memberRow) {
        const peerId = memberRow.dataset.memberPeerId!;
        this.startMemberDM(peerId);
        return;
      }

      const directConvItem = (e.target as HTMLElement).closest('.sidebar-item[data-direct-conv-id]') as HTMLElement;
      if (directConvItem) {
        this.switchToDirectConversation(directConvItem.dataset.directConvId!);
        return;
      }
      const item = (e.target as HTMLElement).closest(
        '.sidebar-item[data-channel-id]',
      ) as HTMLElement;
      if (item) this.switchChannel(item.dataset.channelId!);
    });
    this.bindSidebarActionEvents();
  }

  /**
   * Start a DM with a workspace member — reuses existing conversation if one exists,
   * otherwise creates a new one.
   */
  private startMemberDM(peerId: string): void {
    // Check if there's already a direct conversation with this peer
    const existing = this.cachedDirectConversations.find(c => c.contactPeerId === peerId);
    if (existing) {
      this.switchToDirectConversation(existing.id);
      return;
    }
    // Create new direct conversation — refresh cache first so renderChannelHeaderHTML can find it
    this.callbacks.startDirectMessage?.(peerId).then(async conv => {
      await this.refreshContactsCache();
      this.switchToDirectConversation(conv.id);
    }).catch(() => this.showToast('Could not start DM', 'error'));
  }

  private bindSidebarActionEvents(): void {
    document.getElementById('nav-dms-btn')?.addEventListener('click', () => {
      this.state.activeWorkspaceId = null;
      this.updateWorkspaceRail();
      this.updateSidebar();
      this.updateChannelHeader();
      this.renderMessages();
      this.updateComposePlaceholder();
    });
    document.getElementById('nav-workspaces-btn')?.addEventListener('click', () => {
      if (this.state.activeWorkspaceId) {
        this.switchWorkspace(this.state.activeWorkspaceId);
        return;
      }
      const firstWorkspace = this.callbacks.getAllWorkspaces?.()[0];
      if (!firstWorkspace) {
        this.showToast('Create or join a workspace first', 'error');
        return;
      }
      this.switchWorkspace(firstWorkspace.id);
    });
    document.getElementById('connect-peer-btn')?.addEventListener('click', () =>
      this.showConnectPeerModal(),
    );
    document.getElementById('add-channel-btn')?.addEventListener('click', () =>
      this.showCreateChannelModal(),
    );
    document.getElementById('add-dm-btn')?.addEventListener('click', () =>
      this.showCreateDMModal(),
    );
    document.getElementById('add-contact-btn')?.addEventListener('click', () =>
      this.showAddContactModal(),
    );
    document.getElementById('start-dm-btn')?.addEventListener('click', () =>
      this.showStartDirectMessageModal(),
    );
    document.getElementById('start-ws-dm-btn')?.addEventListener('click', () =>
      this.showStartDirectMessageModal(),
    );
    document.getElementById('copy-peer-id')?.addEventListener('click', () => {
      navigator.clipboard.writeText(this.state.myPeerId);
      this.showToast('Peer ID copied!');
    });
    document.getElementById('copy-invite')?.addEventListener('click', () => {
      if (!this.state.activeWorkspaceId) return;
      const inviteURL = this.callbacks.generateInviteURL?.(this.state.activeWorkspaceId);
      if (inviteURL) {
        navigator.clipboard.writeText(inviteURL);
        this.showToast('Invite link copied!', 'success');
      }
    });
    document.getElementById('sidebar-qr-btn')?.addEventListener('click', () => this.showMyQR());
  }

  private bindChannelHeaderEvents(): void {
    document.getElementById('invite-btn')?.addEventListener('click', () => {
      if (!this.state.activeWorkspaceId) return;
      const inviteURL = this.callbacks.generateInviteURL?.(this.state.activeWorkspaceId);
      if (inviteURL) {
        navigator.clipboard.writeText(inviteURL);
        this.showToast('Invite link copied! Share it with anyone.', 'success');
      }
    });
    document.getElementById('qr-btn')?.addEventListener('click', () => this.showMyQR());
    document.getElementById('search-btn')?.addEventListener('click', () => this.showSearchPanel());
    document.getElementById('settings-btn')?.addEventListener('click', () => this.showSettings());
    document.getElementById('hamburger-btn')?.addEventListener('click', () => {
      const sidebar = document.getElementById('sidebar');
      if (sidebar?.classList.contains('open')) {
        this.closeMobileSidebar();
      } else {
        this.openMobileSidebar();
      }
    });
  }

  // =========================================================================
  // Modal helpers
  // =========================================================================

  showModal(
    title: string,
    bodyHTML: string,
    onSubmit: (form: HTMLFormElement) => boolean | void | Promise<boolean | void>,
  ): void {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h2>${title}</h2>
        <form id="modal-form">
          ${bodyHTML}
          <div class="modal-actions">
            <button type="button" class="btn-secondary" id="modal-cancel">Cancel</button>
            <button type="submit" class="btn-primary">Confirm</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector('#modal-cancel')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);
    overlay.querySelector('#modal-form')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      const shouldClose = await onSubmit(e.target as HTMLFormElement);
      if (shouldClose !== false) {
        overlay.remove();
      }
    });
    setTimeout(() => (overlay.querySelector('input') as HTMLInputElement)?.focus(), 50);
  }

  showCreateWorkspaceModal(): void {
    this.showModal(
      'Create Workspace',
      `
      <div class="form-group">
        <label>Workspace Name</label>
        <input type="text" name="name" placeholder="My Team" required />
      </div>
      <div class="form-group">
        <label>Your Display Name</label>
        <input type="text" name="alias" placeholder="Your name" required />
      </div>
    `,
      (form) => {
        const name = (form.elements.namedItem('name') as HTMLInputElement).value.trim();
        const alias = (form.elements.namedItem('alias') as HTMLInputElement).value.trim();
        if (!name || !alias) return;

        this.state.myAlias = alias;
        const ws = this.callbacks.createWorkspace(name, alias);
        this.state.activeWorkspaceId = ws.id;
        this.state.activeChannelId = ws.channels[0]?.id || null;
        // Persist in background — both must complete before data is safe
        Promise.all([
          this.callbacks.persistWorkspace(ws.id),
          this.callbacks.persistSetting('myAlias', alias),
        ]).catch(err => console.error('[DecentChat] Failed to persist workspace:', err));
        this.renderApp();
        this.showToast(`Workspace "${name}" created! Click 🔗 to copy invite link.`, 'success');
      },
    );
  }

  /** Show join modal pre-filled from an invite URL */
  showJoinWithInvite(inviteCode: string, peerId: string, workspaceName: string, inviteData?: import('decent-protocol').InviteData): void {
    this.showModal(
      `Join ${workspaceName || 'Workspace'}`,
      `
      <input type="hidden" name="peerId" value="${peerId}" />
      ${workspaceName ? `<p style="color: var(--text-muted); margin-bottom: 16px; font-size: 15px;">You've been invited to <strong>${this.escapeHtml(workspaceName)}</strong></p>` : ''}
      <div class="form-group">
        <label>Your Display Name</label>
        <input type="text" name="alias" placeholder="Enter your name" required autofocus />
      </div>
    `,
      (form) => {
        const alias = (form.elements.namedItem('alias') as HTMLInputElement).value.trim();
        if (!alias) return;

        this.state.myAlias = alias;
        this.callbacks.joinWorkspace(workspaceName || inviteCode, alias, peerId, inviteData);
        this.showToast(`Joining ${workspaceName || 'workspace'}...`);
      },
    );
  }

  showJoinWorkspaceModal(): void {
    this.showModal(
      'Join Workspace',
      `
      <div class="form-group">
        <label>Invite Link or Code</label>
        <input type="text" name="invite" placeholder="https://decentchat.app/join/... or paste invite link" required />
        <small style="color: var(--text-muted); margin-top: 4px; display: block;">
          Paste the full invite link you received
        </small>
      </div>
      <div class="form-group">
        <label>Your Display Name</label>
        <input type="text" name="alias" placeholder="Your name" required />
      </div>
    `,
      (form) => {
        const invite = (form.elements.namedItem('invite') as HTMLInputElement).value.trim();
        const alias = (form.elements.namedItem('alias') as HTMLInputElement).value.trim();
        if (!invite || !alias) return;

        let code: string;
        let peerId: string | undefined;
        let inviteData: import('decent-protocol').InviteData | undefined;

        // Try parsing as invite URL first
        if (invite.includes('://') || invite.includes('/')) {
          try {
            const data = InviteURI.decode(invite);
            code = data.inviteCode;
            peerId = data.peerId;
            inviteData = data; // DEP-002: Pass full invite data for server discovery

            // Auto-connect to signaling server from invite
            if (data.host && data.port) {
              console.log(`[DecentChat] Invite points to signaling: ${data.host}:${data.port}`);
            }
          } catch {
            this.showToast('Invalid invite link', 'error');
            return;
          }
        } else {
          // Plain invite code — need a peer ID
          code = invite.toUpperCase();
          const peerInput = prompt('Enter the Peer ID of someone in the workspace:');
          if (!peerInput) return;
          peerId = peerInput.trim();
        }

        if (!peerId) {
          this.showToast('Invite link missing peer info — ask the inviter for an updated link', 'error');
          return;
        }

        this.state.myAlias = alias;
        // Use decoded workspace name if available, otherwise use invite code
        const wsName = inviteData?.workspaceName || code;
        this.callbacks.joinWorkspace(wsName, alias, peerId!, inviteData);
        this.showToast(`Joining workspace... connecting to ${peerId!.slice(0, 8)}`);
      },
    );
  }

  showConnectPeerModal(): void {
    this.showModal(
      'Connect to Peer',
      `
      <div class="form-group">
        <label>Peer ID</label>
        <input type="text" name="peerId" placeholder="Enter peer ID" required />
      </div>
    `,
      (form) => {
        const peerId = (form.elements.namedItem('peerId') as HTMLInputElement).value.trim();
        if (peerId) {
          this.callbacks.connectPeer(peerId);
          this.showToast(`Connecting to ${peerId.slice(0, 8)}...`);
        }
      },
    );
  }

  showCreateChannelModal(): void {
    if (!this.state.activeWorkspaceId) return;

    this.showModal(
      'Create Channel',
      `
      <div class="form-group">
        <label>Channel Name</label>
        <input type="text" name="name" placeholder="e.g. random, dev, design" required />
      </div>
    `,
      (form) => {
        const name = (form.elements.namedItem('name') as HTMLInputElement).value
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '-');
        if (!name) return;

        const result = this.callbacks.createChannel(name);
        if (result.success && result.channel) {
          this.callbacks.persistWorkspace(this.state.activeWorkspaceId!);
          this.switchChannel(result.channel.id);
          this.updateSidebar();
          this.showToast(`#${name} created!`, 'success');
        } else {
          this.showToast(result.error || 'Failed to create channel', 'error');
        }
      },
    );
  }

  showCreateDMModal(): void {
    if (!this.state.activeWorkspaceId) return;

    const ws = this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)!;
    const otherMembers = ws.members.filter(
      (m: import('decent-protocol').WorkspaceMember) => m.peerId !== this.state.myPeerId,
    );

    if (otherMembers.length === 0) {
      this.showToast('No other members in workspace yet. Invite someone first!', 'error');
      return;
    }

    const memberOptions = otherMembers
      .map(
        (m: import('decent-protocol').WorkspaceMember) =>
          `<div class="sidebar-item" data-peer-id="${m.peerId}" style="background: var(--surface); margin: 4px 0; border-radius: 6px; color: var(--text); padding: 10px 12px; cursor: pointer;">
        <span class="dm-status ${this.state.readyPeers.has(m.peerId) ? 'online' : ''}"></span>
        ${this.escapeHtml(m.alias)} (${m.peerId.slice(0, 8)})
      </div>`,
      )
      .join('');

    this.showModal(
      'New Direct Message',
      `
      <div class="form-group">
        <label>Select a member</label>
        <div id="member-list">${memberOptions}</div>
        <input type="hidden" name="peerId" id="dm-peer-select" />
      </div>
    `,
      (form) => {
        const peerId = (form.elements.namedItem('peerId') as HTMLInputElement).value;
        if (!peerId) return;

        const result = this.callbacks.createDM(peerId);
        if (result.success && result.channel) {
          this.switchChannel(result.channel.id);
          this.updateSidebar();
        }
      },
    );

    setTimeout(() => {
      document.getElementById('member-list')?.addEventListener('click', (e) => {
        const item = (e.target as HTMLElement).closest('[data-peer-id]') as HTMLElement;
        if (item) {
          (document.getElementById('dm-peer-select') as HTMLInputElement).value =
            item.dataset.peerId!;
          document
            .querySelectorAll('#member-list .sidebar-item')
            .forEach((el) => ((el as HTMLElement).style.border = 'none'));
          item.style.border = '2px solid var(--accent)';
        }
      });
    }, 50);
  }

  // =========================================================================
  // Contact modals
  // =========================================================================

  showAddContactModal(): void {
    this.showModal(
      'Add Contact',
      `
      <div class="form-group">
        <label>Contact URI</label>
        <textarea name="contactUri" id="contact-uri-input" placeholder="Paste decent://contact?... URI" rows="4" required></textarea>
      </div>
      <div class="form-group">
        <label>Display Name Override (optional)</label>
        <input type="text" name="displayNameOverride" placeholder="Override contact name" />
      </div>
    `,
      async (form) => {
        const uri = (form.elements.namedItem('contactUri') as HTMLTextAreaElement).value.trim();
        const displayNameOverride = (form.elements.namedItem('displayNameOverride') as HTMLInputElement).value.trim();

        if (!ContactURI.isValid(uri)) {
          this.showToast('Invalid Contact URI', 'error');
          return false;
        }

        const parsed = ContactURI.decode(uri);

        const contact: Contact = {
          peerId: parsed.peerId || `contact-${Date.now()}`,
          publicKey: parsed.publicKey,
          displayName: displayNameOverride || parsed.displayName,
          signalingServers: parsed.signalingServers || [],
          addedAt: Date.now(),
          lastSeen: 0,
        };

        await this.callbacks.addContact?.(contact);
        await this.refreshContactsCache();
        this.updateSidebar();
        this.showToast(`Added ${contact.displayName} to contacts`, 'success');
        return true;
      },
    );
  }

  showStartDirectMessageModal(): void {
    if (this.cachedContacts.length === 0) {
      this.showToast('Add a contact first to start a DM', 'error');
      return;
    }

    const contactOptions = this.cachedContacts
      .map(c => {
        const isOnline = this.state.readyPeers.has(c.peerId);
        return `<div class="sidebar-item" data-peer-id="${c.peerId}" style="background: var(--surface); margin: 4px 0; border-radius: 6px; color: var(--text); padding: 10px 12px; cursor: pointer;">
          <span class="dm-status ${isOnline ? 'online' : ''}"></span>
          ${this.escapeHtml(c.displayName)} (${c.peerId.slice(0, 8)})
        </div>`;
      })
      .join('');

    this.showModal(
      'Start Direct Message',
      `
      <div class="form-group">
        <label>Select a contact</label>
        <div id="contact-list">${contactOptions}</div>
        <input type="hidden" name="peerId" id="dm-contact-select" />
      </div>
    `,
      (form) => {
        const peerId = (form.elements.namedItem('peerId') as HTMLInputElement).value;
        if (!peerId) return;

        this.callbacks.startDirectMessage?.(peerId).then(async (conv) => {
          await this.refreshContactsCache();
          this.switchToDirectConversation(conv.id);
        });
      },
    );

    setTimeout(() => {
      document.getElementById('contact-list')?.addEventListener('click', (e) => {
        const item = (e.target as HTMLElement).closest('[data-peer-id]') as HTMLElement;
        if (item) {
          (document.getElementById('dm-contact-select') as HTMLInputElement).value =
            item.dataset.peerId!;
          document
            .querySelectorAll('#contact-list .sidebar-item')
            .forEach((el) => ((el as HTMLElement).style.border = 'none'));
          item.style.border = '2px solid var(--accent)';
        }
      });
    }, 50);
  }

  // =========================================================================
  // Toast notifications
  // =========================================================================

  showToast(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
    document.querySelector('.toast')?.remove();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // =========================================================================
  // Utility helpers
  // =========================================================================

  autoResizeTextarea(el: HTMLTextAreaElement): void {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  /** Show search panel */
  showSearchPanel(): void {
    const existing = document.getElementById('search-overlay');
    if (existing) { existing.remove(); return; }

    const overlay = document.createElement('div');
    overlay.id = 'search-overlay';
    overlay.className = 'search-panel';
    overlay.innerHTML = `
      <div class="search-input-row">
        <input type="text" id="search-input" placeholder="Search messages..." class="search-field" autofocus />
        <button class="icon-btn" id="search-close">✕</button>
      </div>
      <div class="search-results" id="search-results"></div>
    `;

    const header = document.querySelector('.channel-header');
    header?.parentElement?.insertBefore(overlay, header.nextSibling);

    const input = overlay.querySelector('#search-input') as HTMLInputElement;
    const resultsEl = overlay.querySelector('#search-results')!;

    input.focus();
    input.addEventListener('input', () => {
      const query = input.value.trim();
      if (query.length < 2) {
        resultsEl.innerHTML = '<div class="search-hint">Type at least 2 characters...</div>';
        return;
      }

      const results = this.messageSearch.search(query, {
        channelId: this.state.activeChannelId || undefined,
        limit: 20,
      });

      if (results.length === 0) {
        resultsEl.innerHTML = '<div class="search-hint">No results found</div>';
        return;
      }

      resultsEl.innerHTML = results.map(r => {
        const time = new Date(r.message.timestamp).toLocaleString();
        const sender = r.message.senderId === this.state.myPeerId
          ? (this.state.myAlias || 'You')
          : r.message.senderId.slice(0, 8);
        return `
          <div class="search-result" data-msg-id="${r.message.id}">
            <div class="search-result-header">
              <span class="search-result-sender">${this.escapeHtml(sender)}</span>
              <span class="search-result-time">${time}</span>
            </div>
            <div class="search-result-text">${this.escapeHtml(r.highlight)}</div>
          </div>`;
      }).join('');

      resultsEl.querySelectorAll('.search-result').forEach(el => {
        el.addEventListener('click', () => {
          const msgId = (el as HTMLElement).dataset.msgId;
          const msgEl = document.querySelector(`[data-message-id="${msgId}"]`);
          if (msgEl) {
            msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            msgEl.classList.add('highlight');
            setTimeout(() => msgEl.classList.remove('highlight'), 2000);
          }
        });
      });
    });

    overlay.querySelector('#search-close')?.addEventListener('click', () => overlay.remove());
  }

  /** Show QR code with user's identity */
  showMyQR(): void {
    const publicKey = this.callbacks.getMyPublicKey?.();
    if (!publicKey) {
      this.showToast('Public key not available yet', 'error');
      return;
    }
    this.qrCodeManager.showMyQR({
      publicKey,
      displayName: this.state.myAlias || this.state.myPeerId.slice(0, 8),
      peerId: this.state.myPeerId,
    });
  }

  /** Show QR scanner to add a contact */
  showScanQR(): void {
    this.qrCodeManager.showScanQR();
  }

  /** Show settings panel */
  showSettings(): void {
    const wsId = this.state.activeWorkspaceId;
    this.settingsPanel = new SettingsPanel(
      async () => ({
        ...await (this.callbacks.getSettings?.() || {}),
        myPeerId: this.state.myPeerId,
        myAlias: this.state.myAlias,
        activeWorkspaceId: wsId,
        workspaceAlias: wsId ? (this.state.workspaceAliases?.[wsId] || '') : '',
      }),
      (key, value) => {
        if (key === 'workspaceAlias' && wsId) {
          this.callbacks.setWorkspaceAlias?.(wsId, value as string);
          return Promise.resolve();
        }
        return this.callbacks.persistSetting(key, value);
      },
      async (action) => {
        if (action === 'generateSeed') {
          await this.callbacks.onSettingsAction?.(action);
        } else if (action === 'seed-transfer') {
          const seed = await this.callbacks.getCurrentSeed?.();
          if (seed) {
            this.qrCodeManager.showSeedQR(seed);
          } else {
            this.showToast('No seed phrase found — generate one in Settings first', 'error');
          }
        }
      },
    );
    this.settingsPanel.show();
  }

  /** Update typing indicator display */
  updateTypingIndicator(text: string): void {
    const el = document.getElementById('typing-indicator');
    if (!el) return;
    if (text) {
      el.textContent = text;
      el.classList.add('visible');
    } else {
      el.classList.remove('visible');
    }
  }

  /** Get placeholder text for compose input */
  private getComposePlaceholder(): string {
    if (this.state.activeDirectConversationId) {
      const conv = this.cachedDirectConversations.find(c => c.id === this.state.activeDirectConversationId);
      return conv ? `Message ${this.getPeerAlias(conv.contactPeerId)}` : 'Message contact';
    }
    if (!this.state.activeChannelId || !this.state.activeWorkspaceId) {
      return 'Message...';
    }
    const ws = this.workspaceManager.getWorkspace(this.state.activeWorkspaceId);
    const channel = ws ? this.workspaceManager.getChannel(ws.id, this.state.activeChannelId) : null;
    if (channel?.type === 'dm') return `Message ${channel.name}`;
    return `Message #${channel?.name || 'general'}`;
  }

  /** Handle command autocomplete popup */
  private handleCommandAutocomplete(input: HTMLTextAreaElement): void {
    let popup = document.getElementById('command-autocomplete');

    const value = input.value.trim();
    if (!value.startsWith('/') || value.includes(' ') || !this.callbacks.getCommandSuggestions) {
      popup?.remove();
      return;
    }

    const prefix = value.slice(1).toLowerCase();
    const suggestions = this.callbacks.getCommandSuggestions(prefix);

    if (suggestions.length === 0) {
      popup?.remove();
      return;
    }

    if (!popup) {
      popup = document.createElement('div');
      popup.id = 'command-autocomplete';
      popup.className = 'command-autocomplete';
      input.parentElement!.appendChild(popup);
    }

    popup.innerHTML = suggestions.slice(0, 8).map(s =>
      `<div class="command-suggestion" data-cmd="/${s.name}">
        <span class="cmd-name">/${s.name}</span>
        <span class="cmd-desc">${s.description}</span>
      </div>`
    ).join('');

    popup.querySelectorAll('.command-suggestion').forEach(el => {
      el.addEventListener('click', () => {
        input.value = (el as HTMLElement).dataset.cmd + ' ';
        input.focus();
        popup?.remove();
      });
    });
  }

  /** Render attachment previews for a message */
  private renderAttachments(attachments?: any[]): string {
    if (!attachments || attachments.length === 0) return '';

    return attachments.map((att: any) => {
      const sizeStr = this.formatFileSize(att.size);

      if (att.type === 'image' && att.thumbnail) {
        return `
          <div class="attachment attachment-image" data-attachment-id="${att.id}">
            <img src="data:image/jpeg;base64,${att.thumbnail}" alt="${this.escapeHtml(att.name)}" class="attachment-thumbnail" />
            <div class="attachment-info">
              <span class="attachment-name">${this.escapeHtml(att.name)}</span>
              <span class="attachment-size">${sizeStr}</span>
            </div>
          </div>`;
      }

      if (att.type === 'voice' || att.type === 'audio') {
        return `
          <div class="attachment attachment-audio" data-attachment-id="${att.id}">
            <span class="attachment-icon">🎵</span>
            <div class="attachment-info">
              <span class="attachment-name">${this.escapeHtml(att.name)}</span>
              <span class="attachment-size">${sizeStr}${att.durationSec ? ` · ${Math.round(att.durationSec)}s` : ''}</span>
            </div>
          </div>`;
      }

      // Generic file
      const icon = att.type === 'video' ? '🎬' : '📎';
      return `
        <div class="attachment attachment-file" data-attachment-id="${att.id}">
          <span class="attachment-icon">${icon}</span>
          <div class="attachment-info">
            <span class="attachment-name">${this.escapeHtml(att.name)}</span>
            <span class="attachment-size">${sizeStr}</span>
          </div>
        </div>`;
    }).join('');
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  peerColor(peerId: string): string {
    const colors = [
      '#e01e5a',
      '#2eb67d',
      '#ecb22e',
      '#36c5f0',
      '#611f69',
      '#1264a3',
      '#e57373',
      '#4fc3f7',
    ];
    let hash = 0;
    for (let i = 0; i < peerId.length; i++)
      hash = peerId.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private getPeerAlias(peerId: string): string {
    // Use controller callback if available — checks contacts + ALL workspace members
    if (this.callbacks.getDisplayNameForPeer) {
      return this.callbacks.getDisplayNameForPeer(peerId);
    }

    // Fallback: cached contacts then active workspace
    const contact = this.cachedContacts.find(c => c.peerId === peerId);
    if (contact) return contact.displayName;
    if (this.state.activeWorkspaceId) {
      const member = this.workspaceManager.getMember(this.state.activeWorkspaceId, peerId);
      if (member?.alias) return member.alias;
    }
    return peerId.slice(0, 8);
  }
}
