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

export interface ActivityItem {
  id: string;
  type: 'thread-reply' | 'mention';
  workspaceId: string;
  channelId: string;
  threadId?: string;
  messageId: string;
  actorId: string;
  snippet: string;
  timestamp: number;
  read: boolean;
}
import type { HuddleState, HuddleParticipant } from '../huddle/HuddleManager';
import type { AppState } from '../main';
import { renderMarkdown } from './renderMarkdown';

// ---------------------------------------------------------------------------
// Callback interfaces
// ---------------------------------------------------------------------------

export interface UICallbacks {
  /** Send a chat message (optionally in a thread) */
  sendMessage: (content: string, threadId?: string) => Promise<void>;
  /** Send a file attachment with optional text/thread */
  sendAttachment: (file: File, text?: string, threadId?: string) => Promise<void>;
  /** Resolve full-quality image URL for an attachment (blob URL), if available */
  resolveAttachmentImageUrl?: (attachmentId: string) => Promise<string | null>;
  /** Initiate a WebRTC connection to a peer */
  connectPeer: (peerId: string) => void;
  /** Create a new workspace and return it */
  createWorkspace: (name: string, alias: string) => import('decent-protocol').Workspace;
  /** Initiate join flow (connect to a peer with invite code) */
  joinWorkspace: (code: string, alias: string, peerId: string, inviteData?: import('decent-protocol').InviteData) => Promise<void>;
  /** Create a channel inside the active workspace */
  createChannel: (name: string) => { success: boolean; channel?: import('decent-protocol').Channel; error?: string };
  /** Remove a member from the active workspace (owner/admin) */
  removeWorkspaceMember?: (peerId: string) => Promise<{ success: boolean; error?: string }>;
  /** Promote a member's role */
  promoteMember?: (peerId: string, newRole: 'admin') => Promise<{ success: boolean; error?: string }>;
  /** Demote a member to regular member */
  demoteMember?: (peerId: string) => Promise<{ success: boolean; error?: string }>;
  /** Update workspace permissions */
  updateWorkspacePermissions?: (permissions: Partial<import('decent-protocol').WorkspacePermissions>) => Promise<{ success: boolean; error?: string }>;
  /** Update workspace name/description */
  updateWorkspaceInfo?: (updates: { name?: string; description?: string }) => Promise<{ success: boolean; error?: string }>;
  /** Delete workspace */
  deleteWorkspace?: (workspaceId: string) => Promise<boolean>;
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
  /** WhatsApp-like message info (delivered/read breakdown) */
  getMessageReceiptInfo?: (messageId: string) => {
    messageId: string;
    channelId: string;
    recipients: Array<{ peerId: string; name: string; at?: number }>;
    delivered: Array<{ peerId: string; name: string; at?: number }>;
    read: Array<{ peerId: string; name: string; at?: number }>;
    pending: Array<{ peerId: string; name: string; at?: number }>;
  } | null;
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
  /** Activity feed items (thread replies, mentions, etc.) */
  getActivityItems?: () => ActivityItem[];
  /** Count unread activity items */
  getActivityUnreadCount?: () => number;
  /** Mark one activity item as read */
  markActivityRead?: (id: string) => void;
  /** Mark all activity as read */
  markAllActivityRead?: () => void;
  /** Mark activity entries for a specific thread as read */
  markThreadActivityRead?: (channelId: string, threadId: string) => void;
  /** Notify the notification system which channel is currently active */
  setFocusedChannel?: (channelId: string | null) => void;
  /** Mark a channel as fully read */
  markChannelRead?: (channelId: string) => void;
  /** Late-read receipt scan when opening a channel/conversation */
  onChannelViewed?: (channelId: string) => void | Promise<void>;
  /** Resolve best display name for a peer — checks contacts, workspace members, fallback */
  getDisplayNameForPeer?: (peerId: string) => string;
  /** Get current seed phrase (for transfer QR) */
  getCurrentSeed?: () => Promise<string | null>;
  /** Validate a seed phrase — returns error string or null if valid */
  validateSeed?: (mnemonic: string) => string | null;
  /** Called when user restores identity from seed phrase */
  onSeedRestored?: (mnemonic: string) => Promise<void>;
  /** Start a voice huddle in a channel */
  startHuddle?: (channelId: string) => Promise<void>;
  /** Join an existing voice huddle */
  joinHuddle?: (channelId: string) => Promise<void>;
  /** Leave the current voice huddle */
  leaveHuddle?: () => Promise<void>;
  /** Toggle mute in the current huddle */
  toggleHuddleMute?: () => boolean;
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

  /** Huddle (voice call) state */
  private huddleState: HuddleState = 'inactive';
  private huddleChannelId: string | null = null;
  private huddleParticipants: HuddleParticipant[] = [];
  private huddleMuted = false;

  /** Pending compose attachments (staged before send) */
  private pendingMainAttachments: Array<{ id: string; file: File; previewUrl?: string }> = [];
  private pendingThreadAttachments: Array<{ id: string; file: File; previewUrl?: string }> = [];
  private lightboxBlobUrl: string | null = null;
  private frequentReactions: string[] = [];
  private reactionUsage: Record<string, number> = {};

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
    this.reactionUsage = this.loadReactionUsage();
    this.frequentReactions = this.loadFrequentReactions();
  }

  private tracePrefix(): string {
    const alias = (this.state.myAlias || '').trim();
    if (/^alice$/i.test(alias)) return '[TRACE Alice]';
    if (/^bob$/i.test(alias)) return '[TRACE Bob]';
    return `[TRACE ${alias || this.state.myPeerId.slice(0, 8)}]`;
  }

  private frequentReactionsKey(): string {
    return `decentchat:frequentReactions:${this.state.myPeerId || 'anon'}`;
  }

  private reactionUsageKey(): string {
    return `decentchat:reactionUsage:${this.state.myPeerId || 'anon'}`;
  }

  private loadReactionUsage(): Record<string, number> {
    try {
      const raw = localStorage.getItem(this.reactionUsageKey());
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const normalized: Record<string, number> = {};
        for (const [emoji, count] of Object.entries(parsed || {})) {
          if (typeof emoji === 'string' && emoji.length > 0 && typeof count === 'number' && count > 0) {
            normalized[emoji] = Math.floor(count);
          }
        }
        return normalized;
      }
    } catch {}
    return {};
  }

  private saveReactionUsage(): void {
    try {
      localStorage.setItem(this.reactionUsageKey(), JSON.stringify(this.reactionUsage));
    } catch {}
  }

  private loadFrequentReactions(): string[] {
    // Primary: derive from usage counts (true "frequently used").
    const fromUsage = Object.entries(this.reactionUsage)
      .sort((a, b) => b[1] - a[1])
      .map(([emoji]) => emoji);
    if (fromUsage.length > 0) {
      for (const fallback of QUICK_REACTIONS) {
        if (!fromUsage.includes(fallback)) fromUsage.push(fallback);
        if (fromUsage.length >= 3) break;
      }
      return fromUsage.slice(0, 3);
    }

    // Backward compatibility: old list-only storage.
    try {
      const raw = localStorage.getItem(this.frequentReactionsKey());
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const normalized = parsed.filter((e) => typeof e === 'string' && e.length > 0);
          if (normalized.length > 0) {
            return normalized.slice(0, 3);
          }
        }
      }
    } catch {}

    return QUICK_REACTIONS.slice(0, 3);
  }

  private saveFrequentReactions(): void {
    try {
      localStorage.setItem(this.frequentReactionsKey(), JSON.stringify(this.frequentReactions.slice(0, 3)));
    } catch {}
  }

  private rememberReaction(emoji: string): void {
    if (!emoji) return;

    this.reactionUsage[emoji] = (this.reactionUsage[emoji] || 0) + 1;
    this.saveReactionUsage();

    const ranked = Object.entries(this.reactionUsage)
      .sort((a, b) => b[1] - a[1])
      .map(([e]) => e);

    for (const fallback of [...this.frequentReactions, ...QUICK_REACTIONS]) {
      if (!ranked.includes(fallback)) ranked.push(fallback);
      if (ranked.length >= 3) break;
    }

    this.frequentReactions = ranked.slice(0, 3);

    this.saveFrequentReactions();
    this.refreshQuickReactionButtons();
  }

  private refreshQuickReactionButtons(): void {
    const frequent = this.getFrequentReactions();
    document.querySelectorAll('.message-actions-bar').forEach((barEl) => {
      const bar = barEl as HTMLElement;
      const addBtn = bar.querySelector('.quick-react-add') as HTMLElement | null;
      const msgId = addBtn?.dataset.msgId;
      if (!addBtn || !msgId) return;

      bar.querySelectorAll('.quick-react').forEach((btn) => btn.remove());

      for (const emoji of frequent) {
        const btn = document.createElement('button');
        btn.className = 'quick-react';
        btn.dataset.msgId = msgId;
        btn.dataset.emoji = emoji;
        btn.textContent = emoji;
        btn.addEventListener('click', () => {
          this.rememberReaction(emoji);
          this.callbacks.toggleReaction?.(msgId, emoji);
        });
        bar.insertBefore(btn, addBtn);
      }
    });
  }

  private getFrequentReactions(): string[] {
    if (!this.frequentReactions.length) {
      this.frequentReactions = this.loadFrequentReactions();
    }
    return this.frequentReactions.slice(0, 3);
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
    const hasWorkspace = (this.callbacks.getAllWorkspaces?.().length || 0) > 0;
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
              <button class="btn-primary btn-sm" id="open-app-btn-nav">Open App</button>
              ${!hasWorkspace ? '<button class="btn-secondary btn-sm" id="create-ws-btn-nav">Create workspace</button>' : ''}
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
              ${hasWorkspace
                ? '<button class="btn-primary btn-lg" id="open-app-btn">Open App →</button>'
                : '<button class="btn-primary btn-lg" id="create-ws-btn">Start Chatting Free →</button>'}
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
            <p class="lp-section-sub">Two steps. No servers involved.</p>
            <div class="lp-steps">
              <div class="lp-step">
                <div class="lp-step-num">1</div>
                <div class="lp-step-content">
                  <h3>Create your workspace or join one</h3>
                  <p>Start your own workspace in one click, or paste an invite to join an existing one. Your secure seed identity is generated automatically in your browser.</p>
                </div>
              </div>
              <div class="lp-step-arrow">→</div>
              <div class="lp-step">
                <div class="lp-step-num">2</div>
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
              <div class="lp-feature-card lp-feature-card--highlight">
                <div class="lp-feature-icon">🪪</div>
                <h3>No ID. No Face Scan. Ever.</h3>
                <p>While Discord now requires a government ID or face scan to access their platform, DecentChat requires nothing. No email, no phone, no identity checks — just 12 words that only you control.</p>
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
                <span>Discord / WhatsApp / Telegram</span>
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
                <span>ID or face scan to access</span>
                <span class="bad">✓ Discord requires it now</span>
                <span class="good">✗ Never</span>
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
              ${hasWorkspace
                ? '<button class="btn-primary btn-lg" id="open-app-btn-2">Open App →</button>'
                : '<button class="btn-primary btn-lg" id="create-ws-btn-2">Start Chatting Free →</button>'}
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

    const isAppLikeRoute = window.location.pathname === '/app' || window.location.pathname.startsWith('/app/');
    const bootstrapAction = (action: 'create' | 'join') => {
      sessionStorage.setItem('decent:welcomeAction', action);
      window.location.assign('/app');
    };

    const onCreateClick = () => {
      if (!isAppLikeRoute) {
        bootstrapAction('create');
        return;
      }
      this.showCreateWorkspaceModal();
    };

    const onJoinClick = () => {
      if (!isAppLikeRoute) {
        bootstrapAction('join');
        return;
      }
      this.showJoinWorkspaceModal();
    };

    document.getElementById('create-ws-btn')?.addEventListener('click', onCreateClick);
    document.getElementById('create-ws-btn-2')?.addEventListener('click', onCreateClick);
    document.getElementById('create-ws-btn-nav')?.addEventListener('click', onCreateClick);
    document.getElementById('open-app-btn')?.addEventListener('click', () => window.location.assign('/app'));
    document.getElementById('open-app-btn-2')?.addEventListener('click', () => window.location.assign('/app'));
    document.getElementById('open-app-btn-nav')?.addEventListener('click', () => window.location.assign('/app'));
    document.getElementById('join-ws-btn')?.addEventListener('click', onJoinClick);
    document.getElementById('join-ws-btn-2')?.addEventListener('click', onJoinClick);
    document.getElementById('join-ws-btn-nav')?.addEventListener('click', onJoinClick);
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
          <div class="huddle-join-banner" id="huddle-join-banner" style="display:none">
            <span class="huddle-join-icon">🟢</span>
            <span class="huddle-join-text">Huddle in progress</span>
            <button class="huddle-join-btn" id="huddle-join-btn">Join</button>
          </div>
          <div class="messages-area">
            <div class="messages-pane">
              <div class="messages-list" id="messages-list"></div>
              <div class="typing-indicator" id="typing-indicator"></div>
              <div class="huddle-bar" id="huddle-bar" style="display:none">
                <div class="huddle-bar-info">
                  <span class="huddle-icon">🟢</span>
                  <span class="huddle-label">Huddle</span>
                  <div class="huddle-participants" id="huddle-participants"></div>
                </div>
                <div class="huddle-bar-controls">
                  <button class="huddle-mute-btn" id="huddle-mute-btn" title="Mute/Unmute">🎤</button>
                  <button class="huddle-leave-btn" id="huddle-leave-btn" title="Leave Huddle">📵</button>
                </div>
              </div>
              <div class="compose-box">
                <div class="compose-pending" id="compose-pending"></div>
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
                <div class="compose-pending" id="thread-pending"></div>
                <div class="compose-inner">
                  <input type="file" id="thread-file-input" style="display:none" multiple />
                  <button class="compose-attach" id="thread-attach-btn" title="Attach file">📎</button>
                  <textarea class="compose-input" id="thread-input" placeholder="Reply in thread…" rows="1"></textarea>
                  <button class="compose-send" id="thread-send-btn">⬆</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="lightbox" id="lightbox" style="display:none">
          <div class="lightbox-backdrop" id="lightbox-backdrop"></div>
          <button class="lightbox-close" id="lightbox-close">✕</button>
          <img class="lightbox-img" id="lightbox-img" src="" alt="" />
          <div class="lightbox-name" id="lightbox-name"></div>
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

    const activityUnread = this.callbacks.getActivityUnreadCount?.() || 0;

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
      <div class="ws-rail-icon activity-btn" id="activity-btn" title="Activity">
        🔔
        ${activityUnread > 0 ? `<span class="activity-badge ws-rail-badge">${activityUnread > 99 ? '99+' : activityUnread}</span>` : ''}
      </div>
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
      this.persistViewState();
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

    document.getElementById('activity-btn')?.addEventListener('click', () => {
      this.showActivityModal();
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
    this.persistViewState();
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
    const ws = this.state.activeWorkspaceId
      ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)
      : null;
    const channels = ws ? this.workspaceManager.getChannels(ws.id) : [];
    const dms = ws ? this.workspaceManager.getDMs(ws.id, this.state.myPeerId) : [];
    const workspaceMembersHTML = ws
      ? ws.members.map((m) => {
          const alias = this.getPeerAlias(m.peerId);
          const youTag = m.peerId === this.state.myPeerId ? ' <span class="sidebar-item-meta">(you)</span>' : '';
          return `
            <div class="sidebar-item member-row" data-member-peer-id="${m.peerId}">
              <span class="dm-status ${this.peerStatusClass(m.peerId)}" title="${this.peerStatusTitle(m.peerId)}"></span>
              <span>${this.escapeHtml(alias)}${youTag}</span>
            </div>`;
        }).join('')
      : '';

    // Build standalone direct messages section
    const sortedDirectConversations = this.cachedDirectConversations
      .slice()
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    const directDMsHTML = sortedDirectConversations.map(conv => {
      const name = this.getPeerAlias(conv.contactPeerId);
      const isActive = this.state.activeDirectConversationId === conv.id;
      const unreadDM = this.callbacks.getUnreadCount?.(conv.id) || 0;
      const meta = conv.lastMessageAt
        ? new Date(conv.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'No messages';
      return `
        <div class="sidebar-item ${isActive ? 'active' : ''} ${unreadDM > 0 ? 'has-unread' : ''}" data-direct-conv-id="${conv.id}" data-testid="direct-conversation-item">
          <span class="dm-status ${this.peerStatusClass(conv.contactPeerId)}" title="${this.peerStatusTitle(conv.contactPeerId)}"></span>
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
        ${ws ? `
          <button class="workspace-menu-trigger" id="workspace-menu-trigger" title="Workspace menu">
            <h1>${this.escapeHtml(ws.name)}</h1>
            <span class="workspace-menu-caret">▾</span>
          </button>
        ` : `<h1>Workspaces</h1>`}
        <span class="status-dot"></span>
      </div>
      ${ws ? `
      <div class="workspace-menu" id="workspace-menu" style="display:none;">
        <button class="workspace-menu-item" id="workspace-menu-settings">Workspace settings</button>
        <button class="workspace-menu-item" id="workspace-menu-members">Members</button>
        <button class="workspace-menu-item" id="workspace-menu-invite">Invite people</button>
        <button class="workspace-menu-item" id="workspace-menu-notifications">Notification prefs</button>
      </div>
      ` : ''}
      <div class="sidebar-nav" id="sidebar-nav">
        ${ws ? `
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
        ` : ''}
        ${ws ? `
        <div class="sidebar-section" id="workspace-members-section">
          <div class="sidebar-section-header">Members</div>
          <div id="workspace-member-list" data-testid="workspace-member-list">
            ${workspaceMembersHTML}
          </div>
        </div>
        ` : ''}
        <div class="sidebar-section">
          <div class="sidebar-section-header">
            Direct Messages
            <button class="add-btn" id="start-dm-btn" title="Start DM">+</button>
          </div>
          <div id="direct-conversation-list" data-testid="direct-conversation-list">
            ${directDMsHTML || '<div class="sidebar-item" style="font-size:12px; opacity:0.5;">No direct messages yet</div>'}
          </div>
          <div class="sidebar-item" id="connect-peer-sidebar-btn" style="font-size:12px; opacity:0.55; padding-top:6px; padding-bottom:6px;" title="Connect to a peer by ID or invite link">
            🔌 Connect to peer...
          </div>
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
            <button class="icon-btn" id="connect-peer-header-btn" title="Connect to peer">🔌</button>
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
          ${memberCount > 0 ? `<button class="member-count" id="channel-members-btn" title="View channel members">👥 ${memberCount}</button>` : ''}
        </div>
        <div class="channel-header-right">
          <button class="icon-btn${this.huddleState === 'in-call' && this.huddleChannelId === this.state.activeChannelId ? ' huddle-start-btn active' : ''}" id="huddle-start-btn" title="Start Huddle">🎧</button>
          <button class="icon-btn" id="connect-peer-header-btn" title="Connect to peer">🔌</button>
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

  /**
   * Return true when a scroll container is at (or near) the bottom.
   * Used to avoid auto-scroll fighting when user intentionally scrolls up.
   */
  private shouldStickToBottom(container: HTMLElement, thresholdPx = 72): boolean {
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceFromBottom <= thresholdPx;
  }

  private scrollToBottom(container: HTMLElement): void {
    container.scrollTop = container.scrollHeight;
  }

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

    this.upgradeInlineImagePreviews(list);
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

    // Capture user scroll intent before DOM mutations.
    const shouldAutoScroll = this.shouldStickToBottom(list);

    const isMine = msg.senderId === this.state.myPeerId;
    const inThreadView = list.id === 'thread-messages';
    const myDisplayName = (this.state.activeWorkspaceId && this.state.workspaceAliases?.[this.state.activeWorkspaceId])
      || this.state.myAlias
      || 'You';
    const senderName = isMine
      ? myDisplayName
      : ((msg as any).senderName || this.getPeerAlias(msg.senderId));
    const senderLabel = senderName;
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

    const recipientPeerIds = Array.isArray((msg as any).recipientPeerIds)
      ? ((msg as any).recipientPeerIds as string[])
      : [];
    const ackedBy = Array.isArray((msg as any).ackedBy)
      ? ((msg as any).ackedBy as string[])
      : [];
    const expectedAcks = recipientPeerIds.length;
    const ackedCount = ackedBy.length;
    const readBy = Array.isArray((msg as any).readBy)
      ? ((msg as any).readBy as string[])
      : [];
    const readCount = readBy.length;
    const statusClass = (msg as any).status === 'read' ? 'read' : ((msg as any).status || 'pending');
    const statusSymbol = statusClass === 'read' ? '✓✓' : statusClass === 'delivered' ? '✓✓' : statusClass === 'sent' ? '✓' : '⏳';
    const deliveryTitle = statusClass === 'read'
      ? (expectedAcks > 0 ? `Read (${readCount}/${expectedAcks})` : 'Read')
      : statusClass === 'delivered'
        ? (expectedAcks > 0 ? `Delivered (${ackedCount}/${expectedAcks})` : 'Delivered')
        : statusClass === 'sent'
          ? (expectedAcks > 0 ? `Sent (${ackedCount}/${expectedAcks} delivered)` : 'Sent')
          : 'Sending…';

    if (msg.type === 'system') {
      div.innerHTML = `<div class="message-content">${this.escapeHtml(msg.content)}</div>`;
    } else {
      div.innerHTML = `
        <div class="message-avatar" style="background: ${this.peerColor(msg.senderId)}">${this.escapeHtml(initial)}</div>
        <div class="message-body">
          <div class="message-header">
            <span class="message-sender">${this.escapeHtml(senderLabel)}</span>
            <span class="message-time">${time}</span>
            ${isMine ? `<span class="msg-delivery-status ${statusClass}" data-message-id="${msg.id}" title="${deliveryTitle}">${statusSymbol}</span>${expectedAcks > 0 ? `<span class="msg-delivery-detail" data-message-id="${msg.id}">${statusClass === 'read' ? readCount : ackedCount}/${expectedAcks}</span>` : ''}` : ''}
          </div>
          <div class="message-content markdown-body">${renderMarkdown(msg.content)}</div>
          ${this.renderAttachments((msg as any).attachments)}
          ${inThreadView ? '' : `<div class="message-thread-indicator${threadReplies.length > 0 ? ' has-replies' : ''}" data-thread-id="${msg.id}">
            ${threadReplies.length > 0 ? this.renderThreadIndicatorContent(threadReplies) : ''}
          </div>`}
          <div class="message-reactions" id="reactions-${msg.id}"></div>
          <div class="message-actions-bar${inThreadView ? ' in-thread' : ''}">
            ${this.getFrequentReactions().map(e => `<button class="quick-react" data-msg-id="${msg.id}" data-emoji="${e}">${e}</button>`).join('')}
            <button class="quick-react-add" data-msg-id="${msg.id}" title="Add reaction">➕</button>
            <button class="message-thread-btn" data-thread-id="${msg.id}" title="Reply in thread">💬 Reply</button>
            ${(isMine || inThreadView) ? `<button class="message-info-btn" data-message-id="${msg.id}" title="Message info">ℹ️ Info</button>` : ''}
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
          this.rememberReaction(emoji);
          this.callbacks.toggleReaction?.(msgId, emoji);
        });
      });
      div.querySelector('.quick-react-add')?.addEventListener('click', () => {
        const btn = div.querySelector('.quick-react-add') as HTMLElement | null;
        const msgId = btn?.dataset.msgId;
        if (!btn || !msgId) return;
        void this.emojiPicker.show(btn, (emoji) => {
          this.rememberReaction(emoji);
          this.callbacks.toggleReaction?.(msgId, emoji);
        });
      });
      div.querySelector('.message-info-btn')?.addEventListener('click', () =>
        this.showMessageInfo(msg.id),
      );
    }

    list.appendChild(div);
    if (shouldAutoScroll) this.scrollToBottom(list);
    this.upgradeInlineImagePreviews(div);

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

  /**
   * DEP-005: Update the delivery status tick on a sent message without re-rendering everything.
   * Called when an ACK arrives from the recipient.
   */
  updateMessageStatus(
    messageId: string,
    status: 'pending' | 'sent' | 'delivered' | 'read',
    detail?: { acked?: number; total?: number; read?: number },
  ): void {
    const el = document.querySelector(`.msg-delivery-status[data-message-id="${messageId}"]`) as HTMLElement | null;
    if (!el) return;
    el.className = `msg-delivery-status ${status}`;

    const acked = detail?.acked;
    const read = detail?.read;
    const total = detail?.total;
    const hasCounts = typeof total === 'number' && total > 0;

    el.title = status === 'read'
      ? (hasCounts ? `Read (${read ?? 0}/${total})` : 'Read')
      : status === 'delivered'
        ? (hasCounts ? `Delivered (${acked ?? 0}/${total})` : 'Delivered')
        : status === 'sent'
          ? (hasCounts ? `Sent (${acked ?? 0}/${total} delivered)` : 'Sent')
          : 'Sending…';

    el.textContent = status === 'read' ? '✓✓' : status === 'delivered' ? '✓✓' : status === 'sent' ? '✓' : '⏳';

    const detailEl = document.querySelector(`.msg-delivery-detail[data-message-id="${messageId}"]`) as HTMLElement | null;
    if (hasCounts) {
      const value = status === 'read' ? (read ?? 0) : (acked ?? 0);
      if (detailEl) {
        detailEl.textContent = `${value}/${total}`;
      } else if (el.parentElement) {
        const span = document.createElement('span');
        span.className = 'msg-delivery-detail';
        span.dataset.messageId = messageId;
        span.textContent = `${value}/${total}`;
        el.insertAdjacentElement('afterend', span);
      }
    } else if (detailEl) {
      detailEl.remove();
    }
  }

  private showMessageInfo(messageId: string): void {
    const info = this.callbacks.getMessageReceiptInfo?.(messageId);
    if (!info) {
      this.showToast('Message info unavailable', 'error');
      return;
    }

    const fmt = (ts?: number) => ts ? new Date(ts).toLocaleString([], { hour12: false }) : '—';
    const renderList = (title: string, items: Array<{ peerId: string; name: string; at?: number }>) => `
      <div class="message-info-section">
        <div class="message-info-title">${title} <span class="message-info-count">(${items.length})</span></div>
        ${items.length > 0
          ? `<ul class="message-info-list">${items.map((u) => `<li><span class="name">${this.escapeHtml(u.name)}</span> <span class="peer">${this.escapeHtml(u.peerId.slice(0, 8))}</span> <span class="at">${this.escapeHtml(fmt(u.at))}</span></li>`).join('')}</ul>`
          : '<div class="message-info-empty">—</div>'}
      </div>
    `;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay message-info-overlay';
    overlay.innerHTML = `
      <div class="modal message-info-modal">
        <h3>Message Info</h3>
        ${renderList('Read by', info.read)}
        ${renderList('Delivered to', info.delivered)}
        ${renderList('Pending', info.pending)}
        <div class="message-info-actions">
          <button id="message-info-close" class="btn-secondary">Close</button>
        </div>
      </div>
    `;

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onEsc);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector('#message-info-close')?.addEventListener('click', close);
    document.addEventListener('keydown', onEsc);
    document.body.appendChild(overlay);
  }

  updateStreamingMessage(messageId: string, content: string): void {
    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null;
    if (!msgEl) return;

    const container = msgEl.closest('.message-list, #thread-messages, #messages-list') as HTMLElement | null;
    const shouldAutoScroll = container ? this.shouldStickToBottom(container) : false;

    const contentEl = msgEl.querySelector('.message-content') as HTMLElement | null;
    if (!contentEl) return;
    contentEl.innerHTML = renderMarkdown(content + ' ▋');
    msgEl.classList.add('streaming');

    if (container && shouldAutoScroll) this.scrollToBottom(container);
  }

  finalizeStreamingMessage(messageId: string): void {
    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null;
    if (!msgEl) return;
    const contentEl = msgEl.querySelector('.message-content') as HTMLElement | null;
    if (!contentEl) return;
    // Get the raw text from the stored message (not from DOM which has HTML)
    const activeChannelId = this.state.activeChannelId;
    let finalText = '';
    if (activeChannelId) {
      const msg = this.messageStore.getMessages(activeChannelId).find((m: PlaintextMessage) => m.id === messageId);
      finalText = msg?.content ?? '';
    }
    if (!finalText) {
      finalText = (contentEl.textContent ?? '').replace(/ ▋$/, '');
    }
    contentEl.innerHTML = renderMarkdown(finalText);

    if (activeChannelId) {
      const msg = this.messageStore.getMessages(activeChannelId).find((m: PlaintextMessage) => m.id === messageId);
      if (msg) {
        msg.content = finalText;
        (msg as any).streaming = false;
      }
    }

    msgEl.classList.remove('streaming');
  }

  // =========================================================================
  // Thread open/close
  // =========================================================================

  private persistViewState(): void {
    const payload = {
      workspaceId: this.state.activeWorkspaceId,
      channelId: this.state.activeChannelId,
      threadId: this.state.threadOpen ? this.state.activeThreadId : null,
      threadOpen: this.state.threadOpen,
      directConversationId: this.state.activeDirectConversationId,
      at: Date.now(),
    };

    void this.callbacks.persistSetting('ui:lastView', payload).catch(() => {});
  }

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
    this.persistViewState();
    if (this.state.activeChannelId) {
      this.callbacks.markThreadActivityRead?.(this.state.activeChannelId, messageId);
      this.updateChannelHeader();
    }

    // Focus the thread input
    setTimeout(() => {
      (document.getElementById('thread-input') as HTMLTextAreaElement)?.focus();
    }, 100);
  }

  closeThread(): void {
    this.clearPendingAttachments('thread');
    this.state.activeThreadId = null;
    this.state.threadOpen = false;
    this.persistViewState();
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
    void this.callbacks.onChannelViewed?.(channelId);
    this.closeThread();
    this.persistViewState();
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
    void this.callbacks.onChannelViewed?.(conversationId);
    this.closeThread();
    this.persistViewState();
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
    const threadInput = document.getElementById('thread-input') as HTMLTextAreaElement;
    const threadSendBtn = document.getElementById('thread-send-btn')!;

    // ── Typing indicator state (hoisted so all handlers can reference it) ──
    let typingTimeout: any;
    const stopTypingNow = () => {
      clearTimeout(typingTimeout);
      this.callbacks.broadcastStopTyping?.();
    };

    const updateSendButtons = () => {
      sendBtn.classList.toggle('active', input.value.trim().length > 0 || this.pendingMainAttachments.length > 0);
      if (threadSendBtn) {
        threadSendBtn.classList.toggle('active', (threadInput?.value.trim().length || 0) > 0 || this.pendingThreadAttachments.length > 0);
      }
    };

    const sendComposed = async (target: 'main' | 'thread') => {
      const isThread = target === 'thread';
      const targetInput = isThread ? threadInput : input;
      if (!targetInput) return;

      const pending = isThread ? this.pendingThreadAttachments : this.pendingMainAttachments;
      const text = targetInput.value.trim();
      const threadId = isThread ? (this.state.activeThreadId || undefined) : undefined;

      if (pending.length === 0 && !text) return;

      if (pending.length > 0) {
        for (let i = 0; i < pending.length; i++) {
          const item = pending[i];
          await this.callbacks.sendAttachment(item.file, i === 0 ? (text || undefined) : undefined, threadId);
        }
        this.clearPendingAttachments(target);
      } else {
        await this.callbacks.sendMessage(text, threadId);
      }

      targetInput.value = '';
      this.autoResizeTextarea(targetInput);
      if (!isThread) stopTypingNow();
      updateSendButtons();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void sendComposed('main');
      }
    });

    input.addEventListener('input', () => {
      this.autoResizeTextarea(input);
      updateSendButtons();
      this.handleCommandAutocomplete(input);
      // Typing indicator: broadcast and reset auto-stop timer
      this.callbacks.broadcastTyping?.();
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(stopTypingNow, 1500);
    });

    sendBtn.addEventListener('click', () => {
      void sendComposed('main');
    });

    // Stop typing when input loses focus
    input.addEventListener('blur', stopTypingNow);

    // Emoji picker
    const emojiBtn = document.getElementById('emoji-btn');
    emojiBtn?.addEventListener('click', () => {
      void this.emojiPicker.show(emojiBtn, (emoji) => {
        input.value += emoji;
        input.focus();
        updateSendButtons();
      });
    });

    // File attachment (staged, not sent immediately)
    const attachBtn = document.getElementById('attach-btn');
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    attachBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', () => {
      if (fileInput.files) {
        this.addPendingAttachments(Array.from(fileInput.files), 'main');
        fileInput.value = '';
        updateSendButtons();
      }
    });

    const threadAttachBtn = document.getElementById('thread-attach-btn');
    const threadFileInput = document.getElementById('thread-file-input') as HTMLInputElement;
    threadAttachBtn?.addEventListener('click', () => threadFileInput?.click());
    threadFileInput?.addEventListener('change', () => {
      if (threadFileInput.files) {
        this.addPendingAttachments(Array.from(threadFileInput.files), 'thread');
        threadFileInput.value = '';
        updateSendButtons();
      }
    });

    threadInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void sendComposed('thread');
      }
    });

    threadInput?.addEventListener('input', () => {
      this.autoResizeTextarea(threadInput);
      updateSendButtons();
    });

    threadSendBtn?.addEventListener('click', () => {
      void sendComposed('thread');
    });

    document.getElementById('thread-close')?.addEventListener('click', () => this.closeThread());

    // Paste images from clipboard (staged in compose/thread, removable via X)
    document.addEventListener('paste', (e) => {
      const items = Array.from((e as ClipboardEvent).clipboardData?.items || []);
      const imageItems = items.filter(item => item.type.startsWith('image/'));
      const hasActiveChat = !!(this.state.activeChannelId || this.state.activeDirectConversationId);
      if (imageItems.length > 0 && hasActiveChat) {
        e.preventDefault();

        const pasteTarget = e.target as HTMLElement | null;
        const isThreadInputFocused = document.activeElement === threadInput;
        const isThreadTarget = !!pasteTarget?.closest?.('#thread-panel');
        const target: 'main' | 'thread' = (isThreadInputFocused || isThreadTarget) ? 'thread' : 'main';

        const files: File[] = [];
        for (const item of imageItems) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
        this.addPendingAttachments(files, target);
        updateSendButtons();
      }
    });

    // Drag & drop file support (staged, not immediate send)
    const messagesArea = document.querySelector('.messages-area') as HTMLElement;
    if (messagesArea) {
      messagesArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        messagesArea.classList.add('drag-active');
      });
      messagesArea.addEventListener('dragleave', (e) => {
        if (!messagesArea.contains(e.relatedTarget as Node)) {
          messagesArea.classList.remove('drag-active');
        }
      });
      messagesArea.addEventListener('drop', (e) => {
        e.preventDefault();
        messagesArea.classList.remove('drag-active');
        const files = Array.from(e.dataTransfer?.files || []);
        if (this.state.activeChannelId || this.state.activeDirectConversationId) {
          const dropTarget = e.target as HTMLElement | null;
          const target: 'main' | 'thread' = dropTarget?.closest?.('#thread-panel') ? 'thread' : 'main';
          this.addPendingAttachments(files, target);
          updateSendButtons();
        }
      });
    }

    // Lightbox close events
    document.getElementById('lightbox-close')?.addEventListener('click', () => this.closeLightbox());
    document.getElementById('lightbox-backdrop')?.addEventListener('click', () => this.closeLightbox());

    // Thumbnail click -> open lightbox (event delegation)
    const messagesList = document.getElementById('messages-list');
    const threadMessages = document.getElementById('thread-messages');

    const handleThumbnailClick = async (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('attachment-thumbnail')) {
        const img = target as HTMLImageElement;
        const name = img.getAttribute('data-attachment-name') || '';
        const attachmentId = img.getAttribute('data-attachment-id') || '';

        // Open immediately with thumbnail, then upgrade to full-quality when available.
        this.openLightbox(img.src, name);

        if (attachmentId && this.callbacks.resolveAttachmentImageUrl) {
          const fullSrc = await this.callbacks.resolveAttachmentImageUrl(attachmentId);
          if (fullSrc) {
            const lb = document.getElementById('lightbox');
            const lbImg = document.getElementById('lightbox-img') as HTMLImageElement | null;
            if (lb?.style.display !== 'none' && lbImg) {
              if (this.lightboxBlobUrl) URL.revokeObjectURL(this.lightboxBlobUrl);
              this.lightboxBlobUrl = fullSrc;
              lbImg.src = fullSrc;
            }
          }
        }
      }
    };

    messagesList?.addEventListener('click', handleThumbnailClick);
    threadMessages?.addEventListener('click', handleThumbnailClick);

    this.setupThreadResize();

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Escape: close lightbox, thread panel, modals, autocomplete
      if (e.key === 'Escape') {
        if (document.getElementById('lightbox')?.style.display !== 'none') { this.closeLightbox(); return; }
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
    this.bindHuddleEvents();
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
    document.getElementById('connect-peer-sidebar-btn')?.addEventListener('click', () =>
      this.showConnectPeerModal(),
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

    document.getElementById('workspace-menu-trigger')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = document.getElementById('workspace-menu');
      if (!menu) return;
      const next = menu.style.display === 'none' || !menu.style.display;
      menu.style.display = next ? 'block' : 'none';
    });

    document.getElementById('workspace-menu-settings')?.addEventListener('click', () => {
      document.getElementById('workspace-menu')?.setAttribute('style', 'display:none;');
      this.showWorkspaceSettingsModal();
    });
    document.getElementById('workspace-menu-members')?.addEventListener('click', () => {
      document.getElementById('workspace-menu')?.setAttribute('style', 'display:none;');
      this.showWorkspaceMembersModal();
    });
    document.getElementById('workspace-menu-invite')?.addEventListener('click', () => {
      document.getElementById('workspace-menu')?.setAttribute('style', 'display:none;');
      if (!this.state.activeWorkspaceId) return;
      const inviteURL = this.callbacks.generateInviteURL?.(this.state.activeWorkspaceId);
      if (inviteURL) {
        navigator.clipboard.writeText(inviteURL);
        this.showToast('Invite link copied!', 'success');
      }
    });
    document.getElementById('workspace-menu-notifications')?.addEventListener('click', () => {
      document.getElementById('workspace-menu')?.setAttribute('style', 'display:none;');
      this.showSettings();
    });

  }

  private bindChannelHeaderEvents(): void {
    document.getElementById('huddle-start-btn')?.addEventListener('click', async () => {
      const channelId = this.state.activeChannelId;
      if (!channelId) return;
      if (this.huddleState === 'in-call') {
        await this.callbacks.leaveHuddle?.();
      } else {
        await this.callbacks.startHuddle?.(channelId);
      }
    });
    document.getElementById('invite-btn')?.addEventListener('click', () => {
      if (!this.state.activeWorkspaceId) return;
      const inviteURL = this.callbacks.generateInviteURL?.(this.state.activeWorkspaceId);
      if (inviteURL) {
        navigator.clipboard.writeText(inviteURL);
        this.showToast('Invite link copied! Share it with anyone.', 'success');
      }
    });
    document.getElementById('qr-btn')?.addEventListener('click', () => this.showMyQR());
    document.getElementById('activity-btn')?.addEventListener('click', () => this.showActivityModal());
    document.getElementById('channel-members-btn')?.addEventListener('click', () => this.showChannelMembersModal());
    document.getElementById('search-btn')?.addEventListener('click', () => this.showSearchPanel());
    document.getElementById('settings-btn')?.addEventListener('click', () => this.showSettings());
    document.getElementById('connect-peer-header-btn')?.addEventListener('click', () => this.showConnectPeerModal());
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
  // Huddle (voice calling) UI
  // =========================================================================

  private bindHuddleEvents(): void {
    document.getElementById('huddle-mute-btn')?.addEventListener('click', () => {
      const muted = this.callbacks.toggleHuddleMute?.() ?? false;
      this.huddleMuted = muted;
      const btn = document.getElementById('huddle-mute-btn');
      if (btn) btn.textContent = muted ? '🔇' : '🎤';
    });

    document.getElementById('huddle-leave-btn')?.addEventListener('click', async () => {
      await this.callbacks.leaveHuddle?.();
    });

    document.getElementById('huddle-join-btn')?.addEventListener('click', async () => {
      const channelId = this.huddleChannelId || this.state.activeChannelId;
      if (channelId) await this.callbacks.joinHuddle?.(channelId);
    });
  }

  onHuddleStateChange(state: HuddleState, channelId: string | null): void {
    this.huddleState = state;
    this.huddleChannelId = channelId;
    this.updateHuddleUI();
    this.updateChannelHeader();
  }

  onHuddleParticipantsChange(participants: HuddleParticipant[]): void {
    this.huddleParticipants = participants;
    this.updateHuddleUI();
  }

  private updateHuddleUI(): void {
    const bar = document.getElementById('huddle-bar');
    const joinBanner = document.getElementById('huddle-join-banner');
    const participantsEl = document.getElementById('huddle-participants');

    if (!bar || !joinBanner) return;

    if (this.huddleState === 'in-call') {
      bar.style.display = 'flex';
      joinBanner.style.display = 'none';

      if (participantsEl) {
        participantsEl.innerHTML = this.huddleParticipants.map(p => {
          const initials = p.displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
          const color = this.peerColor(p.peerId);
          const muteIcon = p.muted ? ' 🔇' : '';
          return `<span class="huddle-avatar" style="background:${color}" title="${this.escapeHtml(p.displayName)}${muteIcon}">${this.escapeHtml(initials)}</span>`;
        }).join('');
      }

      const muteBtn = document.getElementById('huddle-mute-btn');
      if (muteBtn) muteBtn.textContent = this.huddleMuted ? '🔇' : '🎤';

    } else if (this.huddleState === 'available') {
      bar.style.display = 'none';
      joinBanner.style.display = 'flex';

    } else {
      bar.style.display = 'none';
      joinBanner.style.display = 'none';
    }
  }

  // =========================================================================
  // Modal helpers
  // =========================================================================

  private showActivityModal(): void {
    const items = (this.callbacks.getActivityItems?.() || []).sort((a, b) => b.timestamp - a.timestamp);

    if (items.length === 0) {
      this.showModal('Activity', `
        <div class="empty-state" style="padding:20px 8px;">
          <div class="emoji">🔔</div>
          <h3>No activity yet</h3>
          <p>Thread replies and mentions will appear here.</p>
        </div>
      `, () => true);
      return;
    }

    const rows = items.map(item => {
      const actorName = this.getPeerAlias(item.actorId);
      const isUnread = !item.read;
      const time = this.relativeTime(item.timestamp);
      const meta = item.type === 'mention' ? '📣 Mention' : '💬 Thread reply';
      return `
        <button class="activity-row ${isUnread ? 'unread' : ''}" data-activity-id="${item.id}" data-channel-id="${item.channelId}" data-thread-id="${item.threadId || ''}">
          <div class="activity-row-top">
            <span class="activity-actor">${this.escapeHtml(actorName)}</span>
            <span class="activity-time">${time}</span>
          </div>
          <div class="activity-snippet">${this.escapeHtml(item.snippet || 'New activity')}</div>
          <div class="activity-meta">${meta}</div>
        </button>
      `;
    }).join('');

    this.showModal('Activity', `
      <div class="activity-list">${rows}</div>
      <div style="display:flex; justify-content:flex-end; margin-top:10px;">
        <button type="button" class="btn-primary" id="activity-mark-all">Mark all as read</button>
      </div>
    `, () => true);

    document.getElementById('activity-mark-all')?.addEventListener('click', () => {
      this.callbacks.markAllActivityRead?.();
      document.getElementById('modal-overlay')?.remove();
      this.updateChannelHeader();
    });

    document.querySelectorAll('.activity-row').forEach(el => {
      el.addEventListener('click', () => {
        const activityId = (el as HTMLElement).getAttribute('data-activity-id');
        const channelId = (el as HTMLElement).getAttribute('data-channel-id');
        const threadId = (el as HTMLElement).getAttribute('data-thread-id');
        if (activityId) this.callbacks.markActivityRead?.(activityId);
        document.getElementById('modal-overlay')?.remove();

        if (channelId) this.switchChannel(channelId);
        if (threadId && threadId.trim()) this.openThread(threadId);
        this.updateChannelHeader();
      });
    });
  }

  private showChannelMembersModal(): void {
    if (!this.state.activeWorkspaceId || !this.state.activeChannelId) return;

    const ws = this.workspaceManager.getWorkspace(this.state.activeWorkspaceId);
    const channel = ws ? this.workspaceManager.getChannel(ws.id, this.state.activeChannelId) : null;
    if (!ws || !channel) return;

    const channelMembers = ws.members.filter(m => channel.members.includes(m.peerId));

    const membersHTML = channelMembers.map(member => {
      const { peerId } = member;
      const name = this.getPeerAlias(peerId);
      const initial = name.charAt(0).toUpperCase();
      const color = this.peerColor(peerId);
      const isYou = peerId === this.state.myPeerId;
      const isOnline = this.state.connectedPeers.has(peerId) || isYou;

      return `
        <div class="member-row">
          <div class="member-info">
            <div class="member-avatar" style="background:${color}">${this.escapeHtml(initial)}</div>
            <div class="member-details">
              <div class="member-name-line">
                <span class="member-name">${this.escapeHtml(name)}</span>
                ${isYou ? '<span class="you-badge">you</span>' : ''}
              </div>
              <span class="member-status ${isOnline ? 'online' : 'offline'}">${isOnline ? 'Online' : 'Offline'}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    this.showModal(
      `Channel Members · #${this.escapeHtml(channel.name)}`,
      `
      <div class="form-group" style="margin-bottom: 8px;">
        <div style="font-size: 13px; color: var(--text-muted);">${channelMembers.length} member${channelMembers.length === 1 ? '' : 's'}</div>
      </div>
      <div class="members-list">
        ${membersHTML}
      </div>
    `,
      () => true,
    );
  }

  private showWorkspaceMembersModal(): void {
    if (!this.state.activeWorkspaceId) return;

    const ws = this.workspaceManager.getWorkspace(this.state.activeWorkspaceId);
    if (!ws) return;

    const myMember = ws.members.find(m => m.peerId === this.state.myPeerId);
    const myRole = myMember?.role || 'member';
    const isOwner = myRole === 'owner' || ws.createdBy === this.state.myPeerId || this.workspaceManager.isOwner(ws.id, this.state.myPeerId);
    const isAdminOrOwner = isOwner || myRole === 'admin' || this.workspaceManager.isAdmin(ws.id, this.state.myPeerId);

    const roleBadge = (role: string) => {
      if (role === 'owner') return '<span class="role-badge role-owner" title="Owner">Owner</span>';
      if (role === 'admin') return '<span class="role-badge role-admin" title="Admin">Admin</span>';
      return '';
    };

    const membersHTML = ws.members.map(member => {
      const { peerId, role } = member;
      const name = this.getPeerAlias(peerId);
      const initial = name.charAt(0).toUpperCase();
      const color = this.peerColor(peerId);
      const isYou = peerId === this.state.myPeerId;
      const isOnline = this.state.connectedPeers.has(peerId) || isYou;
      const canRemove = isAdminOrOwner && !isYou && role !== 'owner';
      const canPromote = isOwner && !isYou && role === 'member';
      const canDemote = isOwner && !isYou && role === 'admin';

      let actionButtons = '';
      if (canPromote) actionButtons += `<button type="button" class="btn-action promote-btn" data-peer-id="${peerId}" title="Promote to Admin">Promote</button>`;
      if (canDemote) actionButtons += `<button type="button" class="btn-action demote-btn" data-peer-id="${peerId}" title="Demote to Member">Demote</button>`;
      if (canRemove) actionButtons += `<button type="button" class="btn-action btn-danger remove-member-btn" data-remove-peer-id="${peerId}" title="Remove from workspace">Remove</button>`;

      return `
        <div class="member-row">
          <div class="member-info">
            <div class="member-avatar" style="background:${color}">${this.escapeHtml(initial)}</div>
            <div class="member-details">
              <div class="member-name-line">
                <span class="member-name">${this.escapeHtml(name)}</span>
                ${roleBadge(role)}
                ${isYou ? '<span class="you-badge">you</span>' : ''}
              </div>
              <span class="member-status ${isOnline ? 'online' : 'offline'}">${isOnline ? 'Online' : 'Offline'}</span>
            </div>
          </div>
          <div class="member-actions">${actionButtons}</div>
        </div>
      `;
    }).join('');

    this.showModal(
      `Workspace Members`,
      `
      <div class="form-group" style="margin-bottom: 8px;">
        <div id="members-count-label" style="font-size: 13px; color: var(--text-muted);">${ws.members.length} member${ws.members.length === 1 ? '' : 's'}</div>
      </div>
      <div class="members-list">${membersHTML}</div>
    `,
      () => true,
    );

    const overlay = document.querySelector('.modal-overlay:last-of-type') as HTMLElement | null;

    overlay?.querySelectorAll('.remove-member-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const peerId = (e.currentTarget as HTMLElement).getAttribute('data-remove-peer-id');
        if (!peerId || !this.callbacks.removeWorkspaceMember) return;
        if (!confirm(`Remove ${this.getPeerAlias(peerId)} from workspace?`)) return;

        const res = await this.callbacks.removeWorkspaceMember(peerId);
        if (!res.success) return this.showToast(res.error || 'Failed to remove member', 'error');

        // Keep dialog experience open by immediately re-rendering members modal.
        overlay.remove();
        this.showWorkspaceMembersModal();

        this.showToast('Member removed', 'success');
        this.updateSidebar();
        this.updateChannelHeader();
      });
    });

    overlay?.querySelectorAll('.promote-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const peerId = (e.currentTarget as HTMLElement).getAttribute('data-peer-id');
        if (!peerId || !this.callbacks.promoteMember) return;

        const res = await this.callbacks.promoteMember(peerId, 'admin');
        if (!res.success) return this.showToast(res.error || 'Failed to promote member', 'error');

        overlay.remove();
        this.showToast(`${this.getPeerAlias(peerId)} promoted to Admin`, 'success');
        this.updateSidebar();
        this.updateChannelHeader();
      });
    });

    overlay?.querySelectorAll('.demote-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const peerId = (e.currentTarget as HTMLElement).getAttribute('data-peer-id');
        if (!peerId || !this.callbacks.demoteMember) return;

        const res = await this.callbacks.demoteMember(peerId);
        if (!res.success) return this.showToast(res.error || 'Failed to demote member', 'error');

        overlay.remove();
        this.showToast(`${this.getPeerAlias(peerId)} demoted to Member`, 'success');
        this.updateSidebar();
        this.updateChannelHeader();
      });
    });
  }

  private showWorkspaceSettingsModal(): void {
    if (!this.state.activeWorkspaceId) return;

    const ws = this.workspaceManager.getWorkspace(this.state.activeWorkspaceId);
    if (!ws) return;

    const isOwner = this.workspaceManager.isOwner(ws.id, this.state.myPeerId);
    const perms = ws.permissions ?? { whoCanCreateChannels: 'everyone', whoCanInviteMembers: 'everyone' };

    const deleteSection = isOwner ? `
      <div class="form-group" style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border);">
        <button type="button" class="btn-danger" id="delete-workspace-btn" style="width:100%;">Delete Workspace</button>
      </div>
    ` : '';

    this.showModal(
      'Workspace Settings',
      `
      <div class="form-group">
        <label>Workspace Name</label>
        <input type="text" name="ws-name" value="${this.escapeHtml(ws.name)}" required />
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea name="ws-description" rows="2" placeholder="What's this workspace about?">${this.escapeHtml(ws.description || '')}</textarea>
      </div>
      <div class="form-group">
        <label>Who can create channels?</label>
        <select name="ws-create-channels" class="modal-select">
          <option value="everyone" ${perms.whoCanCreateChannels === 'everyone' ? 'selected' : ''}>Everyone</option>
          <option value="admins" ${perms.whoCanCreateChannels === 'admins' ? 'selected' : ''}>Admins only</option>
        </select>
      </div>
      <div class="form-group">
        <label>Who can invite members?</label>
        <select name="ws-invite-members" class="modal-select">
          <option value="everyone" ${perms.whoCanInviteMembers === 'everyone' ? 'selected' : ''}>Everyone</option>
          <option value="admins" ${perms.whoCanInviteMembers === 'admins' ? 'selected' : ''}>Admins only</option>
        </select>
      </div>
      <div class="form-group">
        <button type="button" class="btn-secondary" id="manage-members-btn" style="width:100%;">Manage Members</button>
      </div>
      ${deleteSection}
    `,
      async (form) => {
        const name = (form.elements.namedItem('ws-name') as HTMLInputElement).value.trim();
        const description = (form.elements.namedItem('ws-description') as HTMLTextAreaElement).value.trim();
        const whoCanCreateChannels = (form.elements.namedItem('ws-create-channels') as HTMLSelectElement).value as 'everyone' | 'admins';
        const whoCanInviteMembers = (form.elements.namedItem('ws-invite-members') as HTMLSelectElement).value as 'everyone' | 'admins';

        if (!name) return false;

        // Update workspace info
        if (name !== ws.name || description !== (ws.description || '')) {
          const infoRes = await this.callbacks.updateWorkspaceInfo?.({ name, description });
          if (infoRes && !infoRes.success) {
            this.showToast(infoRes.error || 'Failed to update workspace info', 'error');
            return false;
          }
        }

        // Update permissions
        if (whoCanCreateChannels !== perms.whoCanCreateChannels || whoCanInviteMembers !== perms.whoCanInviteMembers) {
          const permRes = await this.callbacks.updateWorkspacePermissions?.({ whoCanCreateChannels, whoCanInviteMembers });
          if (permRes && !permRes.success) {
            this.showToast(permRes.error || 'Failed to update permissions', 'error');
            return false;
          }
        }

        this.showToast('Workspace settings saved', 'success');
        this.updateSidebar();
        this.updateChannelHeader();
        return true;
      },
    );

    const overlay = document.querySelector('.modal-overlay:last-of-type') as HTMLElement | null;
    overlay?.querySelector('#manage-members-btn')?.addEventListener('click', () => {
      overlay.remove();
      this.showWorkspaceMembersModal();
    });

    // Bind delete workspace button
    if (isOwner) {
      overlay?.querySelector('#delete-workspace-btn')?.addEventListener('click', async () => {
        const confirmed = confirm(`Delete "${ws.name}"? This cannot be undone.`);
        if (!confirmed) return;
        const secondConfirm = confirm(`Are you sure? All channels and messages will be lost.`);
        if (!secondConfirm) return;

        const result = await this.callbacks.deleteWorkspace?.(ws.id);
        if (result) {
          overlay?.remove();
          this.showToast('Workspace deleted', 'success');
          this.state.activeWorkspaceId = null;
          this.state.activeChannelId = null;
          (this as any).renderApp?.() ?? this.updateSidebar();
        } else {
          this.showToast('Failed to delete workspace', 'error');
        }
      });
    }
  }

  showModal(
    title: string,
    bodyHTML: string,
    onSubmit: (form: HTMLFormElement) => boolean | void | Promise<boolean | void>,
  ): HTMLDivElement {
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
    return overlay;
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
        this.callbacks.persistSetting('myAlias', alias);
        this.callbacks.joinWorkspace(workspaceName || inviteCode, alias, peerId, inviteData);
        this.showToast(`Joining ${workspaceName || 'workspace'}...`);
      },
    );
  }

  private parseJoinInviteInput(invite: string): { code: string; peerId?: string; inviteData?: import('decent-protocol').InviteData; error?: string } {
    if (invite.includes('://') || invite.includes('/')) {
      try {
        const data = InviteURI.decode(invite);

        // Auto-connect to signaling server from invite
        if (data.host && data.port) {
          console.log(`[DecentChat] Invite points to signaling: ${data.host}:${data.port}`);
        }

        return {
          code: data.inviteCode,
          peerId: data.peerId,
          inviteData: data,
        };
      } catch {
        return { code: '', error: 'Invalid invite link' };
      }
    }

    // Plain invite code — need a peer ID
    return { code: invite.toUpperCase() };
  }

  private updateWorkspacePreview(overlay: HTMLDivElement): void {
    const inviteInput = overlay.querySelector('input[name="invite"]') as HTMLInputElement | null;
    const previewGroup = overlay.querySelector('[data-workspace-preview]') as HTMLElement | null;
    const previewInput = overlay.querySelector('input[name="workspacePreview"]') as HTMLInputElement | null;

    if (!inviteInput || !previewGroup || !previewInput) return;

    const parsed = this.parseJoinInviteInput(inviteInput.value.trim());
    const workspaceName = parsed.inviteData?.workspaceName?.trim();

    if (workspaceName) {
      const wasVisible = previewGroup.classList.contains('workspace-preview-visible');
      previewInput.value = workspaceName;
      previewGroup.style.display = 'block';
      previewGroup.classList.add('workspace-preview-visible');
      if (!wasVisible) {
        previewInput.classList.remove('workspace-preview-pop');
        requestAnimationFrame(() => previewInput.classList.add('workspace-preview-pop'));
      }
    } else {
      previewInput.value = '';
      previewGroup.style.display = 'none';
      previewGroup.classList.remove('workspace-preview-visible');
      previewInput.classList.remove('workspace-preview-pop');
    }
  }

  showJoinWorkspaceModal(): void {
    const overlay = this.showModal(
      'Join Workspace',
      `
      <div class="form-group">
        <label>Invite Link or Code</label>
        <input type="text" name="invite" class="invite-input" placeholder="https://decentchat.app/join/... or paste invite link" required />
        <small style="color: var(--text-muted); margin-top: 4px; display: block;">
          Paste the full invite link you received
        </small>
        <small class="invite-autofill-hint" data-invite-autofill-hint style="display: none;">
          ✅ We found an invite in your clipboard and pasted it here for you.
        </small>
      </div>
      <div class="form-group" data-workspace-preview style="display: none;">
        <label>Workspace</label>
        <input type="text" name="workspacePreview" readonly />
      </div>
      <div class="form-group">
        <label>Your Display Name</label>
        <input type="text" name="alias" class="join-alias-input" placeholder="Your name" required />
      </div>
    `,
      (form) => {
        const invite = (form.elements.namedItem('invite') as HTMLInputElement).value.trim();
        const alias = (form.elements.namedItem('alias') as HTMLInputElement).value.trim();
        if (!invite || !alias) return;

        const parsed = this.parseJoinInviteInput(invite);
        if (parsed.error) {
          this.showToast(parsed.error, 'error');
          return;
        }

        let peerId = parsed.peerId;
        if (!peerId) {
          const peerInput = prompt('Enter the Peer ID of someone in the workspace:');
          if (!peerInput) return;
          peerId = peerInput.trim();
        }

        if (!peerId) {
          this.showToast('Invite link missing peer info — ask the inviter for an updated link', 'error');
          return;
        }

        this.state.myAlias = alias;
        this.callbacks.persistSetting('myAlias', alias);
        const wsName = parsed.inviteData?.workspaceName || parsed.code;
        this.callbacks.joinWorkspace(wsName, alias, peerId, parsed.inviteData);
        this.showToast(`Joining workspace... connecting to ${peerId.slice(0, 8)}`);
      },
    );

    const inviteInput = overlay.querySelector('input[name="invite"]') as HTMLInputElement | null;
    const aliasInput = overlay.querySelector('input[name="alias"]') as HTMLInputElement | null;
    const autofillHint = overlay.querySelector('[data-invite-autofill-hint]') as HTMLElement | null;

    if (inviteInput) {
      inviteInput.addEventListener('input', () => {
        this.updateWorkspacePreview(overlay);
        inviteInput.classList.remove('invite-autofilled');
        if (autofillHint) {
          autofillHint.style.display = 'none';
          autofillHint.classList.remove('invite-autofill-hint-visible');
        }
      });
    }

    // Clipboard auto-detect (requires user gesture: opening modal)
    if (navigator.clipboard?.readText) {
      navigator.clipboard.readText()
        .then((text) => {
          const clipboardText = text.trim();
          if (!clipboardText || !inviteInput || inviteInput.value.trim()) return;

          const parsed = this.parseJoinInviteInput(clipboardText);
          if (parsed.error || !parsed.inviteData) return;

          inviteInput.value = clipboardText;
          inviteInput.classList.remove('invite-autofilled');
          requestAnimationFrame(() => inviteInput.classList.add('invite-autofilled'));
          this.updateWorkspacePreview(overlay);

          if (autofillHint) {
            autofillHint.style.display = 'block';
            autofillHint.classList.remove('invite-autofill-hint-visible');
            requestAnimationFrame(() => autofillHint.classList.add('invite-autofill-hint-visible'));
          }

          // Move user directly to the next step.
          // Delay slightly so it wins over modal's initial autofocus on first input.
          setTimeout(() => {
            aliasInput?.focus();
            aliasInput?.select();
          }, 90);
        })
        .catch(() => {
          // Clipboard read can fail due to browser permissions; ignore silently.
        });
    }
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
        <span class="dm-status ${this.peerStatusClass(m.peerId)}" title="${this.peerStatusTitle(m.peerId)}"></span>
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
        return `<div class="sidebar-item" data-peer-id="${c.peerId}" style="background: var(--surface); margin: 4px 0; border-radius: 6px; color: var(--text); padding: 10px 12px; cursor: pointer;">
          <span class="dm-status ${this.peerStatusClass(c.peerId)}" title="${this.peerStatusTitle(c.peerId)}"></span>
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

  private upgradeInlineImagePreviews(container?: HTMLElement): void {
    const root = container || document.getElementById('messages-list');
    if (!root) return;

    // Respect optional low-quality mode.
    this.callbacks.getSettings?.().then(settings => {
      if (settings?.lowQualityPreviews) return;

      const imgs = root.querySelectorAll<HTMLImageElement>('img.attachment-thumbnail[data-attachment-id]');
      for (const img of imgs) {
        if (img.getAttribute('data-inline-upgrade') === 'done') continue;
        const attachmentId = img.getAttribute('data-attachment-id');
        if (!attachmentId) continue;

        const tryResolve = (attempt = 1) => {
          this.callbacks.resolveAttachmentImageUrl?.(attachmentId).then((fullUrl) => {
            if (fullUrl) {
              img.src = fullUrl;
              img.setAttribute('data-inline-upgrade', 'done');
              return;
            }
            if (attempt < 3) {
              setTimeout(() => tryResolve(attempt + 1), 2500);
            }
          }).catch(() => {
            if (attempt < 3) setTimeout(() => tryResolve(attempt + 1), 2500);
          });
        };

        img.setAttribute('data-inline-upgrade', 'loading');
        tryResolve(1);
      }
    }).catch(() => {});
  }

  private addPendingAttachments(files: File[], target: 'main' | 'thread'): void {
    const list = target === 'thread' ? this.pendingThreadAttachments : this.pendingMainAttachments;
    for (const file of files) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      list.push({ id, file, previewUrl });
    }
    this.renderPendingAttachments(target);
  }

  private clearPendingAttachments(target: 'main' | 'thread'): void {
    const list = target === 'thread' ? this.pendingThreadAttachments : this.pendingMainAttachments;
    for (const item of list) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    if (target === 'thread') this.pendingThreadAttachments = [];
    else this.pendingMainAttachments = [];
    this.renderPendingAttachments(target);
  }

  private removePendingAttachment(target: 'main' | 'thread', id: string): void {
    const list = target === 'thread' ? this.pendingThreadAttachments : this.pendingMainAttachments;
    const idx = list.findIndex(item => item.id === id);
    if (idx >= 0) {
      const [removed] = list.splice(idx, 1);
      if (removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      this.renderPendingAttachments(target);
    }
  }

  private renderPendingAttachments(target: 'main' | 'thread'): void {
    const containerId = target === 'thread' ? 'thread-pending' : 'compose-pending';
    const container = document.getElementById(containerId);
    if (!container) return;

    const list = target === 'thread' ? this.pendingThreadAttachments : this.pendingMainAttachments;
    if (list.length === 0) {
      container.innerHTML = '';
      container.classList.remove('has-items');
      return;
    }

    container.classList.add('has-items');
    container.innerHTML = list.map(item => `
      <div class="pending-attachment" data-pending-id="${item.id}">
        ${item.previewUrl
          ? `<img class="pending-attachment-thumb" src="${item.previewUrl}" alt="${this.escapeHtml(item.file.name)}" />`
          : `<span class="pending-attachment-file">📎 ${this.escapeHtml(item.file.name)}</span>`}
        <button class="pending-attachment-remove" title="Remove attachment" data-remove-id="${item.id}">✕</button>
      </div>
    `).join('');

    container.querySelectorAll('.pending-attachment-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).getAttribute('data-remove-id');
        if (id) this.removePendingAttachment(target, id);
      });
    });

    const mainInput = document.getElementById('compose-input') as HTMLTextAreaElement | null;
    const threadInput = document.getElementById('thread-input') as HTMLTextAreaElement | null;
    (document.getElementById('send-btn') as HTMLElement | null)
      ?.classList.toggle('active', (mainInput?.value.trim().length || 0) > 0 || this.pendingMainAttachments.length > 0);
    (document.getElementById('thread-send-btn') as HTMLElement | null)
      ?.classList.toggle('active', (threadInput?.value.trim().length || 0) > 0 || this.pendingThreadAttachments.length > 0);
  }

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
      async (key, value) => {
        if (key === 'workspaceAlias' && wsId) {
          this.callbacks.setWorkspaceAlias?.(wsId, value as string);
          return;
        }
        if (key === 'myAlias' && typeof value === 'string' && value.trim()) {
          this.state.myAlias = value.trim();
        }
        await this.callbacks.persistSetting(key, value);
        if (key === 'showLiveReconnectActivity') {
          this.updateSidebar();
        }
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
    void this.settingsPanel.show();
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

  private openLightbox(src: string, name: string): void {
    if (this.lightboxBlobUrl) {
      URL.revokeObjectURL(this.lightboxBlobUrl);
      this.lightboxBlobUrl = null;
    }
    const lb = document.getElementById('lightbox')!;
    const img = document.getElementById('lightbox-img') as HTMLImageElement;
    const nameEl = document.getElementById('lightbox-name')!;
    img.src = src;
    nameEl.textContent = name;
    lb.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  private closeLightbox(): void {
    const lb = document.getElementById('lightbox')!;
    lb.style.display = 'none';
    document.body.style.overflow = '';
    if (this.lightboxBlobUrl) {
      URL.revokeObjectURL(this.lightboxBlobUrl);
      this.lightboxBlobUrl = null;
    }
  }

  /** Render attachment previews for a message */
  private renderAttachments(attachments?: any[]): string {
    if (!attachments || attachments.length === 0) return '';

    return attachments.map((att: any) => {
      const sizeStr = this.formatFileSize(att.size);

      if (att.type === 'image' && att.thumbnail) {
        return `
          <div class="attachment attachment-image" data-attachment-id="${att.id}">
            <img src="data:image/jpeg;base64,${att.thumbnail}" alt="${this.escapeHtml(att.name)}" class="attachment-thumbnail" data-attachment-name="${this.escapeHtml(att.name)}" data-attachment-id="${att.id}" />
            <div class="attachment-info">
              <span class="attachment-name">${this.escapeHtml(att.name)}</span>
              <span class="attachment-size">${sizeStr}</span>
            </div>
          </div>`;
      }

      if (att.type === 'image' && !att.thumbnail) {
        return `
          <div class="attachment attachment-image attachment-no-preview" data-attachment-id="${att.id}">
            <span class="attachment-icon">🖼️</span>
            <div class="attachment-info">
              <span class="attachment-name">${this.escapeHtml(att.name)}</span>
              <span class="attachment-size">${sizeStr}</span>
              <span class="attachment-hint">Image — preview unavailable</span>
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

  /** 3-state presence CSS class: 'online' | 'connecting' | '' */
  private peerStatusClass(peerId: string): string {
    if (this.state.readyPeers.has(peerId)) return 'online';
    if (this.state.connectingPeers.has(peerId)) return 'connecting';
    return '';
  }

  /** Tooltip text for the presence dot */
  private peerStatusTitle(peerId: string): string {
    if (this.state.readyPeers.has(peerId)) return 'Online';
    if (this.state.connectingPeers.has(peerId)) return 'Connecting...';
    return 'Offline';
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
