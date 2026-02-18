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
import { InviteURI } from 'decent-protocol';
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
  onSettingsAction?: (action: string) => void;
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
      showToast: (msg, type) => this.showToast(msg, type),
    });
    this.refreshContactsCache();
  }

  /** Refresh the cached contacts/conversations from the async stores */
  refreshContactsCache(): void {
    this.callbacks.getContacts?.().then(c => { this.cachedContacts = c; });
    this.callbacks.getDirectConversations?.().then(c => { this.cachedDirectConversations = c; });
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
      <div class="welcome-screen">
        <img src="/icons/logo-light.png" alt="DecentChat" class="welcome-logo" />
        <h1>DecentChat</h1>
        <p>End-to-end encrypted, serverless, peer-to-peer messaging</p>
        <div class="welcome-actions">
          <button class="btn-primary" id="create-ws-btn">Create Workspace</button>
          <button class="btn-secondary" id="join-ws-btn">Join with Invite Code</button>
        </div>
        <p style="margin-top: 16px; font-size: 13px; color: var(--text-light);">
          Your Peer ID: <code style="cursor:pointer;" id="welcome-peer-id">${this.state.myPeerId}</code>
        </p>
      </div>
    `;

    document.getElementById('create-ws-btn')!.addEventListener('click', () => this.showCreateWorkspaceModal());
    document.getElementById('join-ws-btn')!.addEventListener('click', () => this.showJoinWorkspaceModal());
    document.getElementById('welcome-peer-id')!.addEventListener('click', () => {
      navigator.clipboard.writeText(this.state.myPeerId);
      this.showToast('Peer ID copied!');
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
              <div class="thread-header">
                <h3>Thread</h3>
                <button class="thread-close" id="thread-close">✕</button>
              </div>
              <div class="thread-messages" id="thread-messages"></div>
              <div class="thread-compose">
                <div class="compose-inner">
                  <textarea class="compose-input" id="thread-input" placeholder="Reply..." rows="1"></textarea>
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
    const isInDMs = this.state.activeDirectConversationId !== null && this.state.activeWorkspaceId === null;

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
      this.state.activeChannelId = null;
      this.state.activeDirectConversationId = null;
      this.refreshContactsCache();
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
    const ws = this.state.activeWorkspaceId
      ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)
      : null;
    const channels = ws ? this.workspaceManager.getChannels(ws.id) : [];
    const dms = ws ? this.workspaceManager.getDMs(ws.id, this.state.myPeerId) : [];

    // Build contacts section
    const contactsHTML = this.cachedContacts.map(c => {
      const isOnline = this.state.readyPeers.has(c.peerId);
      return `
        <div class="sidebar-item" data-contact-peer-id="${c.peerId}" style="font-size:13px;">
          <span class="dm-status ${isOnline ? 'online' : ''}"></span>
          ${this.escapeHtml(c.displayName)}
        </div>`;
    }).join('');

    // Build standalone direct messages section
    const directDMsHTML = this.cachedDirectConversations.map(conv => {
      const contact = this.cachedContacts.find(c => c.peerId === conv.contactPeerId);
      const name = contact?.displayName || conv.contactPeerId.slice(0, 12);
      const isOnline = this.state.readyPeers.has(conv.contactPeerId);
      const isActive = this.state.activeDirectConversationId === conv.id;
      return `
        <div class="sidebar-item ${isActive ? 'active' : ''}" data-direct-conv-id="${conv.id}">
          <span class="dm-status ${isOnline ? 'online' : ''}"></span>
          ${this.escapeHtml(name)}
        </div>`;
    }).join('');

    return `
      <div class="sidebar-header">
        <img src="/icons/icon-32.png" alt="" class="sidebar-logo" />
        <h1>${ws ? this.escapeHtml(ws.name) : 'DecentChat'}</h1>
        <span class="status-dot"></span>
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
          ${directDMsHTML}
          ${dms.map(dm => {
            const otherPeerId = dm.members.find((m: string) => m !== this.state.myPeerId) || '???';
            const isOnline = this.state.readyPeers.has(otherPeerId);
            return `
              <div class="sidebar-item ${dm.id === this.state.activeChannelId && !this.state.activeDirectConversationId ? 'active' : ''}" data-channel-id="${dm.id}">
                <span class="dm-status ${isOnline ? 'online' : ''}"></span>
                ${this.escapeHtml(otherPeerId.slice(0, 12))}
              </div>
            `;
          }).join('')}
        </div>
        ${ws ? `
        <div class="sidebar-section">
          <div class="sidebar-section-header">
            Channels
            <button class="add-btn" id="add-channel-btn" title="Create channel">+</button>
          </div>
          ${channels.map(ch => `
            <div class="sidebar-item ${ch.id === this.state.activeChannelId && !this.state.activeDirectConversationId ? 'active' : ''}" data-channel-id="${ch.id}">
              <span class="channel-hash">#</span> ${this.escapeHtml(ch.name)}
            </div>
          `).join('')}
        </div>
        ` : ''}
        <div class="sidebar-section">
          <div class="sidebar-section-header">Peers</div>
          <div class="sidebar-item" id="connect-peer-btn" style="color: var(--sidebar-text); opacity: 0.8;">
            + Connect to peer...
          </div>
          ${Array.from(this.state.connectedPeers).map(peerId => `
            <div class="sidebar-item" style="font-size:13px;">
              <span class="dm-status ${this.state.readyPeers.has(peerId) ? 'online' : ''}"></span>
              ${peerId.slice(0, 16)}...
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
      const contact = conv ? this.cachedContacts.find(c => c.peerId === conv.contactPeerId) : null;
      const name = contact?.displayName || conv?.contactPeerId.slice(0, 12) || 'Direct Message';

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
        const contact = conv ? this.cachedContacts.find(c => c.peerId === conv.contactPeerId) : null;
        channelName = contact?.displayName || 'this conversation';
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
    const list = container || document.getElementById('messages-list');
    if (!list) {
      console.error('[DecentChat] messages-list element not found! Cannot render message:', msg.id);
      return;
    }

    const emptyState = list.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const isMine = msg.senderId === this.state.myPeerId;
    const senderName = isMine ? this.state.myAlias || 'You' : this.getPeerAlias(msg.senderId);
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
      ? this.messageStore.getThread(this.state.activeChannelId, msg.id).length
      : 0;

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
          ${threadReplies > 0 ? `
            <div class="message-thread-indicator" data-thread-id="${msg.id}">
              💬 ${threadReplies} ${threadReplies === 1 ? 'reply' : 'replies'}
            </div>
          ` : ''}
          <div class="message-reactions" id="reactions-${msg.id}"></div>
          <div class="message-actions-bar">
            ${QUICK_REACTIONS.slice(0, 4).map(e => `<button class="quick-react" data-msg-id="${msg.id}" data-emoji="${e}">${e}</button>`).join('')}
            <button class="message-thread-btn" data-thread-id="${msg.id}">💬</button>
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
    document.getElementById('thread-panel')!.classList.remove('hidden');
    this.renderThreadMessages();
  }

  closeThread(): void {
    this.state.activeThreadId = null;
    this.state.threadOpen = false;
    document.getElementById('thread-panel')?.classList.add('hidden');
  }

  // =========================================================================
  // Channel switching
  // =========================================================================

  switchChannel(channelId: string): void {
    this.state.activeChannelId = channelId;
    this.state.activeDirectConversationId = null;
    this.closeThread();
    this.updateSidebar();
    this.updateChannelHeader();
    this.renderMessages();
    this.updateComposePlaceholder();
    document.getElementById('sidebar')?.classList.remove('open');
  }

  /** Switch to a standalone direct conversation */
  switchToDirectConversation(conversationId: string): void {
    this.state.activeDirectConversationId = conversationId;
    this.state.activeChannelId = conversationId; // channelId = conversationId for message routing
    this.state.activeWorkspaceId = null;
    this.closeThread();
    this.updateSidebar();
    this.updateChannelHeader();
    this.renderMessages();
    this.updateComposePlaceholder();
    document.getElementById('sidebar')?.classList.remove('open');
  }

  private updateComposePlaceholder(): void {
    const input = document.getElementById('compose-input') as HTMLTextAreaElement;
    if (!input) return;

    // Standalone direct conversation
    if (this.state.activeDirectConversationId) {
      const conv = this.cachedDirectConversations.find(c => c.id === this.state.activeDirectConversationId);
      const contact = conv ? this.cachedContacts.find(c => c.peerId === conv.contactPeerId) : null;
      input.placeholder = `Message ${contact?.displayName || 'contact'}`;
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
    this.refreshContactsCache();
    sidebar.innerHTML = this.renderSidebarHTML();
    this.bindSidebarEvents();
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
      this.emojiPicker.show(emojiBtn, (emoji) => {
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
        document.getElementById('sidebar')?.classList.toggle('open');
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

  private bindSidebarActionEvents(): void {
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
      document.getElementById('sidebar')?.classList.toggle('open');
    });
  }

  // =========================================================================
  // Modal helpers
  // =========================================================================

  showModal(
    title: string,
    bodyHTML: string,
    onSubmit: (form: HTMLFormElement) => void,
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
    overlay.querySelector('#modal-form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      onSubmit(e.target as HTMLFormElement);
      overlay.remove();
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
        <label>Display Name</label>
        <input type="text" name="displayName" placeholder="Contact's name" required />
      </div>
      <div class="form-group">
        <label>Public Key (base64)</label>
        <input type="text" name="publicKey" placeholder="Paste their public key" required />
      </div>
      <div class="form-group">
        <label>Peer ID</label>
        <input type="text" name="peerId" placeholder="Paste their Peer ID" required />
      </div>
      <div class="form-group">
        <label>Signaling Server (optional)</label>
        <input type="text" name="signalingServer" placeholder="wss://..." />
      </div>
    `,
      (form) => {
        const displayName = (form.elements.namedItem('displayName') as HTMLInputElement).value.trim();
        const publicKey = (form.elements.namedItem('publicKey') as HTMLInputElement).value.trim();
        const peerId = (form.elements.namedItem('peerId') as HTMLInputElement).value.trim();
        const signalingServer = (form.elements.namedItem('signalingServer') as HTMLInputElement).value.trim();

        if (!displayName || !publicKey || !peerId) {
          this.showToast('Name, public key, and peer ID are required', 'error');
          return;
        }

        const contact: Contact = {
          peerId,
          publicKey,
          displayName,
          signalingServers: signalingServer ? [signalingServer] : [],
          addedAt: Date.now(),
          lastSeen: 0,
        };

        this.callbacks.addContact?.(contact).then(() => {
          this.refreshContactsCache();
          this.updateSidebar();
          this.showToast(`Added ${displayName} to contacts`, 'success');
        });
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

        this.callbacks.startDirectMessage?.(peerId).then((conv) => {
          this.refreshContactsCache();
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
    this.settingsPanel = new SettingsPanel(
      async () => ({ ...await (this.callbacks.getSettings?.() || {}), myPeerId: this.state.myPeerId, myAlias: this.state.myAlias }),
      (key, value) => this.callbacks.persistSetting(key, value),
      (action) => {
        if (action === 'generateSeed') {
          this.callbacks.onSettingsAction?.(action);
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
      const contact = conv ? this.cachedContacts.find(c => c.peerId === conv.contactPeerId) : null;
      return `Message ${contact?.displayName || 'contact'}`;
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
    // Check contacts first
    const contact = this.cachedContacts.find(c => c.peerId === peerId);
    if (contact) return contact.displayName;

    if (!this.state.activeWorkspaceId) return peerId.slice(0, 12);
    const member = this.workspaceManager.getMember(this.state.activeWorkspaceId, peerId);
    return member?.alias || peerId.slice(0, 12);
  }
}
