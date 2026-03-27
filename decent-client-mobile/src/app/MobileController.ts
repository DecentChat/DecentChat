import { get } from 'svelte/store';
import {
  ChunkedReceiver,
  ChunkedSender,
  ContactURI,
  createAttachmentMeta,
  CryptoManager,
  hashBlob,
  InviteURI,
  MemoryContactStore,
  MemoryDirectConversationStore,
  MessageStore,
  Negentropy,
  PersistentStore,
  SeedPhraseManager,
  WorkspaceManager,
  type AttachmentMeta,
  type Channel,
  type Contact,
  type DirectConversation,
  type InviteData,
  type NegentropyQuery,
  type NegentropyResponse,
  type PlaintextMessage,
  type Workspace,
  type WorkspaceMember,
} from '@decentchat/protocol';
import { KeyStore, MessageProtocol, type HandshakeData } from 'decent-client-core';
import { PeerTransport as PeerJSTransport } from '@decentchat/transport-webrtc';
import * as appState from '../stores/appState';
import { CallManager } from './CallManager';

interface WorkspaceStatePayload {
  type: 'workspace-state';
  name: string;
  description?: string;
  channels: Array<Pick<Channel, 'id' | 'name' | 'type'>>;
  members: Array<
    Pick<WorkspaceMember, 'peerId' | 'alias' | 'publicKey' | 'role'> &
      Partial<Pick<WorkspaceMember, 'signingPublicKey' | 'identityId' | 'devices' | 'isBot'>>
  >;
  inviteCode?: string;
  permissions?: Workspace['permissions'];
  bans?: Workspace['bans'];
}

interface JoinRequestPayload {
  type: 'join-request';
  inviteCode: string;
  member: WorkspaceMember;
}

interface JoinAcceptedPayload {
  type: 'join-accepted';
  workspace: Workspace;
  messageHistory?: Record<string, PlaintextMessage[]>;
}

type WorkspaceSyncPayload =
  | WorkspaceStatePayload
  | JoinRequestPayload
  | JoinAcceptedPayload
  | { type: 'join-rejected'; reason: string };

interface WorkspaceSyncMessage {
  type: 'workspace-sync';
  workspaceId?: string;
  sync: WorkspaceSyncPayload;
}

type EncryptedEnvelope = {
  messageId?: string;
  channelId?: string;
  workspaceId?: string;
  threadId?: string;
  timestamp?: number;
  isDirect?: boolean;
  encrypted?: unknown;
  ratchet?: unknown;
  [key: string]: unknown;
};

interface SyncMessageSummary {
  id: string;
  channelId: string;
  senderId: string;
  content: string;
  timestamp: number;
  type: 'text' | 'file' | 'system';
  status?: PlaintextMessage['status'];
  threadId?: string;
  prevHash: string;
  metadata?: PlaintextMessage['metadata'];
  attachments?: AttachmentMeta[];
  recipientPeerIds?: string[];
  ackedBy?: string[];
  readBy?: string[];
  editedAt?: number;
  deletedAt?: number;
  deleted?: boolean;
}

interface MessageSyncRequestPayload {
  type: 'message-sync-request';
  workspaceId: string;
  channelTimestamps: Record<string, number>;
}

interface MessageSyncResponsePayload {
  type: 'message-sync-response';
  workspaceId: string;
  messages: SyncMessageSummary[];
}

interface MessageSyncFetchRequestPayload {
  type: 'message-sync-fetch-request';
  workspaceId: string;
  messageIdsByChannel: Record<string, string[]>;
}

interface MessageSyncNegentropyQueryPayload {
  type: 'message-sync-negentropy-query';
  requestId: string;
  workspaceId: string;
  channelId: string;
  query: NegentropyQuery;
}

interface MessageSyncNegentropyResponsePayload {
  type: 'message-sync-negentropy-response';
  requestId: string;
  workspaceId: string;
  channelId: string;
  response: NegentropyResponse;
}

interface MessageReceiptPayload {
  type: 'ack' | 'read';
  channelId: string;
  messageId: string;
}

interface TypingPayload {
  type: 'typing';
  channelId: string;
  isTyping: boolean;
}

interface MessageEditPayload {
  type: 'message-edit';
  channelId: string;
  messageId: string;
  content: string;
  editedAt: number;
}

interface MessageDeletePayload {
  type: 'message-delete';
  channelId: string;
  messageId: string;
  deletedAt: number;
}

interface MediaRequestPayload {
  type: 'media-request';
  attachmentId: string;
  channelId: string;
  messageId: string;
}

interface MediaResponsePayload {
  type: 'media-response';
  attachmentId: string;
  channelId: string;
  messageId: string;
  available: boolean;
  totalChunks?: number;
}

interface MediaChunkPayload {
  type: 'media-chunk';
  attachmentId: string;
  channelId: string;
  messageId: string;
  index: number;
  total: number;
  data: string;
  chunkHash: string;
}

interface DeferredOutboxPayload {
  _deferred: true;
  content: string;
  type: 'text' | 'file' | 'system';
  channelId: string;
  workspaceId?: string;
  timestamp: number;
  messageId: string;
  threadId?: string;
  isDirect?: boolean;
  metadata?: PlaintextMessage['metadata'];
  attachments?: AttachmentMeta[];
}

interface PendingPreKeyBundleFetch {
  ownerPeerId: string;
  workspaceId?: string;
  pendingPeerIds: Set<string>;
  resolve: (value: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

const NEGENTROPY_QUERY_TIMEOUT_MS = 10_000;
const PRE_KEY_FETCH_TIMEOUT_MS = 2_500;
const PRE_KEY_CUSTODIAN_TARGET = 2;
const DIRECT_SYNC_CHANNEL_KEY = '__direct__';
const DIRECT_SYNC_WORKSPACE_PREFIX = '__direct__:';


type MobileInitOptions = {
  seedPhrase?: string | null;
  alias?: string | null;
  sourcePeerId?: string | null;
};

type SendMessageOptions = {
  threadId?: string;
  type?: 'text' | 'file' | 'system';
  metadata?: PlaintextMessage['metadata'];
  attachments?: AttachmentMeta[];
  skipCounter?: boolean;
};

type TransportCtor = new () => PeerJSTransport;

declare global {
  var __MockTransport: TransportCtor | undefined;
}

export class MobileController {
  readonly cryptoManager = new CryptoManager();
  readonly keyStore = new KeyStore(this.cryptoManager);
  readonly persistentStore = new PersistentStore();
  readonly workspaceManager = new WorkspaceManager();
  readonly messageStore = new MessageStore();
  readonly contactStore = new MemoryContactStore();
  readonly directConversationStore = new MemoryDirectConversationStore();

  readonly transport: PeerJSTransport;
  readonly callManager: CallManager;
  messageProtocol: MessageProtocol | null = null;

  private myPublicKey = '';
  private mySigningPublicKey = '';
  private transportReady = false;
  private initialized = false;

  private readonly connectedPeers = new Set<string>();
  private readonly readyPeers = new Set<string>();
  private readonly handshakeSent = new Set<string>();
  private readonly pendingJoinRequests = new Map<string, { inviteCode: string; workspaceId: string }>();
  private readonly contactsByPeerId = new Map<string, Contact>();
  private readonly directConversationsById = new Map<string, DirectConversation>();
  private readonly pendingNegentropyQueries = new Map<
    string,
    { peerId: string; resolve: (value: NegentropyResponse) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly pendingPreKeyBundleFetches = new Map<string, PendingPreKeyBundleFetch>();
  private readonly pendingMediaTransfers = new Map<string, { peerId: string; receiver: ChunkedReceiver }>();
  private readonly localAttachmentBlobs = new Map<string, ArrayBuffer>();
  private readonly attachmentMessageIndex = new Map<string, { channelId: string; messageId: string }>();
  private readonly attachmentObjectUrls = new Map<string, string>();

  readonly stores = appState;

  constructor() {
    const TransportClass = globalThis.__MockTransport ?? PeerJSTransport;
    this.transport = new TransportClass();
    this.callManager = new CallManager({
      getMyPeerId: () => get(appState.myPeerId),
      getDisplayName: (peerId: string) => this.getPeerDisplayName(peerId, get(appState.activeWorkspaceId)),
      sendSignal: (peerId, signal) => this.transport.send(peerId, signal),
      broadcastSignal: (signal) => {
        for (const peerId of this.readyPeers) {
          this.transport.send(peerId, signal);
        }
      },
      getConnectedPeers: () => Array.from(this.readyPeers),
    });
    this.setupTransportHandlers();
  }

  async init(options: MobileInitOptions = {}): Promise<void> {
    if (this.initialized) return;

    appState.connectionStatus.set('connecting');

    await this.keyStore.init();
    await this.persistentStore.init();
    try {
      await this.persistentStore.prunePreKeyBundles();
    } catch (error) {
      console.warn('[MobileController] pre-key bundle cleanup failed:', (error as Error).message);
    }

    await this.bootstrapIdentity(options);
    await this.restoreLocalState();

    const preferredPeerId = get(appState.myPeerId) ?? undefined;

    try {
      const assignedPeerId = await this.transport.init(preferredPeerId);
      this.transportReady = true;
      appState.myPeerId.set(assignedPeerId);
      await this.persistentStore.saveSetting('myPeerId', assignedPeerId);
      await this.connectKnownWorkspacePeers();
    } catch (error) {
      console.warn('[MobileController] transport init failed:', (error as Error).message);
      this.transportReady = false;
    }

    this.initialized = true;
    this.updateConnectionState();
  }

  async destroy(): Promise<void> {
    await this.callManager.endCall();
    this.transport.destroy();
    this.connectedPeers.clear();
    this.readyPeers.clear();
    this.handshakeSent.clear();
    this.contactsByPeerId.clear();
    this.directConversationsById.clear();
    this.pendingMediaTransfers.clear();
    this.localAttachmentBlobs.clear();
    this.attachmentMessageIndex.clear();
    for (const objectUrl of this.attachmentObjectUrls.values()) {
      URL.revokeObjectURL(objectUrl);
    }
    this.attachmentObjectUrls.clear();
    for (const pending of this.pendingNegentropyQueries.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Controller destroyed'));
    }
    this.pendingNegentropyQueries.clear();

    for (const pending of this.pendingPreKeyBundleFetches.values()) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.pendingPreKeyBundleFetches.clear();

    appState.typingByChannel.set({});
    this.transportReady = false;
    this.initialized = false;
    this.updateConnectionState();
  }

  async createWorkspace(name: string): Promise<Workspace | null> {
    const myPeerId = get(appState.myPeerId);
    const myAlias = this.getMyAlias();

    if (!myPeerId || !name.trim()) return null;

    const workspace = this.workspaceManager.createWorkspace(
      name.trim(),
      myPeerId,
      myAlias,
      this.myPublicKey,
    );

    await this.persistentStore.saveWorkspace(workspace);
    this.syncWorkspaceStores(workspace.id);

    for (const channel of workspace.channels) {
      this.syncChannelMessages(channel.id);
    }

    this.broadcastWorkspaceState(workspace.id);
    return workspace;
  }

  async joinWorkspace(inviteInput: string): Promise<{ success: boolean; error?: string }> {
    const input = inviteInput.trim();
    if (!input) return { success: false, error: 'Invite is empty' };

    const parsed = this.parseInviteInput(input);
    if (!parsed.inviteCode) {
      return { success: false, error: 'Invalid invite code or link' };
    }

    const myPeerId = get(appState.myPeerId);
    if (!myPeerId) return { success: false, error: 'Identity not initialized' };

    const myAlias = this.getMyAlias();
    const workspace = this.workspaceManager.createWorkspace(
      parsed.inviteData?.workspaceName || parsed.inviteCode,
      myPeerId,
      myAlias,
      this.myPublicKey,
      {
        workspaceId: parsed.inviteData?.workspaceId,
        inviteCode: parsed.inviteCode,
      },
    );

    const me = workspace.members.find((member) => member.peerId === myPeerId);
    if (me) me.role = 'member';

    const inviterPeerId = parsed.inviteData?.peerId;
    if (inviterPeerId) {
      workspace.createdBy = inviterPeerId;
      if (!workspace.members.some((member) => member.peerId === inviterPeerId)) {
        this.workspaceManager.addMember(workspace.id, {
          peerId: inviterPeerId,
          alias: inviterPeerId.slice(0, 8),
          publicKey: parsed.inviteData?.publicKey || '',
          joinedAt: Date.now(),
          role: 'owner',
        });
      }
    }

    await this.persistentStore.saveWorkspace(workspace);
    this.syncWorkspaceStores(workspace.id);
    for (const channel of workspace.channels) {
      this.syncChannelMessages(channel.id);
    }

    if (parsed.inviteData) {
      await this.applyInviteSignalingServers(parsed.inviteData);
    }

    const peerCandidates = [
      parsed.inviteData?.peerId,
      ...(parsed.inviteData?.peers ?? []),
    ].filter((peerId): peerId is string => !!peerId && peerId !== myPeerId);

    const uniquePeerCandidates = [...new Set(peerCandidates)];
    for (const peerId of uniquePeerCandidates) {
      this.connectPeer(peerId);
    }

    if (parsed.inviteCode && parsed.inviteData?.peerId) {
      this.pendingJoinRequests.set(parsed.inviteData.peerId, {
        inviteCode: parsed.inviteCode,
        workspaceId: workspace.id,
      });

      if (this.readyPeers.has(parsed.inviteData.peerId)) {
        this.sendJoinRequest(parsed.inviteData.peerId, parsed.inviteCode);
        this.pendingJoinRequests.delete(parsed.inviteData.peerId);
      }
    }

    return { success: true };
  }

  async addContact(contact: Contact | string): Promise<Contact | null> {
    let normalizedContact: Contact | null = null;

    if (typeof contact === 'string') {
      const parsed = ContactURI.decode(contact);
      if (!parsed.peerId) {
        throw new Error('Contact URI is missing peer ID');
      }

      normalizedContact = {
        peerId: parsed.peerId,
        publicKey: parsed.publicKey,
        displayName: parsed.displayName || parsed.peerId.slice(0, 8),
        signalingServers: parsed.signalingServers ?? [],
        addedAt: Date.now(),
        lastSeen: Date.now(),
      };
    } else {
      normalizedContact = {
        ...contact,
        displayName: contact.displayName?.trim() || contact.peerId.slice(0, 8),
        signalingServers: contact.signalingServers ?? [],
        addedAt: contact.addedAt || Date.now(),
        lastSeen: contact.lastSeen || Date.now(),
      };
    }

    if (!normalizedContact.peerId?.trim() || !normalizedContact.publicKey?.trim()) {
      throw new Error('Contact is missing peer ID or public key');
    }

    await this.contactStore.add(normalizedContact);
    this.contactsByPeerId.set(normalizedContact.peerId, normalizedContact);
    await this.persistentStore.saveContact(normalizedContact);

    await this.persistentStore.savePeer({
      peerId: normalizedContact.peerId,
      publicKey: normalizedContact.publicKey,
      lastSeen: Date.now(),
      alias: normalizedContact.displayName,
    });

    await this.applyContactSignalingServers(normalizedContact);

    this.connectPeer(normalizedContact.peerId);
    this.updateConnectionState();

    return normalizedContact;
  }

  async listContacts(): Promise<Contact[]> {
    const contacts = await this.contactStore.list();
    for (const contact of contacts) {
      this.contactsByPeerId.set(contact.peerId, contact);
    }
    return contacts.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  getContact(peerId: string): Contact | null {
    return this.contactsByPeerId.get(peerId) ?? null;
  }

  getMyContactURI(): string | null {
    const myPeerId = get(appState.myPeerId);
    if (!myPeerId || !this.myPublicKey) return null;

    return ContactURI.encode({
      publicKey: this.myPublicKey,
      displayName: this.getMyAlias(),
      peerId: myPeerId,
      signalingServers: [],
    });
  }

  async startDirectMessage(contactPeerId: string): Promise<DirectConversation | null> {
    const peerId = contactPeerId.trim();
    if (!peerId) return null;

    const conversation = await this.directConversationStore.create(peerId);
    this.directConversationsById.set(conversation.id, conversation);
    await this.persistentStore.saveDirectConversation(conversation);

    this.syncChannelMessages(conversation.id);
    this.connectPeer(peerId);
    return conversation;
  }

  async listDirectConversations(): Promise<DirectConversation[]> {
    const conversations = await this.directConversationStore.list();
    for (const conversation of conversations) {
      this.directConversationsById.set(conversation.id, conversation);
    }
    return conversations.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }

  getDirectConversation(channelId: string): DirectConversation | null {
    return this.directConversationsById.get(channelId) ?? null;
  }

  async hasChatsOrContacts(): Promise<boolean> {
    if (this.contactsByPeerId.size > 0 || this.directConversationsById.size > 0) {
      return true;
    }

    const contacts = await this.contactStore.list();
    if (contacts.length > 0) {
      for (const contact of contacts) {
        this.contactsByPeerId.set(contact.peerId, contact);
      }
      return true;
    }

    const directConversations = await this.directConversationStore.list();
    if (directConversations.length > 0) {
      for (const conversation of directConversations) {
        this.directConversationsById.set(conversation.id, conversation);
      }
      return true;
    }

    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      if (workspace.channels.length > 0) {
        return true;
      }
    }

    return false;
  }

  setActiveWorkspace(workspaceId: string): void {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return;

    appState.activeWorkspaceId.set(workspace.id);
    void this.persistentStore.saveSetting('mobile:activeWorkspaceId', workspace.id);
  }

  connectPeer(peerId: string): void {
    const myPeerId = get(appState.myPeerId);
    if (!peerId || !this.transportReady || peerId === myPeerId) return;

    if (this.readyPeers.size === 0) {
      appState.connectionStatus.set('connecting');
    }

    this.transport
      .connect(peerId)
      .catch((error) => console.warn('[MobileController] connect failed:', (error as Error).message));
  }

  async refresh(): Promise<void> {
    if (!this.initialized) {
      await this.init();
      return;
    }

    if (this.countKnownPeers() > 0) {
      appState.connectionStatus.set('connecting');
    }

    await this.connectKnownWorkspacePeers();

    for (const peerId of this.readyPeers) {
      this.sendWorkspaceState(peerId);
      await this.requestMessageSyncForPeer(peerId);
      await this.flushOfflineQueue(peerId);
    }

    this.updateConnectionState();
  }

  async sendMessage(channelId: string, rawContent: string, options: SendMessageOptions = {}): Promise<boolean> {
    const content = rawContent.trim();
    if (!content) return false;

    const myPeerId = get(appState.myPeerId);
    if (!myPeerId) return false;

    const directConversation = await this.directConversationStore.get(channelId);
    const messageType = options.type ?? 'text';

    if (directConversation) {
      this.directConversationsById.set(directConversation.id, directConversation);

      const message = await this.messageStore.createMessage(channelId, myPeerId, content, messageType, options.threadId);
      message.status = 'sent';
      message.recipientPeerIds = [directConversation.contactPeerId];
      message.ackedBy = [];
      message.readBy = [];
      if (options.metadata) message.metadata = options.metadata;
      if (options.attachments?.length) {
        (message as PlaintextMessage & { attachments?: AttachmentMeta[] }).attachments = options.attachments;
        this.registerAttachmentIndex(channelId, message.id, options.attachments);
      }

      const result = await this.messageStore.addMessage(message);
      if (!result.success) return false;

      await this.persistentStore.saveMessage(message);
      await this.directConversationStore.updateLastMessage(channelId, message.timestamp);

      const updatedConversation = await this.directConversationStore.get(channelId);
      if (updatedConversation) {
        this.directConversationsById.set(updatedConversation.id, updatedConversation);
        await this.persistentStore.saveDirectConversation(updatedConversation);
      } else {
        await this.persistentStore.saveDirectConversation(directConversation);
      }

      this.syncChannelMessages(channelId);
      if (!options.skipCounter) this.incrementMessagesSentCounter();

      await this.dispatchOrQueueMessageToPeer(directConversation.contactPeerId, {
        message,
        content,
        type: messageType,
        channelId,
        timestamp: message.timestamp,
        threadId: options.threadId,
        isDirect: true,
        metadata: options.metadata,
        attachments: options.attachments,
      });

      return true;
    }

    const workspace = this.findWorkspaceByChannel(channelId);
    const channel = workspace?.channels.find((item) => item.id === channelId);
    if (!workspace || !channel) return false;

    const message = await this.messageStore.createMessage(channelId, myPeerId, content, messageType, options.threadId);
    message.status = 'sent';
    const recipientPeerIds = this.getRecipientPeerIds(workspace, channel);
    message.recipientPeerIds = [...recipientPeerIds];
    message.ackedBy = [];
    message.readBy = [];
    if (options.metadata) message.metadata = options.metadata;
    if (options.attachments?.length) {
      (message as PlaintextMessage & { attachments?: AttachmentMeta[] }).attachments = options.attachments;
      this.registerAttachmentIndex(channelId, message.id, options.attachments);
    }

    const result = await this.messageStore.addMessage(message);
    if (!result.success) return false;

    await this.persistentStore.saveMessage(message);
    this.syncChannelMessages(channelId);
    if (!options.skipCounter) this.incrementMessagesSentCounter();

    await Promise.allSettled(
      recipientPeerIds.map((peerId) => this.dispatchOrQueueMessageToPeer(peerId, {
        message,
        content,
        type: messageType,
        channelId,
        workspaceId: workspace.id,
        timestamp: message.timestamp,
        threadId: options.threadId,
        metadata: options.metadata,
        attachments: options.attachments,
      })),
    );

    return true;
  }

  async sendAttachment(channelId: string, file: File, threadId?: string): Promise<boolean> {
    const arrayBuffer = await file.arrayBuffer();
    const hash = await hashBlob(arrayBuffer);
    const attachment = await createAttachmentMeta(file, hash);

    this.localAttachmentBlobs.set(attachment.id, arrayBuffer);

    return this.sendMessage(channelId, file.name, {
      threadId,
      type: 'file',
      metadata: {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
      },
      attachments: [attachment],
      skipCounter: true,
    });
  }

  async pickAndSendAttachment(channelId: string, threadId?: string): Promise<boolean> {
    if (typeof document === 'undefined') return false;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '*/*';

    const file = await new Promise<File | null>((resolve) => {
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.oncancel = () => resolve(null);
      input.click();
    });

    if (!file) return false;
    return this.sendAttachment(channelId, file, threadId);
  }

  hasAttachmentData(attachmentId: string): boolean {
    return this.localAttachmentBlobs.has(attachmentId);
  }

  getAttachmentObjectUrl(attachmentId: string): string | null {
    if (!this.localAttachmentBlobs.has(attachmentId)) return null;

    const existing = this.attachmentObjectUrls.get(attachmentId);
    if (existing) return existing;

    const bytes = this.localAttachmentBlobs.get(attachmentId);
    if (!bytes) return null;

    const attachmentRef = this.attachmentMessageIndex.get(attachmentId);
    const attachmentMeta = attachmentRef
      ? this.findAttachmentMeta(attachmentRef.channelId, attachmentRef.messageId, attachmentId)
      : null;
    const blob = new Blob([bytes], attachmentMeta?.mimeType ? { type: attachmentMeta.mimeType } : undefined);
    const objectUrl = URL.createObjectURL(blob);
    this.attachmentObjectUrls.set(attachmentId, objectUrl);
    return objectUrl;
  }

  openAttachment(attachmentId: string): boolean {
    if (typeof window === 'undefined') return false;

    const objectUrl = this.getAttachmentObjectUrl(attachmentId);
    if (!objectUrl) return false;

    window.open(objectUrl, '_blank', 'noopener,noreferrer');
    return true;
  }

  async requestMessageSync(): Promise<void> {
    const peers = Array.from(this.readyPeers);
    await Promise.allSettled(peers.map((peerId) => this.requestMessageSyncForPeer(peerId)));
  }

  sendTypingIndicator(channelId: string, isTyping: boolean): void {
    const workspace = this.findWorkspaceByChannel(channelId);
    if (workspace) {
      const channel = workspace.channels.find((candidate) => candidate.id === channelId);
      if (!channel) return;
      const recipients = this.getRecipientPeerIds(workspace, channel);
      for (const peerId of recipients) {
        if (!this.readyPeers.has(peerId)) continue;
        this.transport.send(peerId, {
          type: 'typing',
          channelId,
          isTyping,
        } satisfies TypingPayload);
      }
      return;
    }

    const directConversation = this.directConversationsById.get(channelId);
    if (!directConversation) return;
    const peerId = directConversation.contactPeerId;
    if (!this.readyPeers.has(peerId)) return;
    this.transport.send(peerId, {
      type: 'typing',
      channelId,
      isTyping,
    } satisfies TypingPayload);
  }

  async editMessage(channelId: string, messageId: string, nextContent: string): Promise<boolean> {
    const myPeerId = get(appState.myPeerId);
    const content = nextContent.trim();
    if (!myPeerId || !content) return false;

    const messages = this.messageStore.getMessages(channelId);
    const target = messages.find((message) => message.id === messageId);
    if (!target || target.senderId !== myPeerId) return false;

    target.content = content;
    (target as PlaintextMessage & { editedAt?: number }).editedAt = Date.now();
    await this.persistentStore.saveMessage(target);
    this.syncChannelMessages(channelId);

    await this.broadcastControlForChannel(channelId, {
      type: 'message-edit',
      channelId,
      messageId,
      content,
      editedAt: (target as PlaintextMessage & { editedAt: number }).editedAt,
    } satisfies MessageEditPayload);

    return true;
  }

  async deleteMessage(channelId: string, messageId: string): Promise<boolean> {
    const myPeerId = get(appState.myPeerId);
    if (!myPeerId) return false;

    const messages = this.messageStore.getMessages(channelId);
    const target = messages.find((message) => message.id === messageId);
    if (!target || target.senderId !== myPeerId) return false;

    target.content = '🗑️ Message deleted';
    target.type = 'system';
    (target as PlaintextMessage & { deletedAt?: number; deleted?: boolean }).deletedAt = Date.now();
    (target as PlaintextMessage & { deletedAt?: number; deleted?: boolean }).deleted = true;

    await this.persistentStore.saveMessage(target);
    this.syncChannelMessages(channelId);

    await this.broadcastControlForChannel(channelId, {
      type: 'message-delete',
      channelId,
      messageId,
      deletedAt: (target as PlaintextMessage & { deletedAt: number }).deletedAt,
    } satisfies MessageDeletePayload);

    return true;
  }

  async markChannelRead(channelId: string): Promise<void> {
    const myPeerId = get(appState.myPeerId);
    if (!myPeerId) return;

    const messages = this.messageStore.getMessages(channelId);
    const pendingWrites: Promise<void>[] = [];
    const readReceipts = new Map<string, string[]>();
    let changed = false;

    for (const message of messages) {
      if (message.senderId === myPeerId || message.status === 'read') continue;
      message.status = 'read';
      changed = true;
      pendingWrites.push(this.persistentStore.saveMessage(message));

      if (!readReceipts.has(message.senderId)) {
        readReceipts.set(message.senderId, []);
      }
      readReceipts.get(message.senderId)!.push(message.id);
    }

    if (!changed) return;

    await Promise.allSettled(pendingWrites);
    this.syncChannelMessages(channelId);

    for (const [peerId, messageIds] of readReceipts) {
      if (!this.readyPeers.has(peerId)) continue;
      for (const messageId of messageIds) {
        this.transport.send(peerId, {
          type: 'read',
          channelId,
          messageId,
        } satisfies MessageReceiptPayload);
      }
    }
  }

  private getDirectSyncWorkspaceId(peerId: string): string {
    return `${DIRECT_SYNC_WORKSPACE_PREFIX}${peerId}`;
  }

  private parseDirectSyncPeerId(workspaceId: string | undefined): string | null {
    if (typeof workspaceId !== 'string' || !workspaceId.startsWith(DIRECT_SYNC_WORKSPACE_PREFIX)) return null;
    const peerId = workspaceId.slice(DIRECT_SYNC_WORKSPACE_PREFIX.length).trim();
    return peerId || null;
  }

  getPeerDisplayName(peerId: string, workspaceId?: string | null): string {
    if (!peerId) return '';

    const contact = this.contactsByPeerId.get(peerId) || this.contactStore.getSync?.(peerId);
    if (contact?.displayName?.trim()) return contact.displayName;

    if (workspaceId) {
      const workspace = this.workspaceManager.getWorkspace(workspaceId);
      const member = workspace?.members.find((item) => item.peerId === peerId);
      if (member?.alias?.trim()) return member.alias;
    }

    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      const member = workspace.members.find((item) => item.peerId === peerId);
      if (member?.alias?.trim()) return member.alias;
    }

    return peerId.slice(0, 8);
  }

  private async bootstrapIdentity(options: MobileInitOptions = {}): Promise<void> {
    const seedPhraseManager = new SeedPhraseManager();

    const providedSeed = this.normalizeSeedPhrase(options.seedPhrase);
    const persistedSeed = this.normalizeSeedPhrase(await this.persistentStore.getSetting('seedPhrase'));
    const localStorageSeed = this.normalizeSeedPhrase(this.readLocalStorage('decentchat-seed-phrase'));

    let seedPhrase = providedSeed || persistedSeed || localStorageSeed;
    if (!seedPhrase) {
      seedPhrase = seedPhraseManager.generate().mnemonic;
    }

    const validation = seedPhraseManager.validate(seedPhrase);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid seed phrase');
    }

    await this.persistentStore.saveSetting('seedPhrase', seedPhrase);
    this.writeLocalStorage('decentchat-seed-phrase', seedPhrase);

    let deviceIndex = Number((await this.persistentStore.getSetting('deviceIndex')) ?? 0) || 0;
    let derived;
    try {
      derived = await seedPhraseManager.deriveDeviceKeys(seedPhrase, deviceIndex);

      const sourcePeerId = options.sourcePeerId?.trim();
      if (sourcePeerId && derived.peerId === sourcePeerId) {
        // Recovery from another live device must not reuse the same device path,
        // otherwise both devices get the same peerId and kick each other offline.
        let nextIndex = deviceIndex + 1;
        while (nextIndex < 32) {
          const nextDerived = await seedPhraseManager.deriveDeviceKeys(seedPhrase, nextIndex);
          if (nextDerived.peerId !== sourcePeerId) {
            deviceIndex = nextIndex;
            derived = nextDerived;
            await this.persistentStore.saveSetting('deviceIndex', deviceIndex);
            this.writeLocalStorage('decentchat-device-index', String(deviceIndex));
            console.info('[MobileController] source peer collision detected; switched to device index', deviceIndex);
            break;
          }
          nextIndex += 1;
        }
      } else {
        await this.persistentStore.saveSetting('deviceIndex', deviceIndex);
        this.writeLocalStorage('decentchat-device-index', String(deviceIndex));
      }
    } catch (cryptoError) {
      const err = cryptoError as Error;
      console.error('[MobileController] deriveDeviceKeys failed:', err.name, err.message, err.stack);
      throw new Error(`Key derivation failed (${err.name}): ${err.message}`);
    }

    const ecdhKeyPair = derived.deviceKeys.ecdhKeyPair;
    const ecdsaKeyPair = derived.deviceKeys.ecdsaKeyPair;

    await this.keyStore.storeECDHKeyPair(ecdhKeyPair);
    await this.keyStore.storeECDSAKeyPair(ecdsaKeyPair);

    this.cryptoManager.setKeyPair(ecdhKeyPair);
    this.myPublicKey = await this.cryptoManager.exportPublicKey(ecdhKeyPair.publicKey);
    this.mySigningPublicKey = await this.cryptoManager.exportPublicKey(ecdsaKeyPair.publicKey);

    appState.myPeerId.set(derived.peerId);

    const providedAlias = typeof options.alias === 'string' ? options.alias.trim() : '';
    const storedAlias = await this.persistentStore.getSetting('myAlias');
    const localStorageAlias = this.readLocalStorage('decentchat-alias')?.trim() || '';
    const defaultAlias = derived.peerId.slice(0, 8);

    const alias = providedAlias
      || (typeof storedAlias === 'string' && storedAlias.trim() ? storedAlias.trim() : '')
      || localStorageAlias
      || defaultAlias;

    appState.myAlias.set(alias);
    await this.persistentStore.saveSetting('myAlias', alias);
    this.writeLocalStorage('decentchat-alias', alias);

    this.messageProtocol = new MessageProtocol(this.cryptoManager, derived.peerId);
    this.messageProtocol.setPersistence({
      save: (peerId, state) => this.persistentStore.saveRatchetState(peerId, state),
      load: async (peerId) => this.persistentStore.getRatchetState(peerId) ?? null,
      delete: (peerId) => this.persistentStore.deleteRatchetState(peerId),
      savePreKeyBundle: (peerId, bundle) => this.persistentStore.savePreKeyBundle(peerId, bundle),
      loadPreKeyBundle: async (peerId) => (await this.persistentStore.getPreKeyBundle(peerId)) ?? null,
      deletePreKeyBundle: (peerId) => this.persistentStore.deletePreKeyBundle(peerId),
      saveLocalPreKeyState: (ownerPeerId, state) => this.persistentStore.saveLocalPreKeyState(ownerPeerId, state),
      loadLocalPreKeyState: async (ownerPeerId) => (await this.persistentStore.getLocalPreKeyState(ownerPeerId)) ?? null,
      deleteLocalPreKeyState: (ownerPeerId) => this.persistentStore.deleteLocalPreKeyState(ownerPeerId),
    });
    await this.messageProtocol.init(ecdsaKeyPair);
    await this.messageProtocol.createPreKeyBundle();
  }

  private normalizeSeedPhrase(value: unknown): string | null {
    if (typeof value !== 'string') return null;

    const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
    return normalized || null;
  }

  private readLocalStorage(key: string): string | null {
    if (typeof window === 'undefined') return null;

    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private writeLocalStorage(key: string, value: string): void {
    if (typeof window === 'undefined') return;

    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Best effort only.
    }
  }

  private async restoreLocalState(): Promise<void> {
    const storedWorkspaces = (await this.persistentStore.getAllWorkspaces()) as Workspace[];
    const activeWorkspaceFromStorage = await this.persistentStore.getSetting('mobile:activeWorkspaceId');

    for (const workspace of storedWorkspaces) {
      this.workspaceManager.importWorkspace(workspace);
    }

    const storedContacts = (await this.persistentStore.getAllContacts()) as Contact[];
    for (const contact of storedContacts) {
      await this.contactStore.add(contact);
      this.contactsByPeerId.set(contact.peerId, contact);
    }

    const storedDirectConversations = (await this.persistentStore.getAllDirectConversations()) as DirectConversation[];
    for (const conversation of storedDirectConversations) {
      await this.directConversationStore.create(conversation.contactPeerId, {
        originWorkspaceId: conversation.originWorkspaceId,
      });

      const existing = await this.directConversationStore.getByContact(conversation.contactPeerId);
      if (existing && existing.id !== conversation.id) {
        await this.directConversationStore.remove(existing.id);
      }
    }

    for (const conversation of storedDirectConversations) {
      (this.directConversationStore as any).conversations?.set(conversation.id, conversation);
      this.directConversationsById.set(conversation.id, conversation);
    }

    appState.typingByChannel.set({});
    this.syncWorkspaceStores(typeof activeWorkspaceFromStorage === 'string' ? activeWorkspaceFromStorage : undefined);

    const messageMap: Record<string, PlaintextMessage[]> = {};

    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      for (const channel of workspace.channels) {
        const storedMessages = (await this.persistentStore.getMessagesByChannel(channel.id)) as PlaintextMessage[];

        for (const message of storedMessages) {
          this.messageStore.forceAdd(message);
        }

        messageMap[channel.id] = this.messageStore.getMessages(channel.id);
      }
    }

    for (const conversation of this.directConversationsById.values()) {
      const storedMessages = (await this.persistentStore.getMessagesByChannel(conversation.id)) as PlaintextMessage[];

      for (const message of storedMessages) {
        this.messageStore.forceAdd(message);
      }

      messageMap[conversation.id] = this.messageStore.getMessages(conversation.id);
    }

    appState.messages.set(messageMap);
  }

  private async connectKnownWorkspacePeers(): Promise<void> {
    const myPeerId = get(appState.myPeerId);
    if (!myPeerId) return;

    const allPeers = new Set<string>();
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      for (const member of workspace.members) {
        if (member.peerId !== myPeerId) allPeers.add(member.peerId);
      }
    }

    for (const contact of this.contactsByPeerId.values()) {
      if (contact.peerId !== myPeerId) {
        allPeers.add(contact.peerId);
      }
    }

    for (const peerId of allPeers) {
      this.connectPeer(peerId);
    }
  }

  private setupTransportHandlers(): void {
    this.transport.onConnect = async (peerId: string) => {
      this.connectedPeers.add(peerId);
      this.updateConnectedPeersStore();
      this.updateConnectionState();

      await this.sendHandshake(peerId);
    };

    this.transport.onDisconnect = (peerId: string) => {
      this.connectedPeers.delete(peerId);
      this.readyPeers.delete(peerId);
      this.handshakeSent.delete(peerId);
      this.clearTypingForPeer(peerId);

      for (const [requestId, pending] of this.pendingNegentropyQueries.entries()) {
        if (pending.peerId !== peerId) continue;
        clearTimeout(pending.timer);
        pending.reject(new Error(`Peer ${peerId} disconnected during sync`));
        this.pendingNegentropyQueries.delete(requestId);
      }

      for (const pending of this.pendingPreKeyBundleFetches.values()) {
        if (!pending.pendingPeerIds.has(peerId)) continue;
        pending.pendingPeerIds.delete(peerId);
        if (pending.pendingPeerIds.size === 0) {
          clearTimeout(pending.timer);
          pending.resolve(false);
        }
      }

      this.updateConnectedPeersStore();
      this.updateConnectionState();
      void this.callManager.handlePeerDisconnect(peerId);
    };

    this.transport.onError = (error: Error) => {
      console.warn('[MobileController] transport error:', error.message);
      this.updateConnectionState();
    };

    this.transport.onMessage = async (peerId: string, payload: unknown) => {
      if (!payload || typeof payload !== 'object') return;
      const data = payload as Record<string, unknown>;

      if (data.type === 'handshake') {
        await this.handleHandshake(peerId, data as unknown as HandshakeData);
        return;
      }

      if (await this.handlePreKeyControlMessage(peerId, data)) {
        return;
      }

      if (data.type === 'workspace-sync') {
        await this.handleWorkspaceSync(peerId, data as unknown as WorkspaceSyncMessage);
        return;
      }

      if (data.type === 'name-announce') {
        await this.handleNameAnnounce(peerId, data);
        return;
      }

      if (data.type === 'ack' || data.type === 'read') {
        await this.handleReceiptControl(peerId, data as unknown as MessageReceiptPayload);
        return;
      }

      if (data.type === 'typing') {
        this.handleTypingControl(peerId, data as unknown as TypingPayload);
        return;
      }

      if (data.type === 'message-edit') {
        await this.handleMessageEditControl(peerId, data as unknown as MessageEditPayload);
        return;
      }

      if (data.type === 'message-delete') {
        await this.handleMessageDeleteControl(peerId, data as unknown as MessageDeletePayload);
        return;
      }

      if (data.type === 'media-request') {
        await this.handleMediaRequest(peerId, data as unknown as MediaRequestPayload);
        return;
      }

      if (data.type === 'media-response') {
        this.handleMediaResponse(peerId, data as unknown as MediaResponsePayload);
        return;
      }

      if (data.type === 'media-chunk') {
        await this.handleMediaChunk(peerId, data as unknown as MediaChunkPayload);
        return;
      }

      if (data.type === 'message-sync-negentropy-query') {
        await this.handleNegentropySyncQuery(peerId, data as unknown as MessageSyncNegentropyQueryPayload);
        return;
      }

      if (data.type === 'message-sync-negentropy-response') {
        this.handleNegentropySyncResponse(peerId, data as unknown as MessageSyncNegentropyResponsePayload);
        return;
      }

      if (data.type === 'message-sync-fetch-request') {
        await this.handleMessageSyncFetchRequest(peerId, data as unknown as MessageSyncFetchRequestPayload);
        return;
      }

      if (data.type === 'message-sync-request') {
        await this.handleMessageSyncRequest(peerId, data as unknown as MessageSyncRequestPayload);
        return;
      }

      if (data.type === 'message-sync-response') {
        await this.handleMessageSyncResponse(peerId, data as unknown as MessageSyncResponsePayload);
        return;
      }

      if (this.callManager.isHuddleSignal(data)) {
        await this.callManager.handleSignal(peerId, data);
        return;
      }

      if (!this.isEncryptedEnvelope(data)) return;
      await this.handleEncryptedEnvelope(peerId, data);
    };
  }

  private shouldAttemptPreKeyBootstrap(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return message.includes('No shared secret with peer');
  }

  private resolveSharedWorkspaceIds(peerId: string): string[] {
    const myPeerId = get(appState.myPeerId);
    if (!peerId || !myPeerId) return [];

    return this.workspaceManager
      .getAllWorkspaces()
      .filter((workspace) => (
        workspace.members.some((member) => member.peerId === myPeerId)
        && workspace.members.some((member) => member.peerId === peerId)
      ))
      .map((workspace) => workspace.id);
  }

  private isWorkspaceMember(peerId: string, workspaceId: string): boolean {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return false;
    return workspace.members.some((member) => member.peerId === peerId);
  }

  private selectCustodianPeers(workspaceId: string, recipientPeerId: string, limit = PRE_KEY_CUSTODIAN_TARGET): string[] {
    const myPeerId = get(appState.myPeerId);
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace || !myPeerId) return [];

    return workspace.members
      .map((member) => member.peerId)
      .filter((peerId) => peerId !== myPeerId && peerId !== recipientPeerId)
      .filter((peerId) => this.readyPeers.has(peerId))
      .map((peerId) => {
        let score = 100;
        const alias = this.getPeerDisplayName(peerId, workspaceId).toLowerCase();
        if (alias.includes('mobile') || alias.includes('iphone') || alias.includes('android')) score -= 20;
        if (alias.includes('desktop') || alias.includes('server') || alias.includes('bot')) score += 20;
        if (this.connectedPeers.has(peerId)) score += 5;
        return { peerId, score };
      })
      .sort((a, b) => b.score - a.score || a.peerId.localeCompare(b.peerId))
      .slice(0, Math.max(0, limit))
      .map((entry) => entry.peerId);
  }

  private resolveLikelyPreKeyCustodians(ownerPeerId: string, workspaceId?: string): string[] {
    if (!workspaceId) return [];
    return this.selectCustodianPeers(workspaceId, ownerPeerId);
  }

  private resolvePreKeyLookupCandidates(ownerPeerId: string, workspaceId?: string): string[] {
    const myPeerId = get(appState.myPeerId);
    if (!ownerPeerId || !myPeerId) return [];

    if (workspaceId) {
      const workspace = this.workspaceManager.getWorkspace(workspaceId);
      return (workspace?.members ?? [])
        .map((member) => member.peerId)
        .filter((peerId) => peerId && peerId !== myPeerId && peerId !== ownerPeerId && this.readyPeers.has(peerId));
    }

    return Array.from(this.readyPeers)
      .filter((peerId) => peerId !== myPeerId && peerId !== ownerPeerId);
  }

  private async requestPreKeyBundleFromPeers(
    ownerPeerId: string,
    workspaceId?: string,
    opts?: {
      candidatePeerIds?: string[];
      timeoutMs?: number;
      querySource?: 'custodian-targeted' | 'peer-broadcast';
    },
  ): Promise<boolean> {
    if (!this.messageProtocol || !ownerPeerId) return false;

    const myPeerId = get(appState.myPeerId);
    const resolvedWorkspaceId = workspaceId || this.resolveSharedWorkspaceIds(ownerPeerId)[0];
    const requestedCandidates = opts?.candidatePeerIds ?? this.resolvePreKeyLookupCandidates(ownerPeerId, resolvedWorkspaceId);

    const candidates = Array.from(new Set(requestedCandidates))
      .filter((peerId) => peerId && peerId !== myPeerId && peerId !== ownerPeerId && this.readyPeers.has(peerId))
      .filter((peerId) => !resolvedWorkspaceId || this.isWorkspaceMember(peerId, resolvedWorkspaceId));

    if (candidates.length === 0) return false;

    const requestId = crypto.randomUUID();
    const timeoutMs = Math.max(250, opts?.timeoutMs ?? PRE_KEY_FETCH_TIMEOUT_MS);
    const querySource = opts?.querySource ?? 'peer-broadcast';

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPreKeyBundleFetches.delete(requestId);
        resolve(false);
      }, timeoutMs);

      const pending: PendingPreKeyBundleFetch = {
        ownerPeerId,
        ...(resolvedWorkspaceId ? { workspaceId: resolvedWorkspaceId } : {}),
        pendingPeerIds: new Set(candidates),
        resolve: (value: boolean) => {
          clearTimeout(timer);
          this.pendingPreKeyBundleFetches.delete(requestId);
          resolve(value);
        },
        timer,
      };
      this.pendingPreKeyBundleFetches.set(requestId, pending);

      let sentCount = 0;
      for (const peerId of candidates) {
        const accepted = this.transport.send(peerId, {
          type: 'pre-key-bundle.fetch',
          requestId,
          ownerPeerId,
          ...(resolvedWorkspaceId ? { workspaceId: resolvedWorkspaceId } : {}),
          querySource,
        });

        if (accepted) {
          sentCount += 1;
        } else {
          pending.pendingPeerIds.delete(peerId);
        }
      }

      if (sentCount === 0 || pending.pendingPeerIds.size === 0) {
        clearTimeout(timer);
        this.pendingPreKeyBundleFetches.delete(requestId);
        resolve(false);
      }
    });
  }

  private async ensurePeerPreKeyBundle(peerId: string, workspaceId?: string): Promise<boolean> {
    if (!this.messageProtocol || !peerId) return false;

    const existing = await this.messageProtocol.getPeerPreKeyBundle(peerId);
    if (existing) return true;

    const resolvedWorkspaceId = workspaceId || this.resolveSharedWorkspaceIds(peerId)[0];
    const likelyCustodians = this.resolveLikelyPreKeyCustodians(peerId, resolvedWorkspaceId);

    if (likelyCustodians.length > 0) {
      const hydratedViaCustodians = await this.requestPreKeyBundleFromPeers(peerId, resolvedWorkspaceId, {
        candidatePeerIds: likelyCustodians,
        timeoutMs: 1_200,
        querySource: 'custodian-targeted',
      });
      if (hydratedViaCustodians) return true;
    }

    const fallbackCandidates = this.resolvePreKeyLookupCandidates(peerId, resolvedWorkspaceId)
      .filter((candidatePeerId) => !likelyCustodians.includes(candidatePeerId));

    if (fallbackCandidates.length === 0) {
      return this.requestPreKeyBundleFromPeers(peerId, resolvedWorkspaceId, {
        candidatePeerIds: likelyCustodians,
        querySource: 'peer-broadcast',
      });
    }

    return this.requestPreKeyBundleFromPeers(peerId, resolvedWorkspaceId, {
      candidatePeerIds: fallbackCandidates,
      querySource: 'peer-broadcast',
    });
  }

  private async encryptMessageWithPreKeyBootstrap(
    peerId: string,
    content: string,
    type: 'text' | 'file' | 'system' | 'handshake' = 'text',
    metadata?: PlaintextMessage['metadata'],
    workspaceId?: string,
  ): Promise<any> {
    if (!this.messageProtocol) {
      throw new Error('Message protocol unavailable');
    }

    try {
      return await this.messageProtocol.encryptMessage(peerId, content, type, metadata);
    } catch (error) {
      if (!this.shouldAttemptPreKeyBootstrap(error)) throw error;

      const hydrated = await this.ensurePeerPreKeyBundle(peerId, workspaceId);
      if (!hydrated) throw error;

      return this.messageProtocol.encryptMessage(peerId, content, type, metadata);
    }
  }

  private async publishPreKeyBundle(peerId: string): Promise<void> {
    if (!this.messageProtocol) return;

    const myPeerId = get(appState.myPeerId);
    if (!myPeerId) return;

    try {
      const bundle = await this.messageProtocol.createPreKeyBundle();
      const workspaceId = this.resolveSharedWorkspaceIds(peerId)[0];
      this.transport.send(peerId, {
        type: 'pre-key-bundle.publish',
        ...(workspaceId ? { workspaceId } : {}),
        ownerPeerId: myPeerId,
        bundle,
      });
    } catch (error) {
      console.warn('[MobileController] failed to publish pre-key bundle:', error);
    }
  }

  private async handlePreKeyControlMessage(peerId: string, data: Record<string, unknown>): Promise<boolean> {
    if (!this.messageProtocol) return false;

    if (data.type === 'pre-key-bundle.publish') {
      if ((data as any).bundle) {
        const ownerPeerId = typeof (data as any).ownerPeerId === 'string' ? (data as any).ownerPeerId : peerId;
        await this.messageProtocol.storePeerPreKeyBundle(ownerPeerId, (data as any).bundle);
      }
      return true;
    }

    if (data.type === 'pre-key-bundle.request') {
      const myPeerId = get(appState.myPeerId);
      if (!myPeerId) return true;

      try {
        const bundle = await this.messageProtocol.createPreKeyBundle();
        this.transport.send(peerId, {
          type: 'pre-key-bundle.response',
          ownerPeerId: myPeerId,
          ...(typeof (data as any).workspaceId === 'string' ? { workspaceId: (data as any).workspaceId } : {}),
          bundle,
        });
      } catch (error) {
        console.warn('[MobileController] failed to respond with pre-key bundle:', error);
      }
      return true;
    }

    if (data.type === 'pre-key-bundle.response') {
      if ((data as any).bundle) {
        const ownerPeerId = typeof (data as any).ownerPeerId === 'string' ? (data as any).ownerPeerId : peerId;
        await this.messageProtocol.storePeerPreKeyBundle(ownerPeerId, (data as any).bundle);
      }
      return true;
    }

    if (data.type === 'pre-key-bundle.fetch') {
      const requestId = typeof (data as any).requestId === 'string' ? (data as any).requestId : '';
      const ownerPeerId = typeof (data as any).ownerPeerId === 'string' ? (data as any).ownerPeerId : '';
      if (!requestId || !ownerPeerId) return true;

      const workspaceId = typeof (data as any).workspaceId === 'string' ? (data as any).workspaceId : undefined;
      if (workspaceId) {
        const myPeerId = get(appState.myPeerId);
        if (!myPeerId) return true;
        if (!this.isWorkspaceMember(peerId, workspaceId)) return true;
        if (!this.isWorkspaceMember(ownerPeerId, workspaceId)) return true;
        if (!this.isWorkspaceMember(myPeerId, workspaceId)) return true;
      }

      const querySource = ((data as any).querySource === 'custodian-targeted' || (data as any).querySource === 'peer-broadcast')
        ? (data as any).querySource
        : undefined;
      const bundle = await this.messageProtocol.getPeerPreKeyBundle(ownerPeerId);

      this.transport.send(peerId, {
        type: 'pre-key-bundle.fetch-response',
        requestId,
        ownerPeerId,
        ...(workspaceId ? { workspaceId } : {}),
        ...(querySource ? { querySource } : {}),
        ...(bundle ? { bundle } : { notAvailable: true }),
      });
      return true;
    }

    if (data.type === 'pre-key-bundle.fetch-response') {
      const requestId = typeof (data as any).requestId === 'string' ? (data as any).requestId : '';
      if (!requestId) return true;

      const pending = this.pendingPreKeyBundleFetches.get(requestId);
      if (!pending) return true;

      if (!pending.pendingPeerIds.has(peerId)) return true;

      const ownerPeerId = typeof (data as any).ownerPeerId === 'string' ? (data as any).ownerPeerId : pending.ownerPeerId;
      if (ownerPeerId !== pending.ownerPeerId) return true;

      pending.pendingPeerIds.delete(peerId);

      if ((data as any).bundle) {
        const stored = await this.messageProtocol.storePeerPreKeyBundle(ownerPeerId, (data as any).bundle);
        if (stored) {
          pending.resolve(true);
          return true;
        }
      }

      if (pending.pendingPeerIds.size === 0) {
        pending.resolve(false);
      }
      return true;
    }

    return false;
  }

  private isEncryptedEnvelope(data: Record<string, unknown>): data is EncryptedEnvelope {
    return 'encrypted' in data || 'ratchet' in data;
  }

  private async sendHandshake(peerId: string): Promise<void> {
    if (!this.messageProtocol || this.handshakeSent.has(peerId)) return;

    const handshake = await this.messageProtocol.createHandshake();
    const sent = this.transport.send(peerId, {
      type: 'handshake',
      ...handshake,
    });

    if (sent) {
      this.handshakeSent.add(peerId);
      await this.publishPreKeyBundle(peerId);
    }
  }

  private async handleHandshake(peerId: string, handshake: HandshakeData): Promise<void> {
    if (!this.messageProtocol || !handshake.publicKey) return;

    const wasReady = this.readyPeers.has(peerId);

    await this.messageProtocol.processHandshake(peerId, handshake);
    if (handshake.preKeySupport) {
      this.transport.send(peerId, { type: 'pre-key-bundle.request' });
    }
    await this.publishPreKeyBundle(peerId);
    await this.keyStore.storePeerPublicKey(peerId, handshake.publicKey);
    await this.persistentStore.savePeer({
      peerId,
      publicKey: handshake.publicKey,
      lastSeen: Date.now(),
    });

    this.connectedPeers.add(peerId);
    this.readyPeers.add(peerId);

    this.ensurePeerInSingleWorkspace(peerId, handshake.publicKey);

    this.updateConnectedPeersStore();
    this.updateConnectionState();

    if (!this.handshakeSent.has(peerId)) {
      await this.sendHandshake(peerId);
    }

    if (!wasReady) {
      this.announceAlias(peerId);

      const pendingJoin = this.pendingJoinRequests.get(peerId);
      if (pendingJoin) {
        this.sendJoinRequest(peerId, pendingJoin.inviteCode);
        this.pendingJoinRequests.delete(peerId);
      }

      this.sendWorkspaceState(peerId);
      await this.flushOfflineQueue(peerId);
      await this.requestMessageSyncForPeer(peerId);
    }
  }

  private announceAlias(peerId: string): void {
    const alias = this.getMyAlias();
    if (!alias) return;

    this.transport.send(peerId, {
      type: 'name-announce',
      workspaceId: get(appState.activeWorkspaceId),
      alias,
    });
  }

  private async handleNameAnnounce(peerId: string, payload: Record<string, unknown>): Promise<void> {
    const alias = typeof payload.alias === 'string' ? payload.alias.trim() : '';
    if (!alias) return;

    const explicitWorkspaceId =
      typeof payload.workspaceId === 'string' && payload.workspaceId
        ? payload.workspaceId
        : null;

    const candidateWorkspaces = explicitWorkspaceId
      ? [this.workspaceManager.getWorkspace(explicitWorkspaceId)].filter((workspace): workspace is Workspace => !!workspace)
      : this.workspaceManager.getAllWorkspaces();

    let changed = false;

    for (const workspace of candidateWorkspaces) {
      const member = workspace.members.find((item) => item.peerId === peerId);
      if (!member) continue;
      if (member.alias !== alias) {
        member.alias = alias;
        changed = true;
        await this.persistentStore.saveWorkspace(workspace);
      }
    }

    const existingContact = this.contactsByPeerId.get(peerId) || this.contactStore.getSync?.(peerId);
    if (existingContact && existingContact.displayName !== alias) {
      const updatedContact: Contact = {
        ...existingContact,
        displayName: alias,
        lastSeen: Date.now(),
      };
      await this.contactStore.update(peerId, {
        displayName: alias,
        lastSeen: updatedContact.lastSeen,
      });
      this.contactsByPeerId.set(peerId, updatedContact);
      await this.persistentStore.saveContact(updatedContact);
      changed = true;
    }

    if (changed) {
      this.syncWorkspaceStores();
    }
  }

  private async handleWorkspaceSync(peerId: string, msg: WorkspaceSyncMessage): Promise<void> {
    const syncType = msg.sync?.type;

    if (syncType === 'workspace-state') {
      await this.applyWorkspaceState(peerId, msg.workspaceId, msg.sync);
      return;
    }

    if (syncType === 'join-request') {
      await this.handleJoinRequest(peerId, msg.sync);
      return;
    }

    if (syncType === 'join-accepted') {
      await this.handleJoinAccepted(msg.sync);
      return;
    }

    if (syncType === 'join-rejected') {
      console.warn('[MobileController] workspace join rejected:', msg.sync.reason);
    }
  }

  private async handleJoinRequest(peerId: string, payload: JoinRequestPayload): Promise<void> {
    const reject = (reason: string) => {
      this.transport.send(peerId, {
        type: 'workspace-sync',
        sync: {
          type: 'join-rejected',
          reason,
        },
      } satisfies WorkspaceSyncMessage);
    };

    const workspace = this.workspaceManager.validateInviteCode(payload.inviteCode);
    if (!workspace) {
      reject('Invite code not found');
      return;
    }

    if (!payload.member || payload.member.peerId !== peerId) {
      reject('Peer identity mismatch');
      return;
    }

    const alias = payload.member.alias?.trim() || peerId.slice(0, 8);
    let resolvedPublicKey: string | null = null;
    try {
      resolvedPublicKey = await this.resolvePeerPublicKey(peerId);
    } catch {
      resolvedPublicKey = null;
    }
    const publicKey = resolvedPublicKey || payload.member.publicKey;
    if (!publicKey) {
      reject('Missing public key');
      return;
    }

    const existing = workspace.members.find((item) => item.peerId === peerId);
    if (!existing) {
      const addResult = this.workspaceManager.addMember(workspace.id, {
        peerId,
        alias,
        publicKey,
        signingPublicKey: payload.member.signingPublicKey,
        identityId: payload.member.identityId,
        devices: payload.member.devices,
        joinedAt: Date.now(),
        role: 'member',
        isBot: payload.member.isBot === true,
        allowWorkspaceDMs: payload.member.allowWorkspaceDMs !== false,
      });
      if (!addResult.success) {
        reject(addResult.error || 'Join rejected');
        return;
      }
    } else {
      existing.alias = alias;
      existing.publicKey = publicKey;
      existing.signingPublicKey = payload.member.signingPublicKey || existing.signingPublicKey;
      existing.identityId = payload.member.identityId || existing.identityId;
      existing.devices = payload.member.devices || existing.devices;
      existing.allowWorkspaceDMs = payload.member.allowWorkspaceDMs !== false;
    }

    await this.persistentStore.saveWorkspace(workspace);
    this.syncWorkspaceStores();

    const messageHistory: Record<string, PlaintextMessage[]> = {};
    for (const channel of workspace.channels) {
      messageHistory[channel.id] = this.messageStore.getMessages(channel.id);
    }

    this.transport.send(peerId, {
      type: 'workspace-sync',
      workspaceId: workspace.id,
      sync: {
        type: 'join-accepted',
        workspace,
        messageHistory,
      },
    } satisfies WorkspaceSyncMessage);

    this.sendWorkspaceState(peerId, workspace.id);
  }

  private async handleJoinAccepted(payload: JoinAcceptedPayload): Promise<void> {
    this.workspaceManager.importWorkspace(payload.workspace);
    await this.persistentStore.saveWorkspace(payload.workspace);

    if (payload.messageHistory) {
      const toPersist: PlaintextMessage[] = [];

      for (const messages of Object.values(payload.messageHistory)) {
        for (const message of messages) {
          this.messageStore.forceAdd(message);
          toPersist.push(message);
        }
      }

      if (toPersist.length > 0) {
        await this.persistentStore.saveMessages(toPersist);
      }
    }

    this.syncWorkspaceStores(payload.workspace.id);
    for (const channel of payload.workspace.channels) {
      this.syncChannelMessages(channel.id);
    }

    const myPeerId = get(appState.myPeerId);
    for (const member of payload.workspace.members) {
      if (member.peerId !== myPeerId) {
        this.connectPeer(member.peerId);
      }
    }
  }

  private async applyWorkspaceState(
    peerId: string,
    remoteWorkspaceId: string | undefined,
    payload: WorkspaceStatePayload,
  ): Promise<void> {
    if (!remoteWorkspaceId) return;

    const allWorkspaces = this.workspaceManager.getAllWorkspaces();

    let workspace = allWorkspaces.find((item) => item.id === remoteWorkspaceId)
      || (payload.inviteCode
        ? allWorkspaces.find((item) => item.inviteCode === payload.inviteCode)
        : undefined)
      || null;

    if (!workspace) {
      workspace = {
        id: remoteWorkspaceId,
        name: payload.name || 'Workspace',
        inviteCode: payload.inviteCode || '',
        createdBy: peerId,
        createdAt: Date.now(),
        members: [],
        channels: [],
        permissions: payload.permissions,
        bans: payload.bans || [],
      };
      this.workspaceManager.importWorkspace(workspace);
    }

    if (workspace.id !== remoteWorkspaceId && payload.inviteCode && payload.inviteCode === workspace.inviteCode) {
      const previousId = workspace.id;
      this.workspaceManager.removeWorkspace(previousId);
      workspace.id = remoteWorkspaceId;
      for (const channel of workspace.channels) {
        channel.workspaceId = remoteWorkspaceId;
      }
      this.workspaceManager.importWorkspace(workspace);
      await this.persistentStore.deleteWorkspace(previousId);
    }

    const senderListedInPayload = payload.members.some((member) => member?.peerId === peerId);
    if (!senderListedInPayload) {
      console.warn(`[Security] Mobile ignoring workspace-state from ${peerId.slice(0, 8)}: sender not present in member list for ${remoteWorkspaceId.slice(0, 8)}`);
      return;
    }

    if (this.workspaceManager.isBanned(workspace.id, peerId)) {
      console.warn(`[Security] Mobile ignoring workspace-state from banned peer ${peerId.slice(0, 8)} for workspace ${workspace.id.slice(0, 8)}`);
      return;
    }

    const senderIsKnownMember = workspace.members.some((member) => member.peerId === peerId);
    if (!senderIsKnownMember) {
      console.warn(`[Security] Mobile ignoring workspace-state from non-member ${peerId.slice(0, 8)} for workspace ${workspace.id.slice(0, 8)}`);
      return;
    }

    const senderPayload = payload.members.find((member) => member?.peerId === peerId);
    const senderIsOwner = workspace.members.some((member) => member.peerId === peerId && member.role === 'owner')
      || senderPayload?.role === 'owner';

    workspace.name = payload.name || workspace.name;
    workspace.description = payload.description;
    workspace.inviteCode = payload.inviteCode || workspace.inviteCode;
    if (senderIsOwner && payload.permissions) {
      workspace.permissions = payload.permissions;
    }
    if (senderIsOwner && payload.bans) {
      workspace.bans = payload.bans;
    }

    for (const remoteChannel of payload.channels) {
      const remoteMembers = Array.isArray(remoteChannel.members)
        ? remoteChannel.members.filter((memberId): memberId is string => typeof memberId === 'string')
        : [];
      const remoteAccessPolicy = remoteChannel.accessPolicy
        ? JSON.parse(JSON.stringify(remoteChannel.accessPolicy))
        : (remoteChannel.type === 'channel' ? { mode: 'public-workspace', workspaceId: workspace.id } : undefined);

      const localChannel = workspace.channels.find(
        (item) => item.id === remoteChannel.id || (item.name === remoteChannel.name && item.type === remoteChannel.type),
      );

      if (!localChannel) {
        workspace.channels.push({
          id: remoteChannel.id,
          workspaceId: workspace.id,
          name: remoteChannel.name,
          type: remoteChannel.type,
          members: remoteMembers.length > 0 ? remoteMembers : workspace.members.map((member) => member.peerId),
          ...(remoteAccessPolicy ? { accessPolicy: remoteAccessPolicy } : {}),
          createdBy: remoteChannel.createdBy || peerId,
          createdAt: Number.isFinite(remoteChannel.createdAt) ? remoteChannel.createdAt : Date.now(),
        });
        continue;
      }

      if (localChannel.id !== remoteChannel.id) {
        const oldChannelId = localChannel.id;
        localChannel.id = remoteChannel.id;
        this.messageStore.remapChannel(oldChannelId, remoteChannel.id);
        await this.persistentStore.remapChannelMessages(oldChannelId, remoteChannel.id);
      }

      localChannel.name = remoteChannel.name;
      localChannel.type = remoteChannel.type;
      localChannel.workspaceId = workspace.id;
      if (remoteMembers.length > 0) {
        localChannel.members = [...new Set(remoteMembers)];
      }
      if (remoteAccessPolicy) {
        localChannel.accessPolicy = remoteAccessPolicy as any;
      }
      if (remoteChannel.createdBy && !localChannel.createdBy) {
        localChannel.createdBy = remoteChannel.createdBy;
      }
      if (Number.isFinite(remoteChannel.createdAt) && !Number.isFinite(localChannel.createdAt)) {
        localChannel.createdAt = remoteChannel.createdAt;
      }
    }

    for (const remoteMember of payload.members) {
      if (this.workspaceManager.isBanned(workspace.id, remoteMember.peerId)) {
        continue;
      }

      const existingMember = workspace.members.find((member) => member.peerId === remoteMember.peerId);

      if (!existingMember) {
        const safeRole = senderIsOwner && ['owner', 'admin', 'member'].includes(remoteMember.role || '')
          ? remoteMember.role || 'member'
          : 'member';
        workspace.members.push({
          peerId: remoteMember.peerId,
          alias: remoteMember.alias || remoteMember.peerId.slice(0, 8),
          publicKey: remoteMember.publicKey || '',
          signingPublicKey: remoteMember.signingPublicKey,
          identityId: remoteMember.identityId,
          devices: remoteMember.devices,
          joinedAt: Date.now(),
          role: safeRole as WorkspaceMember['role'],
          isBot: remoteMember.isBot,
          allowWorkspaceDMs: remoteMember.allowWorkspaceDMs !== false,
        });
      } else {
        existingMember.alias = remoteMember.alias || existingMember.alias;
        existingMember.publicKey = remoteMember.publicKey || existingMember.publicKey;
        existingMember.signingPublicKey = remoteMember.signingPublicKey || existingMember.signingPublicKey;
        existingMember.identityId = remoteMember.identityId || existingMember.identityId;
        existingMember.devices = remoteMember.devices || existingMember.devices;
        if (senderIsOwner && remoteMember.role && ['owner', 'admin', 'member'].includes(remoteMember.role)) {
          existingMember.role = remoteMember.role;
        }
        existingMember.isBot = remoteMember.isBot || existingMember.isBot;
        if (typeof remoteMember.allowWorkspaceDMs === 'boolean') {
          existingMember.allowWorkspaceDMs = remoteMember.allowWorkspaceDMs;
        }
      }
    }

    await this.persistentStore.saveWorkspace(workspace);

    this.syncWorkspaceStores(workspace.id);
    for (const channel of workspace.channels) {
      this.syncChannelMessages(channel.id);
    }

    const myPeerId = get(appState.myPeerId);
    for (const member of workspace.members) {
      if (member.peerId !== myPeerId && !this.connectedPeers.has(member.peerId)) {
        this.connectPeer(member.peerId);
      }
    }

    if (workspace.createdBy === myPeerId) {
      this.sendWorkspaceState(peerId, workspace.id);
    }
  }

  private async handleEncryptedEnvelope(peerId: string, envelope: EncryptedEnvelope): Promise<void> {
    if (!this.messageProtocol) return;

    const peerPublicKey = await this.resolvePeerPublicKey(peerId);
    if (!peerPublicKey) return;

    const peerCryptoKey = await this.cryptoManager.importPublicKey(peerPublicKey);
    const content = await this.messageProtocol.decryptMessage(peerId, envelope as any, peerCryptoKey);

    if (!content) return;

    if (this.isDirectEnvelope(envelope)) {
      await this.handleDirectMessageEnvelope(peerId, envelope, content);
      return;
    }

    const allWorkspaces = this.workspaceManager.getAllWorkspaces();

    let workspace: Workspace | undefined;
    if (typeof envelope.workspaceId === 'string') {
      workspace = allWorkspaces.find((candidate) => candidate.id === envelope.workspaceId);
      if (!workspace && typeof envelope.channelId === 'string') {
        workspace = allWorkspaces.find((candidate) => candidate.channels.some((channel) => channel.id === envelope.channelId));
        if (workspace) {
          console.warn(`[Security] Mobile workspaceId mismatch from ${peerId.slice(0, 8)}: ${envelope.workspaceId} -> using channel-mapped workspace ${workspace.id}`);
        }
      }
      if (!workspace) {
        console.warn(`[Security] Mobile dropping message from ${peerId.slice(0, 8)}: unknown workspaceId ${envelope.workspaceId}`);
        return;
      }
    } else if (typeof envelope.channelId === 'string') {
      workspace = allWorkspaces.find((candidate) => candidate.channels.some((channel) => channel.id === envelope.channelId));
    }

    if (!workspace) {
      console.warn(`[Security] Mobile dropping message from ${peerId.slice(0, 8)}: workspace/channel not found`);
      return;
    }

    if (!workspace.members.some((member) => member.peerId === peerId)) {
      console.warn(`[Security] Mobile dropping message from ${peerId.slice(0, 8)}: not a member of workspace ${workspace.id}`);
      return;
    }

    let channelId: string | null = null;
    if (typeof envelope.channelId === 'string' && workspace.channels.some((channel) => channel.id === envelope.channelId)) {
      channelId = envelope.channelId;
    } else if (typeof envelope.workspaceId === 'string') {
      console.warn(`[Security] Mobile dropping message from ${peerId.slice(0, 8)}: unknown channel ${envelope.channelId || 'missing'} in workspace ${workspace.id}`);
      return;
    } else {
      channelId = workspace.channels[0]?.id ?? null;
    }

    if (!channelId) return;
    if (!this.workspaceManager.isMemberAllowedInChannel(workspace.id, channelId, peerId)) {
      console.warn(`[Security] Mobile dropping message from ${peerId.slice(0, 8)}: not allowed in channel ${channelId}`);
      return;
    }

    const message = await this.messageStore.createMessage(
      channelId,
      peerId,
      content,
      this.getEnvelopeMessageType(envelope),
      envelope.threadId,
    );
    const channelMessages = this.messageStore.getMessages(channelId);
    const lastMessageTimestamp = channelMessages[channelMessages.length - 1]?.timestamp ?? 0;
    message.timestamp = Math.max(Number(envelope.timestamp) || Date.now(), lastMessageTimestamp + 1);
    if (typeof envelope.messageId === 'string') message.id = envelope.messageId;
    message.status = 'delivered';

    if (this.hasMetadata(envelope.metadata)) {
      message.metadata = envelope.metadata;
    }

    if (Array.isArray(envelope.attachments)) {
      (message as PlaintextMessage & { attachments?: AttachmentMeta[] }).attachments = envelope.attachments as AttachmentMeta[];
      this.registerAttachmentIndex(channelId, message.id, envelope.attachments as AttachmentMeta[]);
      this.requestMissingAttachments(peerId, channelId, message.id, envelope.attachments as AttachmentMeta[]);
    }

    const result = await this.messageStore.addMessage(message);
    if (!result.success) {
      this.messageStore.forceAdd(message);
    }

    await this.persistentStore.saveMessage(message);
    this.syncChannelMessages(channelId);

    this.transport.send(peerId, {
      type: 'ack',
      channelId,
      messageId: message.id,
    } satisfies MessageReceiptPayload);
  }

  private isDirectEnvelope(envelope: EncryptedEnvelope): boolean {
    if (envelope.isDirect === true) return true;
    if (typeof envelope.channelId !== 'string') return false;
    return this.directConversationsById.has(envelope.channelId);
  }

  private async handleDirectMessageEnvelope(peerId: string, envelope: EncryptedEnvelope, content: string): Promise<void> {
    let conversation = await this.directConversationStore.getByContact(peerId);

    if (!conversation) {
      conversation = await this.directConversationStore.create(peerId);
      this.directConversationsById.set(conversation.id, conversation);
      await this.persistentStore.saveDirectConversation(conversation);
    }

    const channelId = conversation.id;

    const message = await this.messageStore.createMessage(
      channelId,
      peerId,
      content,
      this.getEnvelopeMessageType(envelope),
      envelope.threadId,
    );
    const channelMessages = this.messageStore.getMessages(channelId);
    const lastMessageTimestamp = channelMessages[channelMessages.length - 1]?.timestamp ?? 0;
    message.timestamp = Math.max(Number(envelope.timestamp) || Date.now(), lastMessageTimestamp + 1);
    if (typeof envelope.messageId === 'string') message.id = envelope.messageId;
    message.status = 'delivered';

    if (this.hasMetadata(envelope.metadata)) {
      message.metadata = envelope.metadata;
    }

    if (Array.isArray(envelope.attachments)) {
      (message as PlaintextMessage & { attachments?: AttachmentMeta[] }).attachments = envelope.attachments as AttachmentMeta[];
      this.registerAttachmentIndex(channelId, message.id, envelope.attachments as AttachmentMeta[]);
      this.requestMissingAttachments(peerId, channelId, message.id, envelope.attachments as AttachmentMeta[]);
    }

    const result = await this.messageStore.addMessage(message);
    if (!result.success) {
      this.messageStore.forceAdd(message);
    }

    await this.directConversationStore.updateLastMessage(channelId, message.timestamp);
    const updatedConversation = await this.directConversationStore.get(channelId);
    if (updatedConversation) {
      this.directConversationsById.set(updatedConversation.id, updatedConversation);
      await this.persistentStore.saveDirectConversation(updatedConversation);
    } else {
      await this.persistentStore.saveDirectConversation(conversation);
    }

    await this.persistentStore.saveMessage(message);
    this.syncChannelMessages(channelId);

    this.transport.send(peerId, {
      type: 'ack',
      channelId,
      messageId: message.id,
    } satisfies MessageReceiptPayload);
  }

  private resolveWorkspaceForEnvelope(envelope: EncryptedEnvelope): Workspace | null {
    const allWorkspaces = this.workspaceManager.getAllWorkspaces();

    if (typeof envelope.workspaceId === 'string') {
      const match = allWorkspaces.find((workspace) => workspace.id === envelope.workspaceId);
      if (match) return match;
    }

    if (typeof envelope.channelId === 'string') {
      const match = allWorkspaces.find((workspace) => workspace.channels.some((channel) => channel.id === envelope.channelId));
      if (match) return match;
    }

    const activeWorkspaceId = get(appState.activeWorkspaceId);
    if (activeWorkspaceId) {
      const active = this.workspaceManager.getWorkspace(activeWorkspaceId);
      if (active) return active;
    }

    return allWorkspaces[0] ?? null;
  }

  private resolveChannelIdForEnvelope(workspace: Workspace, envelope: EncryptedEnvelope): string | null {
    if (typeof envelope.channelId === 'string' && workspace.channels.some((channel) => channel.id === envelope.channelId)) {
      return envelope.channelId;
    }

    return workspace.channels[0]?.id ?? null;
  }

  private async resolvePeerPublicKey(peerId: string): Promise<string | null> {
    const peerRecord = await this.persistentStore.getPeer(peerId);
    if (peerRecord?.publicKey) return peerRecord.publicKey as string;

    const contact = this.contactsByPeerId.get(peerId) || this.contactStore.getSync?.(peerId);
    if (contact?.publicKey) return contact.publicKey;

    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      const member = workspace.members.find((item) => item.peerId === peerId);
      if (member?.publicKey) return member.publicKey;
    }

    return null;
  }

  private sendWorkspaceState(peerId: string, workspaceId?: string): void {
    const activeWorkspaceId = get(appState.activeWorkspaceId);
    const workspace =
      (workspaceId ? this.workspaceManager.getWorkspace(workspaceId) : null)
      || (activeWorkspaceId ? this.workspaceManager.getWorkspace(activeWorkspaceId) : null)
      || this.workspaceManager.getAllWorkspaces()[0];

    if (!workspace) return;

    this.transport.send(peerId, {
      type: 'workspace-sync',
      workspaceId: workspace.id,
      sync: {
        type: 'workspace-state',
        name: workspace.name,
        description: workspace.description,
        channels: workspace.channels.map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: channel.type,
        })),
        members: workspace.members.map((member) => ({
          peerId: member.peerId,
          alias: member.alias,
          publicKey: member.publicKey,
          signingPublicKey: member.signingPublicKey,
          identityId: member.identityId,
          devices: member.devices,
          role: member.role,
          isBot: member.isBot,
        })),
        inviteCode: workspace.inviteCode,
        permissions: workspace.permissions,
        bans: workspace.bans,
      },
    } satisfies WorkspaceSyncMessage);
  }

  private broadcastWorkspaceState(workspaceId: string): void {
    for (const peerId of this.readyPeers) {
      this.sendWorkspaceState(peerId, workspaceId);
    }
  }

  private sendJoinRequest(peerId: string, inviteCode: string): void {
    const myPeerId = get(appState.myPeerId);
    const myAlias = this.getMyAlias();
    if (!myPeerId) return;

    this.transport.send(peerId, {
      type: 'workspace-sync',
      sync: {
        type: 'join-request',
        inviteCode,
        member: {
          peerId: myPeerId,
          alias: myAlias,
          publicKey: this.myPublicKey,
          signingPublicKey: this.mySigningPublicKey,
          joinedAt: Date.now(),
          role: 'member',
        },
      },
    } satisfies WorkspaceSyncMessage);
  }

  private findWorkspaceByChannel(channelId: string): Workspace | null {
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      if (workspace.channels.some((channel) => channel.id === channelId)) {
        return workspace;
      }
    }
    return null;
  }

  private getRecipientPeerIds(workspace: Workspace, channel: Channel): string[] {
    const myPeerId = get(appState.myPeerId);
    const recipients = new Set<string>();

    const addRecipient = (peerId: string) => {
      if (!peerId || peerId === myPeerId) return;
      recipients.add(peerId);
    };

    if (channel.type === 'dm') {
      for (const memberId of channel.members) addRecipient(memberId);
      return Array.from(recipients);
    }

    if (channel.accessPolicy?.mode === 'explicit' && channel.accessPolicy.explicitMemberPeerIds?.length) {
      for (const memberId of channel.accessPolicy.explicitMemberPeerIds) addRecipient(memberId);
      return Array.from(recipients);
    }

    for (const member of workspace.members) {
      addRecipient(member.peerId);
    }

    return Array.from(recipients);
  }

  private ensurePeerInSingleWorkspace(peerId: string, publicKey: string): void {
    const all = this.workspaceManager.getAllWorkspaces();
    if (all.length !== 1) return;

    const workspace = all[0];
    const exists = workspace.members.some((member) => member.peerId === peerId);
    if (exists) return;

    this.workspaceManager.addMember(workspace.id, {
      peerId,
      alias: peerId.slice(0, 8),
      publicKey,
      joinedAt: Date.now(),
      role: 'member',
    });

    void this.persistentStore.saveWorkspace(workspace);
    this.syncWorkspaceStores();
  }

  private getEnvelopeMessageType(envelope: EncryptedEnvelope): 'text' | 'file' | 'system' {
    if (envelope.type === 'file' || envelope.type === 'system' || envelope.type === 'text') {
      return envelope.type;
    }
    return 'text';
  }

  private hasMetadata(value: unknown): value is PlaintextMessage['metadata'] {
    if (!value || typeof value !== 'object') return false;
    return true;
  }

  private registerAttachmentIndex(channelId: string, messageId: string, attachments: AttachmentMeta[]): void {
    for (const attachment of attachments) {
      this.attachmentMessageIndex.set(attachment.id, { channelId, messageId });
    }
  }

  private requestMissingAttachments(peerId: string, channelId: string, messageId: string, attachments: AttachmentMeta[]): void {
    for (const attachment of attachments) {
      if (this.localAttachmentBlobs.has(attachment.id)) continue;
      this.transport.send(peerId, {
        type: 'media-request',
        attachmentId: attachment.id,
        channelId,
        messageId,
      } satisfies MediaRequestPayload);
    }
  }

  private canPeerAccessChannel(peerId: string, channelId: string): boolean {
    const directConversation = this.directConversationsById.get(channelId);
    if (directConversation) {
      return directConversation.contactPeerId === peerId;
    }

    const workspace = this.findWorkspaceByChannel(channelId);
    if (!workspace) return false;

    const channel = workspace.channels.find((item) => item.id === channelId);
    if (!channel) return false;

    const workspaceMember = workspace.members.find((member) => member.peerId === peerId);
    if (!workspaceMember) return false;

    if (channel.type === 'dm') {
      return channel.members.includes(peerId);
    }

    switch (channel.accessPolicy?.mode) {
      case 'explicit':
      case 'group':
        return channel.accessPolicy.explicitMemberPeerIds?.includes(peerId) ?? channel.members.includes(peerId);
      case 'role-gated':
        return channel.accessPolicy.roles?.includes(workspaceMember.role) ?? false;
      case 'public-workspace':
      default:
        return true;
    }
  }

  private canPeerAccessMessageAttachment(
    peerId: string,
    channelId: string,
    messageId: string,
    attachmentId: string,
  ): boolean {
    if (!this.canPeerAccessChannel(peerId, channelId)) return false;

    const messages = this.messageStore.getMessages(channelId);
    const message = messages.find((candidate) => candidate.id === messageId);
    if (!message) return false;

    const attachments = (message as PlaintextMessage & { attachments?: AttachmentMeta[] }).attachments ?? [];
    const attachmentPresent = attachments.some((attachment) => attachment.id === attachmentId);
    if (!attachmentPresent) return false;

    const myPeerId = get(appState.myPeerId);
    const explicitRecipients = message.recipientPeerIds ?? [];
    if (explicitRecipients.length > 0 && message.senderId === myPeerId) {
      return explicitRecipients.includes(peerId);
    }

    return true;
  }

  private async broadcastControlForChannel(channelId: string, payload: MessageEditPayload | MessageDeletePayload): Promise<void> {
    const workspace = this.findWorkspaceByChannel(channelId);
    if (workspace) {
      const channel = workspace.channels.find((candidate) => candidate.id === channelId);
      if (!channel) return;
      for (const peerId of this.getRecipientPeerIds(workspace, channel)) {
        if (!this.readyPeers.has(peerId)) continue;
        this.transport.send(peerId, payload);
      }
      return;
    }

    const directConversation = this.directConversationsById.get(channelId);
    if (!directConversation) return;
    const peerId = directConversation.contactPeerId;
    if (!this.readyPeers.has(peerId)) return;
    this.transport.send(peerId, payload);
  }

  private async dispatchOrQueueMessageToPeer(
    peerId: string,
    payload: {
      message: PlaintextMessage;
      content: string;
      type: 'text' | 'file' | 'system';
      channelId: string;
      workspaceId?: string;
      timestamp: number;
      threadId?: string;
      isDirect?: boolean;
      metadata?: PlaintextMessage['metadata'];
      attachments?: AttachmentMeta[];
    },
  ): Promise<void> {
    const deferred: DeferredOutboxPayload = {
      _deferred: true,
      content: payload.content,
      type: payload.type,
      channelId: payload.channelId,
      workspaceId: payload.workspaceId,
      timestamp: payload.timestamp,
      messageId: payload.message.id,
      threadId: payload.threadId,
      isDirect: payload.isDirect,
      metadata: payload.metadata,
      attachments: payload.attachments,
    };

    if (!this.messageProtocol || !this.readyPeers.has(peerId)) {
      await this.persistentStore.enqueueMessage(peerId, deferred);
      return;
    }

    try {
      const envelope = await this.encryptMessageWithPreKeyBootstrap(
        peerId,
        payload.content,
        payload.type,
        payload.metadata,
        payload.workspaceId,
      );
      const sent = this.transport.send(peerId, {
        ...envelope,
        messageId: payload.message.id,
        channelId: payload.channelId,
        workspaceId: payload.workspaceId,
        timestamp: payload.timestamp,
        threadId: payload.threadId,
        isDirect: payload.isDirect,
        metadata: payload.metadata,
        attachments: payload.attachments,
      });

      if (!sent) {
        await this.persistentStore.enqueueMessage(peerId, deferred);
      }
    } catch (error) {
      console.warn('[MobileController] send failed, queued for retry:', (error as Error).message);
      await this.persistentStore.enqueueMessage(peerId, deferred);
    }
  }

  private async flushOfflineQueue(peerId: string): Promise<void> {
    if (!this.messageProtocol || !this.readyPeers.has(peerId)) return;

    const queued = await this.persistentStore.getQueuedMessages(peerId);
    for (const item of queued) {
      let envelope = item?.data;
      if (!envelope) continue;

      if (envelope._deferred) {
        try {
          const encrypted = await this.encryptMessageWithPreKeyBootstrap(
            peerId,
            envelope.content,
            envelope.type,
            envelope.metadata,
            envelope.workspaceId,
          );
          envelope = {
            ...encrypted,
            messageId: envelope.messageId,
            channelId: envelope.channelId,
            workspaceId: envelope.workspaceId,
            timestamp: envelope.timestamp,
            threadId: envelope.threadId,
            isDirect: envelope.isDirect,
            metadata: envelope.metadata,
            attachments: envelope.attachments,
          };
        } catch (error) {
          await this.persistentStore.updateQueuedMessage(item.id, {
            attempts: (item.attempts ?? 0) + 1,
            lastAttempt: Date.now(),
          });
          console.warn('[MobileController] deferred outbox encryption failed:', (error as Error).message);
          continue;
        }
      }

      const sent = this.transport.send(peerId, envelope);
      if (!sent) {
        await this.persistentStore.updateQueuedMessage(item.id, {
          attempts: (item.attempts ?? 0) + 1,
          lastAttempt: Date.now(),
        });
        continue;
      }

      await this.persistentStore.dequeueMessage(item.id);
    }
  }

  private getSyncWorkspacesForPeer(peerId: string): Workspace[] {
    return this.workspaceManager
      .getAllWorkspaces()
      .filter((workspace) => workspace.members.some((member) => member.peerId === peerId));
  }

  private buildChannelTimestamps(workspace: Workspace): Record<string, number> {
    const channelTimestamps: Record<string, number> = {};
    for (const channel of workspace.channels) {
      const channelMessages = this.messageStore.getMessages(channel.id);
      channelTimestamps[channel.id] = channelMessages[channelMessages.length - 1]?.timestamp ?? 0;
    }
    return channelTimestamps;
  }

  private async requestMessageSyncForPeer(peerId: string): Promise<void> {
    if (!this.readyPeers.has(peerId)) return;

    const syncWorkspaces = this.getSyncWorkspacesForPeer(peerId);
    if (syncWorkspaces.length === 0) {
      await this.requestTimestampMessageSyncForPeer(peerId);
      return;
    }

    try {
      for (const workspace of syncWorkspaces) {
        await this.requestNegentropyMessageSyncForPeer(peerId, workspace);
      }
    } catch (error) {
      console.warn('[MobileController] negentropy sync failed, falling back to timestamp sync:', (error as Error).message);
      await this.requestTimestampMessageSyncForPeer(peerId);
    }
  }

  private async requestTimestampMessageSyncForPeer(peerId: string): Promise<void> {
    const syncWorkspaces = this.getSyncWorkspacesForPeer(peerId);
    for (const workspace of syncWorkspaces) {
      this.transport.send(peerId, {
        type: 'message-sync-request',
        workspaceId: workspace.id,
        channelTimestamps: this.buildChannelTimestamps(workspace),
      } satisfies MessageSyncRequestPayload);
    }

    const directConversation = await this.directConversationStore.getByContact(peerId);
    if (!directConversation) return;

    this.directConversationsById.set(directConversation.id, directConversation);
    const channelMessages = this.messageStore.getMessages(directConversation.id);
    const lastTimestamp = channelMessages[channelMessages.length - 1]?.timestamp ?? 0;

    this.transport.send(peerId, {
      type: 'message-sync-request',
      workspaceId: this.getDirectSyncWorkspaceId(peerId),
      channelTimestamps: {
        [DIRECT_SYNC_CHANNEL_KEY]: lastTimestamp,
      },
    } satisfies MessageSyncRequestPayload);
  }

  private async requestNegentropyMessageSyncForPeer(peerId: string, workspace: Workspace): Promise<void> {
    const messageIdsByChannel: Record<string, string[]> = {};
    const messagesToPush: SyncMessageSummary[] = [];

    for (const channel of workspace.channels) {
      const localMessages = this.messageStore.getMessages(channel.id);
      const negentropy = new Negentropy();
      await negentropy.build(localMessages.map((message) => ({ id: message.id, timestamp: message.timestamp })));

      const result = await negentropy.reconcile(
        async (query: NegentropyQuery) => this.sendNegentropyQuery(peerId, workspace.id, channel.id, query),
      );

      if (result.need.length > 0) {
        messageIdsByChannel[channel.id] = result.need;
      }

      if (result.excess.length > 0) {
        const excessSet = new Set(result.excess);
        for (const message of localMessages) {
          if (!excessSet.has(message.id)) continue;
          messagesToPush.push(this.toSyncSummary(message));
        }
      }
    }

    if (Object.keys(messageIdsByChannel).length > 0) {
      this.transport.send(peerId, {
        type: 'message-sync-fetch-request',
        workspaceId: workspace.id,
        messageIdsByChannel,
      } satisfies MessageSyncFetchRequestPayload);
    }

    if (messagesToPush.length > 0) {
      this.transport.send(peerId, {
        type: 'message-sync-response',
        workspaceId: workspace.id,
        messages: messagesToPush,
      } satisfies MessageSyncResponsePayload);
    }
  }

  private toSyncSummary(message: PlaintextMessage): SyncMessageSummary {
    return {
      id: message.id,
      channelId: message.channelId,
      senderId: message.senderId,
      content: message.content,
      timestamp: message.timestamp,
      type: message.type,
      status: message.status,
      threadId: message.threadId,
      prevHash: message.prevHash,
      metadata: message.metadata,
      attachments: (message as PlaintextMessage & { attachments?: AttachmentMeta[] }).attachments,
      recipientPeerIds: message.recipientPeerIds,
      ackedBy: message.ackedBy,
      readBy: message.readBy,
      editedAt: (message as PlaintextMessage & { editedAt?: number }).editedAt,
      deletedAt: (message as PlaintextMessage & { deletedAt?: number }).deletedAt,
      deleted: (message as PlaintextMessage & { deleted?: boolean }).deleted,
    };
  }

  private async sendNegentropyQuery(
    peerId: string,
    workspaceId: string,
    channelId: string,
    query: NegentropyQuery,
  ): Promise<NegentropyResponse> {
    const requestId = crypto.randomUUID();

    return new Promise<NegentropyResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingNegentropyQueries.delete(requestId);
        reject(new Error(`Negentropy query timeout for ${peerId}`));
      }, NEGENTROPY_QUERY_TIMEOUT_MS);

      this.pendingNegentropyQueries.set(requestId, { peerId, resolve, reject, timer });

      this.transport.send(peerId, {
        type: 'message-sync-negentropy-query',
        requestId,
        workspaceId,
        channelId,
        query,
      } satisfies MessageSyncNegentropyQueryPayload);
    });
  }

  private async handleNegentropySyncQuery(peerId: string, payload: MessageSyncNegentropyQueryPayload): Promise<void> {
    const { workspaceId, channelId, requestId, query } = payload;
    if (!workspaceId || !channelId || !requestId || !query) return;

    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return;
    if (!workspace.members.some((member) => member.peerId === peerId)) return;
    if (!workspace.channels.some((channel) => channel.id === channelId)) return;

    const localItems = this.messageStore.getMessages(channelId).map((message) => ({ id: message.id, timestamp: message.timestamp }));
    const negentropy = new Negentropy();
    await negentropy.build(localItems);

    const response = await negentropy.processQuery(query);
    this.transport.send(peerId, {
      type: 'message-sync-negentropy-response',
      requestId,
      workspaceId,
      channelId,
      response,
    } satisfies MessageSyncNegentropyResponsePayload);
  }

  private handleNegentropySyncResponse(peerId: string, payload: MessageSyncNegentropyResponsePayload): void {
    const pending = this.pendingNegentropyQueries.get(payload.requestId);
    if (!pending || pending.peerId !== peerId) return;

    clearTimeout(pending.timer);
    this.pendingNegentropyQueries.delete(payload.requestId);
    pending.resolve(payload.response);
  }

  private async handleMessageSyncFetchRequest(peerId: string, payload: MessageSyncFetchRequestPayload): Promise<void> {
    const workspace = this.workspaceManager.getWorkspace(payload.workspaceId);
    if (!workspace) return;
    if (!workspace.members.some((member) => member.peerId === peerId)) return;

    const messages: SyncMessageSummary[] = [];

    for (const channel of workspace.channels) {
      const requestedIds = payload.messageIdsByChannel[channel.id] ?? [];
      if (requestedIds.length === 0) continue;
      const requestedSet = new Set(requestedIds);
      for (const message of this.messageStore.getMessages(channel.id)) {
        if (!requestedSet.has(message.id)) continue;
        messages.push(this.toSyncSummary(message));
      }
    }

    this.transport.send(peerId, {
      type: 'message-sync-response',
      workspaceId: workspace.id,
      messages,
    } satisfies MessageSyncResponsePayload);
  }

  private async handleMessageSyncRequest(peerId: string, payload: MessageSyncRequestPayload): Promise<void> {
    const directSyncPeerId = this.parseDirectSyncPeerId(payload.workspaceId);
    if (directSyncPeerId) {
      if (directSyncPeerId !== peerId) return;

      const directConversation = await this.directConversationStore.getByContact(peerId);
      if (!directConversation) return;

      const since = payload.channelTimestamps[DIRECT_SYNC_CHANNEL_KEY] ?? 0;
      const messages = this.messageStore
        .getMessages(directConversation.id)
        .filter((message) => message.timestamp > since)
        .map((message) => ({
          ...this.toSyncSummary(message),
          channelId: DIRECT_SYNC_CHANNEL_KEY,
        }));

      this.transport.send(peerId, {
        type: 'message-sync-response',
        workspaceId: payload.workspaceId,
        messages,
      } satisfies MessageSyncResponsePayload);
      return;
    }

    const workspace = this.workspaceManager.getWorkspace(payload.workspaceId);
    if (!workspace) return;
    if (!workspace.members.some((member) => member.peerId === peerId)) return;

    const messages: SyncMessageSummary[] = [];
    for (const channel of workspace.channels) {
      const since = payload.channelTimestamps[channel.id] ?? 0;
      for (const message of this.messageStore.getMessages(channel.id)) {
        if (message.timestamp <= since) continue;
        messages.push(this.toSyncSummary(message));
      }
    }

    this.transport.send(peerId, {
      type: 'message-sync-response',
      workspaceId: workspace.id,
      messages,
    } satisfies MessageSyncResponsePayload);
  }

  private async handleMessageSyncResponse(peerId: string, payload: MessageSyncResponsePayload): Promise<void> {
    const directSyncPeerId = this.parseDirectSyncPeerId(payload.workspaceId);
    let directChannelId: string | null = null;
    let workspace: Workspace | null = null;

    if (directSyncPeerId) {
      if (directSyncPeerId !== peerId) return;
      let directConversation = await this.directConversationStore.getByContact(peerId);
      if (!directConversation) {
        directConversation = await this.directConversationStore.create(peerId);
        await this.persistentStore.saveDirectConversation(directConversation);
      }
      this.directConversationsById.set(directConversation.id, directConversation);
      directChannelId = directConversation.id;
    } else {
      workspace = this.workspaceManager.getWorkspace(payload.workspaceId) ?? null;
      if (!workspace) return;
      if (!workspace.members.some((member) => member.peerId === peerId)) return;
    }

    const myPeerId = get(appState.myPeerId);
    const incomingMessages = Array.isArray(payload.messages) ? [...payload.messages] : [];
    incomingMessages.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

    for (const incoming of incomingMessages) {
      if (!incoming?.id || !incoming.senderId) continue;

      if (directChannelId) {
        if (incoming.senderId !== peerId && incoming.senderId !== myPeerId) continue;
      } else if (workspace && !workspace.members.some((member) => member.peerId === incoming.senderId)) {
        continue;
      }

      const targetChannelId = directChannelId ?? (
        workspace!.channels.some((channel) => channel.id === incoming.channelId)
          ? incoming.channelId
          : workspace!.channels[0]?.id
      );
      if (!targetChannelId) continue;

      const existing = this.messageStore.getMessages(targetChannelId).find((message) => message.id === incoming.id);
      if (existing) {
        if (existing.senderId !== incoming.senderId) {
          continue;
        }

        let changed = false;

        if (existing.content !== incoming.content) {
          existing.content = incoming.content;
          changed = true;
        }
        if (existing.type !== (incoming.type ?? existing.type)) {
          existing.type = incoming.type ?? existing.type;
          changed = true;
        }
        if (existing.threadId !== incoming.threadId) {
          existing.threadId = incoming.threadId;
          changed = true;
        }
        if (incoming.prevHash && existing.prevHash !== incoming.prevHash) {
          existing.prevHash = incoming.prevHash;
          changed = true;
        }
        if (incoming.metadata) {
          existing.metadata = incoming.metadata;
          changed = true;
        }
        if (incoming.status && existing.status !== incoming.status) {
          existing.status = incoming.status;
          changed = true;
        }
        if (incoming.recipientPeerIds) {
          existing.recipientPeerIds = [...incoming.recipientPeerIds];
          changed = true;
        }
        if (incoming.ackedBy) {
          existing.ackedBy = [...incoming.ackedBy];
          changed = true;
        }
        if (incoming.readBy) {
          existing.readBy = [...incoming.readBy];
          changed = true;
        }
        if (incoming.attachments?.length) {
          (existing as PlaintextMessage & { attachments?: AttachmentMeta[] }).attachments = incoming.attachments;
          this.registerAttachmentIndex(targetChannelId, existing.id, incoming.attachments);
          this.requestMissingAttachments(peerId, targetChannelId, existing.id, incoming.attachments);
          changed = true;
        }
        if (typeof incoming.editedAt === 'number') {
          (existing as PlaintextMessage & { editedAt?: number }).editedAt = incoming.editedAt;
          changed = true;
        }
        if (typeof incoming.deletedAt === 'number') {
          (existing as PlaintextMessage & { deletedAt?: number }).deletedAt = incoming.deletedAt;
          changed = true;
        }
        if (typeof incoming.deleted === 'boolean') {
          (existing as PlaintextMessage & { deleted?: boolean }).deleted = incoming.deleted;
          changed = true;
        }

        if (changed) {
          await this.persistentStore.saveMessage(existing);
          this.syncChannelMessages(targetChannelId);
        }
        continue;
      }

      const message = await this.messageStore.createMessage(
        targetChannelId,
        incoming.senderId,
        incoming.content,
        incoming.type ?? 'text',
        incoming.threadId,
      );
      message.id = incoming.id;
      const channelMessages = this.messageStore.getMessages(targetChannelId);
      const lastMessageTimestamp = channelMessages[channelMessages.length - 1]?.timestamp ?? 0;
      message.timestamp = Math.max(Number(incoming.timestamp) || Date.now(), lastMessageTimestamp + 1);
      message.prevHash = incoming.prevHash || message.prevHash;
      message.status = incoming.status ?? (incoming.senderId === myPeerId ? 'sent' : 'delivered');
      if (incoming.metadata) message.metadata = incoming.metadata;
      if (incoming.recipientPeerIds) message.recipientPeerIds = [...incoming.recipientPeerIds];
      if (incoming.ackedBy) message.ackedBy = [...incoming.ackedBy];
      if (incoming.readBy) message.readBy = [...incoming.readBy];
      if (incoming.attachments?.length) {
        (message as PlaintextMessage & { attachments?: AttachmentMeta[] }).attachments = incoming.attachments;
        this.registerAttachmentIndex(targetChannelId, message.id, incoming.attachments);
        this.requestMissingAttachments(peerId, targetChannelId, message.id, incoming.attachments);
      }
      if (typeof incoming.editedAt === 'number') {
        (message as PlaintextMessage & { editedAt?: number }).editedAt = incoming.editedAt;
      }
      if (typeof incoming.deletedAt === 'number') {
        (message as PlaintextMessage & { deletedAt?: number }).deletedAt = incoming.deletedAt;
      }
      if (typeof incoming.deleted === 'boolean') {
        (message as PlaintextMessage & { deleted?: boolean }).deleted = incoming.deleted;
      }

      const added = await this.messageStore.addMessage(message);
      if (!added.success) {
        this.messageStore.forceAdd(message);
      }

      await this.persistentStore.saveMessage(message);
      this.syncChannelMessages(targetChannelId);
    }
  }

  private async handleReceiptControl(peerId: string, payload: MessageReceiptPayload): Promise<void> {
    const messages = this.messageStore.getMessages(payload.channelId);
    const target = messages.find((message) => message.id === payload.messageId);
    if (!target) return;

    const myPeerId = get(appState.myPeerId);
    if (!myPeerId || target.senderId !== myPeerId) return;

    const allowedRecipients = new Set(target.recipientPeerIds ?? []);
    if (allowedRecipients.size > 0 && !allowedRecipients.has(peerId)) return;

    const recipients = (target.recipientPeerIds ?? []).filter((candidate) => candidate && candidate !== myPeerId);
    const ackedBy = new Set(target.ackedBy ?? []);
    const readBy = new Set(target.readBy ?? []);

    ackedBy.add(peerId);
    if (payload.type === 'read') {
      readBy.add(peerId);
    }

    target.ackedBy = Array.from(ackedBy);
    target.readBy = Array.from(readBy);

    const deliveredToAll = recipients.length > 0 && recipients.every((recipientPeerId) => ackedBy.has(recipientPeerId));
    const readByAll = recipients.length > 0 && recipients.every((recipientPeerId) => readBy.has(recipientPeerId));

    if (readByAll) {
      target.status = 'read';
    } else if (deliveredToAll) {
      target.status = 'delivered';
    } else {
      target.status = 'sent';
    }

    await this.persistentStore.saveMessage(target);
    this.syncChannelMessages(payload.channelId);
  }

  private handleTypingControl(peerId: string, payload: TypingPayload): void {
    if (!payload.channelId) return;
    if (!this.canPeerAccessChannel(peerId, payload.channelId)) return;
    appState.updateTypingForChannel(payload.channelId, peerId, payload.isTyping);
  }

  private clearTypingForPeer(peerId: string): void {
    appState.removeTypingPeer(peerId);
  }

  private async handleMessageEditControl(peerId: string, payload: MessageEditPayload): Promise<void> {
    const messages = this.messageStore.getMessages(payload.channelId);
    const target = messages.find((message) => message.id === payload.messageId);
    if (!target || target.senderId !== peerId) return;

    target.content = payload.content;
    (target as PlaintextMessage & { editedAt?: number }).editedAt = payload.editedAt;
    await this.persistentStore.saveMessage(target);
    this.syncChannelMessages(payload.channelId);
  }

  private async handleMessageDeleteControl(peerId: string, payload: MessageDeletePayload): Promise<void> {
    const messages = this.messageStore.getMessages(payload.channelId);
    const target = messages.find((message) => message.id === payload.messageId);
    if (!target || target.senderId !== peerId) return;

    target.content = '🗑️ Message deleted';
    target.type = 'system';
    (target as PlaintextMessage & { deletedAt?: number; deleted?: boolean }).deletedAt = payload.deletedAt;
    (target as PlaintextMessage & { deletedAt?: number; deleted?: boolean }).deleted = true;

    await this.persistentStore.saveMessage(target);
    this.syncChannelMessages(payload.channelId);
  }

  private async handleMediaRequest(peerId: string, payload: MediaRequestPayload): Promise<void> {
    const attachmentAllowed = this.canPeerAccessMessageAttachment(
      peerId,
      payload.channelId,
      payload.messageId,
      payload.attachmentId,
    );
    const attachmentData = attachmentAllowed ? this.localAttachmentBlobs.get(payload.attachmentId) : null;

    if (!attachmentData) {
      this.transport.send(peerId, {
        type: 'media-response',
        attachmentId: payload.attachmentId,
        channelId: payload.channelId,
        messageId: payload.messageId,
        available: false,
      } satisfies MediaResponsePayload);
      return;
    }

    const sender = new ChunkedSender(payload.attachmentId, attachmentData);
    this.transport.send(peerId, {
      type: 'media-response',
      attachmentId: payload.attachmentId,
      channelId: payload.channelId,
      messageId: payload.messageId,
      available: true,
      totalChunks: sender.totalChunks,
    } satisfies MediaResponsePayload);

    for await (const chunk of sender.chunks()) {
      this.transport.send(peerId, {
        type: 'media-chunk',
        attachmentId: payload.attachmentId,
        channelId: payload.channelId,
        messageId: payload.messageId,
        index: chunk.index,
        total: chunk.total,
        data: chunk.data,
        chunkHash: chunk.chunkHash,
      } satisfies MediaChunkPayload);
    }
  }

  private handleMediaResponse(peerId: string, payload: MediaResponsePayload): void {
    if (!payload.available || !payload.totalChunks || payload.totalChunks <= 0) return;
    if (!this.canPeerAccessMessageAttachment(peerId, payload.channelId, payload.messageId, payload.attachmentId)) return;

    const meta = this.findAttachmentMeta(payload.channelId, payload.messageId, payload.attachmentId);
    if (!meta) return;

    const existingTransfer = this.pendingMediaTransfers.get(payload.attachmentId);
    if (existingTransfer && existingTransfer.peerId !== peerId) {
      return;
    }

    this.pendingMediaTransfers.set(payload.attachmentId, {
      peerId,
      receiver: new ChunkedReceiver(payload.attachmentId, payload.totalChunks, meta.hash),
    });
  }

  private async handleMediaChunk(peerId: string, payload: MediaChunkPayload): Promise<void> {
    const transfer = this.pendingMediaTransfers.get(payload.attachmentId);
    if (!transfer || transfer.peerId !== peerId) return;

    try {
      await transfer.receiver.addChunk({
        attachmentId: payload.attachmentId,
        index: payload.index,
        total: payload.total,
        data: payload.data,
        chunkHash: payload.chunkHash,
      });

      if (!transfer.receiver.isComplete()) return;

      const assembled = await transfer.receiver.assemble();
      this.localAttachmentBlobs.set(payload.attachmentId, assembled);
      this.pendingMediaTransfers.delete(payload.attachmentId);
    } catch (error) {
      this.pendingMediaTransfers.delete(payload.attachmentId);
      console.warn('[MobileController] media chunk rejected:', (error as Error).message);
    }
  }

  private findAttachmentMeta(channelId: string, messageId: string, attachmentId: string): AttachmentMeta | null {
    const messages = this.messageStore.getMessages(channelId);
    const message = messages.find((candidate) => candidate.id === messageId);
    if (!message) return null;

    const attachments = (message as PlaintextMessage & { attachments?: AttachmentMeta[] }).attachments ?? [];
    return attachments.find((attachment) => attachment.id === attachmentId) ?? null;
  }

  private parseInviteInput(input: string): { inviteCode: string | null; inviteData?: InviteData } {
    try {
      const inviteData = InviteURI.decode(input);
      return { inviteCode: inviteData.inviteCode, inviteData };
    } catch {
      const directCode = input.match(/^[A-Za-z0-9]{6,16}$/)?.[0] ?? null;
      return { inviteCode: directCode };
    }
  }

  private async applyInviteSignalingServers(inviteData: InviteData): Promise<void> {
    const transport = this.transport as PeerJSTransport & {
      addSignalingServer?: (serverUrl: string, label?: string) => Promise<boolean>;
    };

    if (!transport.addSignalingServer) return;

    const primary = this.toSignalingUrl(inviteData);
    if (primary) {
      await transport.addSignalingServer(primary, 'invite-primary');
    }

    for (const fallback of inviteData.fallbackServers || []) {
      await transport.addSignalingServer(fallback, 'invite-fallback');
    }
  }

  private async applyContactSignalingServers(contact: Contact): Promise<void> {
    const transport = this.transport as PeerJSTransport & {
      addSignalingServer?: (serverUrl: string, label?: string) => Promise<boolean>;
    };

    if (!transport.addSignalingServer) return;

    for (const server of contact.signalingServers || []) {
      if (!server?.trim()) continue;
      await transport.addSignalingServer(server, 'contact');
    }
  }

  private toSignalingUrl(inviteData: InviteData): string {
    const protocol = inviteData.secure ? 'wss' : 'ws';
    const normalizedPath = inviteData.path?.startsWith('/') ? inviteData.path : `/${inviteData.path || 'peerjs'}`;
    return `${protocol}://${inviteData.host}:${inviteData.port}${normalizedPath}`;
  }

  private syncWorkspaceStores(preferredActiveWorkspaceId?: string): void {
    const workspaces = this.workspaceManager.getAllWorkspaces();
    appState.workspaces.set(workspaces);

    const currentActive = preferredActiveWorkspaceId ?? get(appState.activeWorkspaceId);
    const activeExists = currentActive ? workspaces.some((workspace) => workspace.id === currentActive) : false;

    const nextActiveWorkspaceId = activeExists
      ? currentActive
      : workspaces[0]?.id ?? null;

    appState.activeWorkspaceId.set(nextActiveWorkspaceId);
    void this.persistentStore.saveSetting('mobile:activeWorkspaceId', nextActiveWorkspaceId);
  }

  private syncChannelMessages(channelId: string): void {
    appState.messages.update((current) => ({
      ...current,
      [channelId]: this.messageStore.getMessages(channelId),
    }));
  }

  private updateConnectedPeersStore(): void {
    appState.connectedPeers.set(Array.from(this.connectedPeers));
  }

  private updateConnectionState(): void {
    const knownPeerCount = this.countKnownPeers();

    if (!this.transportReady) {
      appState.connectionStatus.set(knownPeerCount > 0 ? 'disconnected' : 'idle');
      return;
    }

    if (this.readyPeers.size > 0) {
      appState.connectionStatus.set('connected');
      return;
    }

    if (knownPeerCount > 0) {
      appState.connectionStatus.set('connecting');
      return;
    }

    appState.connectionStatus.set('idle');
  }

  private countKnownPeers(): number {
    const myPeerId = get(appState.myPeerId);
    if (!myPeerId) return 0;

    const peers = new Set<string>();
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      for (const member of workspace.members) {
        if (member.peerId && member.peerId !== myPeerId) {
          peers.add(member.peerId);
        }
      }
    }

    for (const contact of this.contactsByPeerId.values()) {
      if (contact.peerId && contact.peerId !== myPeerId) {
        peers.add(contact.peerId);
      }
    }

    return peers.size;
  }

  private incrementMessagesSentCounter(): void {
    appState.messagesSent.update((current) => {
      const next = current + 1;
      appState.persistMessagesSent(next);
      return next;
    });
  }

  private getMyAlias(): string {
    const alias = get(appState.myAlias)?.trim();
    if (alias) return alias;

    const myPeerId = get(appState.myPeerId) || '';
    return myPeerId.slice(0, 8);
  }
}
