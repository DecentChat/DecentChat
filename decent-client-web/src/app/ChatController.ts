import { MAX_MESSAGE_CHARS } from '../lib/utils/messageDisplay';
import { normalizeOutgoingMessageContent } from '../lib/utils/outgoingMessage';
/**
 * ChatController — Business logic for the P2P Chat app.
 *
 * Owns the protocol instances (transport, messageProtocol, offlineQueue, CRDTs)
 * and handles message send/receive, workspace persistence, and transport events.
 */

import {
  CryptoManager,
  MessageStore,
  WorkspaceManager,
  PersistentStore,
  OfflineQueue,
  CustodyStore,
  ManifestStore,
  MessageCRDT,
  applyMessageReceipt,

  MediaStore,
  ChunkedSender,
  ChunkedReceiver,
  ClockSync,
  MessageGuard,
  Negentropy,
  verifyHandshakeKey,
  verifyPeerIdBinding,
  PeerAuth,
  DeviceManager,
  hashBlob,
  createAttachmentMeta,
  generateImageThumbnail,
  CHUNK_SIZE,
  InviteURI,
  signInvite,
  MemoryContactStore,
  MemoryDirectConversationStore,
  ServerDiscovery,
  PresenceProtocol,
  createLogger,
} from '@decentchat/protocol';
import type { InviteData } from '@decentchat/protocol';
import { MessageCipher } from '@decentchat/protocol';
import type {
  PlaintextMessage, Workspace, Channel,
  AttachmentMeta, Attachment, MediaChunk, MediaRequest, MediaResponse,
  TimeSyncRequest, TimeSyncResponse,
  NegentropyQuery, NegentropyResponse,
  Contact, DirectConversation,
  WorkspaceShell, MemberDirectoryPage, MemberSummary,
  PresenceAggregateMessage,
  PresencePageResponseMessage,
  PresencePeerSlice,
  PresenceSubscribeMessage,
  PresenceUnsubscribeMessage,
  DeliveryReceipt,
  SyncDomain,
  ManifestDelta,
  ManifestDiffRequest,
  SyncManifestSummary,
  SyncManifestSnapshot,
  ManifestStoreState,
  CustodyEnvelope,
  RoutedMessageReceiptPayload,
} from '@decentchat/protocol';
import {
  buildWorkspaceInviteLists,
  markInviteRevokedInRegistry,
  normalizeWorkspaceInviteRegistry,
  recordGeneratedInvite,
} from './inviteRegistry';
import type {
  WorkspaceInviteLists,
  WorkspaceInviteRegistry,
  WorkspaceInviteView,
} from './inviteRegistry';
import { PublicWorkspaceController } from './workspace/PublicWorkspaceController';

import { PeerTransport, ICE_SERVERS_WITH_TURN } from '@decentchat/transport-webrtc';
import { KeyStore } from '../crypto/KeyStore';
import { IndexedDBBlobStorage } from '../storage/IndexedDBBlobStorage';
import { StorageQuotaManager } from '../storage/StorageQuotaManager';
// Database.ts is kept on disk (task #8 — not deleted yet) but is no longer
// instantiated here; PersistentStore is the single source of truth.
import type { MessageProtocol } from '../messages/MessageProtocol';
import { PresenceManager } from '../ui/PresenceManager';
import { ReactionManager } from '../ui/ReactionManager';
import type { ReactionEvent } from '../ui/ReactionManager';
import type { TypingEvent, ReadReceipt } from '../ui/PresenceManager';
import { NotificationManager } from '../ui/NotificationManager';
import { HuddleManager } from '../huddle/HuddleManager';
import type { HuddleState, HuddleParticipant } from '../huddle/HuddleManager';
import type { AppState } from '../main';
import { TopologyTelemetry } from './topology/TopologyTelemetry';
import { TopologyAnomalyDetector } from './topology/TopologyAnomalyDetector';
import type { TopologyDebugSnapshot, TopologyMaintenanceEvent, TopologyPeerEvent } from './topology/TopologyTelemetry';
import { WorkspaceStateSyncDeduper, buildWorkspaceStateFingerprint } from './workspaceStateSyncDeduper';

const PROTOCOL_VERSION = 2;
const NEGENTROPY_SYNC_CAPABILITY = 'negentropy-sync-v1';
const WORKSPACE_SHELL_CAPABILITY = 'workspace-shell-v1';
const MEMBER_DIRECTORY_CAPABILITY = 'member-directory-v1';
const LARGE_WORKSPACE_CAPABILITY = 'large-workspace-v1';
const LEGACY_LARGE_WORKSPACE_CAPABILITY_FLAGS = [
  'shell-delta-v1',
  MEMBER_DIRECTORY_CAPABILITY,
  'presence-slices-v1',
  'history-pages-v1',
];
const DIRECTORY_SHARD_CAPABILITY_PREFIX = 'directory-shard:';
const RELAY_CHANNEL_CAPABILITY_PREFIX = 'relay-channel:';
const ARCHIVE_HISTORY_CAPABILITY = 'archive-history-v1';
const PRESENCE_AGGREGATOR_CAPABILITY = 'presence-aggregator-v1';
const COMPANY_TEMPLATE_CONTROL_CAPABILITY = 'company-template-control-v1';
const COMPANY_TEMPLATE_INSTALL_TIMEOUT_MS = 20_000;
const COMPANY_SIM_CONTROL_TIMEOUT_MS = 8_000;
const DEFERRED_GOSSIP_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFERRED_GOSSIP_INTENT_OFFER_COOLDOWN_MS = 60 * 1000;
const PENDING_DELIVERY_WATCHDOG_MS = 4_000;
const PENDING_DELIVERY_RECOVERY_COOLDOWN_MS = 20_000;
const OUTGOING_DELIVERY_RECOVERY_CONNECT_COOLDOWN_MS = 5_000;
const NEGENTROPY_QUERY_TIMEOUT_MS = 8000;
const PRESENCE_PAGE_REQUEST_TIMEOUT_MS = 5000;
const PRESENCE_AUTO_ADVANCE_PAGE_TARGET = 150;
const DIRECTORY_REQUEST_FAILOVER_TIMEOUT_MS = 1200;
const MEDIUM_WORKSPACE_MEMBER_THRESHOLD = 100;
const IMPORTANT_SHARD_MIN_REPLICAS = 2;
const IMPORTANT_SHARD_PREFERRED_REPLICAS = 3;
const WORKSPACE_STATE_DUPLICATE_SUPPRESS_MS = 3000;

const DEV_SIGNAL_PORT = Number((import.meta as any).env?.VITE_SIGNAL_PORT || 9000);
const DEV_SIGNAL_WS = `ws://localhost:${DEV_SIGNAL_PORT}`;
const PROD_SIGNAL_WS = 'wss://0.peerjs.com/'; // Free PeerJS cloud service (root path → PeerJS appends /peerjs)

const chatLog = createLogger('ChatController', 'app');
const perfLog = createLogger('ChatController', 'perf');
const syncLog = createLogger('ChatController', 'sync');

// Get the appropriate signaling server based on environment
function getDefaultSignalingServer(): string {
  return window.location.hostname === 'localhost' ? DEV_SIGNAL_WS : PROD_SIGNAL_WS;
}

// ---------------------------------------------------------------------------
// Interface for UI callbacks that ChatController drives
// ---------------------------------------------------------------------------

export interface UIUpdater {
  updateSidebar: (options?: { refreshContacts?: boolean }) => void;
  updateChannelHeader: () => void;
  appendMessageToDOM: (msg: PlaintextMessage, animate?: boolean) => void;
  showToast: (message: string, type?: 'info' | 'error' | 'success') => void;
  renderThreadMessages: () => void;
  renderMessages: () => void;
  renderApp: () => void;
  updateWorkspaceRail?: () => void;
  updateComposePlaceholder?: () => void;
  /** Update the thread reply indicator on a parent message in the main list */
  updateThreadIndicator: (parentMessageId: string, channelId: string) => void;
  /** DEP-005/012/013: Update message ticks (sent/delivered/read) without full re-render */
  updateMessageStatus?: (
    messageId: string,
    status: 'pending' | 'sent' | 'delivered' | 'read',
    detail?: { acked?: number; total?: number; read?: number },
  ) => void;
  updateStreamingMessage?: (messageId: string, content: string) => void;
  finalizeStreamingMessage?: (messageId: string) => void;
  openThread?: (messageId: string) => void;
  /** Huddle state changed (inactive / available / in-call) */
  onHuddleStateChange?: (state: HuddleState, channelId: string | null) => void;
  /** Huddle participants list updated */
  onHuddleParticipantsChange?: (participants: HuddleParticipant[]) => void;
  /** Refresh the activity sidebar panel if open */
  refreshActivityPanel?: () => void;
}

// ---------------------------------------------------------------------------
// Peer selection policy types
// ---------------------------------------------------------------------------

type PeerSelectionDeviceClass = 'desktop' | 'mobile';

interface PeerConnectionSnapshot {
  connected: Set<string>;
  connecting: Set<string>;
  ready: Set<string>;
}

interface WorkspacePeerCandidate {
  peerId: string;
  role: 'owner' | 'admin' | 'member';
  isBot: boolean;
  joinedAt?: number;
  connected: boolean;
  connecting: boolean;
  ready: boolean;
  likelyOnline: boolean;
  recentlySeenAt: number;
  sharedWorkspaceCount: number;
  connectedAt?: number;
  lastSyncAt?: number;
  disconnectCount: number;
  lastExplorerAt?: number;
  directoryShardPrefixes?: string[];
  relayChannels?: string[];
  archiveCapable?: boolean;
  presenceAggregator?: boolean;
}

interface DesiredPeerSelection {
  anchors: WorkspacePeerCandidate[];
  core: WorkspacePeerCandidate[];
  explorers: WorkspacePeerCandidate[];
  desiredPeerIds: string[];
  budget: number;
}

interface ConnectionStatusModel {
  showBanner: boolean;
  level: 'offline' | 'warning' | 'info';
  message: string;
  detail?: string;
  debug?: {
    partialMeshEnabled: boolean;
    desiredPeerCount?: number;
    connectedDesiredPeerCount?: number;
    connectingDesiredPeerCount?: number;
    connectedPeerCount: number;
    likelyPeerCount: number;
    coldPeerCount: number;
    desiredPeers?: string[];
    anchors?: string[];
    explorers?: string[];
  };
}

type PendingPreKeyBundleFetch = {
  ownerPeerId: string;
  workspaceId?: string;
  pendingPeerIds: Set<string>;
  resolve: (value: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
};

type CompanyTemplateControlInstallRequest = {
  workspaceId: string;
  templateId: string;
  answers: Record<string, string>;
};

type CompanyTemplateControlInstallResult = {
  provisioningMode: 'runtime-provisioned' | 'config-provisioned';
  createdAccountIds?: string[];
  provisionedAccountIds?: string[];
  onlineReadyAccountIds?: string[];
  manualActionRequiredAccountIds?: string[];
  manualActionItems?: string[];
};

type PendingCompanyTemplateInstallRequest = {
  targetPeerId: string;
  resolve: (result: CompanyTemplateControlInstallResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type PendingCompanySimControlRequest = {
  targetPeerId: string;
  responseType: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type DeferredGossipIntent = {
  intentId: string;
  targetPeerId: string;
  upstreamPeerId: string;
  originalMessageId: string;
  originalSenderId: string;
  plaintext: string;
  workspaceId?: string;
  channelId: string;
  threadId?: string;
  vectorClock?: unknown;
  metadata?: Record<string, unknown>;
  attachments?: unknown[];
  threadRootSnapshot?: Record<string, unknown>;
  hop: number;
  createdAt: number;
};

// ---------------------------------------------------------------------------
// ChatController
// ---------------------------------------------------------------------------

export class ChatController {
  // Protocol instances
  readonly cryptoManager: CryptoManager;
  readonly keyStore: KeyStore;
  transport: PeerTransport | any;
  messageProtocol: MessageProtocol | null = null;
  readonly messageStore: MessageStore;
  readonly workspaceManager: WorkspaceManager;
  readonly persistentStore: PersistentStore;
  readonly publicWorkspaceController: PublicWorkspaceController;
  readonly offlineQueue: OfflineQueue;
  readonly custodyStore: CustodyStore;
  readonly manifestStore: ManifestStore;
  private readonly custodianInbox = new Map<string, CustodyEnvelope>();
  private readonly deferredGossipIntents = new Map<string, DeferredGossipIntent>();
  private readonly deferredGossipIntentOfferState = new Map<string, number>();
  private readonly deferredGossipIntentInboundState = new Map<string, number>();
  private readonly pendingCustodyOffers = new Map<string, string[]>();
  private readonly scheduledOfflineQueueFlushes = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingDeliveryWatchTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingDeliveryRecoveryCooldowns = new Map<string, number>();
  private readonly outgoingDeliveryRecoveryConnectAt = new Map<string, number>();
  readonly messageCRDTs: Map<string, MessageCRDT> = new Map();
  readonly mediaStore: MediaStore;
  private readonly blobStorage: IndexedDBBlobStorage;
  readonly clockSync: ClockSync;
  private signingKeyPair: { publicKey: CryptoKey; privateKey: CryptoKey } | null = null;
  private lastRoleChangeTimestamp = new Map<string, number>(); // peerId → last accepted timestamp
  readonly messageGuard: MessageGuard;
  readonly presence: PresenceManager;
  private readonly presenceProtocol: PresenceProtocol;
  readonly reactions: ReactionManager;
  readonly notifications: NotificationManager;
  readonly contactStore: MemoryContactStore;
  readonly directConversationStore: MemoryDirectConversationStore;
  private networkOnlineListenerBound = false;
  private transportReinitInFlight: Promise<boolean> | null = null;
  private lastTransportReinitAt = 0;
  private peerCapabilities = new Map<string, Set<string>>();
  private pendingNegentropyQueries = new Map<
    string,
    {
      peerId: string;
      resolve: (response: NegentropyResponse) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly pendingCompanyTemplateInstallRequests = new Map<string, PendingCompanyTemplateInstallRequest>();
  private readonly pendingCompanySimControlRequests = new Map<string, PendingCompanySimControlRequest>();
  private readonly pendingPreKeyBundleFetches = new Map<string, PendingPreKeyBundleFetch>();
  private readonly publishedPreKeyVersionByWorkspace = new Map<string, string>();
  private lastMessageSyncRequestAt = new Map<string, number>();
  private readonly messageSyncInFlight = new Map<string, Promise<void>>();
  /** Global serialization lock: only one full message sync runs at a time across all peers.
   *  This prevents concurrent timestamp-sync responses from piling up in the message queue
   *  and starving the event loop for 30-60+ seconds. */
  private _globalSyncLock: Promise<void> = Promise.resolve();
  private readonly retryUnackedInFlight = new Map<string, Promise<void>>();
  /** Global concurrency gate: at most one retryUnackedOutgoingForPeer scan runs at a time.
   *  Additional peers queue behind it so multiple O(allMessages) scans don't run concurrently. */
  private _retryUnackedGlobalGate: Promise<void> = Promise.resolve();
  private directoryRequestFailoverTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** DEP-002: Peer Exchange for signaling server discovery */
  readonly storageQuota: StorageQuotaManager = new StorageQuotaManager();

  private serverDiscovery: Map<string, ServerDiscovery> = new Map();
  private pexBroadcastInterval: number | null = null;
  private _quotaCheckInterval: ReturnType<typeof setInterval> | null = null;
  private _peerMaintenanceInterval: ReturnType<typeof setInterval> | null = null;

  /** Set to true once restoreFromStorage() completes. Heavy post-connect work
   *  (retryUnackedOutgoing, message sync, manifest exchange) is deferred until
   *  this flag is set so that crypto handshakes during restore don't pile onto
   *  the main thread and extend the freeze. */
  private _restoreComplete = false;
  /** Queued post-connect work that was deferred because restore was in progress. */
  private _deferredPostConnectPeers: string[] = [];

  // T3.2: Gossip propagation
  /** Max relay hops a message may travel (0 = sent by original author, 1 = relayed once, …) */
  static readonly GOSSIP_TTL = 2;
  /** Deduplicate received messages by their original ID. Maps id → received timestamp */
  private _gossipSeen = new Map<string, number>();
  /** Reverse-path receipt routing for gossip-relayed messages. Maps message id → upstream relay/origin info. */
  private _gossipReceiptRoutes = new Map<string, { upstreamPeerId: string; originalSenderId: string; timestamp: number }>();

  /** Peers that have completed challenge-response authentication */
  private authenticatedPeers = new Set<string>();

  /** Multi-device: tracks known devices per identity for message delivery */
  private deviceRegistry = new DeviceManager.DeviceRegistry();
  /** Multi-device: message ID dedup to prevent duplicate processing */
  private multiDeviceDedup = new DeviceManager.MessageDedup();
  /** Pending auth challenges we sent (peerId → challenge data) */
  private pendingAuthChallenges = new Map<string, { nonce: string; timestamp: number }>();
  /** Auth timeout: fall back to TOFU if peer doesn't respond to challenge */
  private static readonly AUTH_TIMEOUT_MS = 5000;
  private static readonly WORKSPACE_INVITES_SETTING_KEY = 'workspaceInvites';
  /** Peer considered "likely online" if seen within this window. */
  private static readonly LIKELY_PEER_WINDOW_MS = 6 * 60 * 60 * 1000;
  /** During startup, treat all peers as likely to avoid missing first reconnection. */
  private static readonly INITIAL_LIKELY_BOOTSTRAP_MS = 2 * 60 * 1000;
  private static readonly LIKELY_PEER_RETRY_BASE_MS = 30_000;
  private static readonly LIKELY_PEER_RETRY_MAX_MS = 10 * 60 * 1000;
  private static readonly CONNECT_FAILURE_MIN_UPDATE_MS = 4_000;
  private static readonly WORKSPACE_STATE_CONNECT_SWEEP_MIN_MS = 4_000;
  private static readonly JOIN_CONNECT_CANDIDATE_CAP = 8;
  private static readonly POST_CONNECT_RETRY_UNACKED_MIN_MS = 12_000;
  private static readonly POST_CONNECT_MESSAGE_SYNC_MIN_MS = 5_000;
  private static readonly OFFLINE_QUEUE_FLUSH_MIN_MS = 2_500;
  private static readonly MESSAGE_SYNC_MIN_INTERVAL_MS = 20_000;
  private static readonly WORKSPACE_SHELL_PREFETCH_MIN_MS = 10_000;
  /** Cold peers are retried sparsely to avoid noisy constant reconnect churn. */
  private static readonly COLD_PEER_RETRY_MS = 5 * 60 * 1000;
  /** Join validation timeout: provisional join workspace must be confirmed by owner/member workspace-state. */
  private static readonly JOIN_VALIDATION_TIMEOUT_MS = 30_000;
  private static readonly PERIODIC_MESSAGE_SYNC_INTERVAL_MS = 120 * 1000;
  private static readonly RETRY_UNACKED_SCAN_YIELD_EVERY = 50;
  /** Max messages per channel kept in memory.  Older ones stay in IDB only. */
  private static readonly MAX_IN_MEMORY_MESSAGES_PER_CHANNEL = 500;
  private static readonly PARTIAL_MESH_ENABLED = true;
  private static readonly PARTIAL_MESH_DESKTOP_TARGET = 8;
  private static readonly PARTIAL_MESH_MOBILE_TARGET = 5;
  private static readonly PARTIAL_MESH_DESKTOP_HARD_CAP = 12;
  private static readonly PARTIAL_MESH_MOBILE_HARD_CAP = 8;
  private static readonly PARTIAL_MESH_MIN_SAFE_PEERS = 3;
  private static readonly PARTIAL_MESH_ANCHOR_SLOTS = 2;
  private static readonly PARTIAL_MESH_DESKTOP_EXPLORER_SLOTS = 2;
  private static readonly PARTIAL_MESH_MOBILE_EXPLORER_SLOTS = 1;
  private static readonly PARTIAL_MESH_EXPLORER_ROTATION_MS = 3 * 60 * 1000;
  private static readonly PARTIAL_MESH_REPLACE_THRESHOLD = 20;
  private static readonly PARTIAL_MESH_MIN_DWELL_MS = 90 * 1000;
  /** Cleanup interval for the seen-set (every 5 min) */
  private _gossipCleanupInterval: ReturnType<typeof setInterval> | null = null;

  /** Activity feed (local derived index for thread replies/mentions) */
  private activityItems: Array<{
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
  }> = [];

  /** Pending stream metadata until the first delta arrives */
  private pendingStreams = new Map<string, {
    channelId: string;
    senderId: string;
    senderName?: string;
    threadId?: string;
    isDirect: boolean;
    modelMeta?: {
      modelId?: string;
      modelName?: string;
      modelAlias?: string;
      modelLabel?: string;
    };
  }>();

  /** Active chunked transfers (receiving) */
  private activeTransfers = new Map<string, ChunkedReceiver>();
  /** Active chunked transfers (sending) */
  private activeSenders = new Map<string, ChunkedSender>();

  myPublicKey: string = '';
  /** Canonical identity ID (hash of public key). Set during init. */
  myIdentityId: string = '';
  huddle: HuddleManager | null = null;
  private ui: UIUpdater | null = null;
  private reactionsPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private manifestPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private channelViewInFlight = new Map<string, Promise<void>>();
  private pendingReadReceiptKeys = new Set<string>();
  private presencePageRequestsByScope = new Map<string, Set<string>>();
  /** Provisional joined workspaces awaiting authoritative owner workspace-state. */
  private pendingJoinValidationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private workspaceInviteRegistry: WorkspaceInviteRegistry = {};
  private readonly peerLastSeenAt = new Map<string, number>();
  private readonly peerLastConnectAttemptAt = new Map<string, number>();
  private readonly peerLastSuccessfulSyncAt = new Map<string, number>();
  private readonly peerConnectedAt = new Map<string, number>();
  private readonly peerDisconnectCount = new Map<string, number>();
  private readonly peerExplorerLastUsedAt = new Map<string, number>();
  private readonly peerConnectFailureCount = new Map<string, number>();
  private readonly peerConnectRetryAfterAt = new Map<string, number>();
  private readonly peerLastConnectFailureAt = new Map<string, number>();
  private readonly workspaceStateConnectSweepAt = new Map<string, number>();
  private readonly workspaceStateSyncDeduper = new WorkspaceStateSyncDeduper(WORKSPACE_STATE_DUPLICATE_SUPPRESS_MS);
  private readonly workspaceShellPrefetchAt = new Map<string, number>();
  private readonly offlineQueueFlushInFlight = new Map<string, Promise<void>>();
  private readonly lastOfflineQueueFlushAt = new Map<string, number>();
  private lastPostConnectRetryUnackedAt = 0;
  private lastPostConnectMessageSyncAt = 0;
  /** Timestamps of recent handshake completions for burst stagger detection. */
  private readonly recentHandshakeTimestamps: number[] = [];
  private static readonly HANDSHAKE_BURST_WINDOW_MS = 3_000;
  private static readonly HANDSHAKE_BURST_STAGGER_MS = 800;
  /** Peers currently mid-handshake processing — prevents duplicate concurrent handshakes. */
  private readonly handshakeInFlight = new Set<string>();
  private readonly handshakeReplyAtByPeer = new Map<string, number>();
  private static readonly HANDSHAKE_REPLY_COOLDOWN_MS = 5_000;
  private topologyTelemetry?: TopologyTelemetry;
  private topologyAnomalyDetector?: TopologyAnomalyDetector;
  private topologyDesiredSetByWorkspace?: Map<string, string[]>;
  private readonly startedAt = Date.now();

  constructor(private state: AppState) {
    this.cryptoManager = new CryptoManager();
    this.keyStore = new KeyStore(this.cryptoManager);
    this.transport = this._buildTransport();
    this.messageStore = new MessageStore();
    this.workspaceManager = new WorkspaceManager();
    this.persistentStore = new PersistentStore();
    this.publicWorkspaceController = new PublicWorkspaceController(this.workspaceManager, this.persistentStore);
    this.offlineQueue = new OfflineQueue({ maxAgeMs: 7 * 24 * 60 * 60 * 1000 });
    this.custodyStore = new CustodyStore(this.offlineQueue);
    this.manifestStore = new ManifestStore();
    this.manifestStore.setPersistence(
      async (workspaceId, manifestState) => {
        await this.persistentStore.saveManifest(workspaceId, manifestState);
      },
      async (workspaceId) => this.persistentStore.getManifest(workspaceId),
      async (workspaceId) => {
        await this.persistentStore.deleteManifest(workspaceId);
      },
    );
    this.blobStorage = new IndexedDBBlobStorage();
    this.mediaStore = new MediaStore(this.blobStorage);
    this.clockSync = new ClockSync();
    this.messageGuard = new MessageGuard();
    this.presence = new PresenceManager();
    this.presenceProtocol = new PresenceProtocol();
    this.reactions = new ReactionManager();
    this.reactions.onReactionsChanged = (messageId) => {
      this.syncReactionNodes(messageId);
      this.schedulePersistReactions();
    };
    this.contactStore = new MemoryContactStore();
    this.directConversationStore = new MemoryDirectConversationStore();
    this.notifications = new NotificationManager();
    this.topologyTelemetry = new TopologyTelemetry({ emitConsole: false });
    this.topologyAnomalyDetector = new TopologyAnomalyDetector();
    this.topologyDesiredSetByWorkspace = new Map<string, string[]>();
    this.custodyStore.setReceiptPersistence(
      async (receipt) => {
        await this.persistentStore.saveDeliveryReceipt(receipt);
      },
      async (peerId) => this.persistentStore.getDeliveryReceipts(peerId),
    );

    this.messageGuard.rateLimiter.onViolation = (v) => {
      console.warn(`[Guard] ${v.severity} violation from ${v.peerId.slice(0, 8)}: ${v.action}`);
      if (v.severity === 'ban') {
        this.ui?.showToast(`⚠️ Peer ${v.peerId.slice(0, 8)} temporarily banned (rate limit abuse)`, 'error');
      }
    };

    // Best-effort flush of in-flight streaming messages on page unload
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => {
        for (const [messageId] of this.pendingStreams) {
          const msg = this.findMessageById(messageId);
          if (msg?.content) {
            this.persistMessage(msg).catch(() => {});
          }
        }
      });
    }
  }

  /** Inject UI callbacks after construction (breaks circular dep). */
  setUI(ui: UIUpdater): void {
    this.ui = ui;
  }

  private _buildTransport(): PeerTransport | any {
    const MockT = typeof window !== 'undefined' && (window as any).__MockTransport;
    return MockT ? new MockT() : new PeerTransport({
      signalingServer: getDefaultSignalingServer(),
      iceServers: this.getIceServersFromEnv(),
    });
  }

  private _replaceTransport(nextTransport: PeerTransport | any): void {
    this.transport = nextTransport;
    if (typeof window !== 'undefined') {
      (window as any).__transport = this.transport;
    }
  }

  async recreateTransportAndInit(peerId?: string, reason = 'manual'): Promise<string> {
    try {
      this.transport.destroy();
    } catch {
      // Best-effort teardown of stale transport before recreation.
    }
    const nextTransport = this._buildTransport();
    this._replaceTransport(nextTransport);
    const assignedId = await this.transport.init(peerId);
    this.setupTransportHandlers();
    chatLog.info(`[Reconnect] Recreated transport (${reason})`);
    return assignedId;
  }

  async migrateLocalPeerId(oldPeerId: string | null | undefined, newPeerId: string): Promise<void> {
    const previous = oldPeerId?.trim();
    const current = newPeerId.trim();
    if (!previous || !current || previous === current) return;

    let changed = false;
    const workspaces = this.workspaceManager.getAllWorkspaces();
    for (const ws of workspaces) {
      let wsChanged = false;

      if (ws.createdBy === previous) {
        ws.createdBy = current;
        wsChanged = true;
      }

      const existingCurrent = ws.members.find((m: any) => m.peerId === current);
      const existingPrevious = ws.members.find((m: any) => m.peerId === previous);

      if (existingPrevious && existingCurrent) {
        // Merge stale local member into the current peer entry.
        existingCurrent.role = existingCurrent.role || existingPrevious.role;
        existingCurrent.alias = existingCurrent.alias || existingPrevious.alias;
        existingCurrent.allowWorkspaceDMs = existingCurrent.allowWorkspaceDMs ?? existingPrevious.allowWorkspaceDMs;
        if (this.myIdentityId && !existingCurrent.identityId) existingCurrent.identityId = this.myIdentityId;
        ws.members = ws.members.filter((m: any) => m.peerId !== previous);
        wsChanged = true;
      } else if (existingPrevious) {
        existingPrevious.peerId = current;
        existingPrevious.alias = this.state.myAlias || existingPrevious.alias;
        if (this.myPublicKey) existingPrevious.publicKey = this.myPublicKey;
        if (this.myIdentityId && !existingPrevious.identityId) existingPrevious.identityId = this.myIdentityId;
        wsChanged = true;
      }

      if (wsChanged) {
        changed = true;
        this.publicWorkspaceController.ingestWorkspaceSnapshot(ws);
        await this.persistWorkspace(ws.id);
      }
    }

    if (changed) {
      chatLog.info(`[Identity] Migrated stored workspace membership ${previous.slice(0, 8)} → ${current.slice(0, 8)}`);
      this.ui?.updateSidebar({ refreshContacts: false });
      this.ui?.renderMessages();
    }
  }

  // =========================================================================
  // Transport event wiring
  // =========================================================================

  private isWorkspaceMember(peerId: string, workspaceId?: string): boolean {
    if (!workspaceId) return false;
    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (!ws) return false;
    return ws.members.some((m: any) => m.peerId === peerId);
  }

  private isTrustedSyncControlMessage(peerId: string, data: any): boolean {
    const type = data?.type;
    if (typeof type !== 'string') return false;

    const syncTypes = new Set([
      'message-sync-request',
      'message-sync-response',
      'message-sync-fetch-request',
      'message-sync-fetch-response',
      'message-sync-negentropy-query',
      'message-sync-negentropy-response',
      'sync.summary',
      'sync.diff_request',
      'sync.diff_response',
      'sync.fetch_snapshot',
      'sync.snapshot_response',
      'custody.offer',
      'custody.accept',
      'custody.reject',
      'custody.store',
      'custody.fetch_index',
      'custody.fetch_envelopes',
      'custody.ack',
      'gossip.intent.store',
      'pre-key-bundle.publish',
      'pre-key-bundle.request',
      'pre-key-bundle.response',
      'pre-key-bundle.fetch',
      'pre-key-bundle.fetch-response',
    ]);
    if (!syncTypes.has(type)) return false;

    const workspaceId = data?.workspaceId as string | undefined;
    return !workspaceId || this.isWorkspaceMember(peerId, workspaceId);
  }

  private isTrustedOfflineReplayMessage(_peerId: string, data: any): boolean {
    // Offline queue replay lane: allow higher throughput for messages explicitly
    // marked as local outbox replay after reconnect.
    if (data?._offlineReplay !== 1) return false;
    if (data?.encrypted || data?.ratchet) return true;
    if (data?.type === 'read' || data?.type === 'ack') return true;
    return typeof data?.type === 'string' && data.type.startsWith('custody.');
  }

  /**
   * Best-effort control-message send with short retries across reconnect races.
   * Use only for low-frequency control traffic (handshake/sync metadata), not chat payloads.
   */
  private sendControlWithRetry(
    peerId: string,
    data: unknown,
    opts?: { maxAttempts?: number; initialDelayMs?: number; backoff?: number; label?: string },
  ): boolean {
    const maxAttempts = opts?.maxAttempts ?? 4;
    const initialDelayMs = opts?.initialDelayMs ?? 150;
    const backoff = opts?.backoff ?? 2;

    const trySend = (attempt: number): boolean => {
      const sent = this.transport.send(peerId, data);
      if (sent) return true;
      if (attempt >= maxAttempts) return false;

      const delay = Math.round(initialDelayMs * Math.pow(backoff, attempt - 1));
      setTimeout(() => {
        const ok = trySend(attempt + 1);
        if (!ok && attempt + 1 === maxAttempts) {
          const label = opts?.label ? ` (${opts.label})` : '';
          console.warn(`[Transport] control send failed after retries${label} to ${peerId.slice(0, 8)}`);
        }
      }, delay);
      return false;
    };

    return trySend(1);
  }

  private markPeerSeen(peerId: string): void {
    const seenMap = this.peerLastSeenAt ?? ((this as any).peerLastSeenAt = new Map<string, number>());
    seenMap.set(peerId, Date.now());
  }

  private markPeerConnectSuccess(peerId: string): void {
    const failureCounts = this.peerConnectFailureCount ?? ((this as any).peerConnectFailureCount = new Map<string, number>());
    const retryAfter = this.peerConnectRetryAfterAt ?? ((this as any).peerConnectRetryAfterAt = new Map<string, number>());
    const lastFailure = this.peerLastConnectFailureAt ?? ((this as any).peerLastConnectFailureAt = new Map<string, number>());
    failureCounts.delete(peerId);
    retryAfter.delete(peerId);
    lastFailure.delete(peerId);
  }

  private notePeerConnectFailure(peerId: string, options?: { likelyOnline?: boolean; now?: number }): void {
    if (!peerId || peerId === this.state.myPeerId) return;

    const now = options?.now ?? Date.now();
    const lastFailureMap = this.peerLastConnectFailureAt ?? ((this as any).peerLastConnectFailureAt = new Map<string, number>());
    const previousFailureAt = lastFailureMap.get(peerId) ?? 0;
    if (now - previousFailureAt < ChatController.CONNECT_FAILURE_MIN_UPDATE_MS) return;

    const failureCounts = this.peerConnectFailureCount ?? ((this as any).peerConnectFailureCount = new Map<string, number>());
    const retryAfter = this.peerConnectRetryAfterAt ?? ((this as any).peerConnectRetryAfterAt = new Map<string, number>());
    const likelyOnline = options?.likelyOnline ?? true;
    const previousCount = failureCounts.get(peerId) ?? 0;
    const count = Math.min(previousCount + 1, 10);
    failureCounts.set(peerId, count);
    lastFailureMap.set(peerId, now);

    let delayMs = ChatController.COLD_PEER_RETRY_MS;
    if (likelyOnline) {
      delayMs = Math.min(
        ChatController.LIKELY_PEER_RETRY_MAX_MS,
        Math.round(ChatController.LIKELY_PEER_RETRY_BASE_MS * Math.pow(2, Math.max(0, count - 1))),
      );
    }

    const existingRetryAfter = retryAfter.get(peerId) ?? 0;
    retryAfter.set(peerId, Math.max(existingRetryAfter, now + delayMs));
  }

  private getPeerRetryAfterAt(peerId: string): number {
    const retryAfter = this.peerConnectRetryAfterAt ?? ((this as any).peerConnectRetryAfterAt = new Map<string, number>());
    return retryAfter.get(peerId) ?? 0;
  }

  private getTopologyTelemetry(): TopologyTelemetry {
    if (!this.topologyTelemetry) this.topologyTelemetry = new TopologyTelemetry({ emitConsole: false });
    return this.topologyTelemetry;
  }

  private getTopologyDesiredSetMemory(): Map<string, string[]> {
    if (!this.topologyDesiredSetByWorkspace) this.topologyDesiredSetByWorkspace = new Map<string, string[]>();
    return this.topologyDesiredSetByWorkspace;
  }

  private getTopologyAnomalyDetector(): TopologyAnomalyDetector {
    if (!this.topologyAnomalyDetector) this.topologyAnomalyDetector = new TopologyAnomalyDetector();
    return this.topologyAnomalyDetector;
  }

  private recordTopologyMaintenanceEvent(event: TopologyMaintenanceEvent): void {
    const anomalies = this.getTopologyAnomalyDetector().observeMaintenance(event);
    for (const anomaly of anomalies) this.getTopologyTelemetry().recordAnomalyEvent(anomaly);
  }

  private resolveTopologyWorkspaceId(peerId: string, preferredWorkspaceId?: string): string {
    if (preferredWorkspaceId && this.isWorkspaceMember(peerId, preferredWorkspaceId)) return preferredWorkspaceId;
    const activeWorkspaceId = this.state.activeWorkspaceId ?? '';
    if (activeWorkspaceId && this.isWorkspaceMember(peerId, activeWorkspaceId)) return activeWorkspaceId;
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      if (ws.members.some((member: any) => member.peerId === peerId)) return ws.id;
    }
    return preferredWorkspaceId ?? activeWorkspaceId ?? '';
  }

  private recordTopologyPeerEvent(payload: Omit<TopologyPeerEvent, 'kind' | 'ts'>): void {
    if (!payload.workspaceId) return;
    const event = this.getTopologyTelemetry().recordPeerEvent(payload);
    const anomalies = this.getTopologyAnomalyDetector().observePeerEvent(event);
    for (const anomaly of anomalies) this.getTopologyTelemetry().recordAnomalyEvent(anomaly);
  }

  getTopologyDebugSnapshot(workspaceId = this.state.activeWorkspaceId ?? ''): TopologyDebugSnapshot {
    return this.getTopologyTelemetry().getDebugSnapshot(workspaceId || undefined);
  }

  private resolveSharedWorkspaceIds(peerId: string): string[] {
    if (!peerId) return [];
    if (!this.workspaceManager || typeof this.workspaceManager.getAllWorkspaces !== 'function') return [];
    const ids: string[] = [];
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      const memberPeerIds = new Set(workspace.members.map((member: any) => member.peerId));
      if (memberPeerIds.has(peerId) && memberPeerIds.has(this.state.myPeerId)) {
        ids.push(workspace.id);
      }
    }
    return ids;
  }

  private preKeyBundleVersionToken(bundle: any): string {
    const signedPreKeyId = typeof bundle?.signedPreKey?.keyId === 'number' ? bundle.signedPreKey.keyId : 0;
    const oneTimeCount = Array.isArray(bundle?.oneTimePreKeys) ? bundle.oneTimePreKeys.length : 0;
    const firstOneTimeId = Array.isArray(bundle?.oneTimePreKeys) && typeof bundle.oneTimePreKeys[0]?.keyId === 'number'
      ? bundle.oneTimePreKeys[0].keyId
      : 0;
    const lastOneTimeId = Array.isArray(bundle?.oneTimePreKeys) && oneTimeCount > 0
      && typeof bundle.oneTimePreKeys[oneTimeCount - 1]?.keyId === 'number'
      ? bundle.oneTimePreKeys[oneTimeCount - 1].keyId
      : 0;

    // Ignore generatedAt so repeated publishes of identical key material are deduped.
    return `${signedPreKeyId}:${oneTimeCount}:${firstOneTimeId}:${lastOneTimeId}`;
  }

  private async publishPreKeyBundleToDomain(workspaceId: string, bundle: any): Promise<void> {
    if (!workspaceId) return;
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return;

    const versionToken = this.preKeyBundleVersionToken(bundle);
    if (this.publishedPreKeyVersionByWorkspace.get(workspaceId) === versionToken) {
      return;
    }

    const recipients = workspace.members
      .map((member: any) => member.peerId)
      .filter((memberPeerId: string) => memberPeerId && memberPeerId !== this.state.myPeerId);
    if (recipients.length === 0) return;

    const payload = {
      type: 'pre-key-bundle.publish',
      workspaceId,
      ownerPeerId: this.state.myPeerId,
      bundle,
    };
    const opId = `pre-key-bundle:${this.state.myPeerId}:${versionToken}`;

    for (const recipientPeerId of recipients) {
      await this.queueCustodyEnvelope(recipientPeerId, {
        opId,
        recipientPeerIds: [recipientPeerId],
        workspaceId,
        domain: 'pre-key-bundle',
        ciphertext: payload,
        metadata: {
          ownerPeerId: this.state.myPeerId,
          preKeyVersion: versionToken,
          bundleGeneratedAt: bundle?.generatedAt,
          signedPreKeyId: bundle?.signedPreKey?.keyId,
        },
      }, payload);

      await this.replicateToCustodians(recipientPeerId, {
        workspaceId,
        opId,
        domain: 'pre-key-bundle',
      });

      if (this.state.readyPeers.has(recipientPeerId)) {
        this.sendControlWithRetry(recipientPeerId, payload, { label: 'pre-key-bundle.publish' });
      }
    }

    this.recordManifestDomain('pre-key-bundle', workspaceId, {
      operation: 'update',
      subject: this.state.myPeerId,
      itemCount: recipients.length,
      data: {
        ownerPeerId: this.state.myPeerId,
        preKeyVersion: versionToken,
        bundleGeneratedAt: bundle?.generatedAt,
        signedPreKeyId: bundle?.signedPreKey?.keyId,
      },
    });

    this.publishedPreKeyVersionByWorkspace.set(workspaceId, versionToken);
  }

  private async publishPreKeyBundle(peerId: string): Promise<void> {
    if (!this.messageProtocol) return;
    try {
      const bundle = await this.messageProtocol.createPreKeyBundle();
      const sharedWorkspaceIds = this.resolveSharedWorkspaceIds(peerId);
      const workspaceId = sharedWorkspaceIds[0];
      this.sendControlWithRetry(peerId, {
        type: 'pre-key-bundle.publish',
        ...(workspaceId ? { workspaceId } : {}),
        ownerPeerId: this.state.myPeerId,
        bundle,
      }, { label: 'pre-key-bundle.publish' });

      for (const sharedWorkspaceId of sharedWorkspaceIds) {
        await this.publishPreKeyBundleToDomain(sharedWorkspaceId, bundle);
      }
    } catch (error) {
      console.warn('[PreKey] Failed to publish pre-key bundle:', error);
    }
  }

  private shouldAttemptPreKeyBootstrap(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return message.includes('No shared secret with peer');
  }

  private resolvePreKeyLookupCandidates(ownerPeerId: string, workspaceId?: string): string[] {
    if (!ownerPeerId) return [];

    if (workspaceId) {
      const workspace = this.workspaceManager.getWorkspace(workspaceId);
      return (workspace?.members ?? [])
        .map((member: any) => member.peerId)
        .filter((memberPeerId: string) => (
          memberPeerId
          && memberPeerId !== this.state.myPeerId
          && memberPeerId !== ownerPeerId
          && this.state.readyPeers.has(memberPeerId)
        ));
    }

    return Array.from(this.state.readyPeers).filter((memberPeerId: string) => (
      memberPeerId !== this.state.myPeerId && memberPeerId !== ownerPeerId
    ));
  }

  private resolveLikelyPreKeyCustodians(ownerPeerId: string, workspaceId?: string): string[] {
    if (!workspaceId) return [];
    return this.selectCustodianPeers(workspaceId, ownerPeerId);
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

    const resolvedWorkspaceId = workspaceId || this.resolveSharedWorkspaceIds(ownerPeerId)[0];
    const requestedCandidates = opts?.candidatePeerIds ?? this.resolvePreKeyLookupCandidates(ownerPeerId, resolvedWorkspaceId);
    const candidates = Array.from(new Set(requestedCandidates))
      .filter((peerId) => peerId && peerId !== this.state.myPeerId && peerId !== ownerPeerId && this.state.readyPeers.has(peerId))
      .filter((peerId) => !resolvedWorkspaceId || this.isWorkspaceMember(peerId, resolvedWorkspaceId));

    if (candidates.length === 0) return false;

    const requestId = crypto.randomUUID();
    const timeoutMs = Math.max(250, opts?.timeoutMs ?? 2_500);
    const querySource = opts?.querySource ?? 'peer-broadcast';

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPreKeyBundleFetches.delete(requestId);
        resolve(false);
      }, timeoutMs);

      this.pendingPreKeyBundleFetches.set(requestId, {
        ownerPeerId,
        ...(resolvedWorkspaceId ? { workspaceId: resolvedWorkspaceId } : {}),
        pendingPeerIds: new Set(candidates),
        resolve: (value) => {
          clearTimeout(timer);
          this.pendingPreKeyBundleFetches.delete(requestId);
          resolve(value);
        },
        timer,
      });

      for (const peerId of candidates) {
        this.sendControlWithRetry(peerId, {
          type: 'pre-key-bundle.fetch',
          requestId,
          ownerPeerId,
          ...(resolvedWorkspaceId ? { workspaceId: resolvedWorkspaceId } : {}),
          querySource,
        }, { label: 'pre-key-bundle.fetch' });
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
    workspaceId?: string,
  ): Promise<any> {
    if (!this.messageProtocol) throw new Error('Message protocol unavailable');

    try {
      return await this.messageProtocol.encryptMessage(peerId, content, 'text');
    } catch (error) {
      if (!this.shouldAttemptPreKeyBootstrap(error)) throw error;

      const hydrated = await this.ensurePeerPreKeyBundle(peerId, workspaceId);
      if (!hydrated) throw error;

      return this.messageProtocol.encryptMessage(peerId, content, 'text');
    }
  }

  private async handlePreKeyControlMessage(peerId: string, data: any): Promise<boolean> {
    if (!this.messageProtocol) return false;

    if (data?.type === 'pre-key-bundle.publish') {
      if (!data.bundle) return true;
      const ownerPeerId = typeof data?.ownerPeerId === 'string' ? data.ownerPeerId : peerId;
      const stored = await this.messageProtocol.storePeerPreKeyBundle(ownerPeerId, data.bundle);
      const workspaceId = typeof data?.workspaceId === 'string' ? data.workspaceId : this.resolveSharedWorkspaceIds(ownerPeerId)[0];
      if (stored && workspaceId) {
        this.recordManifestDomain('pre-key-bundle', workspaceId, {
          operation: 'update',
          subject: ownerPeerId,
          itemCount: 1,
          data: {
            ownerPeerId,
            source: 'publish',
            bundleGeneratedAt: data.bundle?.generatedAt,
            signedPreKeyId: data.bundle?.signedPreKey?.keyId,
          },
        });
      }
      return true;
    }

    if (data?.type === 'pre-key-bundle.request') {
      try {
        const bundle = await this.messageProtocol.createPreKeyBundle();
        this.sendControlWithRetry(peerId, {
          type: 'pre-key-bundle.response',
          ownerPeerId: this.state.myPeerId,
          ...(typeof data?.workspaceId === 'string' ? { workspaceId: data.workspaceId } : {}),
          bundle,
        }, { label: 'pre-key-bundle.response' });
      } catch (error) {
        console.warn('[PreKey] Failed to create bundle response:', error);
      }
      return true;
    }

    if (data?.type === 'pre-key-bundle.response') {
      if (!data.bundle) return true;
      const ownerPeerId = typeof data?.ownerPeerId === 'string' ? data.ownerPeerId : peerId;
      const stored = await this.messageProtocol.storePeerPreKeyBundle(ownerPeerId, data.bundle);
      const workspaceId = typeof data?.workspaceId === 'string' ? data.workspaceId : this.resolveSharedWorkspaceIds(ownerPeerId)[0];
      if (stored && workspaceId) {
        this.recordManifestDomain('pre-key-bundle', workspaceId, {
          operation: 'update',
          subject: ownerPeerId,
          itemCount: 1,
          data: {
            ownerPeerId,
            source: 'response',
            bundleGeneratedAt: data.bundle?.generatedAt,
            signedPreKeyId: data.bundle?.signedPreKey?.keyId,
          },
        });
      }
      return true;
    }

    if (data?.type === 'pre-key-bundle.fetch') {
      const requestId = typeof data?.requestId === 'string' ? data.requestId : '';
      const ownerPeerId = typeof data?.ownerPeerId === 'string' ? data.ownerPeerId : '';
      if (!requestId || !ownerPeerId) return true;

      const workspaceId = typeof data?.workspaceId === 'string' ? data.workspaceId : undefined;
      if (workspaceId) {
        if (!this.isWorkspaceMember(peerId, workspaceId)) return true;
        if (!this.isWorkspaceMember(ownerPeerId, workspaceId)) return true;
        if (!this.isWorkspaceMember(this.state.myPeerId, workspaceId)) return true;
      }

      const querySource = (data?.querySource === 'custodian-targeted' || data?.querySource === 'peer-broadcast')
        ? data.querySource
        : undefined;
      const bundle = await this.messageProtocol.getPeerPreKeyBundle(ownerPeerId);

      this.sendControlWithRetry(peerId, {
        type: 'pre-key-bundle.fetch-response',
        requestId,
        ownerPeerId,
        ...(workspaceId ? { workspaceId } : {}),
        ...(querySource ? { querySource } : {}),
        ...(bundle ? { bundle } : { notAvailable: true }),
      }, { label: 'pre-key-bundle.fetch-response' });
      return true;
    }

    if (data?.type === 'pre-key-bundle.fetch-response') {
      const requestId = typeof data?.requestId === 'string' ? data.requestId : '';
      if (!requestId) return true;

      const pending = this.pendingPreKeyBundleFetches.get(requestId);
      if (!pending) return true;

      if (!pending.pendingPeerIds.has(peerId)) return true;

      const ownerPeerId = typeof data?.ownerPeerId === 'string' ? data.ownerPeerId : pending.ownerPeerId;
      if (ownerPeerId !== pending.ownerPeerId) return true;

      pending.pendingPeerIds.delete(peerId);

      if (data?.bundle) {
        const stored = await this.messageProtocol.storePeerPreKeyBundle(ownerPeerId, data.bundle);
        const workspaceId = typeof data?.workspaceId === 'string' ? data.workspaceId : pending.workspaceId;
        if (stored && workspaceId) {
          this.recordManifestDomain('pre-key-bundle', workspaceId, {
            operation: 'update',
            subject: ownerPeerId,
            itemCount: 1,
            data: {
              ownerPeerId,
              source: 'fetch-response',
              bundleGeneratedAt: data.bundle?.generatedAt,
              signedPreKeyId: data.bundle?.signedPreKey?.keyId,
            },
          });
        }

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

  setupTransportHandlers(): void {
    this.transport.onSignalingStateChange = () => {
      this.ui?.updateSidebar({ refreshContacts: false });
    };

    this.transport.onConnect = async (peerId: string) => {
      const _t0 = performance.now();
      this.state.connectedPeers.add(peerId);
      this.state.connectingPeers.delete(peerId);
      this.peerConnectedAt.set(peerId, Date.now());
      this.markPeerSeen(peerId);
      this.markPeerConnectSuccess(peerId);
      const workspaceId = this.resolveTopologyWorkspaceId(peerId);
      this.recordTopologyPeerEvent({
        level: 'info',
        workspaceId,
        peerId,
        event: 'connected',
        connected: true,
        connecting: false,
        ready: this.state.readyPeers.has(peerId),
        connectedAt: this.peerConnectedAt.get(peerId),
      });
      this.ui?.updateSidebar({ refreshContacts: false });

      try {
        const handshake = await this.messageProtocol!.createHandshake();
        const _t1 = performance.now();
        this.sendControlWithRetry(peerId, {
          type: 'handshake',
          ...handshake,
          capabilities: this.getAdvertisedControlCapabilities(this.state.activeWorkspaceId ?? undefined),
        }, { label: 'handshake' });
        perfLog.debug(`onConnect(${peerId.slice(0,8)}): createHandshake=${(_t1-_t0).toFixed(1)}ms, total=${(performance.now()-_t0).toFixed(1)}ms`);
        // Pre-key bundle publishing is handled in the handshake response handler
        // after crypto negotiation completes — removed from here to avoid
        // competing WebCrypto work during the connection burst.
      } catch (err) {
        console.error('Handshake failed:', err);
      }
    };

    this.transport.onDisconnect = (peerId: string) => {
      this.state.connectedPeers.delete(peerId);
      this.state.connectingPeers.delete(peerId);
      this.state.readyPeers.delete(peerId);
      this.handshakeInFlight.delete(peerId);
      this.peerConnectedAt.delete(peerId);
      this.clearPendingDeliveryWatchesForPeer(peerId);
      this.pendingDeliveryRecoveryCooldowns.delete(peerId);
      this.lastOfflineQueueFlushAt.delete(peerId);
      this.peerDisconnectCount.set(peerId, (this.peerDisconnectCount.get(peerId) ?? 0) + 1);
      this.recordTopologyPeerEvent({
        level: 'info',
        workspaceId: this.resolveTopologyWorkspaceId(peerId),
        peerId,
        event: 'disconnected',
        connected: false,
        connecting: false,
        ready: false,
        disconnectCount: this.peerDisconnectCount.get(peerId) ?? 0,
      });
      this.messageProtocol?.clearSharedSecret(peerId);
      this.peerCapabilities?.delete(peerId);
      this.presence?.clearPeerSubscriptions?.(peerId);
      this.authenticatedPeers.delete(peerId);
      this.pendingAuthChallenges.delete(peerId);
      for (const [requestId, pending] of this.pendingNegentropyQueries) {
        if (pending.peerId !== peerId) continue;
        clearTimeout(pending.timer);
        pending.reject(new Error(`Peer ${peerId} disconnected during negentropy sync`));
        this.pendingNegentropyQueries.delete(requestId);
      }
      for (const [requestId, pending] of this.pendingCompanyTemplateInstallRequests) {
        if (pending.targetPeerId !== peerId) continue;
        clearTimeout(pending.timer);
        pending.reject(new Error('Host control peer disconnected during AI team install'));
        this.pendingCompanyTemplateInstallRequests.delete(requestId);
      }
      for (const [requestId, pending] of this.pendingCompanySimControlRequests) {
        if (pending.targetPeerId !== peerId) continue;
        clearTimeout(pending.timer);
        pending.reject(new Error('Host control peer disconnected during company sim request'));
        this.pendingCompanySimControlRequests.delete(requestId);
      }

      // --- Per-peer in-flight guards: stale entries block future operations after reconnect ---
      this.messageSyncInFlight.delete(peerId);
      this.retryUnackedInFlight.delete(peerId);
      this.offlineQueueFlushInFlight.delete(peerId);

      // Clear scheduled flush timer so it doesn't fire after disconnect
      const scheduledFlush = this.scheduledOfflineQueueFlushes.get(peerId);
      if (scheduledFlush) {
        clearTimeout(scheduledFlush);
        this.scheduledOfflineQueueFlushes.delete(peerId);
      }

      // Remove disconnected peer from pending pre-key bundle fetch candidate sets
      for (const [requestId, pending] of this.pendingPreKeyBundleFetches) {
        pending.pendingPeerIds.delete(peerId);
        // If no more candidates remain, resolve(false) and clean up
        if (pending.pendingPeerIds.size === 0) {
          clearTimeout(pending.timer);
          this.pendingPreKeyBundleFetches.delete(requestId);
          pending.resolve(false);
        }
      }

      // Clean up pending streams from this peer (streaming messages that will never finish)
      for (const [messageId, pending] of this.pendingStreams) {
        if (pending.senderId === peerId) {
          this.pendingStreams.delete(messageId);
          // Mark the partial message as no longer streaming so the UI shows what arrived
          const msg = this.findMessageById(messageId);
          if (msg) {
            (msg as any).streaming = false;
            this.ui?.updateStreamingMessage?.(messageId, msg.content);
          }
        }
      }

      // Clean up active chunked transfers from this peer (partial downloads that will never finish)
      // ChunkedReceiver doesn't track senderId, so we can't filter — but orphaned receivers
      // will be cleaned up naturally when a re-request starts. Leave as-is for now.

      // Release rate limiter token buckets for this peer (keeps reputation across reconnects)
      this.messageGuard.rateLimiter.removePeer(peerId);

      // Clear sync request throttle so reconnect can sync immediately
      this.lastMessageSyncRequestAt.delete(peerId);

      this.ui?.updateSidebar({ refreshContacts: false });
    };

    this.transport.onMessage = async (peerId: string, rawData: unknown) => {
      const _mt0 = performance.now();
      const data = rawData as any;
      const _msgType = data?.type || 'unknown';
      this.markPeerSeen(peerId);

      // Rate limit + validate before any processing.
      // Trusted sync-control traffic gets its own lane (still authenticated by
      // workspace membership checks in handlers) so reconnect catch-up is not
      // throttled by normal chat message limits.
      // Huddle signaling (SDP offers/answers, ICE candidates) is control-plane
      // traffic that arrives in rapid bursts — must bypass rate limiting or
      // the WebRTC audio connection will silently fail.
      const isHuddleSignaling = typeof data?.type === 'string' && data.type.startsWith('huddle-');
      const bypassGuard = isHuddleSignaling
        || this.isTrustedSyncControlMessage(peerId, data)
        || this.isTrustedOfflineReplayMessage(peerId, data);
      if (!bypassGuard) {
        const guardResult = this.messageGuard.check(peerId, data);
        if (!guardResult.allowed) {
          console.warn(`[Guard] Blocked message from ${peerId.slice(0, 8)}: ${guardResult.reason} type=${data?.type}`);
          return;
        }
      }

      try {
        // --- DEP-005: Delivery ACK (control message — handle before decrypt) ---
        if (data?.type === 'ack') {
          const channelId = data.channelId as string;
          const messageId = data.messageId as string;
          if (channelId && messageId) {
            const logicalPeerId = this.getInboundReceiptPeerId(peerId, data);
            this.clearPendingDeliveryWatch(logicalPeerId, messageId);
            await this.clearDeferredGossipIntentsForReceipt(messageId, logicalPeerId);
            if (this.shouldForwardInboundReceipt(data)) {
              this.forwardInboundReceipt(messageId, channelId, logicalPeerId, data.type);
              return;
            }

            const validation = this.isValidInboundReceipt(logicalPeerId, channelId, messageId, 'ack');
            if (!validation.valid) return;

            const { msg, recipients } = validation;
            const ackReceipt: DeliveryReceipt = {
              receiptId: `ack:${logicalPeerId}:${messageId}:${Date.now()}`,
              kind: 'acknowledged',
              opId: messageId,
              recipientPeerId: logicalPeerId,
              timestamp: Date.now(),
              metadata: { channelId },
            };
            if (this.custodyStore?.applyReceipt) {
              await this.custodyStore.applyReceipt(logicalPeerId, ackReceipt);
            } else {
              await this.offlineQueue?.applyReceipt?.(logicalPeerId, ackReceipt);
            }
            this.recordManifestDomain('receipt', this.findWorkspaceByChannelId(channelId)?.id, {
              channelId,
              operation: 'create',
              subject: messageId,
              data: { kind: 'acknowledged', peerId: logicalPeerId },
            });

            const statusRecipients = this.getStatusMessageRecipients(msg, recipients);
            const applied = applyMessageReceipt(msg, {
              peerId: logicalPeerId,
              type: 'ack',
              at: Date.now(),
              allowedRecipients: recipients,
              statusRecipients,
            });
            if (!applied.accepted) return;

            Object.assign(msg, applied.message);
            this.ui?.updateMessageStatus?.(messageId, applied.status, applied.counts);

            await this.persistentStore.saveMessage({ ...applied.message, recipientPeerIds: recipients });
          }
          return;
        }

        // Message read receipt (WhatsApp-like message info)
        if (data?.type === 'read') {
          const channelId = data.channelId as string;
          const messageId = data.messageId as string;
          if (channelId && messageId) {
            const logicalPeerId = this.getInboundReceiptPeerId(peerId, data);
            this.clearPendingDeliveryWatch(logicalPeerId, messageId);
            await this.clearDeferredGossipIntentsForReceipt(messageId, logicalPeerId);
            if (this.shouldForwardInboundReceipt(data)) {
              this.forwardInboundReceipt(messageId, channelId, logicalPeerId, data.type);
              return;
            }

            const validation = this.isValidInboundReceipt(logicalPeerId, channelId, messageId, 'read');
            if (!validation.valid) return;

            const { msg, recipients } = validation;
            const readReceipt: DeliveryReceipt = {
              receiptId: `read:${logicalPeerId}:${messageId}:${Date.now()}`,
              kind: 'read',
              opId: messageId,
              recipientPeerId: logicalPeerId,
              timestamp: Date.now(),
              metadata: { channelId },
            };
            if (this.custodyStore?.applyReceipt) {
              await this.custodyStore.applyReceipt(logicalPeerId, readReceipt);
            } else {
              await this.offlineQueue?.applyReceipt?.(logicalPeerId, readReceipt);
            }
            this.recordManifestDomain('receipt', this.findWorkspaceByChannelId(channelId)?.id, {
              channelId,
              operation: 'create',
              subject: messageId,
              data: { kind: 'read', peerId: logicalPeerId },
            });

            const statusRecipients = this.getStatusMessageRecipients(msg, recipients);
            const applied = applyMessageReceipt(msg, {
              peerId: logicalPeerId,
              type: 'read',
              at: Date.now(),
              allowedRecipients: recipients,
              statusRecipients,
            });
            if (!applied.accepted) return;

            Object.assign(msg, applied.message);

            this.ui?.updateMessageStatus?.(messageId, applied.status, applied.counts);

            await this.persistentStore.saveMessage({ ...applied.message, recipientPeerIds: recipients });
          }
          return;
        }

        if (data?.type === 'stream-start') {
          const { messageId, channelId, senderId, senderName, isDirect, threadId, replyToId, modelMeta } = data as any;
          let targetChannelId = channelId as string;
          const streamSenderId = (senderId ?? peerId) as string;

          if (isDirect) {
            let conv = await this.directConversationStore.getByContact(streamSenderId);
            if (!conv) {
              conv = await this.directConversationStore.create(streamSenderId);
              await this.persistentStore.saveDirectConversation(conv);
            }
            targetChannelId = conv.id;
          }

          // IMPORTANT: replyToId is quote/reply metadata, not thread metadata.
          // Only explicit threadId may open/render a thread.
          const streamThreadId = isDirect ? undefined : threadId;
          this.pendingStreams.set(messageId, {
            channelId: targetChannelId,
            senderId: streamSenderId,
            senderName,
            threadId: streamThreadId,
            isDirect: !!isDirect,
            modelMeta: modelMeta as any,
          });

          // Do NOT create/render an empty message yet.
          // We only materialize the message on first non-empty delta,
          // otherwise the user sees a blank bubble that later fills in.
          return;
        }
        if (data?.type === 'stream-delta') {
          const { messageId, content } = data as any;
          const normalizedContent = typeof content === 'string' ? content : '';
          if (!normalizedContent.trim()) {
            // Ignore empty deltas to avoid creating empty placeholder messages.
            return;
          }
          const pending = this.pendingStreams.get(messageId);
          if (pending) {
            let existing = this.findMessageById(messageId);

            // First visible chunk: create the message now so we never show an empty bubble.
            if (!existing) {
              const msg = await this.messageStore.createMessage(
                pending.channelId,
                pending.senderId,
                normalizedContent,
                'text',
                pending.threadId,
              );
              msg.id = messageId;
              (msg as any).senderName = pending.senderName;
              (msg as any).streaming = true;
              if (pending.modelMeta) {
                (msg as any).metadata = { assistant: pending.modelMeta };
              }
              await this.messageStore.addMessage(msg);
              // Register in CRDT so sync-repair dedup recognises this message
              // and routes it through the repair path rather than silently dropping it.
              try {
                const crdt = this.getOrCreateCRDT(pending.channelId);
                crdt.addMessage({
                  id: msg.id,
                  channelId: msg.channelId,
                  senderId: msg.senderId,
                  content: msg.content,
                  type: (msg.type || 'text') as any,
                  vectorClock: (msg as any).vectorClock || {},
                  wallTime: msg.timestamp,
                  prevHash: msg.prevHash || '',
                });
              } catch { /* CRDT dup safe to ignore */ }
              existing = msg;

              if (pending.threadId) {
                this.ui?.openThread?.(pending.threadId);
                if (this.state.threadOpen && this.state.activeThreadId === pending.threadId) {
                  this.ui?.renderThreadMessages?.();
                }
                this.ui?.updateThreadIndicator?.(pending.threadId, pending.channelId);
              }
            }

            if (existing) {
              existing.content = normalizedContent;
              (existing as any).streaming = true;
              await this.persistMessage(existing); // Persist partial content so it survives refresh
            }

            // Replace DOM element text with latest cumulative content / render on first delta.
            this.ui?.updateStreamingMessage?.(messageId, normalizedContent);
          }
          return;
        }
        if (data?.type === 'stream-done') {
          const { messageId } = data as any;
          this.pendingStreams.delete(messageId);
          const msg = this.findMessageById(messageId);
          if (msg) {
            (msg as any).streaming = false;
            await this.persistMessage(msg);
          }

          if (msg?.threadId) {
            this.ui?.updateThreadIndicator?.(msg.threadId, msg.channelId);
          }

          // Record thread/mention activity for streamed messages (same as normal inbound)
          if (msg && msg.senderId !== this.state.myPeerId) {
            const lenBefore = this.activityItems.length;
            const unreadBefore = this.getActivityUnreadCount();

            const wsId = this.resolveWorkspaceIdByChannelId(msg.channelId);
            if (wsId) {
              this.maybeRecordMentionActivity(msg, msg.channelId, wsId);
            }
            if (msg.threadId) {
              this.maybeRecordThreadActivity(msg, msg.channelId);
            }

            const lenAfter = this.activityItems.length;
            const unreadAfter = this.getActivityUnreadCount();
            if (lenAfter !== lenBefore || unreadAfter !== unreadBefore) {
              this.ui?.updateChannelHeader();
              this.ui?.updateWorkspaceRail?.();
            }
          }

          this.ui?.finalizeStreamingMessage?.(messageId);
          return;
        }

        // --- Direct 1:1 call signaling (mobile ↔ web interop) ---
        if (data?.type === 'call-ring' || data?.type === 'call-accept' || data?.type === 'call-decline' || data?.type === 'call-busy') {
          await this.handleDirectCallSignal(peerId, data);
          return;
        }

        // --- Huddle signaling (voice calls) ---
        if (data?.type?.startsWith('huddle-')) {
          await this.huddle?.handleSignal(peerId, data);
          return;
        }

        if (await this.handlePreKeyControlMessage(peerId, data)) {
          return;
        }

        // --- Handshake ---
        if (data?.type === 'handshake') {
          const _ht0 = performance.now();
          // Prevent concurrent handshake processing for the same peer.
          // If a peer rapidly disconnects/reconnects, the previous handshake's
          // heavy async work (ECDH, IndexedDB, sync) may still be running.
          if (this.handshakeInFlight.has(peerId)) {
            chatLog.debug(`[P2P] Dropping duplicate handshake from ${peerId.slice(0, 8)} — already in progress`);
            return;
          }
          this.handshakeInFlight.add(peerId);

          try {
          // DEP-003 / MITM protection: if we have a pre-stored public key for this peer
          // (e.g. from an invite URL), verify the handshake key matches before accepting.
          const wsId = this.state.activeWorkspaceId;
          const ws = wsId ? this.workspaceManager.getWorkspace(wsId) : null;
          const existingMember = ws?.members.find((m: any) => m.peerId === peerId);
          const preStoredKey = existingMember?.publicKey;

          const verification = verifyHandshakeKey(preStoredKey, data.publicKey);
          if (!verification.ok) {
            console.error(`[Security] Handshake rejected for peer ${peerId}: ${verification.reason}`);
            this.transport.disconnect(peerId);
            this.ui?.showToast(
              `⚠️ Security alert: ${peerId.slice(0, 8)} sent a different key than expected. ` +
              `Connection rejected — possible impersonation attempt.`,
              'error',
            );
            return;
          }

           const _ht1 = performance.now();
          // Only clear ratchet state if the peer is NOT already ready.
          // When both peers connect simultaneously, each sends a handshake AND
          // a handshake-reply.  The reply arrives after the initial handshake
          // has already established a valid ratchet.  Clearing + re-creating
          // the ratchet here would desync the two sides and cause decryption
          // failures for any messages encrypted between the first handshake
          // and the reply (race window ≈ network RTT).
          //
          // processHandshake() already has a guard that returns immediately
          // when a ratchet state exists, so skipping the clear is safe — the
          // existing ratchet is kept intact and both peers remain in sync.
          //
          // For genuine reconnects the onDisconnect handler (line 1278) already
          // calls clearSharedSecret, and readyPeers is removed (line 1261), so
          // the next handshake WILL go through the full clear + init path.
          const alreadyReady = this.state.readyPeers.has(peerId) && this.messageProtocol!.hasRatchetState(peerId);
          if (!alreadyReady) {
            await this.messageProtocol?.clearRatchetState(peerId);
            this.messageProtocol?.clearSharedSecret(peerId);
          }
          await this.messageProtocol!.processHandshake(peerId, data);
          const _ht2 = performance.now();

          // --- PeerId↔PublicKey binding verification (anti-impersonation) ---
          if (data.publicKey) {
            const binding = await verifyPeerIdBinding(peerId, data.publicKey);
            if (!binding.valid) {
              console.error(`[Security] PeerId binding failed for ${peerId}: ${binding.reason}`);
              this.transport.disconnect(peerId);
              this.ui?.showToast(
                `⚠️ Security: ${peerId.slice(0, 8)} peerId doesn't match their public key. Connection rejected.`,
                'error',
              );
              return;
            }
          }
          const _ht3 = performance.now();

          // --- Initiate challenge-response auth ---
          // Send a challenge; peer must prove they own the signing key.
          // If they don't respond within AUTH_TIMEOUT_MS, fall back to TOFU.
          if (data.signingPublicKey) {
            const challenge = PeerAuth.createChallenge();
            this.pendingAuthChallenges.set(peerId, challenge);
            this.sendControlWithRetry(peerId, {
              type: 'auth-challenge',
              nonce: challenge.nonce,
            }, { label: 'auth-challenge' });

            // TOFU fallback timeout: if peer doesn't respond, accept without auth
            setTimeout(() => {
              if (!this.authenticatedPeers.has(peerId) && this.state.connectedPeers.has(peerId)) {
                console.warn(`[Auth] Peer ${peerId.slice(0, 8)} did not respond to auth challenge — TOFU fallback`);
                this.authenticatedPeers.add(peerId);
                this.pendingAuthChallenges.delete(peerId);
              }
            }, ChatController.AUTH_TIMEOUT_MS);
          } else {
            // Old client without signing key — mark as authenticated via TOFU
            this.authenticatedPeers.add(peerId);
          }

          // Protocol version check (DEP-004)
          if (data.protocolVersion != null && data.protocolVersion > PROTOCOL_VERSION) {
            console.warn(
              `[Protocol] Peer ${peerId.slice(0, 8)} uses protocol v${data.protocolVersion} ` +
              `(we support v${PROTOCOL_VERSION}). Some features may not work.`,
            );
          }
          const capabilities = Array.isArray(data.capabilities)
            ? data.capabilities.filter((value: unknown): value is string => typeof value === 'string')
            : [];
          this.peerCapabilities.set(peerId, new Set(capabilities));

          if (data.preKeySupport) {
            const preKeyWorkspaceId = this.resolveSharedWorkspaceIds(peerId)[0];
            this.sendControlWithRetry(peerId, {
              type: 'pre-key-bundle.request',
              ...(preKeyWorkspaceId ? { workspaceId: preKeyWorkspaceId } : {}),
            }, { label: 'pre-key-bundle.request' });
          }
          // Defer pre-key bundle publishing by 2.5s so it doesn't compete with
          // handshake crypto and the post-connect sync burst.
          setTimeout(() => {
            if (this.state.readyPeers.has(peerId)) {
              void this.publishPreKeyBundle(peerId);
            }
          }, 2_500);

          this.state.readyPeers.add(peerId);
          this.ensurePeerInActiveWorkspace(peerId, data.publicKey);

          // Persist peer — PersistentStore is the single source of truth for peers.
          const _ht4 = performance.now();
          await this.persistentStore.savePeer({
            peerId,
            publicKey: data.publicKey,
            lastSeen: Date.now(),
          });
          await this.keyStore.storePeerPublicKey(peerId, data.publicKey);
          const _ht5 = performance.now();

          this.state.connectedPeers.add(peerId);
          this.ui?.updateSidebar({ refreshContacts: false });
          const ratchetActive = this.messageProtocol!.hasRatchetState(peerId);
          // Connection toast removed — too noisy for end users
          chatLog.debug(`[P2P] ${ratchetActive ? "Forward-secret" : "Encrypted"} connection with ${peerId.slice(0, 8)}`);

          const now = Date.now();
          const shouldRunRetryUnacked = now - this.lastPostConnectRetryUnackedAt >= ChatController.POST_CONNECT_RETRY_UNACKED_MIN_MS;
          if (shouldRunRetryUnacked) {
            this.lastPostConnectRetryUnackedAt = now;
          }

          // Compute burst stagger BEFORE postConnectWork so both post-connect
          // and heavy sync work use the same stagger index.
          const cutoff = now - ChatController.HANDSHAKE_BURST_WINDOW_MS;
          while (this.recentHandshakeTimestamps.length > 0 && this.recentHandshakeTimestamps[0] < cutoff) {
            this.recentHandshakeTimestamps.shift();
          }
          const burstIndex = this.recentHandshakeTimestamps.length; // 0 = first peer, 1 = second, etc.
          this.recentHandshakeTimestamps.push(now);

          // Defer heavy post-connect work until restore is complete.
          // Connections arriving during restoreFromStorage() only get the
          // handshake/crypto; the expensive O(allMessages) scans, sync
          // requests, and offline-queue flushes wait until the app is ready.
          if (!this._restoreComplete) {
            chatLog.info(`[PostConnect] deferring heavy work for ${peerId.slice(0, 8)} — restore in progress`);
            if (!this._deferredPostConnectPeers.includes(peerId)) {
              this._deferredPostConnectPeers.push(peerId);
            }
          } else {
            this._runPostConnectWork(peerId, burstIndex, shouldRunRetryUnacked);
          }

          // Announce our display name for this workspace
          if (this.state.activeWorkspaceId) {
            this.sendControlWithRetry(peerId, {
              type: 'name-announce',
              workspaceId: this.state.activeWorkspaceId,
              alias: this.getMyAliasForWorkspace(this.state.activeWorkspaceId),
              allowWorkspaceDMs: (
                this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)
                  ?.members.find((m: any) => m.peerId === this.state.myPeerId)
                  ?.allowWorkspaceDMs
              ) !== false,
            }, { label: 'name-announce' });
          }

          // Let the newly-ready peer know which presence slice we're currently viewing.
          this.sendCurrentPresenceSubscription(peerId);

          // Reply with our own handshake (cooldown-limited) so a peer that lost
          // our original connect-time handshake can rebuild its ratchet state too.
          const lastHandshakeReplyAt = this.handshakeReplyAtByPeer.get(peerId) ?? 0;
          if (Date.now() - lastHandshakeReplyAt >= ChatController.HANDSHAKE_REPLY_COOLDOWN_MS) {
            this.handshakeReplyAtByPeer.set(peerId, Date.now());
            try {
              const replyHandshake = await this.messageProtocol!.createHandshake();
              this.sendControlWithRetry(peerId, {
                type: 'handshake',
                ...replyHandshake,
                capabilities: this.getAdvertisedControlCapabilities(this.state.activeWorkspaceId ?? undefined),
              }, { label: 'handshake-reply' });
            } catch (replyErr) {
              console.warn('[Handshake] Failed to reply to inbound handshake', replyErr);
            }
          }

          // Start clock sync with new peer
          const syncReq = this.clockSync.startSync(peerId);
          this.sendControlWithRetry(peerId, syncReq, { label: 'time-sync-request' });
          perfLog.debug(`handshake(${peerId.slice(0,8)}): verify=${(_ht1-_ht0).toFixed(1)}ms, crypto=${(_ht2-_ht1).toFixed(1)}ms, peerIdBind=${(_ht3-_ht2).toFixed(1)}ms, idb=${(_ht5-_ht4).toFixed(1)}ms, total=${(performance.now()-_ht0).toFixed(1)}ms`);
          } finally {
            this.handshakeInFlight.delete(peerId);
          }
          return;
        }

        // --- Auth challenge-response ---
        if (data?.type === 'auth-challenge' && data.nonce) {
          // Peer is challenging us: prove we own our signing key
          if (this.signingKeyPair?.privateKey) {
            try {
              const response = await PeerAuth.respondToChallenge(
                data.nonce,
                peerId, // challenger's peerId goes into the signed payload
                this.signingKeyPair.privateKey,
              );
              this.sendControlWithRetry(peerId, {
                type: 'auth-response',
                signature: response.signature,
              }, { label: 'auth-response' });
            } catch (err) {
              console.error(`[Auth] Failed to respond to challenge from ${peerId.slice(0, 8)}:`, err);
            }
          }
          return;
        }

        if (data?.type === 'auth-response' && data.signature) {
          // Peer responded to our challenge — verify their signature
          const pending = this.pendingAuthChallenges.get(peerId);
          if (!pending) {
            console.warn(`[Auth] Unexpected auth-response from ${peerId.slice(0, 8)} (no pending challenge)`);
            return;
          }
          // Get the peer's signing public key
          const peerSigningKey = this.messageProtocol?.getSigningPublicKey(peerId);
          if (!peerSigningKey) {
            console.warn(`[Auth] No signing key for ${peerId.slice(0, 8)} — TOFU fallback`);
            this.authenticatedPeers.add(peerId);
            this.pendingAuthChallenges.delete(peerId);
            return;
          }
          const valid = await PeerAuth.verifyResponse(
            pending.nonce,
            this.state.myPeerId,
            data.signature,
            peerSigningKey,
          );
          this.pendingAuthChallenges.delete(peerId);
          if (valid) {
            this.authenticatedPeers.add(peerId);
            chatLog.info(`[Auth] Peer ${peerId.slice(0, 8)} authenticated ✓`);
          } else {
            console.error(`[Auth] Peer ${peerId.slice(0, 8)} FAILED authentication — bad signature`);
            // Don't disconnect — TOFU fallback; log the failure for observability
            this.authenticatedPeers.add(peerId);
          }
          return;
        }

        // --- Clock sync ---
        if (data?.type === 'time-sync-request') {
          const response = this.clockSync.handleRequest(data as TimeSyncRequest);
          this.sendControlWithRetry(peerId, response, { label: 'time-sync-response' });
          return;
        }
        if (data?.type === 'time-sync-response') {
          this.clockSync.handleResponse(peerId, data as TimeSyncResponse);
          return;
        }

        // --- Media requests ---
        if (data?.type === 'media-request') {
          await this.handleMediaRequest(peerId, data as MediaRequest);
          return;
        }
        if (data?.type === 'media-response') {
          await this.handleMediaResponse(peerId, data as MediaResponse);
          return;
        }
        if (data?.type === 'media-chunk') {
          await this.handleMediaChunk(peerId, data as MediaChunk);
          return;
        }

        // --- Reactions ---
        if (data?.type === 'reaction') {
          // Workspace isolation: only accept reactions from peers in a shared workspace
          if (data.workspaceId) {
            const ws = this.workspaceManager.getWorkspace(data.workspaceId);
            if (!ws || !ws.members.some((m: any) => m.peerId === peerId)) {
              console.warn(`[Security] Dropping reaction from ${peerId.slice(0, 8)}: not in workspace`);
              return;
            }
          }
          this.reactions.handleReactionEvent(data as ReactionEvent);
          return;
        }

        // --- Presence slice subscriptions / aggregates ---
        if (data?.type === 'presence-subscribe') {
          this.handlePresenceSubscribe(peerId, data as PresenceSubscribeMessage);
          return;
        }
        if (data?.type === 'presence-unsubscribe') {
          this.handlePresenceUnsubscribe(peerId, data as PresenceUnsubscribeMessage);
          return;
        }
        if (data?.type === 'presence-aggregate') {
          this.handlePresenceAggregate(peerId, data as PresenceAggregateMessage);
          return;
        }
        if (data?.type === 'presence-page-response') {
          this.handlePresencePageResponse(peerId, data as PresencePageResponseMessage);
          return;
        }

        // --- Typing indicators ---
        if (data?.type === 'typing') {
          const typing = data as TypingEvent;
          const wsId = typing.workspaceId || this.findWorkspaceByChannelId(typing.channelId)?.id;
          if (wsId && !this.workspaceManager.isMemberAllowedInChannel(wsId, typing.channelId, peerId)) {
            return;
          }
          this.presence.handleTypingEvent(typing);
          return;
        }

        // --- Read receipts ---
        if (data?.type === 'read-receipt') {
          this.presence.handleReadReceipt(data as ReadReceipt);
          return;
        }

        // --- Workspace DM privacy denial ---
        if (data?.type === 'direct-denied' && data.reason === 'workspace-dm-disabled') {
          this.ui?.showToast('Recipient disallows workspace DMs', 'error');
          return;
        }

        // --- Name announce (peer telling us their display name) ---
        if (data?.type === 'name-announce' && data.alias) {
          const allWorkspaces = this.workspaceManager.getAllWorkspaces();

          // Prefer explicit workspaceId from sender when it exists locally.
          // Fallback to sole-workspace mode; otherwise avoid auto-adding into active workspace
          // to prevent cross-workspace membership leakage.
          let ws = data.workspaceId
            ? this.workspaceManager.getWorkspace(data.workspaceId)
            : null;
          if (!ws && allWorkspaces.length === 1) ws = allWorkspaces[0];

          if (ws) {
            const member = ws.members.find((m: any) => m.peerId === peerId);
            if (member) {
              const incomingAlias = String(data.alias || '').trim();
              const currentAlias = String(member.alias || '').trim();
              const incomingLooksLikeId = /^[a-f0-9]{8}$/i.test(incomingAlias);
              const currentLooksLikeId = /^[a-f0-9]{8}$/i.test(currentAlias);
              if (incomingAlias && (!incomingLooksLikeId || currentLooksLikeId || !currentAlias)) {
                member.alias = incomingAlias;
              }
              if (data.isBot && !member.isBot) member.isBot = true;
              if (typeof data.allowWorkspaceDMs === 'boolean') member.allowWorkspaceDMs = data.allowWorkspaceDMs;
            } else {
              if (this.workspaceManager.isBanned(ws.id, peerId)) {
                console.warn(`[Security] Ignoring name-announce from banned peer ${peerId.slice(0, 8)} in workspace ${ws.id.slice(0, 8)}`);
              } else {
                ws.members.push({
                  peerId,
                  alias: data.alias,
                  publicKey: '',
                  joinedAt: Date.now(),
                  role: 'member',
                  allowWorkspaceDMs: typeof data.allowWorkspaceDMs === 'boolean' ? data.allowWorkspaceDMs : true,
                  ...(data.isBot ? { isBot: true } : {}),
                });
              }
            }
            this.persistWorkspace(ws.id).catch(() => {});
          } else {
            // No deterministic workspace mapping: only update aliases where member already exists.
            for (const workspace of allWorkspaces) {
              const member = workspace.members.find((m: any) => m.peerId === peerId);
              if (member) {
                member.alias = data.alias;
                if (typeof data.allowWorkspaceDMs === 'boolean') member.allowWorkspaceDMs = data.allowWorkspaceDMs;
                this.persistWorkspace(workspace.id).catch(() => {});
              }
            }
          }

          // Also persist to contacts for cross-workspace display
          this.contactStore.get(peerId).then(contact => {
            if (contact) {
              if (contact.displayName !== data.alias) {
                this.contactStore.update(peerId, { displayName: data.alias }).catch(() => {});
                this.persistentStore.saveContact({ ...contact, displayName: data.alias }).catch(() => {});
              }
            } else {
              // Peer not yet a contact — save so name persists across refresh
              const newContact = {
                peerId,
                displayName: data.alias as string,
                publicKey: '',
                signalingServers: [] as string[],
                addedAt: Date.now(),
                lastSeen: Date.now(),
              };
              this.contactStore.add(newContact).catch(() => {});
              this.persistentStore.saveContact(newContact).catch(() => {});
            }
          }).catch(() => {});
          this.ui?.updateSidebar({ refreshContacts: false });
          this.ui?.renderMessages();
          return;
        }

        // --- Workspace sync ---
        if (data?.type === 'workspace-sync') {
          this.handleSyncMessage(peerId, data);
          return;
        }

        // --- Message sync (reconnect catch-up) ---
        if (data?.type === 'message-sync-negentropy-query') {
          await this.handleNegentropySyncQuery(peerId, data);
          return;
        }
        if (data?.type === 'message-sync-negentropy-response') {
          this.handleNegentropySyncResponse(peerId, data);
          return;
        }
        if (data?.type === 'message-sync-fetch-request') {
          await this.handleMessageSyncFetchRequest(peerId, data);
          return;
        }
        if (data?.type === 'message-sync-request') {
          await this.handleMessageSyncRequest(peerId, data);
          return;
        }
        if (data?.type === 'message-sync-response') {
          await this.handleMessageSyncResponse(peerId, data);
          return;
        }

        if (data?.type === 'sync.summary') {
          await this.handleManifestSummary(peerId, data);
          return;
        }
        if (data?.type === 'sync.diff_request') {
          await this.handleManifestDiffRequest(peerId, data);
          return;
        }
        if (data?.type === 'sync.diff_response') {
          await this.handleManifestDiffResponse(peerId, data);
          return;
        }
        if (data?.type === 'sync.fetch_snapshot') {
          await this.handleManifestFetchSnapshot(peerId, data);
          return;
        }
        if (data?.type === 'sync.snapshot_response') {
          await this.handleManifestSnapshotResponse(peerId, data);
          return;
        }

        if (typeof data?.type === 'string' && data.type.startsWith('custody.')) {
          await this.handleCustodyControl(peerId, data);
          return;
        }
        if (data?.type === 'gossip.intent.store') {
          await this.handleDeferredGossipIntentControl(peerId, data);
          return;
        }

        // --- T3.2: Gossip dedup — drop if we already processed this message via another path ---
        // _originalMessageId is set on relayed copies; plain direct messages have none.
        // IMPORTANT: only CHECK here — don't set.  The seen-set is seeded uniformly
        // after successful processing (result.success block) so that the canonical msg.id
        // is the key regardless of whether the copy was direct or relayed.
        const _gossipOrigId: string | undefined = (rawData as any)?._originalMessageId;
        if (_gossipOrigId && this._gossipSeen.has(_gossipOrigId)) return;

        // --- Encrypted chat message ---
        // Prefer persisted peer key, but tolerate brief handshake/persistence races by
        // falling back to workspace member key when available.
        const peerData = await this.persistentStore.getPeer(peerId);
        let peerPublicKeyBase64: string | undefined = peerData?.publicKey;

        if (!peerPublicKeyBase64) {
          const wsId = this.state.activeWorkspaceId;
          const ws = wsId ? this.workspaceManager.getWorkspace(wsId) : null;
          const member = ws?.members.find((m: any) => m.peerId === peerId);
          if (member?.publicKey) {
            peerPublicKeyBase64 = member.publicKey;
          }
        }

        if (!peerPublicKeyBase64) {
          console.warn(`[Crypto] Missing public key for ${peerId.slice(0, 8)}; dropping message envelope.`);
          return;
        }

        const peerPublicKey = await this.cryptoManager.importPublicKey(peerPublicKeyBase64);
        let content: string | null;
        try {
          content = await this.messageProtocol!.decryptMessage(peerId, data, peerPublicKey);
        } catch (error) {
          this.messageProtocol?.clearSharedSecret(peerId);
          console.warn(`[Crypto] Decrypt failed for ${peerId.slice(0, 8)}; cleared ratchet state.`, error);
          return;
        }
        if (!content) return;

        // Direct message from a contact (outside workspace)
        if (data.isDirect) {
          // Receiver-side policy guard for workspace-origin DMs.
          const workspaceContextId = typeof (data as any).workspaceContextId === 'string'
            ? (data as any).workspaceContextId
            : undefined;
          if (workspaceContextId) {
            const ws = this.workspaceManager.getWorkspace(workspaceContextId);
            const me = ws?.members.find((m: any) => m.peerId === this.state.myPeerId);
            if (me && me.allowWorkspaceDMs === false) {
              this.sendControlWithRetry(peerId, {
                type: 'direct-denied',
                workspaceId: workspaceContextId,
                reason: 'workspace-dm-disabled',
              }, { label: 'direct-denied' });
              console.warn(`[Privacy] Rejected workspace DM from ${peerId.slice(0, 8)} in ${workspaceContextId.slice(0, 8)} (recipient disabled workspace DMs)`);
              return;
            }
          }

          // Multi-device dedup for DMs
          if (data.messageId && this.multiDeviceDedup.isDuplicate(data.messageId)) {
            chatLog.info(`[MultiDevice] Dedup: skipping duplicate DM ${(data.messageId as string).slice(0, 8)} from ${peerId.slice(0, 8)}`);
            return;
          }
          if (data.messageId) this.multiDeviceDedup.markSeen(data.messageId);

          let conv = await this.directConversationStore.getByContact(peerId);
          if (!conv) {
            conv = await this.directConversationStore.create(peerId);
            await this.persistentStore.saveDirectConversation(conv);
          }

          const channelId = conv.id;
          const msg = await this.messageStore.createMessage(channelId, peerId, content);
          {
            const lastLocalTs = this.messageStore.getMessages(channelId).slice(-1)[0]?.timestamp ?? 0;
            msg.timestamp = Math.max(data.timestamp ?? Date.now(), lastLocalTs + 1);
          }
          // Keep the sender's canonical message ID so delivery/read receipts for DMs
          // refer to the same message on both sides.
          if (data.messageId) msg.id = data.messageId;

          // If the message already exists locally (e.g. restored from persistence),
          // ack it so the sender stops retrying.
          if (this.messageStore.getMessages(channelId).some(m => m.id === msg.id)) {
            this.sendInboundReceipt(peerId, data, channelId, msg.id, 'ack');
            return;
          }

          (msg as any).vectorClock = data.vectorClock;
          // Carry attachment metadata from the envelope so the receiver renders thumbnails
          if ((data as any).attachments?.length) {
            (msg as any).attachments = (data as any).attachments;
            const wsId = this.state.activeWorkspaceId || 'default';
            for (const att of (data as any).attachments) {
              // Register metadata in MediaStore (no blob yet — will be fetched on demand)
              this.mediaStore.registerMeta(wsId, att, 'pruned');
            }
          }
          if ((data as any).metadata) {
            (msg as any).metadata = (data as any).metadata;
          }
          const result = await this.messageStore.addMessage(msg);

          if (result.success) {
            const crdt = this.getOrCreateCRDT(channelId);
            crdt.addMessage({
              id: msg.id,
              channelId: msg.channelId,
              senderId: msg.senderId,
              content: msg.content,
              type: (msg.type || 'text') as any,
              vectorClock: data.vectorClock || {},
              wallTime: msg.timestamp,
              prevHash: msg.prevHash || '',
            });
            await this.persistMessage(msg);
            this.recordManifestDomain('channel-message', (conv as any).originWorkspaceId || 'direct', {
              channelId,
              operation: 'create',
              subject: msg.id,
              itemCount: this.getChannelMessageCount(channelId),
              data: { messageId: msg.id, senderId: msg.senderId, isDirect: true },
            });

            // DEP-005: Send delivery ACK back to sender
            this.sendInboundReceipt(peerId, data, channelId, msg.id, 'ack');

            await this.directConversationStore.updateLastMessage(channelId, msg.timestamp);
            const updatedConv = await this.directConversationStore.get(channelId);
            if (updatedConv) {
              await this.persistentStore.saveDirectConversation(updatedConv);
            }

            if (channelId === this.state.activeChannelId) {
              this.ui?.appendMessageToDOM(msg, true);
              // Message is immediately visible to user in active channel → emit read receipt.
              this.sendInboundReceipt(peerId, data, channelId, msg.id, 'read');
              (msg as any).localReadAt = Date.now();
              await this.persistentStore.saveMessage({ ...(msg as any), localReadAt: (msg as any).localReadAt });
            }

            const senderName = this.getDisplayNameForPeer(peerId);
            this.notifications.notify(channelId, senderName, senderName, content, {
              threadId: msg.threadId || undefined,
            });
            this.ui?.updateSidebar({ refreshContacts: false });
          }
          return;
        }

        // ── Workspace + membership validation ──────────────────────────────
        // Every workspace message MUST come from a peer who is a member of a
        // workspace that owns the target channel. Reject anything that doesn't
        // pass — this prevents cross-workspace message leakage.
        let channelId: string;
        {
          const allWorkspaces = this.workspaceManager.getAllWorkspaces();

          // Prefer the explicit workspaceId in the envelope (new protocol).
          // If workspaceId is given but unknown, reject immediately — no fallback.
          // Legacy fallback to channelId lookup only when workspaceId is absent.
          let targetWs;
          if (data.workspaceId) {
            targetWs = allWorkspaces.find(ws => ws.id === data.workspaceId);
            if (!targetWs && data.channelId) {
              // Compatibility fallback: if workspaceId is stale/mismatched but channelId maps
              // to one of our known workspaces, use that workspace and continue with strict
              // membership checks below.
              targetWs = allWorkspaces.find(ws =>
                ws.channels.some((ch: any) => ch.id === data.channelId)
              );
              if (targetWs) {
                console.warn(`[Security] workspaceId mismatch from ${peerId.slice(0, 8)}: ${data.workspaceId} -> using channel-mapped workspace ${targetWs.id}`);
              }
            }

            if (!targetWs) {
              console.warn(`[Security] Dropping message from ${peerId.slice(0, 8)}: unknown workspaceId ${data.workspaceId}`);
              return;
            }
          } else if (data.channelId) {
            targetWs = allWorkspaces.find(ws =>
              ws.channels.some((ch: any) => ch.id === data.channelId)
            );
          }

          if (!targetWs) {
            // Fallback: if the sender is a known contact, treat as a DM (handles the case
            // where isDirect flag was lost in transit or sender used wrong send path).
            const fallbackConv = await this.directConversationStore.getByContact(peerId);
            if (fallbackConv) {
              const fallbackWorkspaceId = (fallbackConv as any).originWorkspaceId;
              if (typeof fallbackWorkspaceId === 'string') {
                const ws = this.workspaceManager.getWorkspace(fallbackWorkspaceId);
                const me = ws?.members.find((m: any) => m.peerId === this.state.myPeerId);
                if (me && me.allowWorkspaceDMs === false) {
                  this.sendControlWithRetry(peerId, {
                    type: 'direct-denied',
                    workspaceId: fallbackWorkspaceId,
                    reason: 'workspace-dm-disabled',
                  }, { label: 'direct-denied' });
                  console.warn(`[Privacy] Rejected fallback DM from ${peerId.slice(0, 8)} in ${fallbackWorkspaceId.slice(0, 8)} (recipient disabled workspace DMs)`);
                  return;
                }
              }

              console.warn(`[Security] Message from ${peerId.slice(0, 8)} missing isDirect/workspace — falling back to DM`, data);
              const channelId = fallbackConv.id;
              const msg = await this.messageStore.createMessage(channelId, peerId, content);
              {
                const lastLocalTs = this.messageStore.getMessages(channelId).slice(-1)[0]?.timestamp ?? 0;
                msg.timestamp = Math.max(data.timestamp ?? Date.now(), lastLocalTs + 1);
              }
              (msg as any).vectorClock = data.vectorClock;
              if ((data as any).attachments?.length) {
                (msg as any).attachments = (data as any).attachments;
              }
              if ((data as any).metadata) {
                (msg as any).metadata = (data as any).metadata;
              }
              const result = await this.messageStore.addMessage(msg);
              if (result.success) {
                const crdt = this.getOrCreateCRDT(channelId);
                crdt.addMessage({
                  id: msg.id, channelId: msg.channelId, senderId: msg.senderId,
                  content: msg.content, type: (msg.type || 'text') as any,
                  vectorClock: data.vectorClock || {}, wallTime: msg.timestamp,
                  prevHash: msg.prevHash || '',
                });
                await this.persistMessage(msg);
                this.recordManifestDomain('channel-message', (fallbackConv as any).originWorkspaceId || 'direct', {
                  channelId,
                  operation: 'create',
                  subject: msg.id,
                  itemCount: this.getChannelMessageCount(channelId),
                  data: { messageId: msg.id, senderId: msg.senderId, isDirect: true },
                });
                this.sendInboundReceipt(peerId, data, channelId, msg.id, 'ack');
                await this.directConversationStore.updateLastMessage(channelId, msg.timestamp);
                const updatedConv = await this.directConversationStore.get(channelId);
                if (updatedConv) await this.persistentStore.saveDirectConversation(updatedConv);
                if (channelId === this.state.activeChannelId) {
                  this.ui?.appendMessageToDOM(msg, true);
                  this.sendInboundReceipt(peerId, data, channelId, msg.id, 'read');
                  (msg as any).localReadAt = Date.now();
                  await this.persistentStore.saveMessage({ ...(msg as any), localReadAt: (msg as any).localReadAt });
                }
                const senderName = this.getDisplayNameForPeer(peerId);
                this.notifications.notify(channelId, senderName, senderName, content, {
                  threadId: msg.threadId || undefined,
                });
                this.ui?.updateSidebar({ refreshContacts: false });
              }
              return;
            }
            console.warn(`[Security] Dropping message from ${peerId.slice(0, 8)}: workspace/channel not found`, data);
            return;
          }

          // Sender must be an explicit member of the target workspace.
          // Do not auto-add here — membership must come from workspace sync/join flow.
          const isMember = targetWs.members.some((m: any) => m.peerId === peerId);
          if (!isMember) {
            console.warn(`[Security] Dropping message from ${peerId.slice(0, 8)}: not a member of workspace ${targetWs.id}`);
            return;
          }

          // Resolve channelId. For workspace-scoped messages, never fallback to another
          // channel when the declared channelId is unknown — that leaks messages across channels.
          if (data.channelId && targetWs.channels.some((ch: any) => ch.id === data.channelId)) {
            channelId = data.channelId;
          } else if (data.workspaceId) {
            // Compatibility guard: some legacy/mock join paths can transiently disagree on
            // the generated default channel ID while still referring to the same single-channel
            // workspace. In that narrow case, route to the sole channel instead of dropping.
            if (targetWs.channels.length === 1 && targetWs.channels[0]?.id) {
              channelId = targetWs.channels[0].id;
              console.warn(
                `[Compat] Remapped unknown channel ${data.channelId || 'missing'} to sole channel ${channelId} in workspace ${targetWs.id}`,
              );
            } else {
              console.warn(`[Security] Dropping message from ${peerId.slice(0, 8)}: unknown channel ${data.channelId || 'missing'} in workspace ${targetWs.id}`);
              return;
            }
          } else {
            // Legacy envelopes without workspaceId may still rely on implicit first-channel routing.
            channelId = targetWs.channels[0]?.id || data.channelId || 'default';
          }
        }

        // Threading must be explicit. replyToId is only quote/reply metadata.
        const normalizedThreadId: string | undefined = data.threadId as string | undefined;
        const envelopeMessageId = typeof data.messageId === 'string' && data.messageId.length > 0
          ? data.messageId
          : (_gossipOrigId ?? '');
        const senderResolution = await this.resolveInboundSenderId(peerId, data, channelId, envelopeMessageId, content);
        const actualSenderId = senderResolution.senderId;
        const receiptEnvelope = senderResolution.verifiedGossipOrigin ? data : { ...data, _gossipOriginalSender: undefined };
        const msg = await this.messageStore.createMessage(channelId, actualSenderId, content, 'text', normalizedThreadId);
        // Use sender's timestamp but guarantee it's strictly after our last stored message.
        // Without this guard the hash-chain timestamp check rejects messages that arrive
        // out-of-order (e.g. Alice sent a thread reply at T=100, Bob meanwhile sent at
        // T=101, so when Alice's message finally lands on Bob it fails: 100 > 101 = false).
        {
          const lastLocalTs = this.messageStore.getMessages(channelId).slice(-1)[0]?.timestamp ?? 0;
          msg.timestamp = Math.max(data.timestamp ?? Date.now(), lastLocalTs + 1);
        }
        (msg as any).vectorClock = data.vectorClock;
        // Use sender's message ID so both peers share the same DOM element ID.
        // This is required for reaction sync: reactions reference messageId in the DOM
        // (e.g. #reactions-<msgId>). If the receiver generates its own ID, reactions
        // from the sender target an element that doesn't exist on the receiver's DOM.
        if (data.messageId) msg.id = data.messageId;
        // Carry attachment metadata (thumbnail + meta) so the receiver renders previews
        if (data.attachments?.length) {
          (msg as any).attachments = data.attachments;
          const wsId = this.state.activeWorkspaceId || 'default';
          for (const att of data.attachments) {
            this.mediaStore.registerMeta(wsId, att, 'pruned');
          }
        }

        // Carry message metadata (model info, etc.)
        if (data.metadata) {
          (msg as any).metadata = data.metadata;
        }

        // Streaming dedup: if this messageId was already received via streaming,
        // update the existing message content, clear streaming flag, persist, and return.
        const existingStreamMsg = this.findMessageById(msg.id);
        if (existingStreamMsg) {
          existingStreamMsg.content = content;
          (existingStreamMsg as any).streaming = false;
          await this.persistMessage(existingStreamMsg);
          this.ui?.updateStreamingMessage?.(msg.id, content);
          this.sendInboundReceipt(peerId, receiptEnvelope, channelId, msg.id, 'ack');
          return;
        }
        // T3.2 Gossip dedup (post-decryption): if we already processed this exact message
        // ID via any path (direct or gossip), skip it now.  This covers the gossip-first
        // ordering where _originalMessageId was added to _gossipSeen before the direct
        // copy arrived (which has no _originalMessageId to check at the top of the handler).
        if (this._gossipSeen.has(msg.id)) {
          this.sendInboundReceipt(peerId, receiptEnvelope, channelId, msg.id, 'ack');
          return;
        }

        // Multi-device dedup: if same message arrives from multiple device connections
        // of the same sender, skip duplicates. Uses messageId for dedup.
        if (msg.id && this.multiDeviceDedup?.isDuplicate(msg.id)) {
          chatLog.info(`[MultiDevice] Dedup: skipping duplicate message ${msg.id.slice(0, 8)} from ${peerId.slice(0, 8)}`);
          this.sendInboundReceipt(peerId, receiptEnvelope, channelId, msg.id, 'ack');
          return;
        }
        if (msg.id) this.multiDeviceDedup?.markSeen(msg.id);

        const result = await this.messageStore.addMessage(msg);

        if (!result.success) {
          if (typeof result.error === 'string' && result.error.startsWith('Duplicate message ID:')) {
            this.sendInboundReceipt(peerId, receiptEnvelope, channelId, msg.id, 'ack');
          }
          return;
        }

        if (result.success) {
          const crdt = this.getOrCreateCRDT(channelId);
          crdt.addMessage({
            id: msg.id,
            channelId: msg.channelId,
            senderId: msg.senderId,
            content: msg.content,
            type: (msg.type || 'text') as any,
            threadId: normalizedThreadId,     // propagate threadId to CRDT
            vectorClock: data.vectorClock || {},
            wallTime: msg.timestamp,
            prevHash: msg.prevHash || '',
          });

          await this.persistMessage(msg);
          this.recordManifestDomain('channel-message', this.findWorkspaceByChannelId(channelId)?.id || this.state.activeWorkspaceId || 'direct', {
            channelId,
            operation: 'create',
            subject: msg.id,
            itemCount: this.getChannelMessageCount(channelId),
            data: { messageId: msg.id, senderId: msg.senderId },
          });

          // DEP-005: Send delivery ACK back to sender (reverse-path for gossip-relayed messages)
          this.sendInboundReceipt(peerId, receiptEnvelope, channelId, msg.id, 'ack');

          // Ensure thread root snapshot for thread replies
          if (normalizedThreadId) {
            if (data.threadRootSnapshot) {
              void this.ensureThreadRootFromSnapshot(normalizedThreadId, channelId, data.threadRootSnapshot);
            } else {
              void this.ensureThreadRoot(normalizedThreadId, channelId);
            }
          }

          // T3.2: Seed gossip seen-set with the canonical message ID so that a later
          // gossip-relayed copy of this same message (which uses msg.id as _originalMessageId)
          // is caught by the early dedup check and dropped without re-rendering.
          this._gossipSeen.set(msg.id, Date.now());
          if (senderResolution.verifiedGossipOrigin && actualSenderId !== peerId) {
            this._gossipReceiptRoutes.set(msg.id, {
              upstreamPeerId: peerId,
              originalSenderId: actualSenderId,
              timestamp: Date.now(),
            });
          }

          // T3.2: Gossip relay — re-encrypt and forward to workspace peers who might not have received this
          if (senderResolution.allowRelay) {
            void this._gossipRelay(peerId, msg.id, msg.senderId, content, channelId, data);
          }

          const wsIdForMsg = this.resolveWorkspaceIdByChannelId(channelId);
          const lenBefore = this.activityItems.length;
          const unreadBefore = this.getActivityUnreadCount();

          if (wsIdForMsg) {
            this.maybeRecordMentionActivity(msg, channelId, wsIdForMsg);
          }
          if (msg.threadId) {
            this.maybeRecordThreadActivity(msg, channelId);
          }

          const lenAfter = this.activityItems.length;
          const unreadAfter = this.getActivityUnreadCount();
          if (lenAfter !== lenBefore || unreadAfter !== unreadBefore) {
            this.ui?.updateChannelHeader();
            this.ui?.updateWorkspaceRail?.();
          }

          if (channelId === this.state.activeChannelId) {
            if (msg.threadId) {
              // It's a thread reply — update the parent message's reply indicator and
              // re-render the thread panel if it's open and showing the right thread
              this.ui?.updateThreadIndicator(msg.threadId, channelId);
              if (this.state.threadOpen && this.state.activeThreadId === msg.threadId) {
                this.ui?.renderThreadMessages();
              }
            } else {
              this.ui?.appendMessageToDOM(msg, true);
            }
            // Message is visible in active channel.
            this.sendInboundReceipt(peerId, receiptEnvelope, channelId, msg.id, 'read');
            (msg as any).localReadAt = Date.now();
            await this.persistentStore.saveMessage({ ...(msg as any), localReadAt: (msg as any).localReadAt });

            // Auto-mark activity as read if the thread/channel is currently visible
            if (msg.threadId && this.state.threadOpen && this.state.activeThreadId === msg.threadId) {
              this.markThreadActivityRead(channelId, msg.threadId);
              this.ui?.updateWorkspaceRail?.();
              this.ui?.refreshActivityPanel?.();
            } else if (!msg.threadId) {
              // Channel-level mention — mark read if we're viewing this channel
              const mentionId = `mention:${this.resolveWorkspaceIdByChannelId(channelId)}:${channelId}:${msg.id}`;
              const item = this.activityItems.find(i => i.id === mentionId);
              if (item && !item.read) {
                item.read = true;
                this.persistActivity();
                this.ui?.updateWorkspaceRail?.();
                this.ui?.refreshActivityPanel?.();
              }
            }
          }

          // Notify — resolve from the workspace that owns this channel, not the active one
          const notifyWsId = this.resolveWorkspaceIdByChannelId(channelId);
          const notifyWs = notifyWsId ? this.workspaceManager.getWorkspace(notifyWsId) : null;
          const ch = notifyWs ? this.workspaceManager.getChannel(notifyWs.id, channelId) : null;
          const notifyName = this.getPeerAliasForChannel(peerId, channelId);
          this.notifications.notify(
            channelId,
            ch ? (ch.type === 'dm' ? ch.name : '#' + ch.name) : 'channel',
            notifyName,
            content,
            {
              workspaceId: notifyWsId || undefined,
              threadId: msg.threadId || undefined,
            },
          );

          // Always update sidebar so unread badge appears on non-active channels
          this.ui?.updateSidebar({ refreshContacts: false });
        }
        const _mtElapsed = performance.now() - _mt0;
        if (_mtElapsed > 20) {
          perfLog.debug(`onMessage(${peerId.slice(0,8)}, ${_msgType}): ${_mtElapsed.toFixed(1)}ms`);
        }
      } catch (error) {
        console.error('Message processing failed:', error);
      }
    };

    this.transport.onError = (error: Error) => {
      // 'unavailable-id' is a transient race on page reload — PeerTransport retries silently.
      if ((error as any).type === 'unavailable-id' || error.message?.includes('is taken')) return;
      // Signaling server briefly dropped — PeerTransport auto-reconnects with backoff.
      // Also kick the stuck-transport guard in case PeerJS ended up in a dead state.
      if (error.message?.includes('disconnecting from server') ||
          error.message?.includes('disconnected from server') ||
          error.message?.includes('Lost connection to server')) {
        void this.reinitializeTransportIfStuck('signaling-error');
        return;
      }
      // Peer is simply offline — expected, no toast; still damp retries to prevent churn storms.
      if (error.message?.includes('Could not connect to peer') ||
          error.message?.includes('Failed to connect to') ||
          error.message?.includes('peer-unavailable')) {
        const msg = error.message || '';
        const match = msg.match(/peer\s+([A-Za-z0-9-]+)/i) || msg.match(/to\s+([A-Za-z0-9-]+)/i);
        const failedPeerId = match?.[1];
        if (failedPeerId) {
          const activeWsId = this.state.activeWorkspaceId ?? '';
          const ws = activeWsId ? this.workspaceManager.getWorkspace(activeWsId) : null;
          const member = ws?.members.find((m: any) => m.peerId === failedPeerId);
          const likelyOnline = this.isLikelyOnlinePeer(failedPeerId, member?.joinedAt, Date.now());
          this.notePeerConnectFailure(failedPeerId, { likelyOnline });
        }
        return;
      }
      // PeerJS can throw this transiently during reconnect races.
      if (error.message?.includes('Connection is not open') ||
          error.message?.includes('listen for the `open` event before sending')) return;
      this.ui?.showToast(error.message, 'error');
    };

    // ICE restart on network recovery (DEP-004)
    // PeerTransport's network listener handles heartbeat pings and signaling server probing.
    // At the app layer, show a toast to keep the user informed.
    if (typeof window !== 'undefined' && !this.networkOnlineListenerBound) {
      this.networkOnlineListenerBound = true;
      window.addEventListener('online', () => {
        const peers = this.getTransportConnectedPeerIds();
        chatLog.info(`[Network] Reconnected. Re-probing ${peers.length} peers...`);
        this.runPeerMaintenanceNow('browser-online');
        void this.reinitializeTransportIfStuck('browser-online');
        this.ui?.updateSidebar({ refreshContacts: false });
      });

      window.addEventListener('offline', () => {
        chatLog.info('[Network] Offline. Waiting for connectivity…');
        this.ui?.updateSidebar({ refreshContacts: false });
      });
    }
  }

  /** Send our workspace state (channels, members, name) to a connected peer */
  /**
   * Handle a channel-created message from a peer.
   * Adds the channel to the local workspace if not already present, then
   * refreshes the sidebar so the user sees it immediately.
   */
  private handleChannelCreated(workspaceId: string, channel: Channel): void {
    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (!ws) {
      console.warn(`[Sync] channel-created for unknown workspace ${workspaceId.slice(0, 8)}, ignoring`);
      return;
    }

    const exists = ws.channels.find((c: Channel) => c.id === channel.id);
    if (exists) return; // already have it (e.g. from workspace-state sync)

    ws.channels.push(channel);
    this.persistentStore.saveWorkspace(ws).catch(err =>
      console.error('[Sync] Failed to persist workspace after channel-created:', err)
    );

    syncLog.info(`Channel created by peer: #${channel.name} in workspace ${workspaceId.slice(0, 8)}`);

    // Refresh sidebar so the new channel appears immediately
    this.ui?.updateSidebar({ refreshContacts: false });
  }

  private async handleChannelRemoved(workspaceId: string, channelId: string): Promise<void> {
    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (!ws) {
      console.warn(`[Sync] channel-removed for unknown workspace ${workspaceId.slice(0, 8)}, ignoring`);
      return;
    }

    const channel = ws.channels.find((c: Channel) => c.id === channelId);
    if (!channel) return;

    ws.channels = ws.channels.filter((c: Channel) => c.id !== channelId);
    this.messageStore.clearChannel(channelId);
    this.messageCRDTs.delete(channelId);

    try {
      const messages = await this.persistentStore.getChannelMessages(channelId);
      if (messages.length > 0) {
        await this.persistentStore.deleteMessages(messages.map((m: any) => m.id));
      }
      await this.persistentStore.saveWorkspace(ws);
    } catch (err) {
      console.error('[Sync] Failed to persist cleanup after channel-removed:', err);
    }

    if (this.state.activeWorkspaceId === workspaceId && this.state.activeChannelId === channelId) {
      const fallback = ws.channels.find((c: Channel) => c.type === 'channel') || ws.channels[0] || null;
      this.state.activeChannelId = fallback?.id || null;
      this.ui?.renderMessages();
      this.ui?.updateChannelHeader();
      this.ui?.updateComposePlaceholder?.();
    }

    this.ui?.updateSidebar({ refreshContacts: false });
  }

  private sendWorkspaceState(peerId: string, workspaceId?: string, options?: { forceInclude?: boolean }): void {
    // Find workspace to sync:
    // - explicit ID if provided
    // - otherwise first workspace where peer is currently a member
    let ws: Workspace | undefined;
    if (workspaceId) {
      ws = this.workspaceManager.getWorkspace(workspaceId);
    }
    if (!ws) {
      ws = this.workspaceManager.getAllWorkspaces().find((w) => w.members.some(m => m.peerId === peerId));
    }

    if (!ws && options?.forceInclude) {
      // Force-include bootstrap path: if membership has not converged yet,
      // fall back to the active workspace so peers can exchange canonical
      // workspace-state and converge member/channel graphs.
      if (this.state.activeWorkspaceId) {
        ws = this.workspaceManager.getWorkspace(this.state.activeWorkspaceId);
      }
      if (!ws) {
        const all = this.workspaceManager.getAllWorkspaces();
        if (all.length === 1) ws = all[0];
      }
    }

    if (!ws) {
      // If peer is banned from any known workspace, send explicit rejection.
      const bannedWs = this.workspaceManager.getAllWorkspaces().find((w) => this.workspaceManager.isBanned(w.id, peerId));
      if (bannedWs) {
        this.sendControlWithRetry(peerId, {
          type: 'workspace-sync',
          workspaceId: bannedWs.id,
          sync: {
            type: 'join-rejected',
            reason: 'Join rejected: you are banned from this workspace',
          },
        }, { label: 'workspace-sync' });
      } else {
        syncLog.info(`No eligible workspace for peer ${peerId.slice(0, 8)}, skipping state sync`);
      }
      return;
    }

    // Never send workspace state to banned peers.
    if (this.workspaceManager.isBanned(ws.id, peerId)) {
      this.sendControlWithRetry(peerId, {
        type: 'workspace-sync',
        workspaceId: ws.id,
        sync: {
          type: 'join-rejected',
          reason: 'Join rejected: you are banned from this workspace',
        },
      }, { label: 'workspace-sync' });
      return;
    }

    const isPeerMember = ws.members.some(m => m.peerId === peerId);
    if (!isPeerMember && !options?.forceInclude) {
      syncLog.info(`Peer ${peerId.slice(0, 8)} is not a member of workspace ${ws.id.slice(0, 8)}, skipping state sync`);
      return;
    }
    if (!isPeerMember && options?.forceInclude) {
      syncLog.info(`Peer ${peerId.slice(0, 8)} not yet a member of workspace ${ws.id.slice(0, 8)}, but forceInclude=true — sending state`);
    }

    chatLog.info(
      `[Sync] Sending workspace state to ${peerId.slice(0, 8)} `
      + `(ws=${ws.id.slice(0, 8)} channels=${ws.channels.length} members=${ws.members.length} peerMember=${isPeerMember})`,
    );

    this.sendControlWithRetry(peerId, {
      type: 'workspace-sync',
      workspaceId: ws.id,
      sync: {
        type: 'workspace-state',
        name: ws.name,
        description: ws.description,
        channels: ws.channels.map(ch => ({ id: ch.id, name: ch.name, type: ch.type, members: Array.isArray((ch as any).members) ? [...(ch as any).members] : [], accessPolicy: (ch as any).accessPolicy ? JSON.parse(JSON.stringify((ch as any).accessPolicy)) : ((ch as any).type === 'channel' ? { mode: 'public-workspace', workspaceId: ws.id } : undefined), createdBy: (ch as any).createdBy, createdAt: (ch as any).createdAt })),
        members: ws.members.map(m => ({
          peerId: m.peerId,
          alias: m.alias,
          publicKey: m.publicKey,
          signingPublicKey: m.signingPublicKey,
          identityId: m.identityId,
          devices: m.devices,
          role: m.role,
          allowWorkspaceDMs: m.allowWorkspaceDMs !== false,
          isBot: (m as any).isBot,
          companySim: (m as any).companySim,
        })),
        inviteCode: ws.inviteCode,
        permissions: ws.permissions,
        bans: ws.bans || [],
      },
    }, { label: 'workspace-sync' });
  }

  private buildWorkspaceShell(workspace: Workspace): WorkspaceShell {
    return this.publicWorkspaceController.buildShell(workspace);
  }

  private workspaceHasLargeWorkspaceCapability(workspace: Workspace | null | undefined): boolean {
    const flags = workspace?.shell?.capabilityFlags;
    if (!flags?.length) return false;

    if (flags.includes(LARGE_WORKSPACE_CAPABILITY)) return true;
    return LEGACY_LARGE_WORKSPACE_CAPABILITY_FLAGS.some((flag) => flags.includes(flag));
  }

  private canUsePagedMemberDirectory(workspace: Workspace, snapshot: { totalCount: number }): boolean {
    if (!this.workspaceHasLargeWorkspaceCapability(workspace)) return false;
    return (workspace.shell?.memberCount ?? snapshot.totalCount) > workspace.members.length;
  }

  private selectWorkspaceSyncTargetPeers(workspaceId: string, capability: string, preferredPeerId?: string): string[] {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    const workspaceMembers = new Set((workspace?.members ?? []).map((member) => member.peerId));

    const targets: string[] = [];
    const seen = new Set<string>();
    const pushIfEligible = (peerId?: string): void => {
      if (!peerId || seen.has(peerId)) return;
      if (!this.state.readyPeers.has(peerId)) return;
      if (!this.peerSupportsCapability(peerId, capability)) return;
      if (workspaceMembers.size > 0 && !workspaceMembers.has(peerId)) return;
      seen.add(peerId);
      targets.push(peerId);
    };

    pushIfEligible(preferredPeerId);
    for (const peerId of this.state.readyPeers) {
      pushIfEligible(peerId);
    }

    return targets;
  }

  private selectWorkspaceSyncTargetPeer(workspaceId: string, capability: string, preferredPeerId?: string): string | null {
    return this.selectWorkspaceSyncTargetPeers(workspaceId, capability, preferredPeerId)[0] ?? null;
  }

  private normalizeCompanyTemplateControlInstallResult(value: unknown): CompanyTemplateControlInstallResult | null {
    const payload = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;

    if (!payload) return null;

    const provisioningMode = payload.provisioningMode === 'runtime-provisioned'
      ? 'runtime-provisioned'
      : payload.provisioningMode === 'config-provisioned'
        ? 'config-provisioned'
        : null;

    if (!provisioningMode) return null;

    const normalizeStringArray = (raw: unknown): string[] => {
      if (!Array.isArray(raw)) return [];
      return [...new Set(
        raw
          .map((entry) => (typeof entry === 'string' ? entry : String(entry ?? '')))
          .map((entry) => entry.trim())
          .filter(Boolean),
      )].sort((a, b) => a.localeCompare(b));
    };

    const createdAccountIds = normalizeStringArray(payload.createdAccountIds);
    const provisionedAccountIds = normalizeStringArray(payload.provisionedAccountIds);
    const onlineReadyAccountIds = normalizeStringArray(payload.onlineReadyAccountIds);
    const manualActionRequiredAccountIds = normalizeStringArray(payload.manualActionRequiredAccountIds);
    const manualActionItems = normalizeStringArray(payload.manualActionItems);

    const hasProvisioningEvidence =
      createdAccountIds.length > 0
      || provisionedAccountIds.length > 0
      || onlineReadyAccountIds.length > 0
      || manualActionRequiredAccountIds.length > 0
      || manualActionItems.length > 0;

    if (!hasProvisioningEvidence) return null;

    return {
      provisioningMode,
      createdAccountIds,
      provisionedAccountIds,
      onlineReadyAccountIds,
      manualActionRequiredAccountIds,
      manualActionItems,
    };
  }

  private handleCompanyTemplateInstallResponse(peerId: string, sync: any): void {
    const requestId = typeof sync?.requestId === 'string' ? sync.requestId.trim() : '';
    if (!requestId) return;

    const pending = this.pendingCompanyTemplateInstallRequests.get(requestId);
    if (!pending) return;
    if (pending.targetPeerId !== peerId) return;

    clearTimeout(pending.timer);
    this.pendingCompanyTemplateInstallRequests.delete(requestId);

    if (sync?.ok === true) {
      const normalized = this.normalizeCompanyTemplateControlInstallResult(sync?.result);
      if (!normalized) {
        pending.reject(new Error('Host control bridge returned malformed install result payload'));
        return;
      }
      pending.resolve(normalized);
      return;
    }

    const errorMessage = (() => {
      if (typeof sync?.error === 'string') {
        const trimmed = sync.error.trim();
        if (trimmed) return trimmed;
      }
      if (sync?.error && typeof sync.error === 'object') {
        const rawMessage = (sync.error as Record<string, unknown>).message;
        if (typeof rawMessage === 'string' && rawMessage.trim()) {
          return rawMessage.trim();
        }
      }
      return 'Host control bridge rejected AI team install request';
    })();


    pending.reject(new Error(errorMessage));
  }

  private extractCompanySimControlErrorMessage(sync: any): string {
    if (typeof sync?.error === 'string') {
      const trimmed = sync.error.trim();
      if (trimmed) return trimmed;
    }
    if (sync?.error && typeof sync.error === 'object') {
      const rawMessage = (sync.error as Record<string, unknown>).message;
      if (typeof rawMessage === 'string' && rawMessage.trim()) {
        return rawMessage.trim();
      }
    }
    return 'Host control bridge rejected company sim request';
  }

  private handleCompanySimControlResponse(peerId: string, sync: any): void {
    const requestId = typeof sync?.requestId === 'string' ? sync.requestId.trim() : '';
    if (!requestId) return;

    const pending = this.pendingCompanySimControlRequests.get(requestId);
    if (!pending) return;
    if (pending.targetPeerId !== peerId) return;
    if (pending.responseType !== sync?.type) return;

    clearTimeout(pending.timer);
    this.pendingCompanySimControlRequests.delete(requestId);

    if (sync?.ok === true) {
      pending.resolve(sync?.result ?? null);
      return;
    }

    pending.reject(new Error(this.extractCompanySimControlErrorMessage(sync)));
  }

  private requestCompanySimControlFromPeer(params: {
    targetPeerId: string;
    workspaceId: string;
    requestType: string;
    responseType: string;
    label: string;
    payload?: Record<string, unknown>;
  }): Promise<unknown> {
    const randomUuid = (globalThis.crypto as any)?.randomUUID?.bind(globalThis.crypto);
    const requestId = typeof randomUuid === 'function'
      ? randomUuid()
      : `company-sim:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pendingCompanySimControlRequests.get(requestId);
        if (!pending) return;
        this.pendingCompanySimControlRequests.delete(requestId);
        pending.reject(new Error('Company Sim host did not answer in time. Make sure the OpenClaw host peer is online, then try Refresh.'));
      }, COMPANY_SIM_CONTROL_TIMEOUT_MS);

      this.pendingCompanySimControlRequests.set(requestId, {
        targetPeerId: params.targetPeerId,
        responseType: params.responseType,
        resolve,
        reject,
        timer,
      });

      this.sendControlWithRetry(params.targetPeerId, {
        type: 'workspace-sync',
        workspaceId: params.workspaceId,
        sync: {
          type: params.requestType,
          requestId,
          workspaceId: params.workspaceId,
          ...(params.payload ?? {}),
        },
      }, { label: params.label });
    });
  }

  private async requestCompanySimControlViaControlPlane(params: {
    workspaceId: string;
    requestType: string;
    responseType: string;
    label: string;
    payload?: Record<string, unknown>;
    noPeerMessage: string;
  }): Promise<unknown> {
    let targetPeers = this.selectWorkspaceSyncTargetPeers(
      params.workspaceId,
      COMPANY_TEMPLATE_CONTROL_CAPABILITY,
    );

    if (!targetPeers.length) {
      await this.warmCompanyTemplateControlPeerConnections(params.workspaceId);
      targetPeers = this.selectWorkspaceSyncTargetPeers(
        params.workspaceId,
        COMPANY_TEMPLATE_CONTROL_CAPABILITY,
      );
    }

    if (!targetPeers.length) {
      throw new Error(params.noPeerMessage);
    }

    const failures: string[] = [];
    for (const targetPeerId of targetPeers) {
      try {
        return await this.requestCompanySimControlFromPeer({
          targetPeerId,
          workspaceId: params.workspaceId,
          requestType: params.requestType,
          responseType: params.responseType,
          label: params.label,
          payload: params.payload,
        });
      } catch (error) {
        failures.push(String((error as Error)?.message ?? error ?? 'Unknown host control failure'));
      }
    }

    const detail = failures.find((entry) => entry.trim()) ?? 'Host control bridge failed company sim request';
    throw new Error(detail);
  }

  async requestCompanySimStateViaControlPlane(params: { workspaceId: string }): Promise<unknown> {
    const workspaceId = String(params.workspaceId ?? '').trim();
    if (!workspaceId) throw new Error('workspaceId is required for company sim state request');
    return await this.requestCompanySimControlViaControlPlane({
      workspaceId,
      requestType: 'company-sim-state-request',
      responseType: 'company-sim-state-response',
      label: 'company-sim-state',
      noPeerMessage: 'No online host control peer is available to inspect company sim right now',
    });
  }

  async readCompanySimDocumentViaControlPlane(params: { workspaceId: string; relativePath: string }): Promise<unknown> {
    const workspaceId = String(params.workspaceId ?? '').trim();
    const relativePath = String(params.relativePath ?? '').trim();
    if (!workspaceId) throw new Error('workspaceId is required for company sim doc read');
    if (!relativePath) throw new Error('relativePath is required for company sim doc read');
    return await this.requestCompanySimControlViaControlPlane({
      workspaceId,
      requestType: 'company-sim-doc-read-request',
      responseType: 'company-sim-doc-read-response',
      label: 'company-sim-doc-read',
      payload: { relativePath },
      noPeerMessage: 'No online host control peer is available to read company sim docs right now',
    });
  }

  async writeCompanySimDocumentViaControlPlane(params: { workspaceId: string; relativePath: string; content: string }): Promise<unknown> {
    const workspaceId = String(params.workspaceId ?? '').trim();
    const relativePath = String(params.relativePath ?? '').trim();
    if (!workspaceId) throw new Error('workspaceId is required for company sim doc write');
    if (!relativePath) throw new Error('relativePath is required for company sim doc write');
    return await this.requestCompanySimControlViaControlPlane({
      workspaceId,
      requestType: 'company-sim-doc-write-request',
      responseType: 'company-sim-doc-write-response',
      label: 'company-sim-doc-write',
      payload: { relativePath, content: String(params.content ?? '') },
      noPeerMessage: 'No online host control peer is available to write company sim docs right now',
    });
  }

  async requestCompanySimEmployeeContextViaControlPlane(params: { workspaceId: string; employeeId: string }): Promise<unknown> {
    const workspaceId = String(params.workspaceId ?? '').trim();
    const employeeId = String(params.employeeId ?? '').trim();
    if (!workspaceId) throw new Error('workspaceId is required for company sim employee context request');
    if (!employeeId) throw new Error('employeeId is required for company sim employee context request');
    return await this.requestCompanySimControlViaControlPlane({
      workspaceId,
      requestType: 'company-sim-employee-context-request',
      responseType: 'company-sim-employee-context-response',
      label: 'company-sim-employee-context',
      payload: { employeeId },
      noPeerMessage: 'No online host control peer is available to inspect employee context right now',
    });
  }

  async requestCompanySimRoutingPreviewViaControlPlane(params: {
    workspaceId: string;
    chatType: 'direct' | 'channel';
    channelNameOrId?: string;
    text: string;
    threadId?: string;
  }): Promise<unknown> {
    const workspaceId = String(params.workspaceId ?? '').trim();
    if (!workspaceId) throw new Error('workspaceId is required for company sim routing preview');
    return await this.requestCompanySimControlViaControlPlane({
      workspaceId,
      requestType: 'company-sim-routing-preview-request',
      responseType: 'company-sim-routing-preview-response',
      label: 'company-sim-routing-preview',
      payload: {
        chatType: params.chatType === 'direct' ? 'direct' : 'channel',
        ...(params.channelNameOrId ? { channelNameOrId: String(params.channelNameOrId) } : {}),
        text: String(params.text ?? ''),
        ...(params.threadId ? { threadId: String(params.threadId) } : {}),
      },
      noPeerMessage: 'No online host control peer is available to simulate company routing right now',
    });
  }

  private requestCompanyTemplateInstallFromPeer(
    targetPeerId: string,
    request: CompanyTemplateControlInstallRequest,
  ): Promise<CompanyTemplateControlInstallResult> {
    const randomUuid = (globalThis.crypto as any)?.randomUUID?.bind(globalThis.crypto);
    const requestId = typeof randomUuid === 'function'
      ? randomUuid()
      : `company-template:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pendingCompanyTemplateInstallRequests.get(requestId);
        if (!pending) return;
        this.pendingCompanyTemplateInstallRequests.delete(requestId);
        pending.reject(new Error('Timed out waiting for host control bridge response'));
      }, COMPANY_TEMPLATE_INSTALL_TIMEOUT_MS);

      this.pendingCompanyTemplateInstallRequests.set(requestId, {
        targetPeerId,
        resolve,
        reject,
        timer,
      });

      this.sendControlWithRetry(targetPeerId, {
        type: 'workspace-sync',
        workspaceId: request.workspaceId,
        sync: {
          type: 'company-template-install-request',
          requestId,
          workspaceId: request.workspaceId,
          templateId: request.templateId,
          answers: request.answers,
        },
      }, { label: 'company-template-install' });
    });
  }

  private async warmCompanyTemplateControlPeerConnections(workspaceId: string): Promise<void> {
    if (!this.transport?.connect) return;

    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return;

    const connectCandidates = workspace.members
      .filter((member) => member.peerId !== this.state.myPeerId)
      .filter((member) => !this.state.readyPeers.has(member.peerId))
      .sort((a, b) => {
        const aPriority = (a.isBot ? 0 : 1) + ((a.role === 'owner' || a.role === 'admin') ? -1 : 0);
        const bPriority = (b.isBot ? 0 : 1) + ((b.role === 'owner' || b.role === 'admin') ? -1 : 0);
        return aPriority - bPriority;
      })
      .slice(0, 6)
      .map((member) => member.peerId);

    if (!connectCandidates.length) return;

    for (const peerId of connectCandidates) {
      this.transport.connect(peerId).catch(() => {});
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 1200));
  }

  async installCompanyTemplateViaControlPlane(
    request: CompanyTemplateControlInstallRequest,
  ): Promise<CompanyTemplateControlInstallResult> {
    const workspaceId = String(request.workspaceId ?? '').trim();
    const templateId = String(request.templateId ?? '').trim();
    if (!workspaceId) throw new Error('workspaceId is required for host control install');
    if (!templateId) throw new Error('templateId is required for host control install');

    const normalizedAnswers: Record<string, string> = {};
    for (const [rawKey, rawValue] of Object.entries(request.answers ?? {})) {
      const key = rawKey.trim();
      if (!key) continue;
      normalizedAnswers[key] = String(rawValue ?? '').trim();
    }

    let targetPeers = this.selectWorkspaceSyncTargetPeers(
      workspaceId,
      COMPANY_TEMPLATE_CONTROL_CAPABILITY,
    );

    if (!targetPeers.length) {
      await this.warmCompanyTemplateControlPeerConnections(workspaceId);
      targetPeers = this.selectWorkspaceSyncTargetPeers(
        workspaceId,
        COMPANY_TEMPLATE_CONTROL_CAPABILITY,
      );
    }

    if (!targetPeers.length) {
      throw new Error('No online host control peer is available to install AI team right now');
    }

    const failures: string[] = [];
    for (const targetPeerId of targetPeers) {
      try {
        return await this.requestCompanyTemplateInstallFromPeer(targetPeerId, {
          workspaceId,
          templateId,
          answers: normalizedAnswers,
        });
      } catch (error) {
        failures.push(String((error as Error)?.message ?? error ?? 'Unknown host control failure'));
      }
    }

    const detail = failures.find((entry) => entry.trim()) ?? 'Host control bridge failed to install AI team';
    throw new Error(detail);
  }

  private getDirectoryRequestKey(workspaceId: string, cursor?: string): string {
    return `${workspaceId}::${cursor || '__root__'}`;
  }

  private clearDirectoryRequestFailoverTimer(workspaceId: string, cursor?: string): void {
    const key = this.getDirectoryRequestKey(workspaceId, cursor);
    const timer = this.directoryRequestFailoverTimers.get(key);
    if (!timer) return;
    clearTimeout(timer);
    this.directoryRequestFailoverTimers.delete(key);
  }

  private requestMemberDirectoryPageWithFallback(
    workspaceId: string,
    cursor: string | undefined,
    targetPeerIds: string[],
    targetIndex: number,
  ): void {
    const targetPeerId = targetPeerIds[targetIndex];
    if (!targetPeerId) {
      this.clearDirectoryRequestFailoverTimer(workspaceId, cursor);
      this.publicWorkspaceController.endPageRequest(workspaceId, cursor);
      return;
    }

    if (!this.state.readyPeers.has(targetPeerId)) {
      this.requestMemberDirectoryPageWithFallback(workspaceId, cursor, targetPeerIds, targetIndex + 1);
      return;
    }

    this.sendControlWithRetry(targetPeerId, {
      type: 'workspace-sync',
      workspaceId,
      sync: {
        type: 'member-page-request',
        workspaceId,
        cursor,
        pageSize: 100,
      },
    }, { label: 'workspace-sync' });

    const key = this.getDirectoryRequestKey(workspaceId, cursor);
    this.clearDirectoryRequestFailoverTimer(workspaceId, cursor);
    const timer = setTimeout(() => {
      if (this.directoryRequestFailoverTimers.get(key) !== timer) return;
      this.requestMemberDirectoryPageWithFallback(workspaceId, cursor, targetPeerIds, targetIndex + 1);
    }, DIRECTORY_REQUEST_FAILOVER_TIMEOUT_MS);
    this.directoryRequestFailoverTimers.set(key, timer);
  }

  private requestWorkspaceShell(peerId: string, workspaceId: string): void {
    if (!workspaceId) return;
    if (!this.state.readyPeers.has(peerId)) return;
    if (!this.peerSupportsCapability(peerId, WORKSPACE_SHELL_CAPABILITY)) return;

    this.sendControlWithRetry(peerId, {
      type: 'workspace-sync',
      workspaceId,
      sync: {
        type: 'workspace-shell-request',
        workspaceId,
      },
    }, { label: 'workspace-sync' });
  }

  async prefetchWorkspaceMemberDirectory(workspaceId: string, preferredPeerId?: string): Promise<void> {
    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (!ws) return;

    const snapshot = this.publicWorkspaceController.getSnapshot(workspaceId);
    const shouldUsePagedDirectory = this.canUsePagedMemberDirectory(ws, snapshot);
    if (!shouldUsePagedDirectory) return;
    if (!snapshot.hasMore && snapshot.loadedCount > 0) return;

    const cursor = snapshot.nextCursor;
    if (!this.publicWorkspaceController.beginPageRequest(workspaceId, cursor)) return;

    const targetPeerIds = this.selectWorkspaceSyncTargetPeers(
      workspaceId,
      MEMBER_DIRECTORY_CAPABILITY,
      preferredPeerId,
    );
    if (!targetPeerIds.length) {
      this.publicWorkspaceController.endPageRequest(workspaceId, cursor);
      return;
    }

    this.requestMemberDirectoryPageWithFallback(workspaceId, cursor, targetPeerIds, 0);
  }

  private handleWorkspaceShellRequest(peerId: string, workspaceId: string): void {
    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (!ws) return;
    if (this.workspaceManager.isBanned(workspaceId, peerId)) return;

    const snapshot = this.publicWorkspaceController.getSnapshot(workspaceId);
    const isKnownMember = ws.members.some((member) => member.peerId === peerId)
      || snapshot.members.some((member) => member.peerId === peerId);
    if (!isKnownMember) return;

    this.sendControlWithRetry(peerId, {
      type: 'workspace-sync',
      workspaceId,
      sync: {
        type: 'workspace-shell-response',
        shell: this.buildWorkspaceShell(ws),
        inviteCode: ws.inviteCode,
      },
    }, { label: 'workspace-sync' });
  }

  private async handleWorkspaceShellResponse(peerId: string, shell: WorkspaceShell, inviteCode?: string): Promise<void> {
    await this.publicWorkspaceController.ingestWorkspaceShell(shell, inviteCode);

    const ws = this.workspaceManager.getWorkspace(shell.id);
    if (ws) {
      ws.shell = shell;
      ws.version = shell.version;
      await this.persistWorkspace(ws.id);
    }

    if (!this.state.activeWorkspaceId) {
      this.state.activeWorkspaceId = shell.id;
      this.state.activeChannelId = ws?.channels[0]?.id || this.state.activeChannelId;
    }

    if (this.state.activeWorkspaceId === shell.id) {
      this.ui?.updateWorkspaceRail?.();
      this.ui?.updateSidebar({ refreshContacts: false });
    }

    void this.prefetchWorkspaceMemberDirectory(shell.id, peerId);
  }

  private handleMemberPageRequest(peerId: string, sync: { workspaceId: string; cursor?: string; pageSize?: number; shardPrefix?: string }): void {
    const ws = this.workspaceManager.getWorkspace(sync.workspaceId);
    if (!ws) return;
    if (!this.workspaceHasLargeWorkspaceCapability(ws)) return;
    if (this.workspaceManager.isBanned(sync.workspaceId, peerId)) return;

    const snapshot = this.publicWorkspaceController.getSnapshot(sync.workspaceId);
    const isKnownMember = ws.members.some((member) => member.peerId === peerId)
      || snapshot.members.some((member) => member.peerId === peerId);
    if (!isKnownMember) return;

    const page = this.publicWorkspaceController.buildPageFromWorkspace(sync.workspaceId, {
      cursor: sync.cursor,
      pageSize: sync.pageSize,
      shardPrefix: sync.shardPrefix,
    });

    this.sendControlWithRetry(peerId, {
      type: 'workspace-sync',
      workspaceId: sync.workspaceId,
      sync: {
        type: 'member-page-response',
        page,
      },
    }, { label: 'workspace-sync' });
  }

  private async handleMemberPageResponse(_peerId: string, page: MemberDirectoryPage): Promise<void> {
    this.clearDirectoryRequestFailoverTimer(page.workspaceId, page.cursor);
    await this.publicWorkspaceController.ingestMemberPage(page);
    this.publicWorkspaceController.endPageRequest(page.workspaceId, page.cursor);

    if (this.state.activeWorkspaceId === page.workspaceId) {
      this.ui?.updateSidebar({ refreshContacts: false });
    }
  }

  private getWorkspaceDirectoryReplicaCandidates(workspaceId: string, shardPrefix: string): string[] {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return [];

    const workspaceMembers = new Set(workspace.members.map((member) => member.peerId));
    const capability = `${DIRECTORY_SHARD_CAPABILITY_PREFIX}${shardPrefix}`;

    const candidates: string[] = [];
    for (const peerId of this.state.readyPeers) {
      if (!workspaceMembers.has(peerId)) continue;
      if (!this.peerSupportsCapability(peerId, capability)) continue;
      candidates.push(peerId);
    }

    return candidates;
  }

  private normalizeDirectoryShardReplicaPeerIds(
    workspace: Workspace,
    shardPrefix: string,
    replicaPeerIds: string[],
  ): string[] {
    const merged = [...new Set([
      ...replicaPeerIds,
      ...this.getWorkspaceDirectoryReplicaCandidates(workspace.id, shardPrefix),
    ])]
      .filter((peerId) => typeof peerId === 'string' && peerId.length > 0)
      .sort();

    if ((workspace.shell?.memberCount ?? workspace.members.length) < MEDIUM_WORKSPACE_MEMBER_THRESHOLD) {
      return merged;
    }

    if (merged.length <= IMPORTANT_SHARD_MIN_REPLICAS) {
      return merged;
    }

    const targetReplicaCount = Math.min(
      IMPORTANT_SHARD_PREFERRED_REPLICAS,
      Math.max(IMPORTANT_SHARD_MIN_REPLICAS, merged.length),
    );

    return merged.slice(0, targetReplicaCount);
  }

  private async handleDirectoryShardAdvertisement(shard: { workspaceId: string; shardId: string; shardPrefix: string; replicaPeerIds: string[]; version?: number }): Promise<void> {
    const ws = this.workspaceManager.getWorkspace(shard.workspaceId);
    if (!ws) return;

    const current = [...(ws.directoryShards ?? [])];
    const idx = current.findIndex((entry) => entry.shardId === shard.shardId);
    if (idx >= 0) {
      const existing = current[idx]!;
      const nextVersion = shard.version ?? 0;
      const existingVersion = existing.version ?? 0;
      if (nextVersion < existingVersion) return;
      current[idx] = {
        ...existing,
        ...shard,
        replicaPeerIds: this.normalizeDirectoryShardReplicaPeerIds(
          ws,
          shard.shardPrefix,
          [...(existing.replicaPeerIds ?? []), ...(shard.replicaPeerIds ?? [])],
        ),
      };
    } else {
      current.push({
        ...shard,
        replicaPeerIds: this.normalizeDirectoryShardReplicaPeerIds(ws, shard.shardPrefix, shard.replicaPeerIds ?? []),
      });
    }

    ws.directoryShards = current.sort((a, b) => a.shardId.localeCompare(b.shardId));
    await this.persistWorkspace(ws.id);
  }

  private async handleSyncMessage(peerId: string, msg: any): Promise<void> {
    if (msg.sync?.type === 'company-template-install-response') {
      this.handleCompanyTemplateInstallResponse(peerId, msg.sync);
      return;
    }

    if (
      msg.sync?.type === 'company-sim-state-response'
      || msg.sync?.type === 'company-sim-doc-read-response'
      || msg.sync?.type === 'company-sim-doc-write-response'
      || msg.sync?.type === 'company-sim-employee-context-response'
      || msg.sync?.type === 'company-sim-routing-preview-response'
    ) {
      this.handleCompanySimControlResponse(peerId, msg.sync);
      return;
    }

    if (msg.sync?.type === 'workspace-shell-request' && msg.sync.workspaceId) {
      this.handleWorkspaceShellRequest(peerId, msg.sync.workspaceId);
      return;
    }

    if (msg.sync?.type === 'workspace-shell-response' && msg.sync.shell) {
      await this.handleWorkspaceShellResponse(peerId, msg.sync.shell, msg.sync.inviteCode);
      return;
    }

    if (msg.sync?.type === 'member-page-request' && msg.sync.workspaceId) {
      this.handleMemberPageRequest(peerId, msg.sync);
      return;
    }

    if (msg.sync?.type === 'member-page-response' && msg.sync.page?.workspaceId) {
      await this.handleMemberPageResponse(peerId, msg.sync.page);
      return;
    }

    if (msg.sync?.type === 'directory-shard-advertisement' && msg.sync.shard?.workspaceId) {
      await this.handleDirectoryShardAdvertisement(msg.sync.shard);
      return;
    }

    // Handle workspace state sync (channels, members, name)
    if (msg.sync?.type === 'workspace-state' && msg.workspaceId) {
      await this.handleWorkspaceStateSync(peerId, msg.workspaceId, msg.sync);
      return;
    }

    // Handle join rejection.
    // Important: do NOT always self-revoke here; join negotiation can include
    // rejections from peers that are not authoritative for our target workspace.
    if (msg.sync?.type === 'join-rejected') {
      const reason = String(msg.sync.reason || 'Join rejected');
      const indicatesRevocation = /banned|kicked|removed/i.test(reason);

      const candidates = [msg.workspaceId, this.state.activeWorkspaceId]
        .filter((id): id is string => typeof id === 'string' && id.length > 0);

      // Prefer a local workspace candidate where I am currently a member.
      let targetWsId: string | null = null;
      for (const wsId of candidates) {
        const ws = this.workspaceManager.getWorkspace(wsId);
        if (ws && ws.members.some((m: any) => m.peerId === this.state.myPeerId)) {
          targetWsId = wsId;
          break;
        }
      }

      // Fallback for join flow: if server rejected a join but IDs differ,
      // active workspace is still the provisional one we should remove.
      if (!targetWsId && this.state.activeWorkspaceId) {
        const active = this.workspaceManager.getWorkspace(this.state.activeWorkspaceId);
        if (active && active.members.some((m: any) => m.peerId === this.state.myPeerId)) {
          targetWsId = this.state.activeWorkspaceId;
        }
      }

      // Last resort: if a join is pending, map rejection to that provisional workspace.
      if (!targetWsId && this.pendingJoinValidationTimers.size > 0) {
        targetWsId = Array.from(this.pendingJoinValidationTimers.keys())[0] || null;
      }

      if (targetWsId && indicatesRevocation) {
        const mappedReason: 'kicked' | 'banned' = /banned/i.test(reason) ? 'banned' : 'kicked';
        await this.handleSelfWorkspaceRevocation(targetWsId, mappedReason, peerId);
      } else {
        this.ui?.showToast(reason, 'error');
      }
      return;
    }

    // Handle real-time channel creation broadcast
    if (msg.sync?.type === 'channel-created' && msg.workspaceId && msg.sync.channel) {
      this.handleChannelCreated(msg.workspaceId, msg.sync.channel);
      return;
    }

    // Handle real-time channel removal broadcast
    if (msg.sync?.type === 'channel-removed' && msg.workspaceId && msg.sync.channelId) {
      await this.handleChannelRemoved(msg.workspaceId, msg.sync.channelId);
      return;
    }

    // Handle workspace deletion broadcast
    if (msg.sync?.type === 'workspace-deleted' && msg.workspaceId) {
      const existed = this.workspaceManager.getWorkspace(msg.workspaceId);
      if (existed) {
        await this.cleanupWorkspaceLocalState(msg.workspaceId, existed);
        this.workspaceManager.removeWorkspace(msg.workspaceId);
        this.ui?.showToast('Workspace was deleted by owner', 'error');
        this.ui?.updateWorkspaceRail?.();
        this.ui?.updateSidebar({ refreshContacts: false });
        this.ui?.updateChannelHeader();
        this.ui?.renderMessages();
        this.ui?.updateComposePlaceholder?.();
      }
      return;
    }

    // Handle role-changed event
    // SECURITY: Verify ECDSA signature from workspace owner. Fallback to local-state check for backward compat.
    if (msg.sync?.type === 'role-changed' && msg.workspaceId) {
      const ws = this.workspaceManager.getWorkspace(msg.workspaceId);
      if (ws) {
        const changedBy = msg.sync.changedBy;
        const validRoles = ['admin', 'member'];
        if (!validRoles.includes(msg.sync.newRole)) {
          console.warn(`[Security] Rejected role-changed: invalid role "${msg.sync.newRole}"`);
          return;
        }

        // Replay protection: reject if timestamp is not newer than last accepted
        const tsKey = `role:${msg.sync.peerId}`;
        const lastTs = this.lastRoleChangeTimestamp.get(tsKey) || 0;
        if (msg.sync.timestamp && msg.sync.timestamp <= lastTs) {
          console.warn(`[Security] Rejected role-changed: replay detected (ts ${msg.sync.timestamp} <= ${lastTs})`);
          return;
        }

        // ECDSA signature verification against LOCALLY STORED owner signing key
        let signatureVerified = false;
        if (msg.sync.signature) {
          const ownerMember = ws.members.find((m: any) => m.role === 'owner');
          if (ownerMember?.signingPublicKey) {
            // Verify against the owner's signing key we already trust (stored locally)
            signatureVerified = await this.verifyRoleEvent(
              msg.workspaceId, changedBy,
              { targetPeerId: msg.sync.peerId, newRole: msg.sync.newRole, timestamp: msg.sync.timestamp, signature: msg.sync.signature },
              ownerMember.signingPublicKey,
            );
            if (!signatureVerified) {
              console.warn(`[Security] Rejected role-changed: ECDSA signature verification failed against stored owner key`);
              return;
            }
          }
        }

        // Fallback: if no signature, require that transport sender IS the owner
        if (!signatureVerified) {
          if (!this.workspaceManager.isOwner(ws.id, peerId)) {
            console.warn(`[Security] Rejected role-changed from ${peerId.slice(0, 8)}: no valid signature and transport sender is not owner`);
            return;
          }
        }

        const member = ws.members.find((m: any) => m.peerId === msg.sync.peerId);
        if (member && member.role !== 'owner') {
          member.role = msg.sync.newRole;
          if (msg.sync.timestamp) this.lastRoleChangeTimestamp.set(tsKey, msg.sync.timestamp);
          this.persistWorkspace(ws.id).catch(() => {});
          const alias = member.alias || msg.sync.peerId.slice(0, 8);
          this.ui?.showToast(`${alias} is now ${msg.sync.newRole}`, 'info');
          this.ui?.renderApp();
        }
      }
      return;
    }

    // Handle workspace-settings-updated event
    // SECURITY: Verify ECDSA signature from admin/owner. Fallback to local-state check.
    if (msg.sync?.type === 'workspace-settings-updated' && msg.workspaceId) {
      const ws = this.workspaceManager.getWorkspace(msg.workspaceId);
      if (ws) {
        const changedBy = msg.sync.changedBy;

        // Validate settings shape
        const settings = msg.sync.settings;
        if (!settings || typeof settings !== 'object') return;
        const validValues = ['everyone', 'admins'];
        if (settings.whoCanCreateChannels && !validValues.includes(settings.whoCanCreateChannels)) return;
        if (settings.whoCanInviteMembers && !validValues.includes(settings.whoCanInviteMembers)) return;
        if (settings.revokedInviteIds !== undefined) {
          if (!Array.isArray(settings.revokedInviteIds)) return;
          if (settings.revokedInviteIds.some((id: any) => typeof id !== 'string')) return;
        }

        // Replay protection for settings events
        const settingsTsKey = `settings:${msg.workspaceId}`;
        const settingsLastTs = this.lastRoleChangeTimestamp.get(settingsTsKey) || 0;
        if (msg.sync.timestamp && msg.sync.timestamp <= settingsLastTs) {
          console.warn(`[Security] Rejected workspace-settings-updated: replay detected`);
          return;
        }

        // ECDSA signature verification against locally stored admin/owner signing key
        let signatureVerified = false;
        if (msg.sync.signature) {
          const actorMember = ws.members.find((m: any) => m.peerId === changedBy && (m.role === 'owner' || m.role === 'admin'));
          if (actorMember?.signingPublicKey) {
            signatureVerified = await this.verifySettingsEvent(
              msg.workspaceId, changedBy,
              { settings: msg.sync.settings, timestamp: msg.sync.timestamp, signature: msg.sync.signature },
              actorMember.signingPublicKey,
            );
            if (!signatureVerified) {
              console.warn(`[Security] Rejected workspace-settings-updated: ECDSA signature verification failed against stored key`);
              return;
            }
          }
        }

        // Fallback: require transport sender IS an admin/owner
        if (!signatureVerified) {
          if (!this.workspaceManager.isAdmin(ws.id, peerId)) {
            console.warn(`[Security] Rejected workspace-settings-updated: no valid signature and transport sender is not admin/owner`);
            return;
          }
        }

        ws.permissions = {
          ...(ws.permissions || { whoCanCreateChannels: 'everyone', whoCanInviteMembers: 'everyone', revokedInviteIds: [] }),
          ...settings,
          revokedInviteIds: Array.isArray(settings.revokedInviteIds)
            ? Array.from(new Set(settings.revokedInviteIds.map((id: string) => id.trim()).filter(Boolean)))
            : (ws.permissions?.revokedInviteIds || []),
        };
        if (msg.sync.timestamp) this.lastRoleChangeTimestamp.set(settingsTsKey, msg.sync.timestamp);
        this.persistWorkspace(ws.id).catch(() => {});
        this.ui?.showToast('Workspace settings updated', 'info');
      }
      return;
    }

    // Handle member-left event (voluntary leave)
    if (msg.sync?.type === 'member-left' && msg.workspaceId) {
      const ws = this.workspaceManager.getWorkspace(msg.workspaceId);
      if (ws) {
        const leftPeerId = msg.sync.peerId;

        ws.members = ws.members.filter((m: any) => m.peerId !== leftPeerId);
        for (const ch of ws.channels) {
          ch.members = ch.members.filter((id: string) => id !== leftPeerId);
        }

        if (leftPeerId === this.state.myPeerId) {
          const ok = await this.cleanupWorkspaceLocalState(ws.id, ws);
          if (ok) {
            this.workspaceManager.removeWorkspace(ws.id);
            this.ui?.showToast('You left the workspace', 'info');
            this.ui?.updateWorkspaceRail?.();
            this.ui?.updateSidebar({ refreshContacts: false });
            this.ui?.updateChannelHeader();
            this.ui?.renderMessages();
            this.ui?.updateComposePlaceholder?.();
          }
        } else {
          this.persistWorkspace(ws.id).catch(() => {});
          this.ui?.renderApp();
        }
      }
      return;
    }

    // Handle member-removed event
    // SECURITY: Verify ECDSA signature. Fallback to local-state permission check.
    if (msg.sync?.type === 'member-removed' && msg.workspaceId) {
      const ws = this.workspaceManager.getWorkspace(msg.workspaceId);
      if (ws) {
        const removedBy = msg.sync.removedBy;
        const removedPeerId = msg.sync.peerId;

        // Replay protection for member-removed events
        const removeTsKey = `remove:${removedPeerId}`;
        const removeLastTs = this.lastRoleChangeTimestamp.get(removeTsKey) || 0;
        if (msg.sync.timestamp && msg.sync.timestamp <= removeLastTs) {
          console.warn(`[Security] Rejected member-removed: replay detected`);
          return;
        }

        // ECDSA signature verification against locally stored admin/owner signing key
        let signatureVerified = false;
        if (msg.sync.signature) {
          const actorMember = ws.members.find((m: any) => m.peerId === removedBy && (m.role === 'owner' || m.role === 'admin'));
          if (actorMember?.signingPublicKey) {
            signatureVerified = await this.verifyRemoveEvent(
              msg.workspaceId, removedBy,
              { peerId: removedPeerId, timestamp: msg.sync.timestamp, signature: msg.sync.signature },
              actorMember.signingPublicKey,
            );
            if (!signatureVerified) {
              console.warn(`[Security] Rejected member-removed: ECDSA signature verification failed against stored key`);
              return;
            }
          }
        }

        // Fallback: require transport sender has permission (use peerId, not claimed removedBy)
        if (!signatureVerified) {
          if (!this.workspaceManager.canRemoveMember(ws.id, peerId, removedPeerId)) {
            console.warn(`[Security] Rejected member-removed: no valid signature and transport sender lacks permission`);
            return;
          }
        }

        ws.members = ws.members.filter((m: any) => m.peerId !== removedPeerId);
        for (const ch of ws.channels) {
          ch.members = ch.members.filter((id: string) => id !== removedPeerId);
        }

        if (removedPeerId === this.state.myPeerId) {
          const reason: 'kicked' | 'banned' = msg.sync.reason === 'banned' ? 'banned' : 'kicked';
          await this.handleSelfWorkspaceRevocation(msg.workspaceId, reason, removedBy);
          return;
        } else {
          this.persistWorkspace(ws.id).catch(() => {});
          this.ui?.updateSidebar({ refreshContacts: false });
          this.ui?.updateChannelHeader();
          this.ui?.renderMessages();
        }
      }
      return;
    }

    // Multi-device: Handle device-announce sync messages
    if (msg.sync?.type === 'device-announce' && msg.sync.identityId && msg.sync.device && msg.sync.proof) {
      try {
        // Verify the device proof before accepting
        // Look up the signing public key for this identity from workspace members
        const ws = msg.workspaceId ? this.workspaceManager.getWorkspace(msg.workspaceId) : null;
        const member = ws?.members.find((m: any) => m.identityId === msg.sync.identityId);
        if (member?.signingPublicKey) {
          const signingKey = await this.cryptoManager.importSigningPublicKey(member.signingPublicKey);
          const result = await DeviceManager.verifyDeviceProof(msg.sync.proof, signingKey);
          if (result.valid) {
            this.deviceRegistry.addDevice(msg.sync.identityId, msg.sync.device);
            // Update workspace member's device list
            if (member) {
              if (!member.devices) member.devices = [];
              const devIdx = member.devices.findIndex((d: any) => d.deviceId === msg.sync.device.deviceId);
              if (devIdx >= 0) {
                member.devices[devIdx] = msg.sync.device;
              } else {
                member.devices.push(msg.sync.device);
              }
              if (ws) this.persistWorkspace(ws.id).catch(() => {});
            }
            // Send ack
            this.transport.send(peerId, {
              type: 'sync',
              sync: { type: 'device-ack', identityId: msg.sync.identityId, deviceId: msg.sync.device.deviceId },
              workspaceId: msg.workspaceId,
            });
            chatLog.info(`[MultiDevice] Registered device ${msg.sync.device.deviceLabel} for identity ${msg.sync.identityId.slice(0, 8)}`);
          } else {
            console.warn(`[MultiDevice] Rejected device-announce: ${result.reason}`);
          }
        } else {
          // No signing key — can't verify, accept with warning (TOFU for devices)
          this.deviceRegistry.addDevice(msg.sync.identityId, msg.sync.device);
          console.warn(`[MultiDevice] Accepted device-announce without verification (no signing key for identity ${msg.sync.identityId.slice(0, 8)})`);
        }
      } catch (err) {
        console.error('[MultiDevice] device-announce handling error:', err);
      }
      return;
    }

    // DEP-002: Handle peer-exchange messages
    if (msg.sync?.type === 'peer-exchange' && msg.workspaceId) {
      const discovery = this.serverDiscovery.get(msg.workspaceId);
      if (discovery && msg.sync.servers) {
        discovery.mergeReceivedServers(msg.sync.servers);
        this.saveServerDiscovery(msg.workspaceId); // Persist updated state
        chatLog.info(`[PEX] Merged ${msg.sync.servers.length} servers from ${peerId.slice(0, 8)}`);

        // Try to connect to new high-ranked servers
        await this.connectToDiscoveredServers(discovery);
      }
    }
  }

  private buildWorkspaceStateSnapshotForFingerprint(workspace: any): Record<string, unknown> {
    return {
      name: workspace?.name,
      description: workspace?.description,
      inviteCode: workspace?.inviteCode,
      channels: Array.isArray(workspace?.channels)
        ? workspace.channels.map((channel: any) => ({
            id: channel?.id,
            name: channel?.name,
            type: channel?.type,
            members: Array.isArray(channel?.members) ? channel.members : [],
          }))
        : [],
      members: Array.isArray(workspace?.members)
        ? workspace.members.map((member: any) => ({
            peerId: member?.peerId,
            alias: member?.alias,
            role: member?.role,
            isBot: member?.isBot === true,
            allowWorkspaceDMs: member?.allowWorkspaceDMs !== false,
          }))
        : [],
      bans: Array.isArray(workspace?.bans)
        ? workspace.bans.map((ban: any) => ({
            peerId: ban?.peerId,
            bannedAt: ban?.bannedAt,
          }))
        : [],
    };
  }

  private shouldPushWorkspaceStateOnConnect(peerId: string, workspaceId?: string): boolean {
    if (!workspaceId) return false;
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return false;
    if (this.pendingJoinValidationTimers.has(workspaceId)) return true;
    if (this.workspaceManager.isOwner(workspaceId, this.state.myPeerId)) return true;

    // Non-owners push workspace-state to the owner so the owner can learn
    // about members that joined through this non-owner peer.  Without this,
    // the owner's member-addition passthrough (in handleWorkspaceStateSync)
    // never fires because non-owners never send workspace-state.
    if (this.workspaceManager.isOwner(workspaceId, peerId)) return true;

    // Non-owners skip eager full-state pushes to other non-owners to avoid
    // O(n^2) workspace-state storms in larger meshes.
    return false;
  }

  /**
   * Handle incoming workspace state sync — update local channels, members, and name
   * to match the peer's state. This ensures both peers see the same channels.
   */
  private async handleWorkspaceStateSync(peerId: string, remoteWorkspaceId: string, sync: any): Promise<void> {
    const _wst0 = performance.now();
    // Find matching local workspace deterministically:
    // 1) exact workspace ID, 2) matching invite code.
    // Do NOT fallback to active workspace here — that can merge state across unrelated workspaces.
    const allWorkspaces = this.workspaceManager.getAllWorkspaces();
    let localWs = allWorkspaces.find((ws: any) => ws.id === remoteWorkspaceId)
      || (sync?.inviteCode ? allWorkspaces.find((ws: any) => ws.inviteCode === sync.inviteCode) : null);

    if (!localWs) {
      console.warn(`[Sync] No matching workspace for workspace-state from ${peerId.slice(0, 8)} (remote=${remoteWorkspaceId?.slice?.(0, 8) || 'none'})`);
      return;
    }

    // SECURITY: never accept workspace-state from a banned peer.
    if (this.workspaceManager.isBanned(localWs.id, peerId)) {
      this.sendControlWithRetry(peerId, {
        type: 'workspace-sync',
        workspaceId: localWs.id,
        sync: {
          type: 'join-rejected',
          reason: 'Join rejected: you are banned from this workspace',
        },
      }, { label: 'workspace-sync' });
      console.warn(`[Security] Ignoring workspace-state from banned peer ${peerId.slice(0, 8)} for workspace ${localWs.id.slice(0, 8)}`);
      return;
    }

    // SECURITY: workspace IDs should match for normal sync.
    // But on fresh invite-join flows, the joiner may have created a provisional
    // local workspace ID before receiving the owner's canonical workspace-state.
    // In that case, if inviteCode matches, adopt the remote workspace ID once.
    if (remoteWorkspaceId !== localWs.id) {
      const sameInvite = !!sync?.inviteCode && sync.inviteCode === localWs.inviteCode;
      const onlyOneWorkspace = this.workspaceManager.getAllWorkspaces().length === 1;
      const inviterIsKnownMember = localWs.members.some((m: any) => m.peerId === peerId);
      const inviterIsOwner = localWs.members.some((m: any) => m.peerId === peerId && m.role === 'owner');
      // Legacy fallback: only allow adoption heuristic when remote inviteCode is missing.
      // If inviteCode is present and mismatched, never adopt a different workspace ID.
      const canAdoptByJoinHeuristic = !sync?.inviteCode && onlyOneWorkspace && inviterIsKnownMember && inviterIsOwner;

      if (!sameInvite && !canAdoptByJoinHeuristic) {
        console.warn(`[Sync] Rejected workspace state from ${peerId.slice(0, 8)}: workspace ID mismatch. ` +
          `Local: ${localWs.id.slice(0, 8)}, Remote: ${remoteWorkspaceId.slice(0, 8)}. ` +
          `This peer may be from a different workspace.`);
        return;
      }

      // SECURITY: Only the JOINER should adopt the owner's canonical workspace ID.
      // The owner must never adopt a joiner's provisional ID — that corrupts
      // the canonical workspace state for all existing members.
      if (this.workspaceManager.isOwner(localWs.id, this.state.myPeerId)) {
        syncLog.info(`Skipping workspace ID adoption from ${peerId.slice(0, 8)}: I am the owner`);
      } else {
        const oldWorkspaceId = localWs.id;
        syncLog.info(`Adopting remote workspace ID ${remoteWorkspaceId.slice(0, 8)} (was ${oldWorkspaceId.slice(0, 8)}) for invite ${localWs.inviteCode}`);

        // Remap local channel IDs to the owner's canonical channel IDs by name/type.
        if (Array.isArray(sync.channels)) {
          for (const remoteCh of sync.channels) {
            const localCh = localWs.channels.find((ch: any) => ch.name === remoteCh.name && ch.type === remoteCh.type);
            if (localCh && localCh.id !== remoteCh.id) {
              const oldId = localCh.id;
              localCh.id = remoteCh.id;
              localCh.workspaceId = remoteWorkspaceId;
              this.messageStore.remapChannel(oldId, remoteCh.id);
              await this.persistentStore.remapChannelMessages(oldId, remoteCh.id);
              if (this.messageCRDTs.has(oldId)) {
                const crdt = this.messageCRDTs.get(oldId)!;
                this.messageCRDTs.set(remoteCh.id, crdt);
                this.messageCRDTs.delete(oldId);
              }
              if (this.state.activeChannelId === oldId) {
                this.state.activeChannelId = remoteCh.id;
              }
            }
          }
        }

        // Replace provisional workspace ID with canonical one.
        this.workspaceManager.removeWorkspace(oldWorkspaceId);
        localWs.id = remoteWorkspaceId;
        for (const ch of localWs.channels) {
          ch.workspaceId = remoteWorkspaceId;
        }
        this.workspaceManager.importWorkspace(localWs as any);

        await this.persistentStore.deleteWorkspace(oldWorkspaceId);
        await this.persistentStore.saveWorkspace(localWs as any);

        if (this.state.activeWorkspaceId === oldWorkspaceId) {
          this.state.activeWorkspaceId = remoteWorkspaceId;
        }
      }
    }

    const senderIsOwner = this.workspaceManager.isOwner(localWs.id, peerId);
    if (!senderIsOwner) {
      const localIsOwner = this.workspaceManager.isOwner(localWs.id, this.state.myPeerId);
      const connectedOwnerExists = localWs.members.some(
        (member: any) => member.role === 'owner' && this.state.connectedPeers.has(member.peerId),
      );
      const joinValidationPending = this.pendingJoinValidationTimers.has(localWs.id);
      if ((localIsOwner || connectedOwnerExists) && !joinValidationPending) {
        // Even though we reject the full workspace-state from non-owners,
        // we still accept NEW member additions.  Without this, the owner
        // can never discover peers that joined through a non-owner peer
        // (the owner's guard drops the workspace-state, so the new member
        // is invisible until they connect directly and send name-announce).
        if (sync.members && Array.isArray(sync.members)) {
          let membersAdded = false;
          for (const remoteMember of sync.members) {
            if (!remoteMember?.peerId || typeof remoteMember.peerId !== 'string') continue;
            if (this.workspaceManager.isBanned(localWs.id, remoteMember.peerId)) continue;
            const alreadyExists = localWs.members.some((m: any) => m.peerId === remoteMember.peerId);
            if (alreadyExists) continue;
            localWs.members.push({
              peerId: remoteMember.peerId,
              alias: remoteMember.alias || remoteMember.peerId.slice(0, 8),
              publicKey: remoteMember.publicKey || '',
              signingPublicKey: remoteMember.signingPublicKey || undefined,
              joinedAt: Date.now(),
              role: 'member', // SECURITY: never accept elevated roles from non-owner
              isBot: remoteMember.isBot || undefined,
              allowWorkspaceDMs: remoteMember.allowWorkspaceDMs !== false,
            });
            membersAdded = true;
          }
          if (membersAdded) {
            this.persistWorkspace(localWs.id).catch(() => {});
            this.ui?.updateSidebar({ refreshContacts: false });
          }
        }
        return;
      }
    }

    const stateFingerprint = buildWorkspaceStateFingerprint(remoteWorkspaceId, sync);
    if (!this.workspaceStateSyncDeduper.shouldProcess(localWs.id, peerId, stateFingerprint)) {
      return;
    }

    const beforeFingerprint = buildWorkspaceStateFingerprint(
      localWs.id,
      this.buildWorkspaceStateSnapshotForFingerprint(localWs),
    );

    // Update workspace name if it was using the invite code as name
    if (sync.name && localWs.name !== sync.name) {
      const isPlaceholder = localWs.name === localWs.inviteCode || localWs.name.length === 8;
      if (isPlaceholder) {
        localWs.name = sync.name;
      }
    }

    // Sync description
    if (sync.description !== undefined) {
      localWs.description = sync.description;
    }

    // Sync permissions — SECURITY: only accept from owner
    if (sync.permissions && this.workspaceManager.isOwner(localWs.id, peerId)) {
      localWs.permissions = sync.permissions;
    }

    // Sync channels: map remote channels to local ones
    if (sync.channels && Array.isArray(sync.channels)) {
      for (const remoteCh of sync.channels) {
        const remoteMembers = Array.isArray((remoteCh as any).members)
          ? (remoteCh as any).members.filter((memberId: unknown): memberId is string => typeof memberId === 'string')
          : [];
        const remoteAccessPolicy = (remoteCh as any).accessPolicy
          ? JSON.parse(JSON.stringify((remoteCh as any).accessPolicy))
          : ((remoteCh as any).type === 'channel' ? { mode: 'public-workspace', workspaceId: localWs.id } : undefined);

        const localCh = localWs.channels.find(
          (ch: any) => ch.name === remoteCh.name && ch.type === remoteCh.type
        );

        if (localCh) {
          if (remoteAccessPolicy) {
            localCh.accessPolicy = remoteAccessPolicy;
          }
          if (remoteMembers.length > 0) {
            localCh.members = [...new Set<string>(remoteMembers as string[])];
          }
          if ((remoteCh as any).createdBy && !localCh.createdBy) {
            localCh.createdBy = (remoteCh as any).createdBy;
          }
          if (Number.isFinite((remoteCh as any).createdAt) && !Number.isFinite(localCh.createdAt)) {
            localCh.createdAt = (remoteCh as any).createdAt;
          }
        }

        if (localCh && localCh.id !== remoteCh.id && remoteCh.id < localCh.id) {
          // Min-wins: only adopt the remote channel ID when it is lexicographically smaller.
          // This prevents a late-joining peer (with fresh UUIDs) from overwriting the
          // established channel ID and orphaning messages stored under the old key.
          syncLog.info(`Remapping channel "${remoteCh.name}": ${localCh.id.slice(0, 8)} → ${remoteCh.id.slice(0, 8)}`);
          const oldId = localCh.id;
          localCh.id = remoteCh.id;

          // Migrate messages and CRDTs to the new channel ID
          this.messageStore.remapChannel(oldId, remoteCh.id);
          await this.persistentStore.remapChannelMessages(oldId, remoteCh.id);
          if (this.messageCRDTs.has(oldId)) {
            const crdt = this.messageCRDTs.get(oldId)!;
            this.messageCRDTs.set(remoteCh.id, crdt);
            this.messageCRDTs.delete(oldId);
          }

          // Update active channel if needed
          if (this.state.activeChannelId === oldId) {
            this.state.activeChannelId = remoteCh.id;
          }
        } else if (!localCh) {
          // New channel from peer — add it locally
          syncLog.info(`Adding new channel "${remoteCh.name}" from peer`);
          localWs.channels.push({
            id: remoteCh.id,
            workspaceId: localWs.id,
            name: remoteCh.name,
            type: remoteCh.type || 'channel',
            members: remoteMembers as string[],
            ...(remoteAccessPolicy ? { accessPolicy: remoteAccessPolicy } : {}),
            createdBy: (remoteCh as any).createdBy || peerId,
            createdAt: Number.isFinite((remoteCh as any).createdAt) ? (remoteCh as any).createdAt : Date.now(),
          });
        }
      }
    }

    // Sync bans FIRST so we can reject banned members immediately
    if (sync.bans && Array.isArray(sync.bans)) {
      localWs.bans = sync.bans.filter((ban: any) => ban && typeof ban.peerId === 'string' && typeof ban.bannedAt === 'number');
    }

    // Check if I am banned AFTER receiving bans from owner
    if (sync.bans && this.workspaceManager.isBanned(localWs.id, this.state.myPeerId)) {
      console.warn(`[Security] Received workspace-state but I am banned from workspace ${localWs.id.slice(0, 8)}`);
      await this.handleSelfWorkspaceRevocation(localWs.id, 'banned', peerId);
      return;
    }

    // Sync members: add missing, update aliases for existing
    if (sync.members && Array.isArray(sync.members)) {
      for (const remoteMember of sync.members) {
        if (this.workspaceManager.isBanned(localWs.id, remoteMember.peerId)) {
          continue;
        }
        const existing = localWs.members.find((m: any) => m.peerId === remoteMember.peerId);
        if (!existing) {
          // SECURITY: Only accept elevated roles from workspace owner
          const isFromOwner = this.workspaceManager.isOwner(localWs.id, peerId);
          const safeRole = isFromOwner && ['owner', 'admin', 'member'].includes(remoteMember.role)
            ? remoteMember.role : 'member';
          localWs.members.push({
            peerId: remoteMember.peerId,
            alias: remoteMember.alias || remoteMember.peerId.slice(0, 8),
            publicKey: remoteMember.publicKey || '',
            signingPublicKey: remoteMember.signingPublicKey || undefined,
            joinedAt: Date.now(),
            role: safeRole,
            isBot: remoteMember.isBot || undefined,
            allowWorkspaceDMs: remoteMember.allowWorkspaceDMs !== false,
          });
        } else {
          // Update alias when it improves quality; avoid overwriting human names
          // with short peer-id-like placeholders.
          if (remoteMember.alias && remoteMember.alias.trim()) {
            const incomingAlias = remoteMember.alias.trim();
            const currentAlias = (existing.alias || '').trim();
            const incomingLooksLikeId = /^[a-f0-9]{8}$/i.test(incomingAlias);
            const currentLooksLikeId = /^[a-f0-9]{8}$/i.test(currentAlias);
            if (!incomingLooksLikeId || currentLooksLikeId || !currentAlias) {
              existing.alias = incomingAlias;
            }
          }
          if (remoteMember.publicKey) existing.publicKey = remoteMember.publicKey;
          // Store signing public key from remote (trust-on-first-use: accept if not set yet)
          if (remoteMember.signingPublicKey && !existing.signingPublicKey) {
            existing.signingPublicKey = remoteMember.signingPublicKey;
          }
          // SECURITY: Only sync role from remote if the sender is the workspace owner.
          // This prevents a rogue peer from escalating their own privileges via workspace-state sync.
          if (remoteMember.role && this.workspaceManager.isOwner(localWs.id, peerId)) {
            const validRoles = ['owner', 'admin', 'member'];
            if (validRoles.includes(remoteMember.role)) {
              existing.role = remoteMember.role;
            }
          }

          // Multi-device: sync identityId and device list
          if (remoteMember.identityId && !existing.identityId) {
            existing.identityId = remoteMember.identityId;
          }
          if (Array.isArray(remoteMember.devices) && remoteMember.devices.length > 0) {
            existing.devices = remoteMember.devices;
          }
          // Sync bot flag (self-declared by agent peers)
          if (remoteMember.isBot && !existing.isBot) {
            existing.isBot = true;
          }
          // Sync DM privacy flag (missing in legacy payload => keep current/default-allow behavior)
          if (typeof remoteMember.allowWorkspaceDMs === 'boolean') {
            existing.allowWorkspaceDMs = remoteMember.allowWorkspaceDMs;
          }
        }

        // Multi-device: populate device registry from synced member data
        if (remoteMember.identityId && Array.isArray(remoteMember.devices)) {
          for (const device of remoteMember.devices) {
            this.deviceRegistry.addDevice(remoteMember.identityId, device);
          }
        }
      }

      // Identity-based dedup: when a peer regenerates its peerId (e.g. new
      // device key, reinstall) the old member entry lingers with the stale
      // peerId.  Multiple entries for the same identityId waste maintenance
      // budget trying to reconnect to the ghost peerId.  Merge duplicates
      // keeping the entry with the most recent joinedAt.
      const byIdentity = new Map<string, typeof localWs.members[0][]>();
      for (const m of localWs.members) {
        if (!m.identityId) continue;
        let group = byIdentity.get(m.identityId);
        if (!group) { group = []; byIdentity.set(m.identityId, group); }
        group.push(m);
      }
      for (const [, group] of byIdentity) {
        if (group.length <= 1) continue;
        // Keep the most recently joined (highest joinedAt).
        group.sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0));
        const keeper = group[0];
        for (let i = 1; i < group.length; i++) {
          const stale = group[i];
          // Preserve higher role from the stale entry if keeper has lower.
          const rolePriority: Record<string, number> = { owner: 3, admin: 2, member: 1 };
          if ((rolePriority[stale.role] || 0) > (rolePriority[keeper.role] || 0)) {
            keeper.role = stale.role;
          }
          const idx = localWs.members.indexOf(stale);
          if (idx >= 0) localWs.members.splice(idx, 1);
        }
      }
    }

    // Defensive revocation fallback:
    // If owner-sent workspace-state no longer includes us, treat this as access revoked.
    // This covers cases where a member-removed event was dropped/raced.
    if (sync.members && Array.isArray(sync.members) && this.workspaceManager.isOwner(localWs.id, peerId)) {
      const remoteMemberIds = new Set(sync.members
        .map((m: any) => m?.peerId)
        .filter((id: any): id is string => typeof id === 'string'));
      const iAmLocallyMember = localWs.members.some((m: any) => m.peerId === this.state.myPeerId);
      const iAmMissingFromOwnerState = !remoteMemberIds.has(this.state.myPeerId);

      if (iAmLocallyMember && iAmMissingFromOwnerState) {
        await this.handleSelfWorkspaceRevocation(localWs.id, 'kicked', peerId);
        return;
      }
    }

    // Join validation: first authoritative workspace-state confirms provisional join.
    // Owner state is preferred, but in partially available meshes the inviter can be
    // offline while another already-member peer provides a valid state snapshot.
    if (this.pendingJoinValidationTimers.has(localWs.id)) {
      const iAmMember = localWs.members.some((m: any) => m.peerId === this.state.myPeerId);
      const senderIsKnownMember = localWs.members.some((m: any) => m.peerId === peerId);
      const hasOwnerInState = localWs.members.some((m: any) => m.role === 'owner');
      const hasChannels = Array.isArray(localWs.channels) && localWs.channels.length > 0;
      const ownerValidated = this.workspaceManager.isOwner(localWs.id, peerId);
      const memberSnapshotValidated = senderIsKnownMember && hasOwnerInState && hasChannels;
      if (iAmMember && (ownerValidated || memberSnapshotValidated)) {
        this.markJoinValidated(localWs.id);
      }
    }

    const afterFingerprint = buildWorkspaceStateFingerprint(
      localWs.id,
      this.buildWorkspaceStateSnapshotForFingerprint(localWs),
    );
    const workspaceStateChanged = beforeFingerprint !== afterFingerprint;
    if (!workspaceStateChanged) {
      return;
    }

    // Reconcile connectivity after workspace-state merge.
    // IMPORTANT: don't fan out connect() to every member here — in larger workspaces
    // that creates a reconnect storm and UI churn. Use the maintenance selector
    // (desired peers + per-peer cooldown) and rate-limit sweeps.
    const shouldSweepNow = this.state.activeWorkspaceId === localWs.id || this.pendingJoinValidationTimers.has(localWs.id);
    if (shouldSweepNow) {
      const now = Date.now();
      const lastSweepAt = this.workspaceStateConnectSweepAt.get(localWs.id) ?? 0;
      if (now - lastSweepAt >= ChatController.WORKSPACE_STATE_CONNECT_SWEEP_MIN_MS) {
        this.workspaceStateConnectSweepAt.set(localWs.id, now);
        this.runPeerMaintenanceNow('workspace-state-sync');
      }
    }

    localWs.shell = this.buildWorkspaceShell(localWs);
    this.publicWorkspaceController.ingestWorkspaceSnapshot(localWs);

    // Persist updated workspace state
    await this.persistWorkspace(localWs.id);
    this.recordManifestDomain('workspace-manifest', localWs.id, {
      operation: 'update',
      subject: localWs.id,
      itemCount: 1,
      data: { name: localWs.name, description: localWs.description },
    });
    this.recordManifestDomain('membership', localWs.id, {
      operation: 'update',
      subject: localWs.id,
      itemCount: localWs.members.length,
      data: { memberCount: localWs.members.length },
    });
    this.recordManifestDomain('channel-manifest', localWs.id, {
      operation: 'update',
      subject: localWs.id,
      itemCount: localWs.channels.length,
      data: { channelCount: localWs.channels.length },
    });
    this.ui?.renderApp();
    perfLog.debug(`handleWorkspaceStateSync(${peerId.slice(0,8)}): ${(performance.now()-_wst0).toFixed(1)}ms`);

    // Channel remaps and membership updates can land after an initial reconnect sync
    // request has already started. Ask for one follow-up sync; requestMessageSync
    // coalesces in-flight calls and runs one rerun if needed.
    this.requestMessageSync(peerId).catch((error) => {
      console.warn('[Sync] Post-workspace-state message sync failed:', error);
    });

    // If we are the owner, send back our full workspace state so the joiner
    // gets all channels/members (their provisional workspace only has #general).
    if (this.workspaceManager.isOwner(localWs.id, this.state.myPeerId)) {
      this.sendWorkspaceState(peerId, localWs.id);
    }
  }

  /**
   * DEP-002: Try to connect to high-ranked servers we're not yet connected to
   */
  private async connectToDiscoveredServers(discovery: ServerDiscovery): Promise<void> {
    const ranked = discovery.getRankedServers();
    const currentServers = this.transport.getSignalingStatus().map((s: { url: string }) => s.url);

    // Try to connect to top 3 servers we're not connected to
    let attempted = 0;
    for (const server of ranked) {
      if (attempted >= 3) break;
      if (currentServers.includes(server.url)) continue;

      attempted++;
      // Don't await - connect in background
      this.transport.addSignalingServer(server.url, `PEX:${server.url}`).then((success: boolean) => {
        if (success) {
          discovery.recordSuccess(server.url, 100); // Assume 100ms latency for now
          this.saveServerDiscovery(discovery.toJSON().workspaceId);
        } else {
          discovery.recordFailure(server.url);
          this.saveServerDiscovery(discovery.toJSON().workspaceId);
        }
      });
    }
  }

  // =========================================================================
  // DEP-002: Peer Exchange (PEX)
  // =========================================================================

  /**
   * Get or create ServerDiscovery for a workspace
   */
  private getServerDiscovery(workspaceId: string, primaryServer: string): ServerDiscovery {
    if (!this.serverDiscovery.has(workspaceId)) {
      const discovery = new ServerDiscovery(workspaceId, primaryServer);
      this.serverDiscovery.set(workspaceId, discovery);
    }
    return this.serverDiscovery.get(workspaceId)!;
  }

  /**
   * Start periodic PEX broadcasts (every 5 minutes)
   */
  startPEXBroadcasts(): void {
    if (this.pexBroadcastInterval) return;

    const broadcastPEX = () => {
      for (const [workspaceId, discovery] of this.serverDiscovery) {
        const servers = discovery.getHandshakeServers();
        if (servers.length === 0) continue;

        // Broadcast to all connected peers in this workspace
        const connectedPeers = Array.from(this.state.connectedPeers);
        for (const peerId of connectedPeers) {
          this.transport.send(peerId, {
            type: 'workspace-sync',
            workspaceId,
            sync: {
              type: 'peer-exchange',
              servers,
            },
          });
        }
      }
    };

    // Broadcast every 5 minutes
    this.pexBroadcastInterval = window.setInterval(broadcastPEX, 5 * 60 * 1000);
    chatLog.info('[PEX] Started periodic broadcasts (every 5 minutes)');
  }

  /**
   * Stop periodic PEX broadcasts
   */
  stopPEXBroadcasts(): void {
    if (this.pexBroadcastInterval) {
      clearInterval(this.pexBroadcastInterval);
      this.pexBroadcastInterval = null;
    }
    // Also stop maintenance timers
    if (this._quotaCheckInterval) {
      clearInterval(this._quotaCheckInterval);
      this._quotaCheckInterval = null;
    }
    if (this._peerMaintenanceInterval) {
      clearInterval(this._peerMaintenanceInterval);
      this._peerMaintenanceInterval = null;
    }
    if (this._gossipCleanupInterval) {
      clearInterval(this._gossipCleanupInterval);
      this._gossipCleanupInterval = null;
    }
  }

  // =========================================================================
  // T2.4: Storage Quota Management
  // =========================================================================

  /**
   * Check current storage usage and auto-prune if needed.
   * Call once on startup and every 24h thereafter.
   */
  async checkStorageQuota(): Promise<void> {
    const status = await this.storageQuota.check();
    if (!status.isPruneNeeded && !status.isWarning) return;

    const usedPct = Math.round(status.usageFraction * 100);

    if (status.isPruneNeeded) {
      console.warn(`[StorageQuota] Usage at ${usedPct}% — auto-pruning old messages`);
      const result = await this.storageQuota.prune(this.persistentStore, this.workspaceManager);
      if (result.messagesDeleted > 0) {
        const used = StorageQuotaManager.formatBytes(status.usageBytes);
        const quota = StorageQuotaManager.formatBytes(status.quotaBytes);
        this.ui?.showToast(
          `Storage was ${usedPct}% full (${used}/${quota}). Pruned ${result.messagesDeleted} old messages across ${result.channelsPruned} channel(s).`,
          'info',
        );
      }
    } else if (status.isWarning) {
      const used = StorageQuotaManager.formatBytes(status.usageBytes);
      const quota = StorageQuotaManager.formatBytes(status.quotaBytes);
      console.warn(`[StorageQuota] Usage at ${usedPct}% — approaching limit (${used} / ${quota})`);
      this.ui?.showToast(
        `Storage usage is high (${usedPct}%). Consider clearing old messages in Settings.`,
        'info',
      );
    }
  }

  /** Start periodic storage quota checks (every 24h) */
  startQuotaChecks(): void {
    if (this._quotaCheckInterval) return;
    // Check immediately, then every 24 hours
    void this.checkStorageQuota();
    this._quotaCheckInterval = setInterval(() => {
      void this.checkStorageQuota();
    }, 24 * 60 * 60 * 1000);
  }

  // =========================================================================
  // T2.5: Proactive Peer Maintenance
  // =========================================================================

  /** Start the peer maintenance sweep (every 20s) */
  startPeerMaintenance(): void {
    if (this._peerMaintenanceInterval) return;
    // Defer the first sweep by 5 s so it doesn't pile onto the main thread
    // right after restoreFromStorage.  Subsequent sweeps run every 20 s.
    setTimeout(() => this._runPeerMaintenance(), 5_000);
    this._peerMaintenanceInterval = setInterval(() => {
      this._runPeerMaintenance();
    }, 20_000);
  }

  /**
   * Run the heavy post-connect work for a peer (retry unacked, flush offline
   * queue, sync, manifest exchange, etc.).  Extracted so it can be deferred
   * when connections arrive before restoreFromStorage completes.
   */
  private _runPostConnectWork(peerId: string, burstIndex: number, shouldRunRetryUnacked: boolean): void {
    const _pcTag = peerId.slice(0, 8);
    const _pcT0 = performance.now();
    perfLog.debug(`_runPostConnectWork(${_pcTag}): START burstIndex=${burstIndex} retryUnacked=${shouldRunRetryUnacked}`);
    // Fire-and-forget: chain retry → flush → gossip sequentially but
    // don't block the rest of the handshake handler.
    const postConnectStaggerMs = burstIndex * (ChatController.HANDSHAKE_BURST_STAGGER_MS / 2);
    const postConnectWork = (async () => {
      if (postConnectStaggerMs > 0) {
        perfLog.debug(`_runPostConnectWork(${_pcTag}): staggering ${postConnectStaggerMs}ms`);
        await new Promise<void>(r => setTimeout(r, postConnectStaggerMs));
        if (!this.state.readyPeers.has(peerId)) { perfLog.debug(`_runPostConnectWork(${_pcTag}): peer left during stagger`); return; }
      }
      if (shouldRunRetryUnacked) {
        const _t1 = performance.now();
        await this.retryUnackedOutgoingForPeer(peerId);
        perfLog.debug(`_runPostConnectWork(${_pcTag}): retryUnackedOutgoing=${(performance.now()-_t1).toFixed(1)}ms`);
      }
      const _t2 = performance.now();
      await this.flushOfflineQueue(peerId);
      perfLog.debug(`_runPostConnectWork(${_pcTag}): flushOfflineQueue=${(performance.now()-_t2).toFixed(1)}ms`);
      const _t3 = performance.now();
      await this.offerDeferredGossipIntentsToPeer(peerId);
      perfLog.debug(`_runPostConnectWork(${_pcTag}): offerDeferredGossip=${(performance.now()-_t3).toFixed(1)}ms`);
      const _t4 = performance.now();
      await this.processDeferredGossipIntentsForPeer(peerId);
      perfLog.debug(`_runPostConnectWork(${_pcTag}): processDeferredGossip=${(performance.now()-_t4).toFixed(1)}ms`);
      perfLog.debug(`_runPostConnectWork(${_pcTag}): postConnectWork TOTAL=${(performance.now()-_pcT0).toFixed(1)}ms`);
    })();
    postConnectWork.catch(err => console.warn('[PostConnect] background work failed:', (err as Error)?.message || err));

    // Heavy sync work — spread across time via burst stagger
    const heavySyncStaggerMs = burstIndex * ChatController.HANDSHAKE_BURST_STAGGER_MS;
    const runHeavySyncWork = () => {
      const _hsT0 = performance.now();
      if (!this.state.readyPeers.has(peerId)) { perfLog.debug(`_runPostConnectWork(${_pcTag}): heavySync skipped — peer left`); return; }

      const shouldRunMessageSync = Date.now() - this.lastPostConnectMessageSyncAt >= ChatController.POST_CONNECT_MESSAGE_SYNC_MIN_MS;
      if (shouldRunMessageSync) {
        this.lastPostConnectMessageSyncAt = Date.now();
        const _syncT0 = performance.now();
        this.requestMessageSync(peerId)
          .then(() => perfLog.debug(`_runPostConnectWork(${_pcTag}): requestMessageSync RESOLVED=${(performance.now()-_syncT0).toFixed(1)}ms`))
          .catch(err => console.warn('[Sync] Message sync request failed:', err));
      } else {
        perfLog.debug(`_runPostConnectWork(${_pcTag}): messageSync SKIPPED (cooldown)`);
      }

      const _t5 = performance.now();
      this.sendManifestSummary(peerId);
      perfLog.debug(`_runPostConnectWork(${_pcTag}): sendManifestSummary=${(performance.now()-_t5).toFixed(1)}ms`);
      if (shouldRunRetryUnacked) {
        const _t6 = performance.now();
        this.requestCustodyRecovery(peerId);
        perfLog.debug(`_runPostConnectWork(${_pcTag}): requestCustodyRecovery=${(performance.now()-_t6).toFixed(1)}ms`);
      }

      const activeWorkspaceId = this.state.activeWorkspaceId ?? undefined;
      if (this.shouldPushWorkspaceStateOnConnect(peerId, activeWorkspaceId)) {
        const _t7 = performance.now();
        this.sendWorkspaceState(peerId, activeWorkspaceId, { forceInclude: true });
        perfLog.debug(`_runPostConnectWork(${_pcTag}): sendWorkspaceState=${(performance.now()-_t7).toFixed(1)}ms`);
      }

      if (this.state.activeWorkspaceId) {
        const wsId = this.state.activeWorkspaceId;
        const lastShellPrefetchAt = this.workspaceShellPrefetchAt.get(wsId) ?? 0;
        if (Date.now() - lastShellPrefetchAt >= ChatController.WORKSPACE_SHELL_PREFETCH_MIN_MS) {
          this.workspaceShellPrefetchAt.set(wsId, Date.now());
          const _t8 = performance.now();
          this.requestWorkspaceShell(peerId, wsId);
          perfLog.debug(`_runPostConnectWork(${_pcTag}): requestWorkspaceShell=${(performance.now()-_t8).toFixed(1)}ms`);
          void this.prefetchWorkspaceMemberDirectory(wsId, peerId);
        }
      }
      perfLog.debug(`_runPostConnectWork(${_pcTag}): heavySync TOTAL=${(performance.now()-_hsT0).toFixed(1)}ms (stagger=${heavySyncStaggerMs}ms)`);
    };

    if (heavySyncStaggerMs > 0) {
      setTimeout(runHeavySyncWork, heavySyncStaggerMs);
    } else {
      setTimeout(runHeavySyncWork, 50);
    }
  }

  /**
   * Called once restoreFromStorage completes.  Drains the deferred post-connect
   * queue so peers that connected during restore get their heavy sync work.
   */
  private _flushDeferredPostConnectWork(): void {
    const peers = this._deferredPostConnectPeers?.splice(0) ?? [];
    perfLog.debug(`_flushDeferredPostConnectWork: ${peers.length} deferred peers`);
    for (let i = 0; i < peers.length; i++) {
      const peerId = peers[i];
      if (!this.state.readyPeers.has(peerId)) { perfLog.debug(`_flushDeferredPostConnectWork: ${peerId.slice(0,8)} no longer ready, skipping`); continue; }
      // Stagger each deferred peer by 500ms to avoid burst
      setTimeout(() => {
        if (!this.state.readyPeers.has(peerId)) return;
        perfLog.debug(`_flushDeferredPostConnectWork: running deferred work for ${peerId.slice(0, 8)} (index=${i}, delay=${i * 500}ms)`);
        this._runPostConnectWork(peerId, i, true);
      }, i * 500);
    }
  }

  private isLikelyOnlinePeer(peerId: string, joinedAt?: number, now = Date.now()): boolean {
    if (this.state.connectedPeers.has(peerId) || this.state.connectingPeers.has(peerId) || this.state.readyPeers.has(peerId)) {
      return true;
    }

    const recentlySeenAt = this.peerLastSeenAt.get(peerId) ?? 0;
    if (recentlySeenAt > 0 && now - recentlySeenAt <= ChatController.LIKELY_PEER_WINDOW_MS) {
      return true;
    }

    // Bootstrap: right after startup, assume peers are likely so we quickly reconnect once.
    if (now - this.startedAt <= ChatController.INITIAL_LIKELY_BOOTSTRAP_MS) {
      return true;
    }

    // Freshly joined members are also likely candidates for a while.
    if (joinedAt && now - joinedAt <= ChatController.LIKELY_PEER_WINDOW_MS) {
      return true;
    }

    return false;
  }

  private getTransportConnectedPeerIds(): string[] {
    if (typeof this.transport?.getConnectedPeers !== 'function') return [];
    const peers = this.transport.getConnectedPeers();
    return Array.isArray(peers)
      ? peers.filter((peerId): peerId is string => typeof peerId === 'string' && peerId.length > 0)
      : [];
  }

  private getPeerConnectionSnapshot(): PeerConnectionSnapshot {
    return {
      connected: new Set<string>(this.getTransportConnectedPeerIds()),
      connecting: new Set(this.state.connectingPeers),
      ready: new Set(this.state.readyPeers),
    };
  }

  private detectPeerSelectionDeviceClass(isMobileOverride?: boolean): PeerSelectionDeviceClass {
    if (typeof isMobileOverride === 'boolean') return isMobileOverride ? 'mobile' : 'desktop';
    if (typeof navigator === 'undefined') return 'desktop';
    const userAgent = navigator.userAgent || '';
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
    return mobile ? 'mobile' : 'desktop';
  }

  private computeTargetPeerCount(options?: { isMobile?: boolean }): number {
    return this.detectPeerSelectionDeviceClass(options?.isMobile) === 'mobile'
      ? ChatController.PARTIAL_MESH_MOBILE_TARGET
      : ChatController.PARTIAL_MESH_DESKTOP_TARGET;
  }

  private isPartialMeshEnabled(): boolean {
    try {
      const stored = globalThis.localStorage?.getItem?.('decentchat.partialMesh.enabled')
        ?? (typeof window !== 'undefined' ? window.localStorage?.getItem('decentchat.partialMesh.enabled') : null);
      if (stored === 'true' || stored === '1') return true;
      if (stored === 'false' || stored === '0') return false;
    } catch {
      // ignore storage access errors
    }

    const envFlag = (import.meta as any)?.env?.VITE_PARTIAL_MESH_ENABLED;
    if (envFlag === 'true' || envFlag === '1' || envFlag === true) return true;
    if (envFlag === 'false' || envFlag === '0' || envFlag === false) return false;

    return ChatController.PARTIAL_MESH_ENABLED;
  }

  private computeHardCap(options?: { isMobile?: boolean }): number {
    return this.detectPeerSelectionDeviceClass(options?.isMobile) === 'mobile'
      ? ChatController.PARTIAL_MESH_MOBILE_HARD_CAP
      : ChatController.PARTIAL_MESH_DESKTOP_HARD_CAP;
  }

  private computeExplorerSlotCount(options?: { isMobile?: boolean }): number {
    return this.detectPeerSelectionDeviceClass(options?.isMobile) === 'mobile'
      ? ChatController.PARTIAL_MESH_MOBILE_EXPLORER_SLOTS
      : ChatController.PARTIAL_MESH_DESKTOP_EXPLORER_SLOTS;
  }

  private computeDesiredPeerBudget(candidateCount: number, options?: { isMobile?: boolean }): number {
    const target = this.computeTargetPeerCount(options);
    const hardCap = this.computeHardCap(options);
    return Math.max(0, Math.min(candidateCount, target, hardCap));
  }

  private getSharedWorkspacePeerCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      const seen = new Set<string>();
      for (const member of workspace.members) {
        const peerId = member.peerId;
        if (!peerId || peerId === this.state.myPeerId || seen.has(peerId)) continue;
        seen.add(peerId);
        counts.set(peerId, (counts.get(peerId) ?? 0) + 1);
      }
    }
    return counts;
  }

  private getWorkspacePeerCandidates(workspaceId = this.state.activeWorkspaceId ?? '', now = Date.now()): WorkspacePeerCandidate[] {
    if (!workspaceId) return [];
    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (!ws) return [];

    const snapshot = this.getPeerConnectionSnapshot();
    const sharedWorkspaceCounts = this.getSharedWorkspacePeerCounts();

    return ws.members
      .filter((member) => member.peerId && member.peerId !== this.state.myPeerId)
      .map((member) => {
        const peerId = member.peerId;
        const capabilitySummary = this.getPeerCapabilitySummary(peerId);
        return {
          peerId,
          role: member.role as 'owner' | 'admin' | 'member',
          isBot: !!member.isBot,
          joinedAt: member.joinedAt,
          connected: snapshot.connected.has(peerId),
          connecting: snapshot.connecting.has(peerId),
          ready: snapshot.ready.has(peerId),
          likelyOnline: this.isLikelyOnlinePeer(peerId, member.joinedAt, now),
          recentlySeenAt: this.peerLastSeenAt.get(peerId) ?? 0,
          sharedWorkspaceCount: sharedWorkspaceCounts.get(peerId) ?? 1,
          connectedAt: this.peerConnectedAt.get(peerId),
          lastSyncAt: this.peerLastSuccessfulSyncAt.get(peerId),
          disconnectCount: this.peerDisconnectCount.get(peerId) ?? 0,
          lastExplorerAt: this.peerExplorerLastUsedAt.get(peerId),
          directoryShardPrefixes: capabilitySummary.directoryShardPrefixes,
          relayChannels: capabilitySummary.relayChannels,
          archiveCapable: capabilitySummary.archiveCapable,
          presenceAggregator: capabilitySummary.presenceAggregator,
        } satisfies WorkspacePeerCandidate;
      });
  }

  private scoreWorkspacePeer(candidate: WorkspacePeerCandidate, now = Date.now()): number {
    let score = 0;

    if (candidate.connected) score += candidate.ready ? 40 : 25;
    if (candidate.connecting) score += 5;
    if (candidate.likelyOnline) score += 25;

    if (candidate.recentlySeenAt > 0) {
      const age = now - candidate.recentlySeenAt;
      if (age <= 5 * 60 * 1000) score += 20;
      else if (age <= ChatController.LIKELY_PEER_WINDOW_MS) score += 10;
    }

    if (candidate.lastSyncAt && now - candidate.lastSyncAt <= ChatController.LIKELY_PEER_WINDOW_MS) {
      score += 20;
    }

    if (candidate.connectedAt && now - candidate.connectedAt >= ChatController.PARTIAL_MESH_MIN_DWELL_MS) {
      score += 10;
    }

    if (candidate.role === 'owner') score += 15;
    else if (candidate.role === 'admin') score += 10;

    score += Math.min(10, Math.max(0, candidate.sharedWorkspaceCount - 1) * 5);

    // Prefer healthy peers that advertise useful large-workspace helper capabilities.
    score += Math.min(8, candidate.directoryShardPrefixes?.length ?? 0) * 2;
    score += Math.min(6, candidate.relayChannels?.length ?? 0) * 2;
    if (candidate.archiveCapable) score += 8;
    if (candidate.presenceAggregator) score += 5;

    score -= Math.min(30, candidate.disconnectCount * 10);

    // Deprioritize bot peers — they are useful for receiving messages but
    // should not consume connection budget over human peers.  This prevents
    // company-sim agents from crowding out real user connections.
    if (candidate.isBot) score -= 20;

    return score;
  }

  private rankWorkspacePeers(candidates: WorkspacePeerCandidate[], now = Date.now()): WorkspacePeerCandidate[] {
    return [...candidates].sort((a, b) => {
      const scoreDelta = this.scoreWorkspacePeer(b, now) - this.scoreWorkspacePeer(a, now);
      if (scoreDelta !== 0) return scoreDelta;

      const roleWeight = (candidate: WorkspacePeerCandidate): number =>
        candidate.role === 'owner' ? 2 : (candidate.role === 'admin' ? 1 : 0);
      const roleDelta = roleWeight(b) - roleWeight(a);
      if (roleDelta !== 0) return roleDelta;

      const sharedDelta = (b.sharedWorkspaceCount ?? 0) - (a.sharedWorkspaceCount ?? 0);
      if (sharedDelta !== 0) return sharedDelta;

      const seenDelta = (b.recentlySeenAt ?? 0) - (a.recentlySeenAt ?? 0);
      if (seenDelta !== 0) return seenDelta;

      return (a.peerId || '').localeCompare(b.peerId || '');
    });
  }

  private pickAnchorPeers(candidates: WorkspacePeerCandidate[], count: number, now = Date.now()): WorkspacePeerCandidate[] {
    if (count <= 0) return [];

    const ranked = [...candidates].sort((a, b) => {
      const roleWeight = (candidate: WorkspacePeerCandidate): number =>
        candidate.role === 'owner' ? 2 : (candidate.role === 'admin' ? 1 : 0);
      const roleDelta = roleWeight(b) - roleWeight(a);
      if (roleDelta !== 0) return roleDelta;

      const scoreDelta = this.scoreWorkspacePeer(b, now) - this.scoreWorkspacePeer(a, now);
      if (scoreDelta !== 0) return scoreDelta;

      return (a.peerId || '').localeCompare(b.peerId || '');
    });

    return ranked.slice(0, count);
  }

  private pickExplorerPeers(
    candidates: WorkspacePeerCandidate[],
    selectedPeerIds: Set<string>,
    count: number,
    now = Date.now(),
  ): WorkspacePeerCandidate[] {
    if (count <= 0) return [];

    const pool = candidates.filter((candidate) => !selectedPeerIds.has(candidate.peerId));
    const ranked = [...pool].sort((a, b) => {
      const aLast = a.lastExplorerAt ?? 0;
      const bLast = b.lastExplorerAt ?? 0;
      const explorerDelta = aLast - bLast;
      if (explorerDelta !== 0) return explorerDelta;

      const likelyDelta = Number(b.likelyOnline) - Number(a.likelyOnline);
      if (likelyDelta !== 0) return likelyDelta;

      const scoreDelta = this.scoreWorkspacePeer(b, now) - this.scoreWorkspacePeer(a, now);
      if (scoreDelta !== 0) return scoreDelta;

      return (a.peerId || '').localeCompare(b.peerId || '');
    });

    return ranked.slice(0, count);
  }

  private shouldKeepIncumbent(
    incumbent: WorkspacePeerCandidate,
    challenger?: WorkspacePeerCandidate,
    now = Date.now(),
  ): boolean {
    if (!incumbent.connected) return false;

    const connectedAt = incumbent.connectedAt ?? 0;
    if (connectedAt > 0 && now - connectedAt < ChatController.PARTIAL_MESH_MIN_DWELL_MS) {
      return true;
    }

    if (!challenger) return false;

    const incumbentScore = this.scoreWorkspacePeer(incumbent, now);
    const challengerScore = this.scoreWorkspacePeer(challenger, now);
    return challengerScore < incumbentScore + ChatController.PARTIAL_MESH_REPLACE_THRESHOLD;
  }

  private selectDesiredPeers(
    workspaceId = this.state.activeWorkspaceId ?? '',
    now = Date.now(),
    options?: { isMobile?: boolean; emitTopologyEvents?: boolean },
  ): DesiredPeerSelection {
    const candidates = this.getWorkspacePeerCandidates(workspaceId, now);
    const budget = this.computeDesiredPeerBudget(candidates.length, options);
    if (budget <= 0) {
      return { anchors: [], core: [], explorers: [], desiredPeerIds: [], budget: 0 };
    }

    const anchorCount = Math.min(ChatController.PARTIAL_MESH_ANCHOR_SLOTS, budget);
    const anchors = this.pickAnchorPeers(candidates, anchorCount, now);
    const selectedPeerIds = new Set(anchors.map((candidate) => candidate.peerId));

    const explorerBudget = Math.max(0, budget - anchors.length);
    const explorerCount = Math.min(this.computeExplorerSlotCount(options), explorerBudget);
    let explorers = this.pickExplorerPeers(candidates, selectedPeerIds, explorerCount, now);
    for (const explorer of explorers) selectedPeerIds.add(explorer.peerId);

    const coreBudget = Math.max(0, budget - anchors.length - explorers.length);
    let core = this.rankWorkspacePeers(
      candidates.filter((candidate) => !selectedPeerIds.has(candidate.peerId)),
      now,
    ).slice(0, coreBudget);

    let desired = [...anchors, ...core, ...explorers];
    const nonAnchorIncumbents = this.rankWorkspacePeers(
      candidates.filter((candidate) => candidate.connected && !desired.some((selected) => selected.peerId === candidate.peerId)),
      now,
    );

    for (const incumbent of nonAnchorIncumbents) {
      const replaceable = [...core, ...explorers]
        .sort((a, b) => {
          const connectedDelta = Number(a.connected) - Number(b.connected);
          if (connectedDelta !== 0) return connectedDelta;
          return this.scoreWorkspacePeer(a, now) - this.scoreWorkspacePeer(b, now);
        })[0];

      if (!replaceable) break;
      if (!this.shouldKeepIncumbent(incumbent, replaceable, now)) continue;

      if (options?.emitTopologyEvents) {
        this.recordTopologyPeerEvent({
          level: 'debug',
          workspaceId,
          peerId: replaceable.peerId,
          event: 'skipped-incumbent-protection',
          reason: `incumbent ${incumbent.peerId} protected against ${replaceable.peerId}`,
          sharedWorkspaceCount: replaceable.sharedWorkspaceCount,
          score: this.scoreWorkspacePeer(replaceable, now),
          connected: replaceable.connected,
          connecting: replaceable.connecting,
          ready: replaceable.ready,
          likelyOnline: replaceable.likelyOnline,
          disconnectCount: replaceable.disconnectCount,
          connectedAt: replaceable.connectedAt,
          lastSyncAt: replaceable.lastSyncAt,
        });
      }

      if (core.some((candidate) => candidate.peerId === replaceable.peerId)) {
        core = core.filter((candidate) => candidate.peerId !== replaceable.peerId);
        core.push(incumbent);
      } else {
        explorers = explorers.filter((candidate) => candidate.peerId !== replaceable.peerId);
        explorers.push(incumbent);
      }

      desired = [...anchors, ...core, ...explorers];
    }

    const desiredPeerIds = desired.map((candidate) => candidate.peerId);
    return { anchors, core, explorers, desiredPeerIds, budget };
  }

  private markExplorerSelections(explorers: WorkspacePeerCandidate[], now = Date.now()): void {
    for (const explorer of explorers) {
      const lastUsedAt = this.peerExplorerLastUsedAt.get(explorer.peerId) ?? 0;
      if (lastUsedAt <= 0 || now - lastUsedAt >= ChatController.PARTIAL_MESH_EXPLORER_ROTATION_MS) {
        this.peerExplorerLastUsedAt.set(explorer.peerId, now);
      }
    }
  }

  private selectConservativePrunePeers(
    candidates: WorkspacePeerCandidate[],
    desiredSelection: DesiredPeerSelection,
    connectedPeers: Set<string>,
    now = Date.now(),
  ): WorkspacePeerCandidate[] {
    if (connectedPeers.size <= Math.max(desiredSelection.budget, ChatController.PARTIAL_MESH_MIN_SAFE_PEERS)) {
      return [];
    }

    const desiredSet = new Set(desiredSelection.desiredPeerIds);
    const pruneableCount = connectedPeers.size - Math.max(desiredSelection.budget, ChatController.PARTIAL_MESH_MIN_SAFE_PEERS);
    if (pruneableCount <= 0) return [];

    const prunePool = candidates
      .filter((candidate) => connectedPeers.has(candidate.peerId))
      .filter((candidate) => !desiredSet.has(candidate.peerId))
      .filter((candidate) => candidate.sharedWorkspaceCount <= 1)
      .filter((candidate) => {
        if (!candidate.connectedAt) return true;
        return now - candidate.connectedAt >= ChatController.PARTIAL_MESH_MIN_DWELL_MS;
      });

    return [...prunePool]
      .sort((a, b) => {
        const likelyDelta = Number(a.likelyOnline) - Number(b.likelyOnline);
        if (likelyDelta !== 0) return likelyDelta;

        const readyDelta = Number(a.ready) - Number(b.ready);
        if (readyDelta !== 0) return readyDelta;

        const scoreDelta = this.scoreWorkspacePeer(a, now) - this.scoreWorkspacePeer(b, now);
        if (scoreDelta !== 0) return scoreDelta;

        const sharedDelta = (a.sharedWorkspaceCount ?? 0) - (b.sharedWorkspaceCount ?? 0);
        if (sharedDelta !== 0) return sharedDelta;

        return (a.peerId || '').localeCompare(b.peerId || '');
      })
      .slice(0, pruneableCount);
  }

  private getActiveWorkspacePeerStats(now = Date.now()): {
    totalPeers: number;
    likelyPeers: string[];
    coldPeers: string[];
    connectedPeers: string[];
  } {
    const ws = this.state.activeWorkspaceId
      ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)
      : null;
    if (!ws) {
      return { totalPeers: 0, likelyPeers: [], coldPeers: [], connectedPeers: [] };
    }

    const connectedSet = new Set<string>(this.getTransportConnectedPeerIds());
    const likelyPeers: string[] = [];
    const coldPeers: string[] = [];
    const connectedPeers: string[] = [];

    for (const member of ws.members) {
      const peerId = member.peerId;
      if (!peerId || peerId === this.state.myPeerId) continue;

      if (connectedSet.has(peerId)) connectedPeers.push(peerId);
      if (this.isLikelyOnlinePeer(peerId, member.joinedAt, now)) likelyPeers.push(peerId);
      else coldPeers.push(peerId);
    }

    return {
      totalPeers: likelyPeers.length + coldPeers.length,
      likelyPeers,
      coldPeers,
      connectedPeers,
    };
  }

  /** Number of known workspace peers (excluding self) across all workspaces. */
  getExpectedWorkspacePeerCount(): number {
    const peerIds = new Set<string>();
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      for (const member of ws.members) {
        if (member.peerId && member.peerId !== this.state.myPeerId) {
          peerIds.add(member.peerId);
        }
      }
    }
    return peerIds.size;
  }

  /** Sidebar reconnect banner model (best-effort heuristics). */
  getConnectionStatus(): ConnectionStatusModel {
    const browserOnline = typeof window === 'undefined'
      ? true
      : (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? navigator.onLine : true);

    const signalingStatus = typeof this.transport.getSignalingStatus === 'function'
      ? this.transport.getSignalingStatus()
      : [];
    const signalingConnectedCount = signalingStatus.filter((s: any) => !!s.connected).length;
    const signalingConnected = signalingStatus.length === 0 || signalingConnectedCount > 0;

    if (!browserOnline) {
      return {
        showBanner: true,
        level: 'offline',
        message: 'You are offline',
        detail: 'Reconnect to the internet, then press Retry.',
      };
    }

    if (!signalingConnected) {
      return {
        showBanner: true,
        level: 'offline',
        message: 'Disconnected from signaling',
        detail: 'Peer discovery is down. Press Retry to reconnect.',
      };
    }

    const now = Date.now();
    const stats = this.getActiveWorkspacePeerStats(now);
    const connected = stats.connectedPeers.length;
    const likely = stats.likelyPeers.length;
    const connectingLikely = stats.likelyPeers.filter((peerId) => this.state.connectingPeers.has(peerId)).length;

    if (this.isPartialMeshEnabled() && this.state.activeWorkspaceId) {
      const selection = this.selectDesiredPeers(this.state.activeWorkspaceId, now);
      if (selection.budget > 0) {
        const desiredSet = new Set(selection.desiredPeerIds);
        const connectedDesiredCount = stats.connectedPeers.filter((peerId) => desiredSet.has(peerId)).length;
        const connectingDesiredCount = selection.desiredPeerIds.filter((peerId) => this.state.connectingPeers.has(peerId)).length;
        const missingDesired = Math.max(0, selection.budget - connectedDesiredCount);

        const debug = {
          partialMeshEnabled: true,
          desiredPeerCount: selection.budget,
          connectedDesiredPeerCount: connectedDesiredCount,
          connectingDesiredPeerCount: connectingDesiredCount,
          connectedPeerCount: connected,
          likelyPeerCount: likely,
          coldPeerCount: stats.coldPeers.length,
          desiredPeers: selection.desiredPeerIds,
          anchors: selection.anchors.map((candidate) => candidate.peerId),
          explorers: selection.explorers.map((candidate) => candidate.peerId),
          topology: this.getTopologyDebugSnapshot(this.state.activeWorkspaceId ?? ''),
        };

        if (connectedDesiredCount >= selection.budget) {
          return {
            showBanner: false,
            level: 'info',
            message: `Connected ${connectedDesiredCount}/${selection.budget} desired peers`,
            detail: 'Topology is healthy.',
            debug,
          };
        }

        if (connectedDesiredCount > 0 || connectingDesiredCount > 0) {
          return {
            showBanner: true,
            level: connectingDesiredCount > 0 ? 'info' : 'warning',
            message: `Connected ${connectedDesiredCount}/${selection.budget} desired peers`,
            detail: connectingDesiredCount > 0
              ? `Reconnecting to ${missingDesired} desired peer(s); ${connectingDesiredCount} in flight.`
              : `Missing ${missingDesired} desired peer(s). Press Retry to reconnect.`,
            debug,
          };
        }

        return {
          showBanner: true,
          level: 'warning',
          message: `Connected 0/${selection.budget} desired peers`,
          detail: `Trying ${connectingLikely}/${Math.max(likely, selection.budget)} likely peer(s).`,
          debug,
        };
      }
    }

    // If at least one peer is connected, keep UI calm by default.
    if (connected > 0) {
      return {
        showBanner: false,
        level: 'info',
        message: '',
      };
    }

    // Nobody connected. Only warn when there are likely-online peers to recover.
    if (likely > 0) {
      return {
        showBanner: true,
        level: connectingLikely > 0 ? 'info' : 'warning',
        message: connectingLikely > 0 ? 'Reconnecting…' : 'No peers connected',
        detail: connectingLikely > 0
          ? `Trying ${connectingLikely}/${likely} likely peer(s).`
          : `Expected ${likely} likely peer(s) online. Press Retry to reconnect.`,
      };
    }

    // All peers look cold/offline — avoid noisy banner.
    return {
      showBanner: false,
      level: 'info',
      message: '',
    };
  }

  /** Manual reconnect action for the sidebar Retry button. */
  async retryReconnectNow(): Promise<{ attempted: number; reinitialized: boolean }> {
    const firstAttempt = this.runPeerMaintenanceNow('user-retry');
    const noPeersConnected = this.getTransportConnectedPeerIds().length === 0;
    const reinitialized = (firstAttempt === 0 || noPeersConnected)
      ? await this.reinitializeTransportIfStuck('user-retry')
      : false;

    const secondAttempt = (reinitialized || firstAttempt > 0)
      ? 0
      : this.runPeerMaintenanceNow('user-retry-post');

    this.ui?.updateSidebar({ refreshContacts: false });
    return {
      attempted: firstAttempt + secondAttempt,
      reinitialized,
    };
  }

  /** Public one-shot maintenance hook for startup/resume reconnect bootstrap. */
  runPeerMaintenanceNow(reason = 'manual'): number {
    const attempted = this._runPeerMaintenance(reason);
    if (attempted > 0) {
      chatLog.info(`[Maintenance] ${reason}: attempted reconnect to ${attempted} peer(s)`);
    }
    return attempted;
  }

  /**
   * Safety fallback: if signaling appears fully down after startup/resume,
   * reinitialize the transport once with cooldown to avoid reconnect storms.
   */
  async reinitializeTransportIfStuck(reason = 'manual'): Promise<boolean> {
    if (this.transportReinitInFlight) return this.transportReinitInFlight;
    const now = Date.now();
    if (now - this.lastTransportReinitAt < 15_000) return false;

    this.transportReinitInFlight = (async () => {
      this.lastTransportReinitAt = Date.now();
      try {
        const connectedPeers = this.getTransportConnectedPeerIds().length;
        if (connectedPeers > 0) return false;

        const signalingStatus = typeof this.transport.getSignalingStatus === 'function'
          ? this.transport.getSignalingStatus()
          : [];
        const noSignalingInstances = signalingStatus.length === 0;
        const allSignalingDown = signalingStatus.length > 0 && signalingStatus.every((s: any) => !s.connected);
        if (!noSignalingInstances && !allSignalingDown) return false;

        console.warn(`[Reconnect] Reinitializing transport (${reason})`);
        await this.recreateTransportAndInit(this.state.myPeerId || undefined, `stuck:${reason}`);
        this.runPeerMaintenanceNow(`post-reinit:${reason}`);
        return true;
      } catch (error) {
        console.warn('[Reconnect] Transport reinit failed:', (error as Error).message);
        return false;
      } finally {
        this.transportReinitInFlight = null;
      }
    })();

    return this.transportReinitInFlight;
  }

  // =========================================================================
  // T3.2: Gossip Propagation
  // =========================================================================

  /**
   * Relay a received workspace message to connected peers who might not have
   * received it from the original sender (partial mesh scenario).
   *
   * Strategy:
   *   - Re-encrypt the plaintext for each eligible relay target
   *   - Include _originalMessageId so recipients can dedup
   *   - Limit depth with GOSSIP_TTL (default: 2 hops)
   *
   * Overhead in full mesh: near-zero (every peer is already directly connected
   * to the sender; no session established with relay → skipped). CRDT dedup
   * handles the rare duplicate if two paths both deliver the same message.
   */
  private async buildGossipOriginPayload(params: {
    messageId: string;
    channelId: string;
    content: string;
    threadId?: string;
    replyToId?: string;
  }): Promise<string> {
    const data = new TextEncoder().encode(params.content);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const hashBytes = Array.from(new Uint8Array(digest));
    const contentHash = hashBytes.map((b) => b.toString(16).padStart(2, '0')).join('');
    return `v1|${params.messageId}|${params.channelId}|${params.threadId ?? ''}|${params.replyToId ?? ''}|${contentHash}`;
  }

  private async signGossipOrigin(params: {
    messageId: string;
    channelId: string;
    content: string;
    threadId?: string;
    replyToId?: string;
  }): Promise<string | undefined> {
    if (!this.messageProtocol || typeof (this.messageProtocol as any).signData !== 'function') {
      return undefined;
    }
    const payload = await this.buildGossipOriginPayload(params);
    return (this.messageProtocol as any).signData(payload);
  }

  private async resolveInboundSenderId(
    peerId: string,
    envelope: any,
    channelId: string,
    messageId: string,
    content: string,
  ): Promise<{ senderId: string; allowRelay: boolean; verifiedGossipOrigin: boolean }> {
    const gossipSender = typeof envelope._gossipOriginalSender === 'string' && envelope._gossipOriginalSender.length > 0
      ? envelope._gossipOriginalSender
      : undefined;
    if (!gossipSender || gossipSender === peerId) {
      return { senderId: peerId, allowRelay: true, verifiedGossipOrigin: false };
    }

    const originSignature = typeof envelope._gossipOriginSignature === 'string' && envelope._gossipOriginSignature.length > 0
      ? envelope._gossipOriginSignature
      : undefined;
    if (!originSignature || !this.messageProtocol || typeof (this.messageProtocol as any).verifyData !== 'function') {
      console.warn(`[Security] Unsigned gossip origin claim ${gossipSender.slice(0, 8)} via ${peerId.slice(0, 8)} for ${messageId.slice(0, 8)}; attributing to relay`);
      return { senderId: peerId, allowRelay: false, verifiedGossipOrigin: false };
    }

    let isValid = false;
    try {
      const payload = await this.buildGossipOriginPayload({
        messageId,
        channelId,
        content,
        threadId: typeof envelope.threadId === 'string' ? envelope.threadId : undefined,
        replyToId: typeof envelope.replyToId === 'string' ? envelope.replyToId : undefined,
      });
      isValid = await (this.messageProtocol as any).verifyData(
        payload,
        originSignature,
        gossipSender,
      );
    } catch {
      isValid = false;
    }
    if (!isValid) {
      console.warn(`[Security] Invalid gossip origin signature ${gossipSender.slice(0, 8)} via ${peerId.slice(0, 8)} for ${messageId.slice(0, 8)}; attributing to relay`);
      return { senderId: peerId, allowRelay: false, verifiedGossipOrigin: false };
    }
    return { senderId: gossipSender, allowRelay: true, verifiedGossipOrigin: true };
  }

  private buildDeferredGossipRelayPayload(
    originalMsgId: string,
    originalSenderId: string,
    plaintext: string,
    channelId: string,
    workspaceId: string | null,
    hop: number,
    envelope: any,
  ): any {
    return {
      _deferred: true,
      _gossipDeferred: true,
      content: plaintext,
      channelId,
      workspaceId,
      threadId: envelope.threadId,
      vectorClock: envelope.vectorClock,
      messageId: originalMsgId,
      metadata: envelope.metadata,
      attachments: envelope.attachments,
      threadRootSnapshot: envelope.threadRootSnapshot,
      _originalMessageId: originalMsgId,
      _gossipOriginalSender: originalSenderId,
      _gossipHop: hop,
      _gossipOriginSignature: envelope._gossipOriginSignature,
    };
  }

  private async queueDeferredGossipRelay(
    targetPeerId: string,
    originalMsgId: string,
    originalSenderId: string,
    plaintext: string,
    channelId: string,
    workspaceId: string | null,
    hop: number,
    envelope: any,
  ): Promise<void> {
    await this.offlineQueue.enqueue(
      targetPeerId,
      this.buildDeferredGossipRelayPayload(originalMsgId, originalSenderId, plaintext, channelId, workspaceId, hop, envelope),
      {
        opId: originalMsgId,
        domain: 'channel-message',
        ...(workspaceId ? { workspaceId } : {}),
        channelId,
        ...(envelope.threadId ? { threadId: envelope.threadId } : {}),
        recipientPeerIds: [targetPeerId],
      },
    );
  }

  private finalizeGossipRelayEnvelope(
    relayEnv: any,
    originalMsgId: string,
    originalSenderId: string,
    channelId: string,
    workspaceId: string | null,
    hop: number,
    envelope: any,
  ): any {
    (relayEnv as any).messageId = originalMsgId;             // canonical ID — ensures all peers store same msg.id for reaction sync
    (relayEnv as any).channelId = channelId;
    (relayEnv as any).workspaceId = workspaceId;
    (relayEnv as any).threadId = envelope.threadId;
    (relayEnv as any).vectorClock = envelope.vectorClock;
    if (envelope.metadata) {
      (relayEnv as any).metadata = envelope.metadata;
    }
    if (envelope.attachments?.length) {
      (relayEnv as any).attachments = envelope.attachments;  // carry thumbnail + metadata through relay hops
    }
    if (envelope.threadRootSnapshot) {
      (relayEnv as any).threadRootSnapshot = envelope.threadRootSnapshot;  // carry thread root through relay
    }
    (relayEnv as any)._originalMessageId = originalMsgId;    // dedup key (checked before decryption)
    (relayEnv as any)._gossipOriginalSender = originalSenderId; // real author
    (relayEnv as any)._gossipHop = hop;
    if (typeof envelope._gossipOriginSignature === 'string' && envelope._gossipOriginSignature.length > 0) {
      (relayEnv as any)._gossipOriginSignature = envelope._gossipOriginSignature;
    }
    return relayEnv;
  }

  private async _gossipRelay(
    fromPeerId: string,
    originalMsgId: string,
    originalSenderId: string,
    plaintext: string,
    channelId: string,
    envelope: any,
  ): Promise<void> {
    if (!this.messageProtocol) return;

    const hop = (envelope._gossipHop ?? 0) + 1;
    if (hop > ChatController.GOSSIP_TTL) return;

    // Fix #4: look up the workspace the message belongs to, not just the active one.
    // A background workspace message should still be relayed correctly.
    // NOTE: do NOT fall back to '' — empty string is falsy but serializes as '""' on the wire,
    // which confuses the receiver's isDirect detection. Use null so the property is absent/null.
    const workspaceId: string | null = (envelope.workspaceId as string | undefined | null)
      ?? this.state.activeWorkspaceId
      ?? null;
    const ws = workspaceId ? this.workspaceManager.getWorkspace(workspaceId) : null;
    if (!ws) return;

    const connectedPeers = new Set<string>(this.getTransportConnectedPeerIds());

    for (const member of ws.members) {
      const targetPeerId = member.peerId;
      if (targetPeerId === this.state.myPeerId) continue;  // skip self
      if (targetPeerId === fromPeerId) continue;           // don't send back to relay source
      if (targetPeerId === originalSenderId) continue;     // don't send back to original author

      try {
        if (!connectedPeers.has(targetPeerId)) {
          const hasRatchet = typeof this.messageProtocol.hasRatchetState === 'function'
            ? this.messageProtocol.hasRatchetState(targetPeerId)
            : false;
          if (!hasRatchet && typeof this.messageProtocol.restoreRatchetState === 'function') {
            await this.messageProtocol.restoreRatchetState(targetPeerId);
          }
        }

        const relayEnv = this.finalizeGossipRelayEnvelope(
          await this.encryptMessageWithPreKeyBootstrap(targetPeerId, plaintext, workspaceId ?? undefined),
          originalMsgId,
          originalSenderId,
          channelId,
          workspaceId,
          hop,
          envelope,
        );

        if (connectedPeers.has(targetPeerId)) {
          const sent = this.transport.send(targetPeerId, relayEnv);
          if (sent !== false) continue;
        }

        await this.queueCustodyEnvelope(targetPeerId, {
          envelopeId: typeof (relayEnv as any).id === 'string' ? (relayEnv as any).id : undefined,
          opId: originalMsgId,
          recipientPeerIds: [targetPeerId],
          workspaceId: workspaceId ?? ws.id,
          channelId,
          ...(envelope.threadId ? { threadId: envelope.threadId } : {}),
          domain: 'channel-message',
          ciphertext: relayEnv,
          metadata: {
            messageId: originalMsgId,
            senderId: originalSenderId,
          },
        }, relayEnv);

        if (workspaceId) {
          await this.replicateToCustodians(targetPeerId, {
            workspaceId,
            channelId,
            opId: originalMsgId,
            domain: 'channel-message',
          });
        }
      } catch {
        const intent = this.buildDeferredGossipIntent(
          targetPeerId,
          originalMsgId,
          originalSenderId,
          plaintext,
          channelId,
          workspaceId,
          hop,
          envelope,
        );
        await this.storeDeferredGossipIntent(intent);
        await this.replicateDeferredGossipIntentToCustodians(intent);
        if (this.state.readyPeers.has(targetPeerId)) {
          await this.processDeferredGossipIntentsForPeer(targetPeerId);
        }
      }
    }
  }

  /** Start cleanup sweep for the gossip seen-set (every 5 minutes) */
  startGossipCleanup(): void {
    if (this._gossipCleanupInterval) return;
    const FIVE_MIN = 5 * 60 * 1000;
    this._gossipCleanupInterval = setInterval(() => {
      const cutoff = Date.now() - FIVE_MIN;
      for (const [id, ts] of this._gossipSeen) {
        if (ts < cutoff) this._gossipSeen.delete(id);
      }
      for (const [id, route] of this._gossipReceiptRoutes) {
        if (route.timestamp < cutoff) this._gossipReceiptRoutes.delete(id);
      }
      void this.pruneExpiredDeferredGossipIntents();
    }, FIVE_MIN);
  }

  // =========================================================================
  // Workspace Peer Registry (signaling server discovery)
  // =========================================================================

  /**
   * Build the HTTP base URL of the signaling server for workspace registry API.
   * Converts ws:// → http:// and wss:// → https://.
   */
  private getSignalingHttpBase(): string {
    const signalingStatus = typeof this.transport.getSignalingStatus === 'function'
      ? this.transport.getSignalingStatus()
      : [];
    const wsUrl = signalingStatus[0]?.url || getDefaultSignalingServer();
    const httpUrl = wsUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    // Strip trailing /peerjs path and trailing slashes
    return httpUrl.replace(/\/peerjs\/?$/, '').replace(/\/+$/, '');
  }

  /**
   * PeerJS cloud (0.peerjs.com) does not expose the custom workspace registry
   * endpoints with CORS, so skip registry calls there.
   */
  private canUseWorkspaceRegistry(base: string): boolean {
    try {
      const host = new URL(base).hostname.toLowerCase();
      return host !== '0.peerjs.com';
    } catch {
      return false;
    }
  }

  /**
   * Register this peer in the signaling server's workspace registry.
   * Called after transport init and workspace restore.
   * @param workspaceId - workspace to register in
   */
  async registerWorkspacePeer(workspaceId: string): Promise<void> {
    if (!this.state.myPeerId) return;
    const base = this.getSignalingHttpBase();
    if (!this.canUseWorkspaceRegistry(base)) return;
    try {
      await fetch(`${base}/workspace/${encodeURIComponent(workspaceId)}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId: this.state.myPeerId }),
      });
    } catch (err) {
      // Best-effort — signaling server may not support registry yet
      console.warn(`[Registry] Failed to register in workspace ${workspaceId.slice(0, 8)}:`, (err as Error)?.message);
    }
  }

  /**
   * Register this peer in all known workspaces.
   * Called once after transport init + workspace restore.
   */
  registerAllWorkspaces(): void {
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      void this.registerWorkspacePeer(ws.id);
    }
  }

  /**
   * Discover online peers for a workspace from the signaling server registry.
   * @param workspaceId - workspace to query
   * @returns Array of online peer IDs (may be empty if server doesn't support registry)
   */
  async discoverWorkspacePeers(workspaceId: string): Promise<string[]> {
    const base = this.getSignalingHttpBase();
    if (!this.canUseWorkspaceRegistry(base)) return [];
    try {
      const res = await fetch(`${base}/workspace/${encodeURIComponent(workspaceId)}/peers`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data?.peers) ? data.peers : [];
    } catch {
      // Signaling server may not support registry — fail silently
      return [];
    }
  }

  /**
   * Proactive peer maintenance sweep — attempts to connect to any workspace
   * member we're not currently connected to.
   *
   * Complements PeerTransport's auto-reconnect (which only fires on connection
   * drop) by also reaching out to members we've never connected to.
   */
  private _runPeerMaintenance(reason = 'manual'): number {
    const ws = this.state.activeWorkspaceId
      ? this.workspaceManager.getWorkspace(this.state.activeWorkspaceId)
      : null;
    if (!ws) return 0;

    const maintenanceStartedAt = Date.now();
    const connectedPeers = new Set<string>(this.getTransportConnectedPeerIds());
    const now = Date.now();
    const candidates = this.getWorkspacePeerCandidates(ws.id, now);
    let attempted = 0;
    let pruned = 0;

    const likelyTargets: string[] = [];
    const coldTargets: string[] = [];
    const previousDesiredPeerIds = this.getTopologyDesiredSetMemory().get(ws.id) ?? [];
    const selectionStartedAt = Date.now();
    const desiredSelection = this.isPartialMeshEnabled()
      ? this.selectDesiredPeers(ws.id, now, { emitTopologyEvents: true })
      : undefined;
    const selectionDurationMs = Date.now() - selectionStartedAt;
    const desiredPeerIds = new Set(desiredSelection?.desiredPeerIds ?? []);
    const connectedDesiredCount = desiredSelection
      ? desiredSelection.desiredPeerIds.filter((peerId) => connectedPeers.has(peerId)).length
      : connectedPeers.size;
    const needsMinimumSafeRecovery = connectedDesiredCount < ChatController.PARTIAL_MESH_MIN_SAFE_PEERS;

    if (desiredSelection) {
      const previousDesiredSet = new Set(previousDesiredPeerIds);
      const desiredCandidateMap = new Map(candidates.map((candidate) => [candidate.peerId, candidate]));
      for (const candidate of desiredSelection.anchors) {
        if (!previousDesiredSet.has(candidate.peerId)) {
          this.recordTopologyPeerEvent({
            level: 'info',
            workspaceId: ws.id,
            peerId: candidate.peerId,
            event: 'selected-anchor',
            sharedWorkspaceCount: candidate.sharedWorkspaceCount,
            score: this.scoreWorkspacePeer(candidate, now),
            connected: candidate.connected,
            connecting: candidate.connecting,
            ready: candidate.ready,
            likelyOnline: candidate.likelyOnline,
            disconnectCount: candidate.disconnectCount,
            connectedAt: candidate.connectedAt,
            lastSyncAt: candidate.lastSyncAt,
          });
        }
      }
      for (const candidate of desiredSelection.core) {
        if (!previousDesiredSet.has(candidate.peerId)) {
          this.recordTopologyPeerEvent({
            level: 'debug',
            workspaceId: ws.id,
            peerId: candidate.peerId,
            event: 'selected-core',
            sharedWorkspaceCount: candidate.sharedWorkspaceCount,
            score: this.scoreWorkspacePeer(candidate, now),
            connected: candidate.connected,
            connecting: candidate.connecting,
            ready: candidate.ready,
            likelyOnline: candidate.likelyOnline,
            disconnectCount: candidate.disconnectCount,
            connectedAt: candidate.connectedAt,
            lastSyncAt: candidate.lastSyncAt,
          });
        }
      }
      for (const candidate of desiredSelection.explorers) {
        if (!previousDesiredSet.has(candidate.peerId)) {
          this.recordTopologyPeerEvent({
            level: 'info',
            workspaceId: ws.id,
            peerId: candidate.peerId,
            event: 'selected-explorer',
            sharedWorkspaceCount: candidate.sharedWorkspaceCount,
            score: this.scoreWorkspacePeer(candidate, now),
            connected: candidate.connected,
            connecting: candidate.connecting,
            ready: candidate.ready,
            likelyOnline: candidate.likelyOnline,
            disconnectCount: candidate.disconnectCount,
            connectedAt: candidate.connectedAt,
            lastSyncAt: candidate.lastSyncAt,
          });
        }
      }
      for (const peerId of desiredSelection.desiredPeerIds) {
        const candidate = desiredCandidateMap.get(peerId);
        if (!candidate || candidate.sharedWorkspaceCount <= 1 || previousDesiredSet.has(peerId)) continue;
        this.recordTopologyPeerEvent({
          level: 'info',
          workspaceId: ws.id,
          peerId,
          event: 'selected-overlap',
          sharedWorkspaceCount: candidate.sharedWorkspaceCount,
          score: this.scoreWorkspacePeer(candidate, now),
          connected: candidate.connected,
          connecting: candidate.connecting,
          ready: candidate.ready,
          likelyOnline: candidate.likelyOnline,
          disconnectCount: candidate.disconnectCount,
          connectedAt: candidate.connectedAt,
          lastSyncAt: candidate.lastSyncAt,
        });
      }
    }

    for (const candidate of candidates) {
      const peerId = candidate.peerId;

      if (connectedPeers.has(peerId)) {
        // Even when transport still thinks a peer is connected, traffic can be
        // dropped during relay outages. Periodic sync closes those gaps.
        if (this.state.readyPeers.has(peerId)) {
          const last = this.lastMessageSyncRequestAt.get(peerId) ?? 0;
          if (now - last >= ChatController.PERIODIC_MESSAGE_SYNC_INTERVAL_MS) {
            this.lastMessageSyncRequestAt.set(peerId, now);
            this.requestMessageSync(peerId).catch(err => {
              console.warn('[Maintenance] Periodic message sync failed:', err);
            });
          }
        }
        continue;
      }

      const inDesiredSet = desiredSelection ? desiredPeerIds.has(peerId) : true;
      if (!inDesiredSet) continue;

      const retryAfterAt = this.getPeerRetryAfterAt(peerId);
      if (retryAfterAt > now) continue;

      if (candidate.likelyOnline) likelyTargets.push(peerId);
      else coldTargets.push(peerId);
    }

    const connectPeer = (peerId: string, options?: { likelyOnline?: boolean }): void => {
      // Use the transport's own in-flight state (connectingTo + pending reconnect
      // timers) instead of app-level connectingPeers, which can go stale when
      // connect() returns immediately (dedup early-return, no catch fired).
      if (typeof this.transport.isConnectingToPeer === 'function' &&
          this.transport.isConnectingToPeer(peerId)) {
        this.state.connectingPeers.add(peerId); // keep UI in sync
        return;
      }

      attempted++;
      this.peerLastConnectAttemptAt.set(peerId, now);
      this.state.connectingPeers.add(peerId);
      const connectCandidate = candidates.find((candidate) => candidate.peerId === peerId);
      this.recordTopologyPeerEvent({
        level: 'info',
        workspaceId: ws.id,
        peerId,
        event: 'connect-attempt',
        reason: desiredSelection ? 'desired-peer' : 'legacy-connect-all',
        sharedWorkspaceCount: connectCandidate?.sharedWorkspaceCount,
        score: connectCandidate ? this.scoreWorkspacePeer(connectCandidate, now) : undefined,
        connected: connectCandidate?.connected,
        connecting: true,
        ready: connectCandidate?.ready,
        likelyOnline: connectCandidate?.likelyOnline,
        disconnectCount: connectCandidate?.disconnectCount,
        connectedAt: connectCandidate?.connectedAt,
        lastSyncAt: connectCandidate?.lastSyncAt,
      });
      this.ui?.updateSidebar({ refreshContacts: false });
      // Stop the pulsating indicator quickly — if the peer doesn't answer in
      // 4s, show them as offline rather than spinning forever. PeerTransport
      // keeps retrying silently in the background; onConnect will light them
      // up green the moment they come back.
      setTimeout(() => {
        if (!this.state.connectedPeers.has(peerId)) {
          this.state.connectingPeers.delete(peerId);
          this.notePeerConnectFailure(peerId, { likelyOnline: options?.likelyOnline ?? true });
          this.ui?.updateSidebar({ refreshContacts: false });
        }
      }, 4000);
      this.transport.connect(peerId).catch(() => {
        this.notePeerConnectFailure(peerId, { likelyOnline: options?.likelyOnline ?? true });
        /* retries handled by PeerTransport */
      });
    };

    // Aggressive reconnect for likely-online peers with adaptive cooldown after repeated failures.
    for (const peerId of likelyTargets) {
      const retryAfterAt = this.getPeerRetryAfterAt(peerId);
      if (retryAfterAt > now) continue;
      connectPeer(peerId, { likelyOnline: true });
    }

    // Sparse reconnect for cold peers (background probing, low noise).
    for (const peerId of coldTargets) {
      const lastAttempt = this.peerLastConnectAttemptAt.get(peerId) ?? 0;
      const retryAfterAt = this.getPeerRetryAfterAt(peerId);
      const nextAllowedAt = Math.max(lastAttempt + ChatController.COLD_PEER_RETRY_MS, retryAfterAt);
      if (now < nextAllowedAt) continue;
      connectPeer(peerId, { likelyOnline: false });
    }

    if (desiredSelection) {
      this.markExplorerSelections(desiredSelection.explorers, now);

      if (!needsMinimumSafeRecovery && connectedPeers.size > desiredSelection.budget) {
        const pruneCandidates = this.selectConservativePrunePeers(candidates, desiredSelection, connectedPeers, now);
        for (const candidate of pruneCandidates) {
          if (typeof this.transport.disconnect !== 'function') break;
          this.transport.disconnect(candidate.peerId);
          pruned++;
          this.recordTopologyPeerEvent({
            level: candidate.sharedWorkspaceCount > 1 ? 'warn' : 'info',
            workspaceId: ws.id,
            peerId: candidate.peerId,
            event: 'pruned',
            reason: 'non-desired-conservative-prune',
            sharedWorkspaceCount: candidate.sharedWorkspaceCount,
            score: this.scoreWorkspacePeer(candidate, now),
            connected: candidate.connected,
            connecting: candidate.connecting,
            ready: candidate.ready,
            likelyOnline: candidate.likelyOnline,
            disconnectCount: candidate.disconnectCount,
            connectedAt: candidate.connectedAt,
            lastSyncAt: candidate.lastSyncAt,
          });
          connectedPeers.delete(candidate.peerId);
        }
      }
    }

    if (desiredSelection) {
      const connectingDesiredCount = desiredSelection.desiredPeerIds.filter((peerId) => this.state.connectingPeers.has(peerId)).length;
      const overlapDesiredPeerIds = desiredSelection.desiredPeerIds.filter((peerId) => {
        const candidate = candidates.find((entry) => entry.peerId === peerId);
        return (candidate?.sharedWorkspaceCount ?? 0) > 1;
      });
      const maintenanceEvent = this.getTopologyTelemetry().recordMaintenanceCycle({
        level: 'info',
        reason,
        workspaceId: ws.id,
        activeWorkspace: this.state.activeWorkspaceId === ws.id,
        partialMeshEnabled: true,
        candidatePeerCount: candidates.length,
        desiredPeerIds: desiredSelection.desiredPeerIds,
        previousDesiredPeerIds,
        connectedPeerCount: connectedPeers.size,
        connectedDesiredPeerCount: desiredSelection.desiredPeerIds.filter((peerId) => connectedPeers.has(peerId)).length,
        connectingDesiredPeerCount: connectingDesiredCount,
        likelyPeerCount: likelyTargets.length + candidates.filter((candidate) => candidate.connected && candidate.likelyOnline).length,
        coldPeerCount: coldTargets.length + candidates.filter((candidate) => candidate.connected && !candidate.likelyOnline).length,
        anchorPeerIds: desiredSelection.anchors.map((candidate) => candidate.peerId),
        explorerPeerIds: desiredSelection.explorers.map((candidate) => candidate.peerId),
        reconnectAttemptsThisSweep: attempted,
        pruneCountThisSweep: pruned,
        safeMinimumRecovery: needsMinimumSafeRecovery,
        safeMinimumTarget: ChatController.PARTIAL_MESH_MIN_SAFE_PEERS,
        overlapSelectedCount: overlapDesiredPeerIds.length,
        overlapDesiredPeerIds,
        selectionDurationMs,
        maintenanceDurationMs: Date.now() - maintenanceStartedAt,
        desiredBudget: desiredSelection.budget,
        hardCap: this.computeHardCap(),
        targetDegree: this.computeTargetPeerCount(),
      });
      this.recordTopologyMaintenanceEvent(maintenanceEvent);
      this.getTopologyDesiredSetMemory().set(ws.id, [...desiredSelection.desiredPeerIds]);
    }

    if (attempted > 0 || pruned > 0) {
      const desiredDetail = desiredSelection
        ? ` desired=${desiredSelection.desiredPeerIds.length}/${desiredSelection.budget} connectedDesired=${connectedDesiredCount}`
        : '';
      chatLog.info(`[Maintenance] reconnect=${attempted} prune=${pruned} [likely=${likelyTargets.length}, cold=${coldTargets.length}]${desiredDetail}`);
    }

    // Prune stale peer-tracking Map entries to prevent unbounded memory growth.
    // Remove entries for peers that are not current workspace members and haven't
    // been seen in over an hour.
    const STALE_PEER_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
    const knownMemberPeerIds = new Set<string>();
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      for (const member of workspace.members) {
        knownMemberPeerIds.add(member.peerId);
      }
    }
    const peerTrackingMaps = [
      this.peerLastSeenAt,
      this.peerLastConnectAttemptAt,
      this.peerLastSuccessfulSyncAt,
      this.peerConnectedAt,
      this.peerDisconnectCount,
      this.peerExplorerLastUsedAt,
    ] as const;
    for (const map of peerTrackingMaps) {
      for (const peerId of map.keys()) {
        if (knownMemberPeerIds.has(peerId)) continue;
        const lastSeen = this.peerLastSeenAt.get(peerId) ?? 0;
        if (now - lastSeen > STALE_PEER_THRESHOLD_MS) {
          map.delete(peerId);
        }
      }
    }

    return attempted;
  }

  /**
   * Save ServerDiscovery state to IndexedDB
   */
  private async saveServerDiscovery(workspaceId: string): Promise<void> {
    const discovery = this.serverDiscovery.get(workspaceId);
    if (!discovery) return;

    const json = discovery.toJSON();
    await this.persistentStore.saveSetting(`pex:${workspaceId}`, JSON.stringify(json));
  }

  /**
   * Restore ServerDiscovery state from IndexedDB
   */
  private async restoreServerDiscovery(workspaceId: string, primaryServer: string): Promise<void> {
    const saved = await this.persistentStore.getSetting(`pex:${workspaceId}`);
    if (!saved) {
      // No saved state, create new
      this.getServerDiscovery(workspaceId, primaryServer);
      return;
    }

    try {
      const json = JSON.parse(saved);
      const discovery = ServerDiscovery.fromJSON(json, primaryServer);
      this.serverDiscovery.set(workspaceId, discovery);
      chatLog.info(`[PEX] Restored ${discovery.getRankedServers().length} servers for workspace ${workspaceId}`);
    } catch (err) {
      console.error('[PEX] Failed to restore server discovery:', err);
      this.getServerDiscovery(workspaceId, primaryServer);
    }
  }

  // =========================================================================
  // Persistence
  // =========================================================================

  private schedulePersistReactions(): void {
    if (this.reactionsPersistTimer) clearTimeout(this.reactionsPersistTimer);
    this.reactionsPersistTimer = setTimeout(() => {
      this.reactionsPersistTimer = null;
      void this.persistSetting('reactions', this.reactions.toJSON());
    }, 200);
  }

  private syncReactionNodes(messageId: string): void {
    const selector = `[data-reactions-for="${CSS.escape(messageId)}"]`;
    const nodes = document.querySelectorAll<HTMLElement>(selector);
    nodes.forEach((el) => {
      el.innerHTML = this.reactions.renderReactions(messageId, this.state.myPeerId);
      el.querySelectorAll('.reaction-pill').forEach(btn => {
        btn.addEventListener('click', () => {
          const emoji = (btn as HTMLElement).dataset.emoji!;
          this.toggleReaction(messageId, emoji);
        });
      });
    });
  }

  /** Re-render persisted reactions into currently visible DOM message slots. */
  syncReactionsToDOM(): void {
    const nodes = document.querySelectorAll<HTMLElement>('[data-reactions-for]');
    const seen = new Set<string>();
    nodes.forEach((el) => {
      const messageId = el.dataset.reactionsFor || '';
      if (!messageId || seen.has(messageId)) return;
      seen.add(messageId);
      this.syncReactionNodes(messageId);
    });
  }

  async restoreFromStorage(): Promise<void> {
    const _rst0 = performance.now();

    // Fire all independent IDB reads in parallel instead of serial awaits.
    // Each getSetting creates its own IDB transaction — running them
    // concurrently eliminates the per-transaction overhead.
    const [
      /* custodian */ ,
      /* gossip */ ,
      savedAlias,
      savedThreadRoots,
      savedActivity,
      savedWsAliases,
      rawInviteRegistry,
      /* manifest */ ,
      /* publicWs */ ,
      persistedWorkspaces,
    ] = await Promise.all([
      this.loadCustodianInbox().catch((error) => {
        console.warn('[Custody] Failed to load custodian inbox', error);
      }),
      this.loadDeferredGossipIntents().catch((error) => {
        console.warn('[GossipIntent] Failed to load deferred gossip intents', error);
      }),
      this.persistentStore.getSetting('myAlias'),
      this.persistentStore.getSetting('threadRoots'),
      this.persistentStore.getSetting('activityItems'),
      this.persistentStore.getSetting('workspaceAliases'),
      this.persistentStore.getSetting(ChatController.WORKSPACE_INVITES_SETTING_KEY),
      this.restoreManifestState(),
      this.publicWorkspaceController.restoreFromStorage(),
      this.persistentStore.getAllWorkspaces(),
    ]);
    perfLog.debug(`restore:parallelIDB=${(performance.now()-_rst0).toFixed(0)}ms`);

    if (savedAlias) this.state.myAlias = savedAlias;

    // Restore thread root snapshots from IndexedDB
    if (savedThreadRoots && typeof savedThreadRoots === 'object') {
      for (const [threadId, snapshot] of Object.entries(savedThreadRoots)) {
        if (snapshot && typeof snapshot === 'object') {
          this.messageStore.setThreadRoot(threadId, snapshot as PlaintextMessage);
        }
      }
    }

    // Restore activity feed from IndexedDB
    if (Array.isArray(savedActivity)) {
      this.activityItems = savedActivity;
    }

    if (savedWsAliases) {
      try { this.state.workspaceAliases = JSON.parse(savedWsAliases); } catch {}
    }

    this.workspaceInviteRegistry = normalizeWorkspaceInviteRegistry(rawInviteRegistry);
    const hydratedWorkspaceIds = new Set<string>();
    const _rstSync = performance.now();
    perfLog.debug(`restore:settingsApply=${(_rstSync-_rst0).toFixed(0)}ms`);
    chatLog.info('[DecentChat] restoreFromStorage: found', persistedWorkspaces.length, 'full workspaces');
    for (const ws of persistedWorkspaces) {
      const _wsT0 = performance.now();
      hydratedWorkspaceIds.add(ws.id);
      this.workspaceManager.importWorkspace(ws);
      const _wsT1 = performance.now();
      this.publicWorkspaceController.ingestWorkspaceSnapshot(ws);
      const _wsT2 = performance.now();
      await this.manifestStore.restoreWorkspace(ws.id);
      const _wsT3 = performance.now();

      // DEP-002: Restore server discovery for this workspace
      await this.restoreServerDiscovery(ws.id, getDefaultSignalingServer());
      const _wsT4 = performance.now();
      perfLog.debug(`restore:ws(${ws.id.slice(0,8)}) import=${(_wsT1-_wsT0).toFixed(1)}ms ingest=${(_wsT2-_wsT1).toFixed(1)}ms manifest=${(_wsT3-_wsT2).toFixed(1)}ms serverDisc=${(_wsT4-_wsT3).toFixed(1)}ms total=${(_wsT4-_wsT0).toFixed(1)}ms`);
      const _rstMsgStart = performance.now();

      // Batch-load messages for ALL channels in a single IDB transaction.
      // This replaces the old per-channel serial loop that created N separate
      // IDB transactions and awaited each one — major perf win on restore.
      const channelIds = ws.channels.map((ch: { id: string }) => ch.id);
      const channelMessages = await this.persistentStore.getRecentMessagesForChannels(channelIds, 200);
      const _rstMsgLoaded = performance.now();
      perfLog.debug(`restore:batchIDB=${(_rstMsgLoaded-_rstMsgStart).toFixed(0)}ms channels=${channelIds.length} loaded=${channelMessages.size}`);

      let channelCount = 0;
      let totalMsgCount = 0;
      for (const channel of ws.channels) {
        const messages = channelMessages.get(channel.id);
        if (!messages || messages.length === 0) continue;
        totalMsgCount += messages.length;

        // Fix streaming flags before bulk-insert (mutates in-place, lightweight)
        for (const msg of messages) {
          if ((msg as any).streaming) {
            (msg as any).streaming = false;
            this.persistMessage(msg).catch(() => {});
          }
        }

        // Bulk-insert into MessageStore — O(n log n) instead of per-message
        // forceAdd which was O(n²) due to linear duplicate scan on growing array.
        this.messageStore.bulkAdd(messages);

        // Bulk-merge into CRDT — uses Map-based dedup (O(1) per message).
        const crdt = this.getOrCreateCRDT(channel.id);
        const crdtMsgs = messages.map(msg => ({
          id: msg.id,
          channelId: msg.channelId,
          senderId: msg.senderId,
          content: msg.content,
          type: (msg.type || 'text') as any,
          vectorClock: msg.vectorClock || {},
          wallTime: msg.timestamp,
          prevHash: msg.prevHash || '',
        }));
        crdt.merge(crdtMsgs);

        // Register attachment metadata (fire-and-forget async lookups)
        for (const msg of messages) {
          if ((msg as any).attachments?.length) {
            for (const att of (msg as any).attachments) {
              if (!this.mediaStore.getAttachment(att.id)) {
                const blobKey = `media:${ws.id}:${att.id}`;
                this.blobStorage.has(blobKey).then(hasBlob => {
                  this.mediaStore.registerMeta(ws.id, att, hasBlob ? 'available' : 'pruned');
                }).catch(() => {
                  this.mediaStore.registerMeta(ws.id, att, 'pruned');
                });
              }
            }
          }
        }

        // Yield every 5 channels so the event loop can service connections
        // that arrived during the restore phase.
        channelCount++;
        if (channelCount % 5 === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
      perfLog.debug(`restore:channelProcess=${(performance.now()-_rstMsgLoaded).toFixed(0)}ms channels=${channelCount} msgs=${totalMsgCount}`);
    }

    perfLog.debug(`restore:wsLoop=${(performance.now()-_rstSync).toFixed(0)}ms`);
    const staleOwnedShells = this.publicWorkspaceController.findStaleOwnedShellPlaceholders(
      this.state.myPeerId,
      hydratedWorkspaceIds,
    );
    for (const workspaceId of staleOwnedShells) {
      await this.publicWorkspaceController.removeWorkspace(workspaceId);
    }

    const savedReactions = await this.persistentStore.getSetting('reactions');
    if (savedReactions) {
      this.reactions.loadFromJSON(savedReactions);
    }

    // DEP-002: Start periodic PEX broadcasts
    if (this.workspaceManager.getAllWorkspaces().length > 0) {
      this.startPEXBroadcasts();
      this.startPeerMaintenance();  // T2.5
      this.startQuotaChecks();      // T2.4
      this.startGossipCleanup();    // T3.2
    }

    // Mark restore complete and flush any deferred post-connect work for
    // peers that connected during the restore phase.
    this._restoreComplete = true;
    this._flushDeferredPostConnectWork();

    perfLog.debug(`restoreFromStorage: ${(performance.now()-_rst0).toFixed(1)}ms`);
  }

  async persistWorkspace(workspaceId: string): Promise<void> {
    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (ws) {
      await this.persistentStore.saveWorkspace(
        this.workspaceManager.exportWorkspace(workspaceId),
      );
      await this.publicWorkspaceController.persistWorkspaceShell(ws);
    }
  }

  async persistMessage(msg: PlaintextMessage): Promise<void> {
    await this.persistentStore.saveMessage(msg);
  }

  async persistSetting(key: string, value: unknown): Promise<void> {
    await this.persistentStore.saveSetting(key, value);

    // Keep aggregate app-settings in sync (SettingsPanel reads via getSettings()).
    if (key !== 'app-settings') {
      const current = await this.persistentStore.getSettings<Record<string, any>>({});
      await this.persistentStore.saveSettings({ ...current, [key]: value });
    }

    if (key === 'myAlias' && typeof value === 'string' && value.trim()) {
      const alias = value.trim();
      this.state.myAlias = alias;

      // Update our member entry in the active workspace
      const wsId = this.state.activeWorkspaceId;
      if (wsId) {
        const ws = this.workspaceManager.getWorkspace(wsId);
        if (ws) {
          const myMember = ws.members.find((m: any) => m.peerId === this.state.myPeerId);
          if (myMember) myMember.alias = alias;
          this.persistWorkspace(wsId).catch(() => {});
        }

        // Announce new name to connected peers
        const targets = this.getWorkspaceRecipientPeerIds();
        for (const peerId of targets) {
          if (this.state.readyPeers.has(peerId)) {
            this.sendControlWithRetry(peerId, {
              type: 'name-announce',
              workspaceId: wsId,
              alias,
              allowWorkspaceDMs: (
                this.workspaceManager.getWorkspace(wsId)
                  ?.members.find((m: any) => m.peerId === this.state.myPeerId)
                  ?.allowWorkspaceDMs
              ) !== false,
            }, { label: 'name-announce' });
          }
        }
      }

      // Refresh sidebar and messages so own name updates immediately
      this.ui?.updateSidebar({ refreshContacts: false });
      this.ui?.renderMessages();
    }

  }

  async getSettings(): Promise<any> {
    return this.persistentStore.getSettings<any>({});
  }

  private async persistWorkspaceInviteRegistry(): Promise<void> {
    await this.persistSetting(ChatController.WORKSPACE_INVITES_SETTING_KEY, this.workspaceInviteRegistry);
  }

  listWorkspaceInvites(workspaceId?: string): WorkspaceInviteLists {
    const wsId = workspaceId || this.state.activeWorkspaceId;
    if (!wsId) return { active: [], revoked: [] };

    const ws = this.workspaceManager.getWorkspace(wsId);
    const revokedInviteIds = ws?.permissions?.revokedInviteIds || [];
    return buildWorkspaceInviteLists(this.workspaceInviteRegistry, wsId, revokedInviteIds);
  }

  getWorkspaceInviteById(workspaceId: string, inviteId: string): WorkspaceInviteView | null {
    const { active, revoked } = this.listWorkspaceInvites(workspaceId);
    const all = [...active, ...revoked];
    return all.find((invite) => invite.inviteId === inviteId) || null;
  }

  async revokeInviteById(inviteId: string): Promise<{ success: boolean; error?: string; inviteId?: string; alreadyRevoked?: boolean }> {
    return this.revokeInviteLink(inviteId);
  }

  // =========================================================================
  // Thread Root Snapshots
  // =========================================================================

  /**
   * Ensure a thread root snapshot exists for the given threadId.
   * Creates a copy of the parent message so the thread is self-contained
   * even if the parent is later compacted from the channel.
   */
  private async ensureThreadRoot(threadId: string, channelId: string): Promise<PlaintextMessage | undefined> {
    const getThreadRoot = (this.messageStore as any).getThreadRoot as ((id: string) => PlaintextMessage | undefined) | undefined;
    const setThreadRoot = (this.messageStore as any).setThreadRoot as ((id: string, value: PlaintextMessage) => void) | undefined;
    if (typeof getThreadRoot !== 'function' || typeof setThreadRoot !== 'function') return undefined;

    const existingRoot = getThreadRoot.call(this.messageStore, threadId);
    if (existingRoot) {
      return existingRoot;
    }

    const allMsgs = this.messageStore.getMessages(channelId);
    const parent = allMsgs.find(m => m.id === threadId);
    if (!parent) return undefined;

    const snapshot: PlaintextMessage = {
      id: parent.id,
      channelId: parent.channelId,
      senderId: parent.senderId,
      timestamp: parent.timestamp,
      content: parent.content,
      type: parent.type,
      prevHash: '',
      status: 'sent',
    };
    if ((parent as any).senderIdentityId) {
      (snapshot as any).senderIdentityId = (parent as any).senderIdentityId;
    }
    if ((parent as any).attachments) {
      (snapshot as any).attachments = (parent as any).attachments;
    }

    setThreadRoot.call(this.messageStore, threadId, snapshot);
    await this.persistThreadRoots();
    return snapshot;
  }

  /**
   * Create a thread root from a received envelope's snapshot data.
   * Used when the receiver doesn't have the parent message (e.g., joined late or compacted).
   */
  private async ensureThreadRootFromSnapshot(
    threadId: string,
    channelId: string,
    snapshot: { senderId?: string; senderIdentityId?: string; content?: string; timestamp?: number; attachments?: any[] },
  ): Promise<void> {
    const getThreadRoot = (this.messageStore as any).getThreadRoot as ((id: string) => PlaintextMessage | undefined) | undefined;
    const setThreadRoot = (this.messageStore as any).setThreadRoot as ((id: string, value: PlaintextMessage) => void) | undefined;
    if (typeof getThreadRoot !== 'function' || typeof setThreadRoot !== 'function') return;

    if (getThreadRoot.call(this.messageStore, threadId)) return;

    // Try local parent first
    const allMsgs = this.messageStore.getMessages(channelId);
    const parent = allMsgs.find(m => m.id === threadId);
    if (parent) {
      await this.ensureThreadRoot(threadId, channelId);
      return;
    }

    // Build from snapshot
    const root: PlaintextMessage = {
      id: threadId,
      channelId,
      senderId: snapshot.senderId || 'unknown',
      timestamp: snapshot.timestamp || Date.now(),
      content: snapshot.content || '',
      type: 'text',
      prevHash: '',
      status: 'sent',
    };
    if (snapshot.senderIdentityId) (root as any).senderIdentityId = snapshot.senderIdentityId;
    if (snapshot.attachments) (root as any).attachments = snapshot.attachments;

    setThreadRoot.call(this.messageStore, threadId, root);
    await this.persistThreadRoots();
  }

  /** Persist all thread roots to IndexedDB. */
  private async persistThreadRoots(): Promise<void> {
    const getAllThreadRoots = (this.messageStore as any).getAllThreadRoots as (() => Iterable<[string, PlaintextMessage]>) | undefined;
    const saveSetting = (this.persistentStore as any)?.saveSetting as ((key: string, value: unknown) => Promise<void>) | undefined;
    if (typeof getAllThreadRoots !== 'function' || typeof saveSetting !== 'function') return;

    const roots = getAllThreadRoots.call(this.messageStore);
    const obj: Record<string, any> = {};
    for (const [id, snapshot] of roots) {
      obj[id] = snapshot;
    }
    await saveSetting.call(this.persistentStore, 'threadRoots', obj);
  }

  // =========================================================================
  // Send
  // =========================================================================

  async sendMessage(content: string, threadId?: string): Promise<void> {
    if (!this.state.activeChannelId) return;

    const normalized = normalizeOutgoingMessageContent(content);
    if (normalized.empty) return;
    if (normalized.truncated) {
      this.ui?.showToast(`Message was truncated to ${MAX_MESSAGE_CHARS.toLocaleString()} characters`, 'info');
    }

    const safeContent = normalized.text;

    const msg = await this.messageStore.createMessage(
      this.state.activeChannelId,
      this.state.myPeerId,
      safeContent,
      'text',
      threadId,
    );
    if (this.myIdentityId) (msg as any).senderIdentityId = this.myIdentityId;

    const result = await this.messageStore.addMessage(msg);
    if (!result.success) {
      this.ui?.showToast('Failed to create message: ' + result.error, 'error');
      return;
    }

    const crdt = this.getOrCreateCRDT(this.state.activeChannelId);
    const crdtMsg = crdt.createMessage(this.state.activeChannelId, safeContent, 'text', threadId);
    (msg as any).vectorClock = crdtMsg.vectorClock;

    await this.persistMessage(msg);
    this.recordManifestDomain('channel-message', this.state.activeWorkspaceId ?? undefined, {
      channelId: this.state.activeChannelId ?? undefined,
      operation: 'create',
      subject: msg.id,
      itemCount: this.getChannelMessageCount(this.state.activeChannelId ?? undefined),
      data: { messageId: msg.id, senderId: this.state.myPeerId },
    });

    // Ensure thread root snapshot exists so the thread is self-contained
    if (threadId) {
      await this.ensureThreadRoot(threadId, this.state.activeChannelId);
    }

    if (threadId && this.state.threadOpen) {
      this.ui?.renderThreadMessages();
    } else if (!threadId) {
      this.ui?.appendMessageToDOM(msg, true);
    }
    // Update reply count on parent message for the sender (peer events handle remote side)
    if (threadId) {
      this.ui?.updateThreadIndicator(threadId, this.state.activeChannelId);
    }

    // Deliver to workspace peers (or queue if offline)
    // Snapshot recipients at send-time for deterministic group ACK semantics.
    const recipientPeerIds = this.getChannelDeliveryPeerIds(
      this.state.activeChannelId ?? undefined,
      this.state.activeWorkspaceId ?? undefined,
    );
    const statusRecipientPeerIds = this.getOnlineRecipientPeerIds(recipientPeerIds);
    (msg as any).recipientPeerIds = recipientPeerIds;
    (msg as any).statusRecipientPeerIds = statusRecipientPeerIds;
    (msg as any).ackedBy = [] as string[];
    (msg as any).ackedAt = {} as Record<string, number>;
    (msg as any).readBy = [] as string[];
    (msg as any).readAt = {} as Record<string, number>;

    let attemptedDispatch = false;
    for (const peerId of recipientPeerIds) {
      try {
        // If peer is offline and ratchet state is not loaded (e.g. after page refresh),
        // restore it from persistence so we can encrypt and queue the message.
        if (!this.state.readyPeers.has(peerId)) {
          const hasRatchet = this.messageProtocol!.hasRatchetState(peerId);
          if (!hasRatchet) {
            await this.messageProtocol!.restoreRatchetState(peerId);
          }
        }

        const envelope = await this.encryptMessageWithPreKeyBootstrap(peerId, safeContent, this.state.activeWorkspaceId ?? undefined);
        (envelope as any).channelId = this.state.activeChannelId;
        (envelope as any).workspaceId = this.state.activeWorkspaceId;
        (envelope as any).threadId = threadId;
        (envelope as any).vectorClock = (msg as any).vectorClock;
        (envelope as any).messageId = msg.id; // For reaction targeting — receiver must use same ID
        if (this.state.activeChannelId) {
          const gossipOriginSignature = await this.signGossipOrigin({
            messageId: msg.id,
            channelId: this.state.activeChannelId,
            content: safeContent,
            threadId,
          });
          if (gossipOriginSignature) {
            (envelope as any)._gossipOriginSignature = gossipOriginSignature;
          }
        }

        // Include thread root snapshot so receiver can reconstruct thread context
        if (threadId) {
          const threadRoot = this.messageStore.getThreadRoot(threadId);
          if (threadRoot) {
            (envelope as any).threadRootSnapshot = {
              senderId: threadRoot.senderId,
              senderIdentityId: (threadRoot as any).senderIdentityId,
              content: threadRoot.content,
              timestamp: threadRoot.timestamp,
              attachments: (threadRoot as any).attachments,
            };
          }
        }

        if (this.state.readyPeers.has(peerId)) {
          const sent = this.transport.send(peerId, envelope);
          if (sent !== false) {
            this.schedulePendingDeliveryWatch(peerId, this.state.activeChannelId!, msg.id, this.state.activeWorkspaceId ?? undefined);
          }
          // Reconnect race: readyPeers can be briefly stale after disconnect.
          // If transport rejects the send, persist to outbox instead of dropping.
          if (sent === false) {
            await this.queueCustodyEnvelope(peerId, {
              envelopeId: typeof (envelope as any).id === 'string' ? (envelope as any).id : undefined,
              opId: msg.id,
              recipientPeerIds: [peerId],
              workspaceId: this.state.activeWorkspaceId || 'direct',
              channelId: this.state.activeChannelId,
              ...(threadId ? { threadId } : {}),
              domain: 'channel-message',
              ciphertext: envelope,
              metadata: {
                messageId: msg.id,
                senderId: this.state.myPeerId,
                senderName: this.getDisplayNameForPeer(this.state.myPeerId),
              },
            }, envelope);
            await this.replicateToCustodians(peerId, { workspaceId: this.state.activeWorkspaceId, channelId: this.state.activeChannelId, opId: msg.id, domain: 'channel-message' });
            this.scheduleOfflineQueueFlush(peerId);
          }
        } else {
          await this.queueCustodyEnvelope(peerId, {
            envelopeId: typeof (envelope as any).id === 'string' ? (envelope as any).id : undefined,
            opId: msg.id,
            recipientPeerIds: [peerId],
            workspaceId: this.state.activeWorkspaceId || 'direct',
            channelId: this.state.activeChannelId,
            ...(threadId ? { threadId } : {}),
            domain: 'channel-message',
            ciphertext: envelope,
            metadata: {
              messageId: msg.id,
              senderId: this.state.myPeerId,
              senderName: this.getDisplayNameForPeer(this.state.myPeerId),
            },
          }, envelope);
          await this.replicateToCustodians(peerId, { workspaceId: this.state.activeWorkspaceId, channelId: this.state.activeChannelId, opId: msg.id, domain: 'channel-message' });
        }
        attemptedDispatch = true;
      } catch (err) {
        console.error('Send to', peerId, 'failed:', err);
        // Encryption failed (no ratchet state or shared secret — peer never connected
        // in this session). Keep the deferred-plaintext outbox fallback for now:
        // after app restarts we may have queued content before ratchets are restored,
        // and dropping here would silently lose messages.
        // flushOfflineQueue re-encrypts and sends once the handshake completes.
        try {
          await this.offlineQueue.enqueue(peerId, {
            _deferred: true,
            channelId: this.state.activeChannelId,
            workspaceId: this.state.activeWorkspaceId,
            threadId: threadId,
            content: content.trim(),
            messageId: msg.id,
            vectorClock: (msg as any).vectorClock,
          }, {
            domain: 'channel-message',
            workspaceId: this.state.activeWorkspaceId || undefined,
            channelId: this.state.activeChannelId || undefined,
            opId: msg.id,
            recipientPeerIds: [peerId],
          });
          attemptedDispatch = true;
        } catch (queueErr) {
          console.error("Failed to queue deferred message for", peerId, queueErr);
        }
      }
    }

    // DEP-005 (+group semantics): pending → sent once dispatched or queued for at least one recipient
    if (attemptedDispatch && msg.status !== 'sent' && msg.status !== 'delivered') {
      msg.status = 'sent';
      await this.persistentStore.saveMessage({
        ...msg,
        status: 'sent',
        recipientPeerIds,
        ackedBy: [],
        ackedAt: {},
        readBy: [],
        readAt: {},
      });
      this.ui?.updateMessageStatus?.(msg.id, 'sent', { acked: 0, total: statusRecipientPeerIds.length });
    }

    const onlineRecipientsAfterDispatch = new Set(this.getOnlineRecipientPeerIds(recipientPeerIds));
    const recoveryRecipients = recipientPeerIds.filter((peerId) => !onlineRecipientsAfterDispatch.has(peerId));
    if (recoveryRecipients.length > 0) {
      this.kickOutgoingDeliveryRecovery(recoveryRecipients, 'outgoing-workspace-send');
    }

  }

  // =========================================================================
  // Workspace / channel helpers (delegated to by UIService callbacks)
  // =========================================================================

  createWorkspace(name: string, alias: string): Workspace {
    const ws = this.workspaceManager.createWorkspace(
      name,
      this.state.myPeerId,
      alias,
      this.myPublicKey,
    );

    // DEP-002: Initialize server discovery for new workspace
    const defaultServer = getDefaultSignalingServer();
    this.getServerDiscovery(ws.id, defaultServer);
    this.startPEXBroadcasts();
    this.startPeerMaintenance();  // T2.5
    this.startQuotaChecks();      // T2.4
    this.startGossipCleanup();    // T3.2

    return ws;
  }

  private async connectPeerWithRetry(peerId: string, reason: string, attempts = 6): Promise<void> {
    if (!peerId || peerId === this.state.myPeerId) return;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (this.state.connectedPeers.has(peerId)) return;
      try {
        await this.transport.connect(peerId);
        return;
      } catch (err) {
        const isLast = attempt === attempts;
        const delayMs = Math.min(300 * (2 ** (attempt - 1)), 2_500);
        if (isLast) {
          console.warn(
            `[Connect] Failed to connect to ${peerId.slice(0, 8)} after ${attempts} attempts (${reason}):`,
            (err as Error)?.message ?? err,
          );
          throw err;
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  async joinWorkspace(
    code: string,
    alias: string,
    peerId: string,
    inviteData?: InviteData,
    options?: { allowWorkspaceDMs?: boolean },
  ): Promise<void> {
    chatLog.info('[DecentChat] joinWorkspace called:', { code, alias, peerId, hasUI: !!this.ui });

    const existingWorkspace = (inviteData?.workspaceId ? this.workspaceManager.getWorkspace(inviteData.workspaceId) : null)
      || this.workspaceManager.validateInviteCode(inviteData?.inviteCode || code);

    // ── Invite security validation ──────────────────────────────────────
    if (inviteData) {
      // Check expiration
      if (InviteURI.isExpired(inviteData)) {
        const msg = 'This invite link has expired';
        console.warn(`[DecentChat] ${msg}`);
        this.ui?.showToast(msg, 'error');
        throw new Error(msg);
      }

      // Check revocation (when we already know this workspace locally)
      const knownWorkspace = existingWorkspace
        || (inviteData.workspaceId ? this.workspaceManager.getWorkspace(inviteData.workspaceId) : null)
        || this.workspaceManager.validateInviteCode(inviteData.inviteCode);
      if (inviteData.inviteId && knownWorkspace && this.workspaceManager.isInviteRevoked(knownWorkspace.id, inviteData.inviteId)) {
        const msg = 'This invite link has been revoked by an admin';
        console.warn(`[DecentChat] ${msg}`);
        this.ui?.showToast(msg, 'error');
        throw new Error(msg);
      }

      // Check max uses (tracked in localStorage per invite code)
      if (inviteData.maxUses && inviteData.maxUses > 0) {
        const usageKey = `invite-usage:${inviteData.inviteCode}`;
        const currentUses = parseInt(localStorage.getItem(usageKey) || '0', 10);
        if (currentUses >= inviteData.maxUses) {
          const msg = 'This invite has reached its maximum uses';
          console.warn(`[DecentChat] ${msg}`);
          this.ui?.showToast(msg, 'error');
          throw new Error(msg);
        }
        // Increment usage
        localStorage.setItem(usageKey, String(currentUses + 1));
      }

      // Verify signature if present (optional — unsigned invites still work for backward compat)
      if (inviteData.signature && inviteData.publicKey) {
        const invalidSignatureMessage = 'This invite link has an invalid signature — it may have been tampered with';
        try {
          const { verifyInviteSignature } = await import('@decentchat/protocol');
          const valid = await verifyInviteSignature(inviteData.publicKey, inviteData);
          if (!valid) {
            console.warn(`[DecentChat] ${invalidSignatureMessage}`);
            this.ui?.showToast(invalidSignatureMessage, 'error');
            throw new Error(invalidSignatureMessage);
          }
          chatLog.info('[DecentChat] Invite signature verified ✓');
        } catch (err) {
          if ((err as Error)?.message === invalidSignatureMessage) {
            throw err;
          }
          console.warn('[DecentChat] Failed to verify invite signature:', err);
          // Don't block join — verification failure is non-fatal for backward compat
        }
      }
    }

    // Dedup guard: if we've already joined this workspace, do not create/re-join again.
    if (existingWorkspace && existingWorkspace.members.some((member: any) => member.peerId === this.state.myPeerId)) {
      this.state.activeWorkspaceId = existingWorkspace.id;
      this.state.activeChannelId = existingWorkspace.channels[0]?.id || null;
      void this.onWorkspaceActivated(existingWorkspace.id);
      this.ui?.renderApp();
      this.ui?.showToast('You already joined this workspace', 'info');
      return;
    }

    // Create the workspace locally for the joining user
    const ws = this.workspaceManager.createWorkspace(
      code, // use invite code as workspace name (will be updated from peer)
      this.state.myPeerId,
      alias,
      this.myPublicKey,
      {
        inviteCode: code,
        workspaceId: inviteData?.workspaceId,
      },
    );

    // DEP-002: Initialize server discovery for joined workspace
    // Extract primary signaling server from invite data
    const primaryServer = inviteData
      ? `${inviteData.secure ? 'wss' : 'ws'}://${inviteData.host}:${inviteData.port}${inviteData.path || ''}`
      : getDefaultSignalingServer(); // Fallback to environment-appropriate server

    chatLog.info(`[PEX] Initializing server discovery with primary: ${primaryServer}`);
    this.getServerDiscovery(ws.id, primaryServer);

    // Add fallback servers from invite
    if (inviteData?.fallbackServers && inviteData.fallbackServers.length > 0) {
      const discovery = this.serverDiscovery.get(ws.id)!;
      discovery.mergeReceivedServers(
        inviteData.fallbackServers.map(url => ({
          url,
          lastSeen: Date.now(),
          successRate: 0.9, // Assume good until proven otherwise
        }))
      );
      this.saveServerDiscovery(ws.id);
    }

    this.startPEXBroadcasts();
    this.startPeerMaintenance();  // T2.5
    this.startQuotaChecks();      // T2.4
    this.startGossipCleanup();    // T3.2

    // This is a JOINED workspace, not one we own.
    // Reassign ownership semantics so sync/permissions match canonical host workspace.
    ws.createdBy = peerId;
    const me = ws.members.find((m: any) => m.peerId === this.state.myPeerId);
    if (me) {
      me.role = 'member';
      me.allowWorkspaceDMs = options?.allowWorkspaceDMs !== false;
    }

    // Bootstrap inviter as owner so incoming workspace-state from inviter is trusted.
    // Modern signed invites carry BOTH the inviter signing key (`publicKey`) and the
    // transport handshake key (`transportPublicKey`), so the joiner can verify the invite
    // and immediately encrypt to the inviter without waiting for later workspace sync.
    this.workspaceManager.addMember(ws.id, {
      peerId,
      alias: inviteData?.inviterAlias || peerId.slice(0, 8),
      publicKey: inviteData?.transportPublicKey || '',
      signingPublicKey: inviteData?.publicKey || undefined,
      joinedAt: Date.now(),
      role: 'owner',
      ...(inviteData?.inviterIsBot ? { isBot: true } : {}),
      allowWorkspaceDMs: inviteData?.inviterAllowWorkspaceDMs !== false,
    });

    // Set as active workspace
    this.state.activeWorkspaceId = ws.id;
    this.state.activeChannelId = ws.channels[0]?.id || null;
    void this.onWorkspaceActivated(ws.id);

    // Persist provisional workspace (will be rolled back if not validated by owner state).
    await this.persistWorkspace(ws.id);

    // Require authoritative workspace-state within timeout, otherwise rollback provisional join.
    this.schedulePendingJoinValidation(ws.id);

    // Render the app UI
    this.ui?.renderApp();

    // Register in the workspace registry for discovery
    void this.registerWorkspacePeer(ws.id);

    // Multi-peer join: try connecting to all candidate peers in parallel.
    // Collect: inviter peerId + invite peers + signaling-discovered peers.
    void this.connectToMultiplePeers(peerId, inviteData, ws.id);
  }

  /**
   * Connect to multiple candidate peers in parallel for resilient workspace join.
   * Collects peers from invite data and signaling server discovery, deduplicates,
   * and attempts all connections simultaneously.
   */
  private async connectToMultiplePeers(
    primaryPeerId: string,
    inviteData: InviteData | undefined,
    workspaceId: string,
  ): Promise<void> {
    // Collect all candidate peer IDs (deduplicated)
    const candidates = new Set<string>();
    candidates.add(primaryPeerId);

    // Add peers from invite data
    if (inviteData?.peers) {
      for (const p of inviteData.peers) {
        if (p && p !== this.state.myPeerId) candidates.add(p);
      }
    }

    // Discover additional peers from signaling server registry
    if (workspaceId) {
      try {
        const discovered = await this.discoverWorkspacePeers(workspaceId);
        for (const p of discovered) {
          if (p && p !== this.state.myPeerId) candidates.add(p);
        }
      } catch {
        // Best-effort — continue with invite peers only
      }
    }

    const orderedCandidates = Array.from(candidates);
    const cappedCandidates = orderedCandidates.slice(0, ChatController.JOIN_CONNECT_CANDIDATE_CAP);

    chatLog.info(`[Join] Attempting parallel connect to ${cappedCandidates.length}/${orderedCandidates.length} candidate peer(s):`,
      cappedCandidates.map(p => p.slice(0, 8)));

    // Connect to a bounded candidate set in parallel — first one that responds and
    // completes handshake wins. Workspace-state sync from any member is valid.
    const results = await Promise.allSettled(
      cappedCandidates.map(p => this.connectPeerWithRetry(p, 'join-workspace'))
    );

    const connected = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    chatLog.info(`[Join] Parallel connect results: ${connected} succeeded, ${failed} failed`);
  }

  connectPeer(peerId: string): void {
    void this.connectPeerWithRetry(peerId, 'manual-connect');
  }

  createChannel(name: string): { success: boolean; channel?: Channel; error?: string } {
    if (!this.state.activeWorkspaceId) return { success: false, error: 'No active workspace' };

    // Permission guard
    if (!this.workspaceManager.canCreateChannel(this.state.activeWorkspaceId, this.state.myPeerId)) {
      return { success: false, error: 'Only admins can create channels' };
    }

    const result = this.workspaceManager.createChannel(
      this.state.activeWorkspaceId,
      name,
      this.state.myPeerId,
    );
    if (result.success && result.channel) {
      // Broadcast to all connected workspace members so they see the new channel immediately
      const wsId = this.state.activeWorkspaceId;
      const channel = result.channel;
      for (const peerId of this.getWorkspaceRecipientPeerIds()) {
        this.transport.send(peerId, {
          type: 'workspace-sync',
          workspaceId: wsId,
          sync: { type: 'channel-created', channel },
        });
      }
    }
    return result;
  }

  getActivityItems() {
    return [...this.activityItems].sort((a, b) => b.timestamp - a.timestamp);
  }

  getActivityUnreadCount(): number {
    return this.activityItems.filter(i => !i.read).length;
  }

  markActivityRead(id: string): void {
    const item = this.activityItems.find(i => i.id === id);
    if (item) { item.read = true; this.persistActivity(); }
  }

  markAllActivityRead(): void {
    for (const item of this.activityItems) item.read = true;
    this.persistActivity();
  }

  markThreadActivityRead(channelId: string, threadId: string): void {
    let changed = false;
    for (const item of this.activityItems) {
      if (item.channelId === channelId && item.threadId === threadId && !item.read) {
        item.read = true;
        changed = true;
      }
    }
    if (changed) this.persistActivity();
  }

  private resolveWorkspaceIdByChannelId(channelId: string): string | null {
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      if (ws.channels.some((c: any) => c.id === channelId)) return ws.id;
    }
    return this.state.activeWorkspaceId || null;
  }

  private isMentioningMe(content: string, wsId: string | null): boolean {
    if (!content || !content.includes('@')) return false;

    const normalize = (v: string) => v.trim().toLowerCase();
    const mine = new Set<string>();

    const wsAlias = this.getMyAliasForWorkspace(wsId);
    if (wsAlias) {
      mine.add(normalize(wsAlias));
      for (const part of wsAlias.split(/\s+/)) if (part.trim()) mine.add(normalize(part));
    }
    if (this.state.myAlias) {
      mine.add(normalize(this.state.myAlias));
      for (const part of this.state.myAlias.split(/\s+/)) if (part.trim()) mine.add(normalize(part));
    }

    mine.add(normalize(this.state.myPeerId));
    mine.add(normalize(this.state.myPeerId.slice(0, 8)));

    const mentionTokens = content.match(/(^|\s)@[A-Za-z0-9_.\-]+/g) || [];
    for (const token of mentionTokens) {
      const value = normalize(token.replace(/^\s*@/, ''));
      if (mine.has(value)) return true;
    }
    return false;
  }

  private maybeRecordMentionActivity(msg: PlaintextMessage, channelId: string, wsId: string): void {
    if (msg.senderId === this.state.myPeerId) return;
    if (!this.isMentioningMe(msg.content || '', wsId)) return;

    const isCurrentlyOpen = this.state.activeChannelId === channelId && (!msg.threadId || (this.state.threadOpen && this.state.activeThreadId === msg.threadId));
    const id = `mention:${wsId}:${channelId}:${msg.id}`;
    if (this.activityItems.some(i => i.id === id)) return;

    this.activityItems.unshift({
      id,
      type: 'mention',
      workspaceId: wsId,
      channelId,
      threadId: msg.threadId || undefined,
      messageId: msg.id,
      actorId: msg.senderId,
      snippet: msg.content.slice(0, 140),
      timestamp: msg.timestamp,
      read: isCurrentlyOpen,
    });

    if (this.activityItems.length > 500) this.activityItems.length = 500;
    this.persistActivity();
  }

  private maybeRecordThreadActivity(msg: PlaintextMessage, channelId: string): void {
    const threadId = msg.threadId;
    if (!threadId) return;
    if (msg.senderId === this.state.myPeerId) return;

    const wsId = this.resolveWorkspaceIdByChannelId(channelId);
    if (!wsId) return;

    // If user is currently reading this thread, don't create unread activity.
    const isCurrentlyOpen = this.state.activeChannelId === channelId && this.state.threadOpen && this.state.activeThreadId === threadId;

    // One activity item per thread — update existing instead of accumulating.
    // Uses thread-level ID so multiple replies in the same thread merge into one entry.
    const threadActivityId = `thread:${wsId}:${channelId}:${threadId}`;
    const existingIdx = this.activityItems.findIndex(i => i.id === threadActivityId);

    if (existingIdx >= 0) {
      // Ignore historical replay of the same (or older) reply so a previously
      // read activity item does not get resurrected as unread after refresh/sync.
      const existing = this.activityItems[existingIdx];
      const isSameOrOlderReply = existing.messageId === msg.id || msg.timestamp <= existing.timestamp;
      if (isSameOrOlderReply) return;

      // Update existing entry with latest reply info and bump to top
      existing.actorId = msg.senderId;
      existing.snippet = msg.content.slice(0, 140);
      existing.messageId = msg.id;
      existing.timestamp = msg.timestamp;
      if (!isCurrentlyOpen) existing.read = false; // re-mark as unread only for newer replies
      // Move to top
      this.activityItems.splice(existingIdx, 1);
      this.activityItems.unshift(existing);
    } else {
      this.activityItems.unshift({
        id: threadActivityId,
        type: 'thread-reply',
        workspaceId: wsId,
        channelId,
        threadId,
        messageId: msg.id,
        actorId: msg.senderId,
        snippet: msg.content.slice(0, 140),
        timestamp: msg.timestamp,
        read: isCurrentlyOpen,
      });
    }

    // Keep list bounded
    if (this.activityItems.length > 500) this.activityItems.length = 500;
    this.persistActivity();
  }

  /** Persist activity items to IndexedDB so they survive page refresh. */
  private persistActivity(): void {
    const saveSetting = (this.persistentStore as any)?.saveSetting as ((key: string, value: unknown) => Promise<void>) | undefined;
    if (typeof saveSetting !== 'function') return;
    saveSetting.call(this.persistentStore, 'activityItems', this.activityItems).catch(() => {});
  }

  async removeChannel(channelId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.activeWorkspaceId) return { success: false, error: 'No active workspace' };

    const wsId = this.state.activeWorkspaceId;
    const result = this.workspaceManager.removeChannel(wsId, channelId, this.state.myPeerId);
    if (!result.success) return result;

    this.messageStore.clearChannel(channelId);
    this.messageCRDTs.delete(channelId);

    try {
      const messages = await this.persistentStore.getChannelMessages(channelId);
      if (messages.length > 0) {
        await this.persistentStore.deleteMessages(messages.map((m: any) => m.id));
      }
      const ws = this.workspaceManager.getWorkspace(wsId);
      if (ws) await this.persistentStore.saveWorkspace(ws);
    } catch (err) {
      console.error('[Workspace] Failed to persist cleanup after removeChannel:', err);
    }

    if (this.state.activeChannelId === channelId) {
      const ws = this.workspaceManager.getWorkspace(wsId);
      const fallback = ws?.channels.find((c: Channel) => c.type === 'channel') || ws?.channels[0] || null;
      this.state.activeChannelId = fallback?.id || null;
    }

    for (const peerId of this.getWorkspaceRecipientPeerIds()) {
      this.transport.send(peerId, {
        type: 'workspace-sync',
        workspaceId: wsId,
        sync: { type: 'channel-removed', channelId, removedBy: this.state.myPeerId },
      });
    }

    this.ui?.updateSidebar({ refreshContacts: false });
    this.ui?.updateChannelHeader();
    this.ui?.renderMessages();
    this.ui?.updateComposePlaceholder?.();

    return { success: true };
  }

  createDM(peerId: string): { success: boolean; channel?: Channel } {
    if (!this.state.activeWorkspaceId) return { success: false };
    return this.workspaceManager.createDM(
      this.state.activeWorkspaceId,
      this.state.myPeerId,
      peerId,
    );
  }

  private schedulePendingJoinValidation(wsId: string): void {
    this.clearPendingJoinValidation(wsId);
    const timer = setTimeout(() => {
      void this.rollbackUnvalidatedJoin(wsId);
    }, ChatController.JOIN_VALIDATION_TIMEOUT_MS);
    this.pendingJoinValidationTimers.set(wsId, timer);
  }

  private clearPendingJoinValidation(wsId: string): void {
    const timer = this.pendingJoinValidationTimers.get(wsId);
    if (timer) {
      clearTimeout(timer);
      this.pendingJoinValidationTimers.delete(wsId);
    }
  }

  private async rollbackUnvalidatedJoin(wsId: string): Promise<void> {
    // Timeout fired, ensure still pending.
    if (!this.pendingJoinValidationTimers.has(wsId)) return;
    this.clearPendingJoinValidation(wsId);

    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return;

    const workspaceName = ws.name || 'workspace';
    await this.cleanupWorkspaceLocalState(wsId, ws);
    this.workspaceManager.removeWorkspace(wsId);

    if (!this.state.activeWorkspaceId) {
      const fallback = this.workspaceManager.getAllWorkspaces()[0];
      if (fallback) {
        this.state.activeWorkspaceId = fallback.id;
        const fallbackChannel = fallback.channels.find((ch: any) => ch.type === 'channel') || fallback.channels[0] || null;
        this.state.activeChannelId = fallbackChannel?.id || null;
      }
    }

    this.ui?.showToast(`Could not join ${workspaceName}. Access denied or join timed out.`, 'error');
    this.ui?.updateWorkspaceRail?.();
    this.ui?.updateSidebar({ refreshContacts: false });
    this.ui?.updateChannelHeader();
    this.ui?.renderMessages();
    this.ui?.updateComposePlaceholder?.();
  }

  private markJoinValidated(wsId: string): void {
    this.clearPendingJoinValidation(wsId);
  }

  private async handleSelfWorkspaceRevocation(
    wsId: string,
    reason: 'kicked' | 'banned',
    _byPeerId: string,
  ): Promise<void> {
    this.clearPendingJoinValidation(wsId);
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return;

    const workspaceName = ws.name || 'workspace';
    const cleanupOk = await this.cleanupWorkspaceLocalState(wsId, ws);

    // Even when purge fails, hide workspace from UI immediately (best-effort UX).
    this.workspaceManager.removeWorkspace(wsId);

    if (!this.state.activeWorkspaceId) {
      const fallback = this.workspaceManager.getAllWorkspaces()[0];
      if (fallback) {
        this.state.activeWorkspaceId = fallback.id;
        const fallbackChannel = fallback.channels.find((ch: any) => ch.type === 'channel') || fallback.channels[0] || null;
        this.state.activeChannelId = fallbackChannel?.id || null;
      }
    }

    if (!cleanupOk) {
      this.ui?.showToast(`Removed from ${workspaceName}. Some local data cleanup may have failed.`, 'error');
    } else if (reason === 'banned') {
      this.ui?.showToast(`You were banned from ${workspaceName}`, 'error');
    } else {
      this.ui?.showToast(`You were removed from ${workspaceName}`, 'error');
    }

    this.ui?.updateWorkspaceRail?.();
    this.ui?.updateSidebar({ refreshContacts: false });
    this.ui?.updateChannelHeader();
    this.ui?.renderMessages();
    this.ui?.updateComposePlaceholder?.();
  }

  private async cleanupWorkspaceLocalState(wsId: string, workspaceSnapshot?: Workspace | null): Promise<boolean> {
    const ws = workspaceSnapshot || this.workspaceManager.getWorkspace(wsId);
    if (!ws) return false;

    const channelIds = ws.channels.map((ch) => ch.id);

    for (const channelId of channelIds) {
      this.messageStore.clearChannel(channelId);
      this.messageCRDTs.delete(channelId);
    }

    try {
      for (const channelId of channelIds) {
        const messages = await this.persistentStore.getChannelMessages(channelId);
        if (messages.length > 0) {
          await this.persistentStore.deleteMessages(messages.map((m: any) => m.id));
        }
      }
      await this.persistentStore.deleteWorkspace(wsId);
      await this.manifestStore.removeWorkspace(wsId);
      await this.publicWorkspaceController.removeWorkspace(wsId);
    } catch (err) {
      console.error('[Workspace] Failed to delete persisted workspace data:', err);
      return false;
    }

    if (this.state.workspaceAliases?.[wsId]) {
      delete this.state.workspaceAliases[wsId];
      await this.persistentStore.saveSetting('workspaceAliases', JSON.stringify(this.state.workspaceAliases));
    }

    if (this.state.activeWorkspaceId === wsId) {
      this.state.activeWorkspaceId = null;
      this.state.activeChannelId = null;
      this.state.activeThreadId = null;
      this.state.threadOpen = false;
    }

    return true;
  }

  async deleteWorkspace(wsId: string): Promise<boolean> {
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return false;

    const deleted = this.workspaceManager.deleteWorkspace(wsId, this.state.myPeerId);
    if (!deleted) return false;

    const recipients = ws.members
      .map((m: any) => m.peerId)
      .filter((peerId: string) => peerId !== this.state.myPeerId && this.state.connectedPeers.has(peerId));

    for (const peerId of recipients) {
      this.transport.send(peerId, {
        type: 'workspace-sync',
        workspaceId: wsId,
        sync: { type: 'workspace-deleted', workspaceId: wsId, deletedBy: this.state.myPeerId },
      });
    }

    const ok = await this.cleanupWorkspaceLocalState(wsId, ws);
    if (ok) {
      this.ui?.updateWorkspaceRail?.();
      this.ui?.updateSidebar({ refreshContacts: false });
      this.ui?.updateChannelHeader();
      this.ui?.renderMessages();
      this.ui?.updateComposePlaceholder?.();
    }
    return ok;
  }

  async leaveWorkspace(wsId: string): Promise<{ success: boolean; error?: string }> {
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return { success: false, error: 'Workspace not found' };

    const me = ws.members.find((m: any) => m.peerId === this.state.myPeerId);
    if (!me) return { success: false, error: 'You are not a member of this workspace' };

    if (me.role === 'owner') {
      return { success: false, error: 'Owner cannot leave workspace. Transfer ownership or delete workspace.' };
    }

    const timestamp = Date.now();

    // Broadcast voluntary leave event to connected members.
    for (const connectedPeerId of this.state.connectedPeers) {
      this.transport.send(connectedPeerId, {
        type: 'workspace-sync',
        workspaceId: wsId,
        sync: {
          type: 'member-left',
          peerId: this.state.myPeerId,
          timestamp,
        },
      });
    }

    // Remove locally and purge all persisted workspace data.
    ws.members = ws.members.filter((m: any) => m.peerId !== this.state.myPeerId);
    for (const ch of ws.channels) {
      ch.members = ch.members.filter((id: string) => id !== this.state.myPeerId);
    }

    const ok = await this.cleanupWorkspaceLocalState(wsId, ws);
    if (!ok) return { success: false, error: 'Failed to delete local workspace data' };

    this.workspaceManager.removeWorkspace(wsId);

    this.ui?.showToast('You left the workspace', 'info');
    this.ui?.updateWorkspaceRail?.();
    this.ui?.updateSidebar({ refreshContacts: false });
    this.ui?.updateChannelHeader();
    this.ui?.renderMessages();
    this.ui?.updateComposePlaceholder?.();

    return { success: true };
  }

  async removeWorkspaceMember(peerId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.activeWorkspaceId) return { success: false, error: 'No active workspace' };

    const wsId = this.state.activeWorkspaceId;
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return { success: false, error: 'Workspace not found' };

    const me = ws.members.find((m: any) => m.peerId === this.state.myPeerId);
    const target = ws.members.find((m: any) => m.peerId === peerId);
    if (!target) return { success: false, error: 'Member not found' };
    if (target.role === 'owner') return { success: false, error: 'Cannot remove owner' };

    // Robust permission check: tolerate stale local role snapshots.
    const managerOwner = this.workspaceManager.isOwner(wsId, this.state.myPeerId);
    const managerAdmin = this.workspaceManager.isAdmin(wsId, this.state.myPeerId);
    const hasRemovePermission = managerOwner || managerAdmin || ws.createdBy === this.state.myPeerId || me?.role === 'owner' || me?.role === 'admin';
    if (!hasRemovePermission) {
      return { success: false, error: 'Only owner or admin can remove members' };
    }

    // Deterministic local remove (avoid stale-role false negatives in manager guards).
    ws.members = ws.members.filter((m: any) => m.peerId !== peerId);
    for (const ch of ws.channels) {
      ch.members = ch.members.filter((id: string) => id !== peerId);
    }

    await this.persistWorkspace(wsId);

    // Sign and broadcast member-removed event
    const timestamp = Date.now();
    let signature: string | undefined;
    try {
      signature = await this.signRemoveEvent(wsId, { peerId, timestamp });
      if (this.signingKeyPair) {
      }
    } catch (e) {
      console.warn('[Security] Could not sign remove event:', e);
    }

    for (const connectedPeerId of this.state.connectedPeers) {
      this.transport.send(connectedPeerId, {
        type: 'workspace-sync',
        workspaceId: wsId,
        sync: { type: 'member-removed', peerId, removedBy: this.state.myPeerId, reason: 'kicked', timestamp, signature },
      });

      // Do not send fresh workspace-state to the removed peer.
      // They should receive the removal event and lose access instead.
      if (connectedPeerId !== peerId) {
        this.sendWorkspaceState(connectedPeerId);
      }
    }

    this.ui?.updateSidebar({ refreshContacts: false });
    this.ui?.updateChannelHeader();
    this.ui?.renderMessages();

    return { success: true };
  }

  async banWorkspaceMember(
    peerId: string,
    opts?: { durationMs?: number; reason?: string },
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.state.activeWorkspaceId) return { success: false, error: 'No active workspace' };

    const wsId = this.state.activeWorkspaceId;
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return { success: false, error: 'Workspace not found' };

    const target = ws.members.find((m: any) => m.peerId === peerId);
    if (!target) return { success: false, error: 'Member not found' };
    if (target.role === 'owner') return { success: false, error: 'Cannot ban owner' };

    const managerOwner = this.workspaceManager.isOwner(wsId, this.state.myPeerId);
    const managerAdmin = this.workspaceManager.isAdmin(wsId, this.state.myPeerId);
    if (!managerOwner && !managerAdmin) {
      return { success: false, error: 'Only owner or admin can ban members' };
    }

    const result = this.workspaceManager.banMember(wsId, peerId, this.state.myPeerId, {
      durationMs: opts?.durationMs,
      reason: opts?.reason,
    });
    if (!result.success) return { success: false, error: result.error || 'Failed to ban member' };

    await this.persistWorkspace(wsId);

    // Also ban at transport guard level on this device for immediate hardening.
    const durationMs = opts?.durationMs && opts.durationMs > 0 ? opts.durationMs : 365 * 24 * 60 * 60 * 1000;
    this.messageGuard.ban(peerId, durationMs);

    const timestamp = Date.now();
    for (const connectedPeerId of this.state.connectedPeers) {
      this.transport.send(connectedPeerId, {
        type: 'workspace-sync',
        workspaceId: wsId,
        sync: {
          type: 'member-removed',
          peerId,
          removedBy: this.state.myPeerId,
          reason: 'banned',
          ...(result.ban?.expiresAt ? { banExpiresAt: result.ban.expiresAt } : {}),
          timestamp,
        },
      });

      if (connectedPeerId !== peerId) {
        this.sendWorkspaceState(connectedPeerId, wsId);
      }
    }

    this.ui?.updateWorkspaceRail?.();
    this.ui?.updateSidebar({ refreshContacts: false });
    this.ui?.updateChannelHeader();
    this.ui?.renderMessages();
    this.ui?.updateComposePlaceholder?.();

    return { success: true };
  }

  async promoteMember(targetPeerId: string, newRole: 'admin'): Promise<{ success: boolean; error?: string }> {
    if (!this.state.activeWorkspaceId) return { success: false, error: 'No active workspace' };

    const wsId = this.state.activeWorkspaceId;
    const result = this.workspaceManager.promoteMember(wsId, this.state.myPeerId, targetPeerId, newRole);
    if (!result.success) return result;

    await this.persistWorkspace(wsId);

    // Sign and broadcast role-changed event
    const timestamp = Date.now();
    let signature: string | undefined;
    try {
      signature = await this.signRoleEvent(wsId, { targetPeerId, newRole, timestamp });
    } catch (e) {
      console.warn('[Security] Could not sign role event:', e);
    }

    for (const connectedPeerId of this.state.connectedPeers) {
      this.transport.send(connectedPeerId, {
        type: 'workspace-sync',
        workspaceId: wsId,
        sync: { type: 'role-changed', peerId: targetPeerId, newRole, changedBy: this.state.myPeerId, timestamp, signature },
      });
    }

    this.ui?.updateSidebar({ refreshContacts: false });
    this.ui?.updateChannelHeader();
    return { success: true };
  }

  async demoteMember(targetPeerId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.activeWorkspaceId) return { success: false, error: 'No active workspace' };

    const wsId = this.state.activeWorkspaceId;
    const result = this.workspaceManager.demoteMember(wsId, this.state.myPeerId, targetPeerId);
    if (!result.success) return result;

    await this.persistWorkspace(wsId);

    // Sign and broadcast role-changed event
    const timestamp = Date.now();
    const newRole = 'member';
    let signature: string | undefined;
    try {
      signature = await this.signRoleEvent(wsId, { targetPeerId, newRole, timestamp });
      if (this.signingKeyPair) {
      }
    } catch (e) {
      console.warn('[Security] Could not sign role event:', e);
    }

    for (const connectedPeerId of this.state.connectedPeers) {
      this.transport.send(connectedPeerId, {
        type: 'workspace-sync',
        workspaceId: wsId,
        sync: { type: 'role-changed', peerId: targetPeerId, newRole, changedBy: this.state.myPeerId, timestamp, signature },
      });
    }

    this.ui?.updateSidebar({ refreshContacts: false });
    this.ui?.updateChannelHeader();
    return { success: true };
  }

  async updateWorkspacePermissions(permissions: Partial<import('@decentchat/protocol').WorkspacePermissions>): Promise<{ success: boolean; error?: string }> {
    if (!this.state.activeWorkspaceId) return { success: false, error: 'No active workspace' };

    const wsId = this.state.activeWorkspaceId;
    const result = this.workspaceManager.updatePermissions(wsId, this.state.myPeerId, permissions);
    if (!result.success) return result;

    await this.persistWorkspace(wsId);

    // Sign and broadcast settings-updated event
    const fullPerms = this.workspaceManager.getPermissions(wsId);
    const timestamp = Date.now();
    let signature: string | undefined;
    try {
      signature = await this.signSettingsEvent(wsId, { settings: fullPerms, timestamp });
      if (this.signingKeyPair) {
      }
    } catch (e) {
      console.warn('[Security] Could not sign settings event:', e);
    }

    for (const connectedPeerId of this.state.connectedPeers) {
      this.transport.send(connectedPeerId, {
        type: 'workspace-sync',
        workspaceId: wsId,
        sync: { type: 'workspace-settings-updated', settings: fullPerms, changedBy: this.state.myPeerId, timestamp, signature },
      });
    }

    return { success: true };
  }

  async revokeInviteLink(inviteIdOrUrl: string): Promise<{ success: boolean; error?: string; inviteId?: string; alreadyRevoked?: boolean }> {
    if (!this.state.activeWorkspaceId) return { success: false, error: 'No active workspace' };

    const ws = this.workspaceManager.getWorkspace(this.state.activeWorkspaceId);
    if (!ws) return { success: false, error: 'Workspace not found' };

    let inviteId = String(inviteIdOrUrl || '').trim();
    if (!inviteId) return { success: false, error: 'Usage: /invite-revoke <inviteId|inviteURL>' };

    if (inviteId.includes('://') || inviteId.includes('/join/')) {
      try {
        const decoded = InviteURI.decode(inviteId);
        if (decoded.workspaceId && decoded.workspaceId !== ws.id) {
          return { success: false, error: 'Invite URL belongs to a different workspace' };
        }
        if (!decoded.workspaceId && decoded.inviteCode !== ws.inviteCode) {
          return { success: false, error: 'Invite URL does not match this workspace' };
        }
        if (!decoded.inviteId) {
          return { success: false, error: 'Invite URL has no revokable invite ID (older link)' };
        }
        inviteId = decoded.inviteId;
      } catch {
        return { success: false, error: 'Invalid invite URL' };
      }
    }

    const existingRevoked = this.workspaceManager.getPermissions(ws.id).revokedInviteIds || [];
    if (existingRevoked.includes(inviteId)) {
      this.workspaceInviteRegistry = markInviteRevokedInRegistry(this.workspaceInviteRegistry, ws.id, inviteId);
      await this.persistWorkspaceInviteRegistry();
      return { success: true, inviteId, alreadyRevoked: true };
    }

    const result = await this.updateWorkspacePermissions({
      revokedInviteIds: [...existingRevoked, inviteId],
    });
    if (!result.success) return result;

    this.workspaceInviteRegistry = markInviteRevokedInRegistry(this.workspaceInviteRegistry, ws.id, inviteId);
    await this.persistWorkspaceInviteRegistry();

    return { success: true, inviteId };
  }

  async updateWorkspaceInfo(updates: { name?: string; description?: string }): Promise<{ success: boolean; error?: string }> {
    if (!this.state.activeWorkspaceId) return { success: false, error: 'No active workspace' };

    const wsId = this.state.activeWorkspaceId;
    const result = this.workspaceManager.updateWorkspaceInfo(wsId, this.state.myPeerId, updates);
    if (!result.success) return result;

    await this.persistWorkspace(wsId);

    // Broadcast full workspace state so all peers get the updated name/description
    for (const connectedPeerId of this.state.connectedPeers) {
      this.sendWorkspaceState(connectedPeerId);
    }

    this.ui?.updateSidebar({ refreshContacts: false });
    this.ui?.updateChannelHeader();
    return { success: true };
  }

  /** Set the ECDSA signing key pair for signing admin events */
  async setSigningKeyPair(keyPair: { publicKey: CryptoKey; privateKey: CryptoKey }): Promise<void> {
    this.signingKeyPair = keyPair;
    // Export and store our signing public key on our workspace members
    const exportedKey = await this.cryptoManager.exportPublicKey(keyPair.publicKey);
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      const myMember = ws.members.find(m => m.peerId === this.state.myPeerId);
      if (myMember && myMember.signingPublicKey !== exportedKey) {
        myMember.signingPublicKey = exportedKey;
        this.persistWorkspace(ws.id).catch(() => {});
      }
    }
  }

  /** Sign an admin event. Payload includes workspaceId + actorPeerId for cross-context replay protection. */
  private async signAdminEvent(type: string, workspaceId: string, fields: string, timestamp: number): Promise<string> {
    if (!this.signingKeyPair) throw new Error('Signing key pair not available');
    const data = `${type}:${workspaceId}:${this.state.myPeerId}:${fields}:${timestamp}`;
    const cipher = new MessageCipher();
    return cipher.sign(data, this.signingKeyPair.privateKey);
  }

  /** Verify an admin event signature against a stored public key. */
  private async verifyAdminEvent(
    type: string, workspaceId: string, actorPeerId: string, fields: string,
    timestamp: number, signature: string, signerPublicKeyBase64: string,
  ): Promise<boolean> {
    try {
      const publicKey = await this.cryptoManager.importSigningPublicKey(signerPublicKeyBase64);
      const data = `${type}:${workspaceId}:${actorPeerId}:${fields}:${timestamp}`;
      const cipher = new MessageCipher();
      return cipher.verify(data, signature, publicKey);
    } catch (e) {
      console.warn('[Security] Failed to verify admin event signature:', e);
      return false;
    }
  }

  private async signRoleEvent(wsId: string, payload: { targetPeerId: string; newRole: string; timestamp: number }): Promise<string> {
    return this.signAdminEvent('role', wsId, `${payload.targetPeerId}:${payload.newRole}`, payload.timestamp);
  }

  private async verifyRoleEvent(wsId: string, actorPeerId: string,
    payload: { targetPeerId: string; newRole: string; timestamp: number; signature: string },
    signerPublicKeyBase64: string): Promise<boolean> {
    return this.verifyAdminEvent('role', wsId, actorPeerId, `${payload.targetPeerId}:${payload.newRole}`,
      payload.timestamp, payload.signature, signerPublicKeyBase64);
  }

  private async signSettingsEvent(wsId: string, payload: { settings: any; timestamp: number }): Promise<string> {
    return this.signAdminEvent('settings', wsId, JSON.stringify(payload.settings), payload.timestamp);
  }

  private async verifySettingsEvent(wsId: string, actorPeerId: string,
    payload: { settings: any; timestamp: number; signature: string },
    signerPublicKeyBase64: string): Promise<boolean> {
    return this.verifyAdminEvent('settings', wsId, actorPeerId, JSON.stringify(payload.settings),
      payload.timestamp, payload.signature, signerPublicKeyBase64);
  }

  private async signRemoveEvent(wsId: string, payload: { peerId: string; timestamp: number }): Promise<string> {
    return this.signAdminEvent('remove', wsId, payload.peerId, payload.timestamp);
  }

  private async verifyRemoveEvent(wsId: string, actorPeerId: string,
    payload: { peerId: string; timestamp: number; signature: string },
    signerPublicKeyBase64: string): Promise<boolean> {
    return this.verifyAdminEvent('remove', wsId, actorPeerId, payload.peerId,
      payload.timestamp, payload.signature, signerPublicKeyBase64);
  }

  // =========================================================================
  // Contacts
  // =========================================================================

  async addContact(contact: Contact): Promise<void> {
    await this.contactStore.add(contact);
    await this.persistentStore.saveContact(contact);
    // Also persist the peer's public key so the decrypt path can find it
    // (receive path checks persistentStore.getPeer before decrypting)
    if (contact.publicKey) {
      await this.persistentStore.savePeer({
        peerId: contact.peerId,
        publicKey: contact.publicKey,
        lastSeen: Date.now(),
        alias: contact.displayName,
      });
    }
    this.ui?.updateSidebar({ refreshContacts: false });
  }

  async removeContact(peerId: string): Promise<void> {
    await this.contactStore.remove(peerId);
    await this.persistentStore.deleteContact(peerId);
    this.ui?.updateSidebar({ refreshContacts: false });
  }

  async getContacts(): Promise<Contact[]> {
    return this.contactStore.list();
  }

  // =========================================================================
  // Standalone Direct Messages
  // =========================================================================

  async startDirectMessage(
    contactPeerId: string,
    options?: { sourceWorkspaceId?: string },
  ): Promise<DirectConversation> {
    const sourceWorkspaceId = options?.sourceWorkspaceId;

    // Sender-side policy guard: if DM is initiated from workspace context,
    // respect recipient preference for workspace-origin DMs.
    if (sourceWorkspaceId) {
      const ws = this.workspaceManager.getWorkspace(sourceWorkspaceId);
      const targetMember = ws?.members.find((m: any) => m.peerId === contactPeerId);
      const targetDirectoryMember = targetMember
        ? null
        : this.getWorkspaceMemberDirectory(sourceWorkspaceId).members.find((m) => m.peerId === contactPeerId);
      if (targetMember?.allowWorkspaceDMs === false || targetDirectoryMember?.allowWorkspaceDMs === false) {
        throw new Error('This member disallows workspace DMs.');
      }
    }

    const conv = await this.directConversationStore.create(contactPeerId, {
      originWorkspaceId: sourceWorkspaceId,
    });
    await this.persistentStore.saveDirectConversation(conv);
    this.ui?.updateSidebar({ refreshContacts: false });
    return conv;
  }

  async getDirectConversations(): Promise<DirectConversation[]> {
    const conversations = await this.directConversationStore.list();
    return conversations.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }

  async sendDirectMessage(conversationId: string, content: string, threadId?: string): Promise<void> {
    const normalized = normalizeOutgoingMessageContent(content);
    if (normalized.empty) return;
    if (normalized.truncated) {
      this.ui?.showToast(`Message was truncated to ${MAX_MESSAGE_CHARS.toLocaleString()} characters`, 'info');
    }

    const safeContent = normalized.text;

    const conv = await this.directConversationStore.get(conversationId);
    if (!conv) return;

    const msg = await this.messageStore.createMessage(
      conversationId,
      this.state.myPeerId,
      safeContent,
      'text',
      threadId,
    );
    if (this.myIdentityId) (msg as any).senderIdentityId = this.myIdentityId;
    (msg as any).recipientPeerIds = [conv.contactPeerId];
    (msg as any).ackedBy = [] as string[];
    (msg as any).ackedAt = {} as Record<string, number>;
    (msg as any).readBy = [] as string[];
    (msg as any).readAt = {} as Record<string, number>;

    const result = await this.messageStore.addMessage(msg);
    if (!result.success) {
      this.ui?.showToast('Failed to create message: ' + result.error, 'error');
      return;
    }

    const crdt = this.getOrCreateCRDT(conversationId);
    const crdtMsg = crdt.createMessage(conversationId, safeContent, 'text', threadId);
    (msg as any).vectorClock = crdtMsg.vectorClock;

    await this.persistMessage(msg);
    this.recordManifestDomain('channel-message', (conv as any).originWorkspaceId || 'direct', {
      channelId: conversationId,
      operation: 'create',
      subject: msg.id,
      itemCount: this.getChannelMessageCount(conversationId),
      data: { messageId: msg.id, senderId: this.state.myPeerId, isDirect: true },
    });

    // Ensure thread root snapshot exists for DM thread replies
    if (threadId) {
      await this.ensureThreadRoot(threadId, conversationId);
    }

    await this.directConversationStore.updateLastMessage(conversationId, msg.timestamp);
    const updatedConv = await this.directConversationStore.get(conversationId);
    if (updatedConv) {
      await this.persistentStore.saveDirectConversation(updatedConv);
    } else {
      await this.persistentStore.saveDirectConversation(conv);
    }
    this.ui?.updateSidebar({ refreshContacts: false });

    if (conversationId === this.state.activeChannelId) {
      if (threadId && this.state.threadOpen) {
        this.ui?.renderThreadMessages();
      } else if (!threadId) {
        this.ui?.appendMessageToDOM(msg, true);
      }
      // Update reply count on parent message for the sender
      if (threadId) {
        this.ui?.updateThreadIndicator(threadId, conversationId);
      }
    }

    // Encrypt and send to the contact
    const peerId = conv.contactPeerId;
    let attemptedDispatch = false;
    try {
      const envelope = await this.encryptMessageWithPreKeyBootstrap(peerId, safeContent, this.resolveSharedWorkspaceIds(peerId)[0]);
      (envelope as any).channelId = conversationId;
      (envelope as any).threadId = threadId;
      (envelope as any).vectorClock = (msg as any).vectorClock;
      (envelope as any).messageId = msg.id;
      (envelope as any).timestamp = msg.timestamp;
      (envelope as any).isDirect = true;
      if ((conv as any).originWorkspaceId) {
        (envelope as any).workspaceContextId = (conv as any).originWorkspaceId;
      }

      // Include thread root snapshot for DM thread replies
      if (threadId) {
        const threadRoot = this.messageStore.getThreadRoot(threadId);
        if (threadRoot) {
          (envelope as any).threadRootSnapshot = {
            senderId: threadRoot.senderId,
            senderIdentityId: (threadRoot as any).senderIdentityId,
            content: threadRoot.content,
            timestamp: threadRoot.timestamp,
            attachments: (threadRoot as any).attachments,
          };
        }
      }

      if (this.state.readyPeers.has(peerId)) {
        const sent = this.transport.send(peerId, envelope);
        if (sent === false) {
          await this.queueCustodyEnvelope(peerId, {
            envelopeId: typeof (envelope as any).id === 'string' ? (envelope as any).id : undefined,
            opId: msg.id,
            recipientPeerIds: [peerId],
            workspaceId: ((conv as any).originWorkspaceId || 'direct') as string,
            channelId: conversationId,
            ...(threadId ? { threadId } : {}),
            domain: 'channel-message',
            ciphertext: envelope,
            metadata: {
              messageId: msg.id,
              senderId: this.state.myPeerId,
              senderName: this.getDisplayNameForPeer(this.state.myPeerId),
              isDirect: true,
            },
          }, envelope);
          this.scheduleOfflineQueueFlush(peerId);
        }
      } else {
        await this.queueCustodyEnvelope(peerId, {
          envelopeId: typeof (envelope as any).id === 'string' ? (envelope as any).id : undefined,
          opId: msg.id,
          recipientPeerIds: [peerId],
          workspaceId: ((conv as any).originWorkspaceId || 'direct') as string,
          channelId: conversationId,
          ...(threadId ? { threadId } : {}),
          domain: 'channel-message',
          ciphertext: envelope,
          metadata: {
            messageId: msg.id,
            senderId: this.state.myPeerId,
            senderName: this.getDisplayNameForPeer(this.state.myPeerId),
            isDirect: true,
          },
        }, envelope);
      }
      attemptedDispatch = true;
    } catch (err) {
      console.error('Direct message send failed:', err);
    }

    if (attemptedDispatch && msg.status !== 'sent' && msg.status !== 'delivered') {
      msg.status = 'sent';
      await this.persistentStore.saveMessage({
        ...msg,
        status: 'sent',
        recipientPeerIds: [peerId],
        ackedBy: [],
        ackedAt: {},
        readBy: [],
        readAt: {},
      });
      this.ui?.updateMessageStatus?.(msg.id, 'sent', { acked: 0, total: 1, read: 0 });
    }

    const onlineRecipientsAfterDispatch = new Set(this.getOnlineRecipientPeerIds([peerId]));
    const recoveryRecipients = [peerId].filter((candidate) => !onlineRecipientsAfterDispatch.has(candidate));
    if (recoveryRecipients.length > 0) {
      this.kickOutgoingDeliveryRecovery(recoveryRecipients, 'outgoing-direct-send');
    }

  }

  async restoreContacts(): Promise<void> {
    const contacts = await this.persistentStore.getAllContacts();
    for (const c of contacts) {
      await this.contactStore.add(c);
    }

    const conversations = await this.persistentStore.getAllDirectConversations();
    for (const conv of conversations) {
      await this.directConversationStore.create(conv.contactPeerId);
      // Restore the actual conversation object with its ID
      const existing = await this.directConversationStore.getByContact(conv.contactPeerId);
      if (existing && existing.id !== conv.id) {
        // The in-memory store generated a new ID; we need the persisted one
        await this.directConversationStore.remove(existing.id);
      }
    }

    // Re-import persisted conversations directly to preserve IDs
    for (const conv of conversations) {
      (this.directConversationStore as any).conversations?.set(conv.id, conv);
      // Restore only the most recent messages for this conversation
      const messages = await this.persistentStore.getRecentChannelMessages(conv.id, 200);
      if (messages.length === 0) continue;

      // Bulk-insert into MessageStore — O(n log n) instead of per-message
      // forceAdd which was O(n²) due to linear duplicate scan.
      this.messageStore.bulkAdd(messages);

      // Bulk-merge into CRDT
      const crdt = this.getOrCreateCRDT(conv.id);
      const crdtMsgs = messages.map(msg => ({
        id: msg.id,
        channelId: msg.channelId,
        senderId: msg.senderId,
        content: msg.content,
        type: (msg.type || 'text') as any,
        vectorClock: msg.vectorClock || {},
        wallTime: msg.timestamp,
        prevHash: msg.prevHash || '',
      }));
      crdt.merge(crdtMsgs);
    }
  }

  // =========================================================================
  // Typing / Presence
  // =========================================================================

  private getPresenceProtocol(): PresenceProtocol {
    if (!(this as any).presenceProtocol) {
      (this as any).presenceProtocol = new PresenceProtocol();
    }
    return (this as any).presenceProtocol as PresenceProtocol;
  }

  private getPresenceScopeKey(workspaceId: string, channelId: string): string {
    return `${workspaceId}::${channelId}`;
  }

  private getPresenceCursorKey(cursor?: string): string {
    return cursor || '__root__';
  }

  private beginPresencePageRequest(workspaceId: string, channelId: string, cursor?: string): boolean {
    if (!this.presencePageRequestsByScope) {
      this.presencePageRequestsByScope = new Map<string, Set<string>>();
    }

    const scopeKey = this.getPresenceScopeKey(workspaceId, channelId);
    const cursorKey = this.getPresenceCursorKey(cursor);
    let inFlight = this.presencePageRequestsByScope.get(scopeKey);
    if (!inFlight) {
      inFlight = new Set<string>();
      this.presencePageRequestsByScope.set(scopeKey, inFlight);
    }

    if (inFlight.has(cursorKey)) return false;
    inFlight.add(cursorKey);
    return true;
  }

  private endPresencePageRequest(workspaceId: string, channelId: string, cursor?: string): void {
    if (!this.presencePageRequestsByScope) return;

    const scopeKey = this.getPresenceScopeKey(workspaceId, channelId);
    const cursorKey = this.getPresenceCursorKey(cursor);
    const inFlight = this.presencePageRequestsByScope.get(scopeKey);
    if (!inFlight) return;

    inFlight.delete(cursorKey);
    if (inFlight.size === 0) {
      this.presencePageRequestsByScope.delete(scopeKey);
    }
  }

  private resetPresencePageRequests(workspaceId: string, channelId: string): void {
    this.presencePageRequestsByScope?.delete(this.getPresenceScopeKey(workspaceId, channelId));
  }

  private requestPresencePage(
    workspaceId: string,
    channelId: string,
    options: { cursor?: string; pageSize?: number; preferredPeerId?: string } = {},
  ): boolean {
    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (!ws) return false;

    const cursor = options.cursor;
    if (!this.beginPresencePageRequest(workspaceId, channelId, cursor)) return false;

    const targetPeer = this.selectWorkspaceSyncTargetPeer(
      workspaceId,
      PRESENCE_AGGREGATOR_CAPABILITY,
      options.preferredPeerId,
    ) || this.getWorkspaceRecipientPeerIds(workspaceId).find((peerId) => this.state.readyPeers.has(peerId));

    if (!targetPeer || !this.state.readyPeers.has(targetPeer)) {
      this.endPresencePageRequest(workspaceId, channelId, cursor);
      return false;
    }

    const subscribe = this.getPresenceProtocol().buildSubscribeMessage(workspaceId, channelId, {
      pageCursor: cursor,
      pageSize: options.pageSize,
    });

    this.sendControlWithRetry(targetPeer, subscribe, { label: 'presence-subscribe' });
    setTimeout(
      () => this.endPresencePageRequest(workspaceId, channelId, cursor),
      PRESENCE_PAGE_REQUEST_TIMEOUT_MS,
    );
    return true;
  }

  private maybeRequestNextPresencePage(
    peerId: string,
    msg: PresencePageResponseMessage,
  ): void {
    if (!msg.nextCursor) return;
    if (typeof (this.presence as any).getActiveScope !== 'function') return;
    if (typeof (this.presence as any).getPresencePageSnapshot !== 'function') return;
    if (typeof (this.presence as any).getPresenceAggregate !== 'function') return;

    const activeScope = this.presence.getActiveScope();
    if (!activeScope) return;
    if (activeScope.workspaceId !== msg.workspaceId || activeScope.channelId !== msg.channelId) return;

    const pageSnapshot = this.presence.getPresencePageSnapshot(msg.workspaceId, msg.channelId);
    if (!pageSnapshot || !pageSnapshot.hasMore) return;

    const aggregate = this.presence.getPresenceAggregate(msg.workspaceId);
    const aggregateOnline = aggregate?.onlineCount ?? 0;
    const expectedOnline = Math.max(pageSnapshot.onlinePeerCount, aggregateOnline);
    const targetOnline = Math.min(expectedOnline, PRESENCE_AUTO_ADVANCE_PAGE_TARGET);

    if (targetOnline > 0 && pageSnapshot.onlinePeerCount >= targetOnline) return;

    this.requestPresencePage(msg.workspaceId, msg.channelId, {
      cursor: msg.nextCursor,
      pageSize: msg.pageSize,
      preferredPeerId: peerId,
    });
  }

  private sendCurrentPresenceSubscription(peerId: string): void {
    if (!this.state.readyPeers.has(peerId)) return;
    if (!this.presence || typeof (this.presence as any).getActiveScope !== 'function') return;

    const scope = this.presence.getActiveScope();
    if (!scope) return;
    if (!this.isWorkspaceMember(peerId, scope.workspaceId)) return;
    if (!this.workspaceManager.isMemberAllowedInChannel(scope.workspaceId, scope.channelId, peerId)) return;

    const subscribe = this.getPresenceProtocol().buildSubscribeMessage(scope.workspaceId, scope.channelId);
    this.sendControlWithRetry(peerId, subscribe, { label: 'presence-subscribe' });
  }

  private syncPresenceScopeForActiveChannel(channelId: string | null): void {
    if (!this.presence || typeof (this.presence as any).setActiveScope !== 'function') return;

    const transition = this.presence.setActiveScope(this.state.activeWorkspaceId, channelId);

    if (transition.unsubscribe) {
      this.fanoutPresenceScopeTransition('unsubscribe', transition.unsubscribe);
      this.resetPresencePageRequests(transition.unsubscribe.workspaceId, transition.unsubscribe.channelId);
    }
    if (transition.subscribe) {
      if (typeof (this.presence as any).resetPresencePageSnapshot === 'function') {
        this.presence.resetPresencePageSnapshot(transition.subscribe.workspaceId, transition.subscribe.channelId);
      }
      this.resetPresencePageRequests(transition.subscribe.workspaceId, transition.subscribe.channelId);
      this.fanoutPresenceScopeTransition('subscribe', transition.subscribe);
    }
  }

  private fanoutPresenceScopeTransition(
    kind: 'subscribe' | 'unsubscribe',
    scope: { workspaceId: string; channelId: string },
  ): void {
    const recipients = this
      .getWorkspaceRecipientPeerIds(scope.workspaceId)
      .filter((peerId) => this.state.readyPeers.has(peerId));

    if (recipients.length === 0) return;

    const presenceProtocol = this.getPresenceProtocol();
    const message = kind === 'subscribe'
      ? presenceProtocol.buildSubscribeMessage(scope.workspaceId, scope.channelId)
      : presenceProtocol.buildUnsubscribeMessage(scope.workspaceId, scope.channelId);

    for (const peerId of recipients) {
      if (!this.isWorkspaceMember(peerId, scope.workspaceId)) continue;
      this.sendControlWithRetry(peerId, message, { label: `presence-${kind}` });
    }
  }

  private handlePresenceSubscribe(peerId: string, msg: PresenceSubscribeMessage): void {
    if (!msg.workspaceId || !msg.channelId) return;
    if (!this.isWorkspaceMember(peerId, msg.workspaceId)) return;
    if (!this.workspaceManager.isMemberAllowedInChannel(msg.workspaceId, msg.channelId, peerId)) return;

    this.presence.trackPeerSubscription(peerId, msg.workspaceId, msg.channelId);
    this.sendPresenceSnapshot(peerId, msg.workspaceId, msg.channelId, msg.pageCursor, msg.pageSize);
  }

  private handlePresenceUnsubscribe(peerId: string, msg: PresenceUnsubscribeMessage): void {
    if (!msg.workspaceId || !msg.channelId) {
      this.presence.clearPeerSubscriptions(peerId);
      return;
    }

    this.presence.untrackPeerSubscription(peerId, msg.workspaceId, msg.channelId);
  }

  private handlePresenceAggregate(peerId: string, msg: PresenceAggregateMessage): void {
    if (!msg.workspaceId || !msg.aggregate) return;
    if (!this.isWorkspaceMember(peerId, msg.workspaceId)) return;
    if (msg.aggregate.workspaceId !== msg.workspaceId) return;

    this.presence.handlePresenceAggregate(msg.aggregate);

    if (this.state.activeWorkspaceId === msg.workspaceId) {
      this.ui?.updateSidebar({ refreshContacts: false });
      this.ui?.updateChannelHeader();
    }
  }

  private handlePresencePageResponse(peerId: string, msg: PresencePageResponseMessage): void {
    if (!msg.workspaceId || !msg.channelId) return;
    if (!this.isWorkspaceMember(peerId, msg.workspaceId)) return;

    this.endPresencePageRequest(msg.workspaceId, msg.channelId, msg.cursor);

    this.presence.handlePresencePageResponse({
      type: 'presence-page-response',
      workspaceId: msg.workspaceId,
      channelId: msg.channelId,
      cursor: msg.cursor,
      nextCursor: msg.nextCursor,
      pageSize: msg.pageSize,
      peers: msg.peers,
      updatedAt: msg.updatedAt,
    });

    if (this.state.activeWorkspaceId === msg.workspaceId) {
      this.ui?.updateSidebar({ refreshContacts: false });
      this.ui?.updateChannelHeader();
    }

    this.maybeRequestNextPresencePage(peerId, msg);
  }

  private sendPresenceSnapshot(
    peerId: string,
    workspaceId: string,
    channelId: string,
    cursor?: string,
    pageSize?: number,
  ): void {
    const subscribedPeers = this.presence
      .getSubscribedPeers(workspaceId, channelId)
      .filter((id) => this.state.readyPeers.has(id));

    const peerIds = new Set<string>([this.state.myPeerId, peerId, ...subscribedPeers]);
    const slices: PresencePeerSlice[] = [...peerIds].map((id) => ({
      peerId: id,
      status: id === this.state.myPeerId || this.state.readyPeers.has(id) ? 'online' : 'offline',
      lastSeen: Date.now(),
      typing: false,
    }));

    const presenceProtocol = this.getPresenceProtocol();
    const aggregate = presenceProtocol.buildAggregateMessage(workspaceId, {
      onlineCount: slices.filter((item) => item.status === 'online').length,
      activeChannelId: channelId,
    });

    this.sendControlWithRetry(peerId, aggregate, { label: 'presence-aggregate' });
    this.presence.handlePresenceAggregate(aggregate.aggregate);

    const page = presenceProtocol.buildPageResponseMessage(workspaceId, channelId, slices, {
      cursor,
      pageSize,
    });
    this.sendControlWithRetry(peerId, page, { label: 'presence-page-response' });
  }

  private getInviteAdditionalPeerIds(workspaceId: string, maxPeers = 3, now = Date.now()): string[] {
    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (!ws || maxPeers <= 0) return [];

    const connectedSet = new Set<string>(this.getTransportConnectedPeerIds());
    const picked: string[] = [];
    const addPeer = (peerId: string): void => {
      if (!peerId || peerId === this.state.myPeerId) return;
      if (picked.includes(peerId)) return;
      if (picked.length >= maxPeers) return;
      picked.push(peerId);
    };

    // Safety rollout: keep legacy connected-first behavior while the feature flag is off.
    if (!this.isPartialMeshEnabled()) {
      for (const member of ws.members) {
        if (connectedSet.has(member.peerId)) addPeer(member.peerId);
      }
      for (const member of ws.members) {
        addPeer(member.peerId);
      }
      return picked;
    }

    const candidates = this.getWorkspacePeerCandidates(workspaceId, now);
    const rankedCandidates = this.rankWorkspacePeers(candidates, now);
    const preferredDesired = this.selectDesiredPeers(workspaceId, now);
    const desiredSet = new Set(preferredDesired.desiredPeerIds);

    for (const candidate of rankedCandidates) {
      if (!desiredSet.has(candidate.peerId)) continue;
      if (!connectedSet.has(candidate.peerId)) continue;
      addPeer(candidate.peerId);
    }

    for (const candidate of rankedCandidates) {
      if (!desiredSet.has(candidate.peerId)) continue;
      addPeer(candidate.peerId);
    }

    for (const candidate of rankedCandidates) {
      if (!connectedSet.has(candidate.peerId)) continue;
      addPeer(candidate.peerId);
    }

    for (const member of ws.members) {
      addPeer(member.peerId);
    }

    return picked;
  }

  /** Generate a full invite URL for a workspace (signed, expiring by default). */
  async generateInviteURL(workspaceId: string, opts?: { permanent?: boolean }): Promise<string> {
    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (!ws) return '';

    if (!this.workspaceManager.canInviteMembers(workspaceId, this.state.myPeerId)) {
      this.ui?.showToast('You do not have permission to create invites in this workspace', 'error');
      return '';
    }

    const permanent = opts?.permanent === true;

    // Parse primary signaling server
    const defaultServer = getDefaultSignalingServer();
    const { host, port, secure, path } = this.parseSignalingURL(defaultServer);

    // Collect up to 3 topology-aligned peers for multi-peer join resilience.
    // Prefer desired/healthy peers first, then connected fallbacks, then known members.
    const additionalPeers = this.getInviteAdditionalPeerIds(workspaceId, 3);

    // Signed invites must embed the SIGNING public key (ECDSA), not the
    // transport/encryption public key. Otherwise signature verification fails
    // on the receiving side and valid invites are rejected as tampered.
    let inviteVerificationPublicKey: string | undefined = this.myPublicKey || undefined;
    if (this.signingKeyPair?.publicKey) {
      try {
        inviteVerificationPublicKey = await this.cryptoManager.exportPublicKey(this.signingKeyPair.publicKey);
      } catch (err) {
        console.warn('[DecentChat] Failed to export signing public key for invite verification, falling back:', err);
      }
    }

    const myWorkspaceMember = ws.members.find((m: any) => m.peerId === this.state.myPeerId);

    // Build InviteData with security fields
    const inviteData: InviteData = {
      host,
      port,
      inviteCode: ws.inviteCode,
      secure,
      path,
      fallbackServers: [],
      turnServers: [],
      peerId: this.state.myPeerId,
      peers: additionalPeers.length > 0 ? additionalPeers : undefined,
      publicKey: inviteVerificationPublicKey,
      transportPublicKey: this.myPublicKey || undefined,
      inviterAlias: this.getMyAliasForWorkspace(workspaceId),
      inviterIsBot: myWorkspaceMember?.isBot || undefined,
      inviterAllowWorkspaceDMs: myWorkspaceMember?.allowWorkspaceDMs !== false,
      workspaceName: ws.name || undefined,
      workspaceId: ws.id,
      // Invite security: 7-day expiration by default, unlimited uses, signed by inviter
      expiresAt: permanent ? undefined : Date.now() + 7 * 24 * 60 * 60 * 1000,
      maxUses: 0,
      inviteId: this.createInviteId(),
      inviterId: this.state.myPeerId,
    };

    // Sign invite with ECDSA key if available
    if (this.signingKeyPair?.privateKey) {
      try {
        inviteData.signature = await signInvite(this.signingKeyPair.privateKey, inviteData);
      } catch (err) {
        console.warn('[DecentChat] Failed to sign invite:', err);
        // Continue without signature — backward compatible
      }
    }

    // Use InviteURI.encode to generate proper URL (InviteURI hardcodes https, fix for localhost)
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const webDomain = isLocal ? `${window.location.hostname}:${window.location.port}` : 'decentchat.app';
    const url = InviteURI.encode(inviteData, webDomain);
    const finalUrl = isLocal ? url.replace('https://', 'http://') : url;

    this.workspaceInviteRegistry = recordGeneratedInvite(
      this.workspaceInviteRegistry,
      workspaceId,
      inviteData,
      finalUrl,
    );
    await this.persistWorkspaceInviteRegistry();

    return finalUrl;
  }

  private createInviteId(): string {
    // 12-char stable token for this invite instance (short but collision-resistant enough for local admin revocation lists).
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  }

  private findMessageById(messageId: string): PlaintextMessage | null {
    for (const channelId of this.messageStore.getAllChannelIds()) {
      const msg = this.messageStore.getMessages(channelId).find(m => m.id === messageId);
      if (msg) return msg;
    }
    return null;
  }

  /** Parse a WebSocket signaling URL into host/port/secure/path components */
  private parseSignalingURL(url: string): { host: string; port: number; secure: boolean; path: string } {
    // Handle ws://host:port/path or wss://host:port/path
    const match = url.match(/^(wss?):\/\/([^:/]+)(?::(\d+))?(\/.*)?$/);
    if (!match) {
      throw new Error(`Invalid signaling URL: ${url}`);
    }

    const [, protocol, host, portStr, path] = match;
    const secure = protocol === 'wss';
    const port = portStr ? parseInt(portStr, 10) : (secure ? 443 : 80);

    return { host, port, secure, path: path || '/peerjs' };
  }

  /** Toggle a reaction on a message and broadcast to peers */
  toggleReaction(messageId: string, emoji: string): void {
    const event = this.reactions.toggleReaction(messageId, emoji, this.state.myPeerId);
    if (event && this.state.activeChannelId) {
      event.channelId = this.state.activeChannelId;
      event.workspaceId = this.state.activeWorkspaceId ?? undefined;
      this.broadcastToWorkspacePeers(event);
    }
  }

  /** Broadcast typing indicator to subscribed peers for the active channel */
  broadcastTyping(): void {
    const channelId = this.state.activeChannelId;
    if (!channelId) return;
    if (!this.presence || typeof (this.presence as any).createTypingEvent !== 'function') return;

    const event = this.presence.createTypingEvent(channelId, this.state.myPeerId, this.state.activeWorkspaceId ?? undefined);
    if (!event) return; // Throttled

    for (const peerId of this.getScopedTypingRecipientPeerIds()) {
      try { this.transport.send(peerId, event); } catch {}
    }
  }

  /** Broadcast stop typing */
  broadcastStopTyping(): void {
    const channelId = this.state.activeChannelId;
    if (!channelId) return;
    if (!this.presence || typeof (this.presence as any).createStopTypingEvent !== 'function') return;

    const event = this.presence.createStopTypingEvent(channelId, this.state.myPeerId, this.state.activeWorkspaceId ?? undefined);
    for (const peerId of this.getScopedTypingRecipientPeerIds()) {
      try { this.transport.send(peerId, event); } catch {}
    }
  }

  private getScopedTypingRecipientPeerIds(): string[] {
    const workspaceId = this.state.activeWorkspaceId;
    const channelId = this.state.activeChannelId;
    const readyWorkspacePeers = this
      .getWorkspaceRecipientPeerIds(workspaceId ?? undefined)
      .filter((peerId) => this.state.readyPeers.has(peerId));

    if (!workspaceId || !channelId) {
      return readyWorkspacePeers;
    }

    if (!this.presence || typeof (this.presence as any).getSubscribedPeers !== 'function') {
      return readyWorkspacePeers;
    }

    const subscribed = this.presence
      .getSubscribedPeers(workspaceId, channelId)
      .filter((peerId) => readyWorkspacePeers.includes(peerId));

    // Backward compatibility: if no peer opted into scoped subscriptions,
    // keep legacy workspace fanout.
    return subscribed.length > 0 ? subscribed : readyWorkspacePeers;
  }

  // =========================================================================
  // Huddle (voice calling)
  // =========================================================================

  /** Initialize HuddleManager — call after myPeerId is known */
  initHuddle(): void {
    this.huddle = new HuddleManager(this.state.myPeerId, {
      onStateChange: (state, channelId) => {
        this.ui?.onHuddleStateChange?.(state, channelId);
      },
      onParticipantsChange: (participants) => {
        this.ui?.onHuddleParticipantsChange?.(participants);
      },
      onError: (msg) => {
        this.ui?.showToast(msg, 'error');
      },
      sendSignal: (peerId, data) => {
        this.transport.send(peerId, data);
      },
      broadcastSignal: (data) => {
        for (const peerId of this.getWorkspaceRecipientPeerIds()) {
          try { this.transport.send(peerId, data); } catch {}
        }
      },
      getConnectedPeers: () => this.getTransportConnectedPeerIds(),
      getDisplayName: (peerId) => this.getDisplayNameForPeer(peerId),
    });
  }

  async startHuddle(channelId: string): Promise<void> {
    // Guard: check signaling server connectivity before starting a huddle.
    // Without signaling, we cannot discover or reach peers, so the huddle
    // would silently fail with no user feedback.
    const signalingStatus = typeof this.transport?.getSignalingStatus === 'function'
      ? this.transport.getSignalingStatus()
      : [];
    const signalingConnected = signalingStatus.length === 0 ||
      signalingStatus.some((s: any) => !!s.connected);

    if (!signalingConnected) {
      this.ui?.showToast('Huddle unavailable — not connected to signaling server', 'error');
      return;
    }

    await this.huddle?.startHuddle(channelId);
  }

  async joinHuddle(channelId: string): Promise<void> {
    // Guard: check signaling server connectivity before joining a huddle.
    const signalingStatus = typeof this.transport?.getSignalingStatus === 'function'
      ? this.transport.getSignalingStatus()
      : [];
    const signalingConnected = signalingStatus.length === 0 ||
      signalingStatus.some((s: any) => !!s.connected);

    if (!signalingConnected) {
      this.ui?.showToast('Huddle unavailable — not connected to signaling server', 'error');
      return;
    }

    await this.huddle?.joinHuddle(channelId);
  }

  async leaveHuddle(): Promise<void> {
    await this.huddle?.leaveHuddle();
  }

  toggleHuddleMute(): boolean {
    return this.huddle?.toggleMute() ?? false;
  }

  private async handleDirectCallSignal(peerId: string, data: { type?: string; channelId?: string }): Promise<void> {
    const type = data?.type;
    if (!type) return;

    const myPeerId = this.state.myPeerId;
    if (!myPeerId) return;

    const callerName = this.getDisplayNameForPeer(peerId);
    const channelId = typeof data.channelId === 'string' && data.channelId.trim().length > 0
      ? data.channelId.trim()
      : undefined;

    const respond = (responseType: 'call-accept' | 'call-decline' | 'call-busy') => {
      this.sendControlWithRetry(peerId, {
        type: responseType,
        channelId,
        fromPeerId: myPeerId,
        peerId: myPeerId,
      }, { label: responseType });
    };

    if (type === 'call-ring') {
      if (!channelId || !this.huddle) {
        respond('call-busy');
        return;
      }

      if (this.huddle.getState() === 'in-call') {
        respond('call-busy');
        this.ui?.showToast(`${callerName} is calling, but you're already in a call.`, 'info');
        return;
      }

      await this.huddle.joinHuddle(channelId);

      const joined = this.huddle.getState() === 'in-call' && this.huddle.getActiveChannelId() === channelId;
      if (!joined) {
        respond('call-decline');
        this.ui?.showToast(`Missed call from ${callerName}.`, 'error');
        return;
      }

      const wsForCall = this.findWorkspaceByChannelId(channelId);
      if (wsForCall) {
        this.state.activeWorkspaceId = wsForCall.id;
        this.state.activeChannelId = channelId;
        this.ui?.updateSidebar({ refreshContacts: false });
        this.ui?.renderMessages();
      }

      respond('call-accept');
      this.ui?.showToast(`Connected call with ${callerName}.`, 'success');
      return;
    }

    if (type === 'call-accept') {
      this.ui?.showToast(`${callerName} accepted the call.`, 'success');
      return;
    }

    if (type === 'call-decline') {
      this.ui?.showToast(`${callerName} declined the call.`, 'info');
      return;
    }

    if (type === 'call-busy') {
      this.ui?.showToast(`${callerName} is busy right now.`, 'info');
    }
  }

  /** Send read receipt for a message */
  sendReadReceipt(channelId: string, messageId: string): void {
    const receipt = this.presence.createReadReceipt(channelId, messageId, this.state.myPeerId);
    const recipients = this.getWorkspaceRecipientPeerIds();
    const workspaceId = this.findWorkspaceByChannelId(channelId)?.id || this.state.activeWorkspaceId || 'direct';

    for (const peerId of recipients) {
      if (this.state.readyPeers.has(peerId)) {
        try {
          const sent = this.transport.send(peerId, receipt);
          if (sent === false) {
            void this.queueCustodyEnvelope(peerId, {
              opId: messageId,
              recipientPeerIds: [peerId],
              workspaceId,
              channelId,
              domain: 'receipt',
              ciphertext: receipt,
              metadata: { kind: 'read' },
            }, receipt);
          }
        } catch {
          void this.queueCustodyEnvelope(peerId, {
            opId: messageId,
            recipientPeerIds: [peerId],
            workspaceId,
            channelId,
            domain: 'receipt',
            ciphertext: receipt,
            metadata: { kind: 'read' },
          }, receipt);
        }
      } else {
        void this.queueCustodyEnvelope(peerId, {
          opId: messageId,
          recipientPeerIds: [peerId],
          workspaceId,
          channelId,
          domain: 'receipt',
          ciphertext: receipt,
          metadata: { kind: 'read' },
        }, receipt);
      }
    }

    this.recordManifestDomain('receipt', workspaceId, {
      channelId,
      operation: 'create',
      subject: messageId,
      data: { kind: 'read', senderId: this.state.myPeerId },
    });
  }

  private broadcastToWorkspacePeers(data: any): void {
    const recipients = this.getWorkspaceRecipientPeerIds();
    for (const peerId of recipients) {
      if (this.state.readyPeers.has(peerId)) {
        try { this.transport.send(peerId, data); } catch {}
      }
    }
  }

  // =========================================================================
  // Media / Attachments
  // =========================================================================

  /**
   * Send a message with a file attachment.
   * Encrypts blob, creates metadata + thumbnail, sends message,
   * then streams chunks to peers on demand.
   */
  async sendAttachment(file: File, text?: string, threadId?: string): Promise<void> {
    if (!this.state.activeChannelId) return;

    // Read file
    const arrayBuffer = await file.arrayBuffer();
    const hash = await hashBlob(arrayBuffer);

    // Generate thumbnail (browser-only, async)
    let thumbnail: string | undefined;
    let width: number | undefined;
    let height: number | undefined;

    if (file.type.startsWith('image/')) {
      try {
        const result = await generateImageThumbnail(file);
        if (result) {
          thumbnail = result.data;
          width = result.width;
          height = result.height;
        } else {
          console.warn('[sendAttachment] generateImageThumbnail returned null for', file.name, file.type);
        }
      } catch (err) {
        console.warn('[sendAttachment] generateImageThumbnail failed:', err);
      }
    }

    // Create attachment metadata
    const meta = await createAttachmentMeta(
      { name: file.name, size: file.size, type: file.type },
      hash,
      { thumbnail, width, height },
    );

    const encrypted = await this.encryptAttachmentBlob(arrayBuffer);
    meta.iv = encrypted.iv;
    meta.encryptionKey = encrypted.encryptionKey;
    meta.encryptedHash = await hashBlob(encrypted.ciphertext);

    // Store locally
    const wsId = this.state.activeWorkspaceId || 'default';
    await this.mediaStore.store(wsId, meta, encrypted.ciphertext);

    // Create chunked sender for when peers request it
    this.activeSenders.set(meta.id, new ChunkedSender(meta.id, arrayBuffer));

    // Send message with attachment metadata
    const normalizedAttachmentText = normalizeOutgoingMessageContent(text || `📎 ${file.name}`);
    if (normalizedAttachmentText.truncated) {
      this.ui?.showToast(`Message was truncated to ${MAX_MESSAGE_CHARS.toLocaleString()} characters`, 'info');
    }
    const content = normalizedAttachmentText.text || `📎 ${file.name}`;
    const msg = await this.messageStore.createMessage(
      this.state.activeChannelId,
      this.state.myPeerId,
      content,
      'text',
      threadId,
    );
    if (this.myIdentityId) (msg as any).senderIdentityId = this.myIdentityId;
    (msg as any).attachments = [meta];
    const recipientPeerIds = this.getChannelDeliveryPeerIds(
      this.state.activeChannelId ?? undefined,
      this.state.activeWorkspaceId ?? undefined,
    );
    const statusRecipientPeerIds = this.getOnlineRecipientPeerIds(recipientPeerIds);
    (msg as any).recipientPeerIds = recipientPeerIds;
    (msg as any).statusRecipientPeerIds = statusRecipientPeerIds;
    (msg as any).ackedBy = [] as string[];
    (msg as any).ackedAt = {} as Record<string, number>;
    (msg as any).readBy = [] as string[];
    (msg as any).readAt = {} as Record<string, number>;

    const result = await this.messageStore.addMessage(msg);
    if (!result.success) return;

    const crdt = this.getOrCreateCRDT(this.state.activeChannelId);
    const crdtResult = crdt.createMessage(this.state.myPeerId, content);
    (msg as any).vectorClock = crdtResult.vectorClock;

    await this.persistMessage(msg);
    this.recordManifestDomain('channel-message', this.state.activeWorkspaceId ?? undefined, {
      channelId: this.state.activeChannelId ?? undefined,
      operation: 'create',
      subject: msg.id,
      itemCount: this.getChannelMessageCount(this.state.activeChannelId ?? undefined),
      data: { messageId: msg.id, senderId: this.state.myPeerId, hasAttachment: true },
    });
    if (threadId && this.state.threadOpen) {
      this.ui?.renderThreadMessages();
      this.ui?.updateThreadIndicator(threadId, this.state.activeChannelId);
    } else if (!threadId) {
      this.ui?.appendMessageToDOM(msg, true);
    }

    // Send to workspace peers
    let attemptedDispatch = false;
    for (const peerId of recipientPeerIds) {
      try {
        const envelope = await this.encryptMessageWithPreKeyBootstrap(peerId, content, this.state.activeWorkspaceId ?? undefined);
        (envelope as any).channelId = this.state.activeChannelId;
        (envelope as any).workspaceId = this.state.activeWorkspaceId;
        (envelope as any).threadId = threadId;
        (envelope as any).messageId = msg.id;  // receiver must use same ID so reactions sync
        if (this.state.activeChannelId) {
          const gossipOriginSignature = await this.signGossipOrigin({
            messageId: msg.id,
            channelId: this.state.activeChannelId,
            content,
            threadId,
          });
          if (gossipOriginSignature) {
            (envelope as any)._gossipOriginSignature = gossipOriginSignature;
          }
        }
        (envelope as any).timestamp = msg.timestamp;
        (envelope as any).vectorClock = (msg as any).vectorClock;
        (envelope as any).attachments = [meta]; // Metadata travels with message

        if (this.state.readyPeers.has(peerId)) {
          const sent = this.transport.send(peerId, envelope);
          if (sent !== false) {
            this.schedulePendingDeliveryWatch(peerId, this.state.activeChannelId!, msg.id, this.state.activeWorkspaceId ?? undefined);
          }
          if (sent === false) {
            await this.queueCustodyEnvelope(peerId, {
              envelopeId: typeof (envelope as any).id === 'string' ? (envelope as any).id : undefined,
              opId: msg.id,
              recipientPeerIds: [peerId],
              workspaceId: this.state.activeWorkspaceId || 'direct',
              channelId: this.state.activeChannelId,
              ...(threadId ? { threadId } : {}),
              domain: 'channel-message',
              ciphertext: envelope,
              metadata: {
                messageId: msg.id,
                senderId: this.state.myPeerId,
                senderName: this.getDisplayNameForPeer(this.state.myPeerId),
                hasAttachment: true,
              },
            }, envelope);
            this.scheduleOfflineQueueFlush(peerId);
          }
        } else {
          await this.queueCustodyEnvelope(peerId, {
            envelopeId: typeof (envelope as any).id === 'string' ? (envelope as any).id : undefined,
            opId: msg.id,
            recipientPeerIds: [peerId],
            workspaceId: this.state.activeWorkspaceId || 'direct',
            channelId: this.state.activeChannelId,
            ...(threadId ? { threadId } : {}),
            domain: 'channel-message',
            ciphertext: envelope,
            metadata: {
              messageId: msg.id,
              senderId: this.state.myPeerId,
              senderName: this.getDisplayNameForPeer(this.state.myPeerId),
              hasAttachment: true,
            },
          }, envelope);
          await this.replicateToCustodians(peerId, { workspaceId: this.state.activeWorkspaceId, channelId: this.state.activeChannelId, opId: msg.id, domain: 'channel-message' });
        }
        attemptedDispatch = true;
      } catch (err) {
        console.error('Send attachment to', peerId, 'failed:', err);
      }
    }

    if (attemptedDispatch && msg.status !== 'sent' && msg.status !== 'delivered') {
      msg.status = 'sent';
      await this.persistentStore.saveMessage({
        ...msg,
        status: 'sent',
        recipientPeerIds,
        ackedBy: [],
        ackedAt: {},
        readBy: [],
        readAt: {},
      });
      this.ui?.updateMessageStatus?.(msg.id, 'sent', { acked: 0, total: statusRecipientPeerIds.length, read: 0 });
    }

    const onlineRecipientsAfterDispatch = new Set(this.getOnlineRecipientPeerIds(recipientPeerIds));
    const recoveryRecipients = recipientPeerIds.filter((peerId) => !onlineRecipientsAfterDispatch.has(peerId));
    if (recoveryRecipients.length > 0) {
      this.kickOutgoingDeliveryRecovery(recoveryRecipients, 'outgoing-attachment-send');
    }
  }

  /**
   * Request a media blob from a peer
   */
  requestMedia(peerId: string, attachmentId: string): void {
    const request: MediaRequest = { type: 'media-request', attachmentId };
    this.transport.send(peerId, request);
  }

  async resolveAttachmentImageUrl(attachmentId: string): Promise<string | null> {
    const attachment = this.mediaStore.getAttachment(attachmentId) as AttachmentMeta | undefined;
    if (!attachment) return null;

    let encryptedBlob = await this.mediaStore.getBlob(attachmentId);

    // If not available locally, request from currently connected peers and wait briefly.
    if (!encryptedBlob) {
      for (const peerId of this.state.connectedPeers) {
        this.requestMedia(peerId, attachmentId);
      }

      const timeoutAt = Date.now() + 8000;
      while (Date.now() < timeoutAt) {
        await new Promise(resolve => setTimeout(resolve, 250));
        encryptedBlob = await this.mediaStore.getBlob(attachmentId);
        if (encryptedBlob) break;
      }
    }

    if (!encryptedBlob) return null;

    const clearBlob = await this.decryptStoredAttachmentBlob(attachmentId, encryptedBlob);
    const mimeType = attachment.mimeType || 'image/jpeg';
    return URL.createObjectURL(new Blob([clearBlob], { type: mimeType }));
  }

  /** Handle incoming media request — start sending chunks */
  private async handleMediaRequest(peerId: string, request: MediaRequest): Promise<void> {
    // Create sender if needed
    if (!this.activeSenders.has(request.attachmentId)) {
      const encryptedBlob = await this.mediaStore.getBlob(request.attachmentId);
      if (!encryptedBlob) {
        // We don't have this blob — tell the requester
        const response: MediaResponse = {
          type: 'media-response',
          attachmentId: request.attachmentId,
          available: false,
        };
        this.transport.send(peerId, response);
        return;
      }

      const blob = await this.decryptStoredAttachmentBlob(request.attachmentId, encryptedBlob);
      this.activeSenders.set(request.attachmentId, new ChunkedSender(request.attachmentId, blob));
    }
    const sender = this.activeSenders.get(request.attachmentId)!;

    // Send availability response
    const response: MediaResponse = {
      type: 'media-response',
      attachmentId: request.attachmentId,
      available: true,
      totalChunks: sender.totalChunks,
    };
    this.transport.send(peerId, response);

    // Stream all chunks
    const fromChunk = request.fromChunk ?? 0;
    for await (const chunk of sender.chunks(fromChunk)) {
      this.transport.send(peerId, { type: 'media-chunk', ...chunk });
    }
  }

  /** Handle media availability response */
  private async handleMediaResponse(peerId: string, response: MediaResponse): Promise<void> {
    if (!response.available) {
      // Silent no-op: peer doesn't have requested media.
      return;
    }

    // Create receiver
    const att = this.mediaStore.getAttachment(response.attachmentId);
    if (!att) return;

    const receiver = new ChunkedReceiver(
      response.attachmentId,
      response.totalChunks!,
      att.hash,
    );
    this.activeTransfers.set(response.attachmentId, receiver);
  }

  /** Handle incoming media chunk */
  private async handleMediaChunk(_peerId: string, chunk: MediaChunk): Promise<void> {
    const receiver = this.activeTransfers.get(chunk.attachmentId);
    if (!receiver) return;

    try {
      const progress = await receiver.addChunk(chunk);

      // Update UI with progress
      // TODO: show progress bar in message attachment

      if (receiver.isComplete()) {
        const blob = await receiver.assemble();
        const wsId = this.state.activeWorkspaceId || 'default';
        const att = this.mediaStore.getAttachment(chunk.attachmentId);
        if (att) {
          const encrypted = await this.encryptAttachmentBlob(blob, att);
          await this.mediaStore.store(wsId, {
            ...att,
            iv: encrypted.iv,
            encryptionKey: encrypted.encryptionKey,
            encryptedHash: await hashBlob(encrypted.ciphertext),
          } as AttachmentMeta, encrypted.ciphertext);
        }
        this.activeTransfers.delete(chunk.attachmentId);
        this.ui?.showToast(`📥 Downloaded ${att?.name || 'attachment'}`, 'success');
      }
    } catch (err) {
      this.ui?.showToast(`Download failed: ${(err as Error).message}`, 'error');
      this.activeTransfers.delete(chunk.attachmentId);
    }
  }

  /**
   * Get storage stats for display
   */
  getStorageStats() {
    return this.mediaStore.getStats();
  }

  getWorkspaceStorageStats(workspaceId: string) {
    return this.mediaStore.getWorkspaceStats(workspaceId);
  }

  async pruneWorkspaceMedia(workspaceId: string): Promise<number> {
    return this.mediaStore.pruneWorkspace(workspaceId);
  }

  async pruneOldMedia(ageMs: number): Promise<number> {
    return this.mediaStore.pruneOlderThan(ageMs);
  }

  private async encryptAttachmentBlob(
    data: ArrayBuffer,
    existingMeta?: Partial<AttachmentMeta> & { encryptionKey?: string }
  ): Promise<{ ciphertext: ArrayBuffer; iv: string; encryptionKey: string }> {
    let aesKey: CryptoKey;
    let encryptionKey = existingMeta?.encryptionKey;
    let ivBytes: Uint8Array<ArrayBuffer>;

    if (encryptionKey) {
      aesKey = await this.importAesKeyFromBase64Jwk(encryptionKey);
    } else {
      aesKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      );
      encryptionKey = await this.exportAesKeyToBase64Jwk(aesKey);
    }

    if (existingMeta?.iv) {
      ivBytes = new Uint8Array(this.base64ToArrayBuffer(existingMeta.iv));
    } else {
      ivBytes = new Uint8Array(crypto.getRandomValues(new Uint8Array(12)));
    }

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: ivBytes },
      aesKey,
      data,
    );

    return {
      ciphertext,
      iv: this.arrayBufferToBase64(ivBytes.buffer as ArrayBuffer),
      encryptionKey,
    };
  }

  private async decryptStoredAttachmentBlob(attachmentId: string, encryptedBlob: ArrayBuffer): Promise<ArrayBuffer> {
    const attachment = this.mediaStore.getAttachment(attachmentId) as (AttachmentMeta & { encryptionKey?: string }) | undefined;
    if (!attachment?.encryptionKey || !attachment.iv) {
      return encryptedBlob;
    }

    const key = await this.importAesKeyFromBase64Jwk(attachment.encryptionKey);
    const iv = this.base64ToArrayBuffer(attachment.iv);
    return await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      key,
      encryptedBlob,
    );
  }

  private async exportAesKeyToBase64Jwk(key: CryptoKey): Promise<string> {
    const jwk = await crypto.subtle.exportKey('jwk', key);
    return btoa(JSON.stringify(jwk));
  }

  private async importAesKeyFromBase64Jwk(keyBase64: string): Promise<CryptoKey> {
    const jwk = JSON.parse(atob(keyBase64));
    return await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt'],
    );
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  private getIceServersFromEnv(): RTCIceServer[] | undefined {
    const env = (import.meta as any).env || {};
    const turnUrls: string[] = [];

    if (typeof env.VITE_TURN_URL === 'string' && env.VITE_TURN_URL.trim()) {
      turnUrls.push(env.VITE_TURN_URL.trim());
    }
    if (typeof env.VITE_TURNS_URL === 'string' && env.VITE_TURNS_URL.trim()) {
      turnUrls.push(env.VITE_TURNS_URL.trim());
    }
    if (typeof env.VITE_TURN_URLS === 'string' && env.VITE_TURN_URLS.trim()) {
      turnUrls.push(...env.VITE_TURN_URLS.split(',').map((s: string) => s.trim()).filter(Boolean));
    }

    // No custom TURN configured — let PeerTransport._resolveIceServers() decide (uses DEFAULT_TURN_SERVERS)
    if (turnUrls.length === 0) return undefined;

    const username = typeof env.VITE_TURN_USERNAME === 'string' ? env.VITE_TURN_USERNAME : '';
    const credential = typeof env.VITE_TURN_CREDENTIAL === 'string'
      ? env.VITE_TURN_CREDENTIAL
      : (typeof env.VITE_TURN_PASSWORD === 'string' ? env.VITE_TURN_PASSWORD : '');

    const customTurn: RTCIceServer[] = turnUrls.map((url) => ({
      urls: url,
      ...(username ? { username } : {}),
      ...(credential ? { credential } : {}),
    }));

    // Always include STUN alongside custom TURN for best connectivity
    return [...ICE_SERVERS_WITH_TURN, ...customTurn];
  }

  // =========================================================================
  // Message sync (reconnect catch-up)
  // =========================================================================

  private isCustodyEnvelope(value: unknown): value is CustodyEnvelope {
    if (!value || typeof value !== 'object') return false;
    const envelope = value as Partial<CustodyEnvelope>;
    return typeof envelope.envelopeId === 'string'
      && typeof envelope.opId === 'string'
      && Array.isArray(envelope.recipientPeerIds)
      && typeof envelope.workspaceId === 'string'
      && typeof envelope.domain === 'string'
      && 'ciphertext' in envelope;
  }

  private async loadCustodianInbox(): Promise<void> {
    const raw = await this.persistentStore.getSetting('custodyInbox');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      this.custodianInbox.clear();
      for (const item of parsed) {
        if (this.isCustodyEnvelope(item)) {
          this.custodianInbox.set(item.envelopeId, item);
        }
      }
    } catch {
      // ignore malformed cache
    }
  }

  private async persistCustodianInbox(): Promise<void> {
    await this.persistentStore.saveSetting('custodyInbox', JSON.stringify([...this.custodianInbox.values()]));
  }

  private isDeferredGossipIntent(value: any): value is DeferredGossipIntent {
    return value
      && typeof value.intentId === 'string'
      && typeof value.targetPeerId === 'string'
      && typeof value.upstreamPeerId === 'string'
      && typeof value.originalMessageId === 'string'
      && typeof value.originalSenderId === 'string'
      && typeof value.plaintext === 'string'
      && typeof value.channelId === 'string'
      && typeof value.hop === 'number'
      && typeof value.createdAt === 'number';
  }

  private async loadDeferredGossipIntents(nowMs = Date.now()): Promise<void> {
    const raw = await this.persistentStore.getSetting('deferredGossipIntents');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      this.deferredGossipIntents.clear();
      for (const item of parsed) {
        if (this.isDeferredGossipIntent(item)) {
          this.deferredGossipIntents.set(item.intentId, item);
        }
      }
      await this.pruneExpiredDeferredGossipIntents(nowMs);
    } catch {
      // ignore malformed cache
    }
  }

  private async persistDeferredGossipIntents(): Promise<void> {
    await this.persistentStore.saveSetting('deferredGossipIntents', JSON.stringify([...this.deferredGossipIntents.values()]));
  }

  private async pruneExpiredDeferredGossipIntents(nowMs = Date.now()): Promise<void> {
    const intents = this.deferredGossipIntents;
    if (!intents) return;

    const cutoff = nowMs - DEFERRED_GOSSIP_INTENT_TTL_MS;
    let changed = false;
    for (const [intentId, intent] of intents) {
      if (intent.createdAt < cutoff) {
        intents.delete(intentId);
        this.clearDeferredGossipIntentOfferState(intentId);
        this.clearDeferredGossipIntentInboundState(intentId);
        changed = true;
      }
    }

    if (changed) {
      await this.persistDeferredGossipIntents();
    }
  }

  private getDeferredGossipIntentOfferKey(intentId: string, peerId: string): string {
    return `${intentId}::${peerId}`;
  }

  private clearDeferredGossipIntentOfferState(intentId: string): void {
    const offerState = this.deferredGossipIntentOfferState;
    if (!offerState) return;
    const prefix = `${intentId}::`;
    for (const key of offerState.keys()) {
      if (key.startsWith(prefix)) offerState.delete(key);
    }
  }

  private clearDeferredGossipIntentInboundState(intentId: string): void {
    const inboundState = this.deferredGossipIntentInboundState;
    if (!inboundState) return;
    const suffix = `::${intentId}`;
    for (const key of inboundState.keys()) {
      if (key.endsWith(suffix)) inboundState.delete(key);
    }
  }

  private getDeferredGossipIntentInboundKey(peerId: string, intentId: string): string {
    return `${peerId}::${intentId}`;
  }

  private areDeferredGossipIntentsEquivalent(a: DeferredGossipIntent, b: DeferredGossipIntent): boolean {
    return a.intentId === b.intentId
      && a.targetPeerId === b.targetPeerId
      && a.upstreamPeerId === b.upstreamPeerId
      && a.originalMessageId === b.originalMessageId
      && a.originalSenderId === b.originalSenderId
      && a.plaintext === b.plaintext
      && a.workspaceId === b.workspaceId
      && a.channelId === b.channelId
      && a.threadId === b.threadId
      && a.hop === b.hop
      && a.createdAt === b.createdAt
      && JSON.stringify(a.vectorClock ?? null) === JSON.stringify(b.vectorClock ?? null)
      && JSON.stringify(a.metadata ?? null) === JSON.stringify(b.metadata ?? null)
      && JSON.stringify(a.attachments ?? null) === JSON.stringify(b.attachments ?? null)
      && JSON.stringify(a.threadRootSnapshot ?? null) === JSON.stringify(b.threadRootSnapshot ?? null);
  }

  private sendDeferredGossipIntentOffer(peerId: string, intent: DeferredGossipIntent, nowMs = Date.now()): boolean {
    const offerState = this.deferredGossipIntentOfferState ?? ((this as any).deferredGossipIntentOfferState = new Map<string, number>());
    const key = this.getDeferredGossipIntentOfferKey(intent.intentId, peerId);
    const lastOfferedAt = offerState.get(key) ?? 0;
    if (nowMs - lastOfferedAt < DEFERRED_GOSSIP_INTENT_OFFER_COOLDOWN_MS) {
      return false;
    }

    const sent = this.sendControlWithRetry(peerId, {
      type: 'gossip.intent.store',
      workspaceId: intent.workspaceId,
      recipientPeerId: intent.targetPeerId,
      intent: {
        ...intent,
        upstreamPeerId: this.state.myPeerId,
      },
    }, { label: 'gossip.intent.store' });

    if (sent) {
      offerState.set(key, nowMs);
    }
    return sent;
  }

  private buildDeferredGossipIntent(
    targetPeerId: string,
    originalMsgId: string,
    originalSenderId: string,
    plaintext: string,
    channelId: string,
    workspaceId: string | null,
    hop: number,
    envelope: any,
  ): DeferredGossipIntent {
    return {
      intentId: `gossip-intent:${originalMsgId}:${targetPeerId}`,
      targetPeerId,
      upstreamPeerId: this.state.myPeerId,
      originalMessageId: originalMsgId,
      originalSenderId,
      plaintext,
      ...(workspaceId ? { workspaceId } : {}),
      channelId,
      ...(envelope.threadId ? { threadId: envelope.threadId } : {}),
      ...(envelope.vectorClock ? { vectorClock: envelope.vectorClock } : {}),
      ...(envelope.metadata ? { metadata: envelope.metadata } : {}),
      ...(Array.isArray(envelope.attachments) && envelope.attachments.length > 0 ? { attachments: envelope.attachments } : {}),
      ...(envelope.threadRootSnapshot ? { threadRootSnapshot: envelope.threadRootSnapshot } : {}),
      hop,
      createdAt: Date.now(),
    };
  }

  private async storeDeferredGossipIntent(intent: DeferredGossipIntent): Promise<void> {
    this.deferredGossipIntents.set(intent.intentId, intent);
    await this.persistDeferredGossipIntents();
  }

  private async deleteDeferredGossipIntent(intentId: string): Promise<void> {
    if (!this.deferredGossipIntents.delete(intentId)) return;
    this.clearDeferredGossipIntentOfferState(intentId);
    this.clearDeferredGossipIntentInboundState(intentId);
    await this.persistDeferredGossipIntents();
  }

  private async clearDeferredGossipIntentsForReceipt(messageId: string, recipientPeerId: string): Promise<void> {
    const intents = this.deferredGossipIntents;
    if (!intents) return;

    const matches = [...intents.values()]
      .filter((intent) => intent.originalMessageId === messageId && intent.targetPeerId === recipientPeerId)
      .map((intent) => intent.intentId);
    if (matches.length === 0) return;

    let changed = false;
    for (const intentId of matches) {
      if (intents.delete(intentId)) {
        this.clearDeferredGossipIntentOfferState(intentId);
        this.clearDeferredGossipIntentInboundState(intentId);
        changed = true;
      }
    }
    if (changed) {
      await this.persistDeferredGossipIntents();
    }
  }

  private async replicateDeferredGossipIntentToCustodians(intent: DeferredGossipIntent, nowMs = Date.now()): Promise<void> {
    if (!intent.workspaceId) return;
    const custodians = this.selectCustodianPeers(intent.workspaceId, intent.targetPeerId);
    for (const custodianPeerId of custodians) {
      this.sendDeferredGossipIntentOffer(custodianPeerId, intent, nowMs);
    }
  }

  private async offerDeferredGossipIntentsToPeer(peerId: string, nowMs = Date.now()): Promise<void> {
    for (const intent of this.deferredGossipIntents.values()) {
      if (!intent.workspaceId) continue;
      const custodians = this.selectCustodianPeers(intent.workspaceId, intent.targetPeerId);
      if (!custodians.includes(peerId)) continue;
      this.sendDeferredGossipIntentOffer(peerId, intent, nowMs);
    }
  }

  private async handleDeferredGossipIntentControl(peerId: string, data: any, nowMs = Date.now()): Promise<void> {
    const workspaceId = typeof data?.workspaceId === 'string' ? data.workspaceId : undefined;
    if (workspaceId && !this.isWorkspaceMember(peerId, workspaceId)) return;

    const intent = data?.intent;
    if (!this.isDeferredGossipIntent(intent)) return;
    if (workspaceId && intent.workspaceId && intent.workspaceId !== workspaceId) return;
    if (workspaceId && !this.isWorkspaceMember(this.state.myPeerId, workspaceId)) return;
    if (workspaceId && !this.isWorkspaceMember(intent.targetPeerId, workspaceId)) return;
    if (workspaceId && !this.isWorkspaceMember(intent.originalSenderId, workspaceId)) return;

    const normalizedIntent: DeferredGossipIntent = {
      ...intent,
      upstreamPeerId: peerId,
    };
    const inboundState = this.deferredGossipIntentInboundState ?? ((this as any).deferredGossipIntentInboundState = new Map<string, number>());
    const inboundKey = this.getDeferredGossipIntentInboundKey(peerId, normalizedIntent.intentId);
    const lastSeenAt = inboundState.get(inboundKey) ?? 0;
    const existingIntent = this.deferredGossipIntents.get(normalizedIntent.intentId);
    const identicalExisting = !!existingIntent && this.areDeferredGossipIntentsEquivalent(existingIntent, normalizedIntent);
    if (identicalExisting && nowMs - lastSeenAt < DEFERRED_GOSSIP_INTENT_OFFER_COOLDOWN_MS) {
      return;
    }
    inboundState.set(inboundKey, nowMs);

    if (!identicalExisting) {
      await this.storeDeferredGossipIntent(normalizedIntent);
    }
    if (this.state.readyPeers.has(intent.targetPeerId)) {
      await this.processDeferredGossipIntentsForPeer(intent.targetPeerId);
    }
  }

  private async processDeferredGossipIntentsForPeer(peerId: string): Promise<void> {
    const intents = [...this.deferredGossipIntents.values()]
      .filter((intent) => intent.targetPeerId === peerId)
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const intent of intents) {
      try {
        const relayEnv = this.finalizeGossipRelayEnvelope(
          await this.encryptMessageWithPreKeyBootstrap(peerId, intent.plaintext, intent.workspaceId),
          intent.originalMessageId,
          intent.originalSenderId,
          intent.channelId,
          intent.workspaceId ?? null,
          intent.hop,
          intent,
        );

        const existingRoute = this._gossipReceiptRoutes.get(intent.originalMessageId);
        this._gossipReceiptRoutes.set(intent.originalMessageId, {
          upstreamPeerId: existingRoute?.upstreamPeerId ?? intent.upstreamPeerId ?? intent.originalSenderId,
          originalSenderId: intent.originalSenderId,
          timestamp: Date.now(),
        });

        if (this.state.readyPeers.has(peerId)) {
          const sent = this.transport.send(peerId, relayEnv);
          if (sent !== false) {
            await this.deleteDeferredGossipIntent(intent.intentId);
            continue;
          }
        }

        await this.queueCustodyEnvelope(peerId, {
          envelopeId: typeof (relayEnv as any).id === 'string' ? (relayEnv as any).id : undefined,
          opId: intent.originalMessageId,
          recipientPeerIds: [peerId],
          workspaceId: intent.workspaceId || 'direct',
          channelId: intent.channelId,
          ...(intent.threadId ? { threadId: intent.threadId } : {}),
          domain: 'channel-message',
          ciphertext: relayEnv,
          metadata: {
            messageId: intent.originalMessageId,
            senderId: intent.originalSenderId,
          },
        }, relayEnv);
        if (intent.workspaceId) {
          await this.replicateToCustodians(peerId, {
            workspaceId: intent.workspaceId,
            channelId: intent.channelId,
            opId: intent.originalMessageId,
            domain: 'channel-message',
          });
        }
        await this.deleteDeferredGossipIntent(intent.intentId);
      } catch {
        // Keep the intent for a later reconnect / pre-key hydration opportunity.
      }
    }
  }

  private schedulePersistManifestState(): void {
    if (this.manifestPersistTimer) clearTimeout(this.manifestPersistTimer);
    this.manifestPersistTimer = setTimeout(() => {
      this.manifestPersistTimer = null;
      void this.persistManifestState();
    }, 150);
  }

  private async persistManifestState(): Promise<void> {
    try {
      const state = this.manifestStore.exportState();
      await this.persistentStore.saveManifestStoreState(state);
    } catch (error) {
      console.warn('[DecentChat] failed to persist manifest state', error);
    }
  }

  private async restoreManifestState(): Promise<void> {
    try {
      const persisted = await this.persistentStore.getManifestStoreState();
      if (!persisted) return;
      this.manifestStore.importState(persisted as ManifestStoreState);
    } catch (error) {
      console.warn('[DecentChat] failed to restore manifest state', error);
    }
  }

  private recordManifestDomain(
    domain: SyncDomain,
    workspaceId: string | undefined,
    params?: {
      channelId?: string;
      operation?: ManifestDelta['operation'];
      subject?: string;
      itemCount?: number;
      data?: Record<string, unknown>;
    },
  ): ManifestDelta | null {
    if (!workspaceId || !this.manifestStore || typeof this.manifestStore.updateDomain !== 'function') return null;
    return this.manifestStore.updateDomain({
      domain,
      workspaceId,
      ...(params?.channelId ? { channelId: params.channelId } : {}),
      author: this.state.myPeerId || 'unknown',
      operation: params?.operation ?? 'update',
      subject: params?.subject,
      itemCount: params?.itemCount,
      data: params?.data,
    });
  }

  private getChannelMessageCount(channelId?: string): number {
    if (!channelId) return 0;
    const store: any = this.messageStore as any;
    if (!store || typeof store.getMessages !== 'function') return 0;
    return (store.getMessages(channelId) as any[])?.length ?? 0;
  }

  /** In-flight guard per channel to prevent overlapping loadOlderMessages calls. */
  private _loadingOlder = new Set<string>();
  /** Channels where we know IDB has no older messages than what's in memory. */
  private _noOlderMessages = new Set<string>();

  /**
   * Whether older messages may exist in IDB for a channel beyond what's in memory.
   */
  hasOlderMessages(channelId: string): boolean {
    if (this._noOlderMessages.has(channelId)) return false;
    // If the channel was loaded at startup with windowing (≤200) or trimmed,
    // there might be older messages.  We conservatively return true unless we
    // have explicit evidence there aren't any.
    return this.messageStore.getMessages(channelId).length > 0;
  }

  /**
   * Load older messages from IndexedDB and prepend them to the in-memory store.
   * Called by the UI when the user scrolls to the top of a channel.
   * Returns the number of messages actually prepended (0 means nothing older exists).
   */
  async loadOlderMessages(channelId: string, batchSize = 100): Promise<number> {
    if (!channelId) return 0;
    if (this._loadingOlder.has(channelId)) return 0;
    this._loadingOlder.add(channelId);

    try {
      const currentMsgs = this.messageStore.getMessages(channelId);
      const oldestTimestamp = currentMsgs.length > 0 ? currentMsgs[0].timestamp : Date.now();

      const older = await this.persistentStore.getOlderChannelMessages(channelId, oldestTimestamp, batchSize);
      if (older.length === 0) {
        this._noOlderMessages.add(channelId);
        return 0;
      }
      if (older.length < batchSize) {
        // Fetched fewer than requested — we've reached the beginning of history.
        this._noOlderMessages.add(channelId);
      }

      // Prepend into MessageStore (handles dedup by ID).
      const prepended = this.messageStore.prependMessages(channelId, older);

      // Also add to CRDT for dedup consistency.
      if (prepended > 0) {
        const crdt = this.getOrCreateCRDT(channelId);
        for (const msg of older) {
          try {
            crdt.addMessage({
              id: msg.id, channelId: msg.channelId, senderId: msg.senderId,
              content: msg.content,
              type: (msg.type || 'text') as 'text' | 'file' | 'system',
              vectorClock: msg.vectorClock || {},
              wallTime: msg.timestamp,
              prevHash: msg.prevHash || '',
            });
          } catch { /* dup safe to ignore */ }
        }

        // Re-render so the UI sees the new messages.
        this.ui?.renderMessages();
      }

      return prepended;
    } finally {
      this._loadingOlder.delete(channelId);
    }
  }

  private async queueCustodyEnvelope(peerId: string, envelope: Parameters<CustodyStore['storeEnvelope']>[0], fallbackPayload?: any): Promise<void> {
    if (this.custodyStore && typeof this.custodyStore.storeEnvelope === 'function') {
      await this.custodyStore.storeEnvelope(envelope);
      return;
    }
    if (fallbackPayload !== undefined) {
      await this.offlineQueue.enqueue(peerId, fallbackPayload);
    }
  }

  private scheduleOfflineQueueFlush(peerId: string, delayMs = 250): void {
    if (!peerId) return;
    const flushMap = this.scheduledOfflineQueueFlushes;
    if (!flushMap) return;
    const existing = flushMap.get(peerId);
    if (existing) return;

    const timer = setTimeout(() => {
      flushMap.delete(peerId);
      if (!this.state.readyPeers.has(peerId)) return;
      this.flushOfflineQueue(peerId).catch((err) => {
        console.warn('[OfflineQueue] scheduled flush failed:', (err as Error)?.message || err);
      });
    }, delayMs);

    flushMap.set(peerId, timer);
  }

  private kickOutgoingDeliveryRecovery(recipientPeerIds: string[], reason: string): void {
    const recipients = Array.from(new Set(
      recipientPeerIds.filter((peerId): peerId is string => typeof peerId === 'string' && peerId.length > 0 && peerId !== this.state.myPeerId),
    ));
    if (recipients.length === 0) return;

    const connectedViaTransport = new Set<string>(this.getTransportConnectedPeerIds());
    const now = Date.now();
    let attemptedDirectConnect = 0;

    for (const peerId of recipients) {
      if (this.state.readyPeers.has(peerId) || this.state.connectedPeers.has(peerId) || connectedViaTransport.has(peerId)) continue;
      if (this.state.connectingPeers.has(peerId)) continue;
      if (typeof this.transport?.isConnectingToPeer === 'function' && this.transport.isConnectingToPeer(peerId)) {
        this.state.connectingPeers.add(peerId);
        continue;
      }

      const lastAttemptAt = this.outgoingDeliveryRecoveryConnectAt.get(peerId) ?? 0;
      if (now - lastAttemptAt < OUTGOING_DELIVERY_RECOVERY_CONNECT_COOLDOWN_MS) continue;
      this.outgoingDeliveryRecoveryConnectAt.set(peerId, now);

      if (typeof this.transport?.connect !== 'function') continue;

      attemptedDirectConnect += 1;
      this.state.connectingPeers.add(peerId);

      try {
        const connectPromise = this.transport.connect(peerId);
        if (connectPromise && typeof (connectPromise as Promise<unknown>).catch === 'function') {
          (connectPromise as Promise<unknown>).catch(() => {
            this.state.connectingPeers.delete(peerId);
            this.ui?.updateSidebar({ refreshContacts: false });
          });
        }
      } catch {
        this.state.connectingPeers.delete(peerId);
      }
    }

    if (attemptedDirectConnect > 0) {
      this.ui?.updateSidebar({ refreshContacts: false });
    }

    const attemptedMaintenance = this.runPeerMaintenanceNow(reason);
    if (attemptedDirectConnect === 0 && attemptedMaintenance === 0 && this.getTransportConnectedPeerIds().length === 0) {
      void this.reinitializeTransportIfStuck(reason);
    }
  }

  private pendingDeliveryWatchKey(peerId: string, messageId: string): string {
    return `${peerId}:${messageId}`;
  }

  private clearPendingDeliveryWatch(peerId: string, messageId: string): void {
    const timers = this.pendingDeliveryWatchTimers;
    if (!timers) return;
    const key = this.pendingDeliveryWatchKey(peerId, messageId);
    const timer = timers.get(key);
    if (!timer) return;
    clearTimeout(timer);
    timers.delete(key);
  }

  private clearPendingDeliveryWatchesForPeer(peerId: string): void {
    const timers = this.pendingDeliveryWatchTimers;
    if (!timers) return;
    const prefix = `${peerId}:`;
    for (const [key, timer] of timers) {
      if (!key.startsWith(prefix)) continue;
      clearTimeout(timer);
      timers.delete(key);
    }
  }

  private isMessagePendingForPeer(channelId: string, messageId: string, peerId: string): boolean {
    if (typeof this.messageStore?.getMessages !== 'function') return false;
    const msg = this.messageStore.getMessages(channelId).find((candidate: any) => candidate.id === messageId) as any;
    if (!msg) return false;
    if (msg.senderId !== this.state.myPeerId) return false;
    const ackedBy = new Set<string>(Array.isArray(msg.ackedBy) ? msg.ackedBy : []);
    const readBy = new Set<string>(Array.isArray(msg.readBy) ? msg.readBy : []);
    return !ackedBy.has(peerId) && !readBy.has(peerId);
  }

  private schedulePendingDeliveryWatch(
    peerId: string,
    channelId: string,
    messageId: string,
    workspaceId?: string,
    delayMs = PENDING_DELIVERY_WATCHDOG_MS,
  ): void {
    if (!peerId || !channelId || !messageId) return;
    const timers = this.pendingDeliveryWatchTimers ?? ((this as any).pendingDeliveryWatchTimers = new Map<string, ReturnType<typeof setTimeout>>());
    const key = this.pendingDeliveryWatchKey(peerId, messageId);
    if (timers.has(key)) return;

    const timer = setTimeout(() => {
      timers.delete(key);
      // Guard against stale timers firing after controller teardown (or in test
      // environments where the controller prototype mock is incomplete).
      if (!this.state?.readyPeers?.has(peerId)) return;
      if (!this.isMessagePendingForPeer(channelId, messageId, peerId)) return;

      const now = Date.now();
      const cooldowns = this.pendingDeliveryRecoveryCooldowns ?? ((this as any).pendingDeliveryRecoveryCooldowns = new Map<string, number>());
      const lastRecoveryAt = cooldowns.get(peerId) ?? 0;
      if (now - lastRecoveryAt < PENDING_DELIVERY_RECOVERY_COOLDOWN_MS) return;
      cooldowns.set(peerId, now);

      this.scheduleOfflineQueueFlush(peerId, 250);
      this.retryUnackedOutgoingForPeer?.(peerId)?.catch?.((err: unknown) => {
        console.warn('[DeliveryWatch] retryUnackedOutgoingForPeer failed:', (err as Error)?.message || err);
      });
      if (workspaceId) {
        this.requestCustodyRecovery?.(peerId);
        if (!this.messageSyncInFlight?.has(peerId)) {
          this.requestMessageSync(peerId).catch((err) => {
            console.warn('[DeliveryWatch] requestMessageSync failed:', (err as Error)?.message || err);
          });
        }
      }
    }, delayMs);

    timers.set(key, timer);
  }

  private sendManifestSummary(peerId: string, onlyWorkspaceId?: string): void {
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      if (onlyWorkspaceId && workspace.id !== onlyWorkspaceId) continue;
      if (!workspace.members.some((member: any) => member.peerId === peerId)) continue;
      const summary = this.manifestStore.getSummary(workspace.id);
      this.transport.send(peerId, {
        type: 'sync.summary',
        workspaceId: workspace.id,
        summary,
      });
    }
  }

  private async handleManifestSummary(peerId: string, data: any): Promise<void> {
    const summary = (data?.summary ?? data) as SyncManifestSummary;
    const workspaceId = typeof data?.workspaceId === 'string' ? data.workspaceId : summary?.workspaceId;
    if (!workspaceId || !summary || !Array.isArray(summary.versions)) return;

    if (!this.isWorkspaceMember(peerId, workspaceId)) return;

    const requests = this.manifestStore.buildDiffRequest(workspaceId, summary);
    if (requests.length > 0) {
      this.transport.send(peerId, {
        type: 'sync.diff_request',
        workspaceId,
        requestId: crypto.randomUUID(),
        requests,
      });
    }

    const remoteByKey: Map<string, { version: number }> = new Map(summary.versions.map((version) => [`${version.domain}:${version.channelId ?? ''}`, version]));
    const localSummary = this.manifestStore.getSummary(workspaceId);
    const deltas: ManifestDelta[] = [];

    for (const localVersion of localSummary.versions) {
      const key = `${localVersion.domain}:${localVersion.channelId ?? ''}`;
      const remoteVersion = remoteByKey.get(key)?.version ?? 0;
      if (localVersion.version <= remoteVersion) continue;
      deltas.push(...this.manifestStore.getDeltasSince({
        workspaceId,
        domain: localVersion.domain,
        channelId: localVersion.channelId,
        fromVersion: remoteVersion,
        toVersion: localVersion.version,
        limit: 500,
      }));
    }

    if (deltas.length > 0) {
      this.transport.send(peerId, {
        type: 'sync.diff_response',
        workspaceId,
        requestId: `push:${crypto.randomUUID()}`,
        deltas,
      });
    }
  }

  private async handleManifestDiffRequest(peerId: string, data: any): Promise<void> {
    const workspaceId = typeof data?.workspaceId === 'string' ? data.workspaceId : '';
    if (!workspaceId || !this.isWorkspaceMember(peerId, workspaceId)) return;

    const requests = Array.isArray(data?.requests)
      ? (data.requests as ManifestDiffRequest[])
      : (data?.request ? [data.request as ManifestDiffRequest] : []);
    if (requests.length === 0) return;

    const deltas: ManifestDelta[] = [];
    const snapshots: Array<{ domain: SyncDomain; workspaceId: string; channelId?: string; snapshotId: string; version: number; basedOnVersion: number; createdAt: number; createdBy: string }> = [];

    for (const request of requests) {
      const chunk = this.manifestStore.getDeltasSince({
        workspaceId,
        domain: request.domain,
        channelId: request.channelId,
        fromVersion: request.fromVersion,
        toVersion: request.toVersion,
        limit: 500,
      });
      deltas.push(...chunk);

      if (chunk.length === 0 && (request.toVersion ?? 0) > request.fromVersion) {
        const snapshot = this.buildManifestSnapshot(workspaceId, request.domain, request.channelId);
        if (snapshot) {
          this.manifestStore.saveSnapshot(snapshot);
          snapshots.push({
            domain: snapshot.domain,
            workspaceId: snapshot.workspaceId,
            ...(snapshot.domain === 'channel-message' && snapshot.channelId ? { channelId: snapshot.channelId } : {}),
            snapshotId: snapshot.snapshotId,
            version: snapshot.version,
            basedOnVersion: snapshot.basedOnVersion,
            createdAt: snapshot.createdAt,
            createdBy: snapshot.createdBy,
          });
        }
      }
    }

    this.transport.send(peerId, {
      type: 'sync.diff_response',
      workspaceId,
      requestId: typeof data?.requestId === 'string' ? data.requestId : crypto.randomUUID(),
      deltas,
      ...(snapshots.length > 0 ? { snapshots } : {}),
    });
  }

  private async handleManifestDiffResponse(peerId: string, data: any): Promise<void> {
    const workspaceId = typeof data?.workspaceId === 'string' ? data.workspaceId : '';
    if (!workspaceId || !this.isWorkspaceMember(peerId, workspaceId)) return;

    const deltas = Array.isArray(data?.deltas) ? (data.deltas as ManifestDelta[]) : [];
    let needsMessageSync = false;

    // Apply all deltas in a batch — this persists workspace state only once
    // at the end instead of per-delta (avoids O(N * stateSize) serialization).
    this.manifestStore.applyDeltaBatch(deltas);
    for (const delta of deltas) {
      if (delta.domain === 'channel-message') needsMessageSync = true;
    }

    if (needsMessageSync) {
      await this.requestMessageSync(peerId);
    }

    const snapshots = Array.isArray(data?.snapshots) ? data.snapshots : [];
    for (const pointer of snapshots) {
      const existing = this.manifestStore.getSnapshot(workspaceId, pointer.domain, pointer.channelId);
      if (!existing || existing.version < pointer.version) {
        this.transport.send(peerId, {
          type: 'sync.fetch_snapshot',
          workspaceId,
          domain: pointer.domain,
          ...(pointer.channelId ? { channelId: pointer.channelId } : {}),
          snapshotId: pointer.snapshotId,
        });
      }
    }
  }

  private async handleManifestFetchSnapshot(peerId: string, data: any): Promise<void> {
    const workspaceId = typeof data?.workspaceId === 'string' ? data.workspaceId : '';
    const domain = data?.domain as SyncDomain | undefined;
    const channelId = typeof data?.channelId === 'string' ? data.channelId : undefined;
    if (!workspaceId || !domain) return;
    if (!this.isWorkspaceMember(peerId, workspaceId)) return;

    const snapshot = this.manifestStore.getSnapshot(workspaceId, domain, channelId)
      ?? this.buildManifestSnapshot(workspaceId, domain, channelId);
    if (!snapshot) return;

    this.manifestStore.saveSnapshot(snapshot);
    this.transport.send(peerId, {
      type: 'sync.snapshot_response',
      workspaceId,
      snapshot,
    });
  }

  private async handleManifestSnapshotResponse(peerId: string, data: any): Promise<void> {
    const snapshot = data?.snapshot as SyncManifestSnapshot | undefined;
    if (!snapshot) return;

    this.manifestStore.restoreSnapshot(snapshot, this.state.myPeerId || 'unknown');

    if (snapshot.domain === 'workspace-manifest') {
      const ws = this.workspaceManager.getWorkspace(snapshot.workspaceId);
      if (ws) {
        ws.name = snapshot.name;
        ws.description = snapshot.description;
        await this.persistWorkspace(ws.id);
      }
      return;
    }

    if (snapshot.domain === 'membership') {
      const ws = this.workspaceManager.getWorkspace(snapshot.workspaceId);
      if (ws) {
        const existingByPeer = new Map(ws.members.map((member: any) => [member.peerId, member]));
        ws.members = snapshot.members.map((member) => ({
          peerId: member.peerId,
          alias: member.alias || member.peerId.slice(0, 8),
          publicKey: existingByPeer.get(member.peerId)?.publicKey || '',
          role: member.role as 'owner' | 'admin' | 'member',
          joinedAt: member.joinedAt,
        }));
        await this.persistWorkspace(ws.id);
      }
      return;
    }

    if (snapshot.domain === 'channel-manifest') {
      const ws = this.workspaceManager.getWorkspace(snapshot.workspaceId);
      if (ws) {
        for (const channel of snapshot.channels) {
          if (ws.channels.some((existing: any) => existing.id === channel.id)) continue;
          ws.channels.push({
            id: channel.id,
            workspaceId: ws.id,
            name: channel.name,
            type: channel.type,
            members: [],
            createdBy: channel.createdBy,
            createdAt: channel.createdAt,
          } as any);
        }
        await this.persistWorkspace(ws.id);
      }
      return;
    }

    if (snapshot.domain === 'channel-message') {
      const localIds = new Set(this.messageStore.getMessages(snapshot.channelId).map((message: any) => message.id));
      const missing = snapshot.messageIds.filter((id) => !localIds.has(id));
      if (missing.length > 0) {
        this.transport.send(peerId, {
          type: 'message-sync-fetch-request',
          workspaceId: snapshot.workspaceId,
          messageIdsByChannel: {
            [snapshot.channelId]: missing,
          },
        });
      }
    }
  }

  private buildManifestSnapshot(workspaceId: string, domain: SyncDomain, channelId?: string): SyncManifestSnapshot | null {
    const summary = this.manifestStore.getSummary(workspaceId);
    const version = summary.versions.find((entry) => entry.domain === domain && (entry.channelId ?? '') === (channelId ?? ''))?.version ?? 0;

    if (domain === 'workspace-manifest') {
      const workspace = this.workspaceManager.getWorkspace(workspaceId);
      if (!workspace) return null;
      return {
        domain,
        workspaceId,
        version,
        name: workspace.name,
        description: workspace.description,
        policy: workspace.permissions as Record<string, unknown> | undefined,
        snapshotId: crypto.randomUUID(),
        snapshotVersion: version,
        basedOnVersion: version,
        deltasSince: 0,
        createdAt: Date.now(),
        createdBy: this.state.myPeerId,
      };
    }

    if (domain === 'membership') {
      const workspace = this.workspaceManager.getWorkspace(workspaceId);
      if (!workspace) return null;
      return {
        domain,
        workspaceId,
        version,
        snapshotId: crypto.randomUUID(),
        basedOnVersion: version,
        memberCount: workspace.members.length,
        members: workspace.members.map((member: any) => ({
          peerId: member.peerId,
          alias: member.alias,
          role: member.role as 'owner' | 'admin' | 'member',
          joinedAt: member.joinedAt,
        })),
        createdAt: Date.now(),
        createdBy: this.state.myPeerId,
      };
    }

    if (domain === 'channel-manifest') {
      const workspace = this.workspaceManager.getWorkspace(workspaceId);
      if (!workspace) return null;
      return {
        domain,
        workspaceId,
        version,
        snapshotId: crypto.randomUUID(),
        basedOnVersion: version,
        channelCount: workspace.channels.length,
        channels: workspace.channels.map((channel: any) => ({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          createdAt: channel.createdAt,
          createdBy: channel.createdBy,
        })),
        createdAt: Date.now(),
        createdBy: this.state.myPeerId,
      };
    }

    if (domain === 'channel-message' && channelId) {
      const messages = this.messageStore.getMessages(channelId).slice().sort((a, b) => a.timestamp - b.timestamp);
      const minTimestamp = messages[0]?.timestamp ?? Date.now();
      const maxTimestamp = messages[messages.length - 1]?.timestamp ?? minTimestamp;
      return {
        domain,
        workspaceId,
        channelId,
        version,
        snapshotId: crypto.randomUUID(),
        basedOnVersion: version,
        messageCount: messages.length,
        messageIds: messages.map((message) => message.id),
        minTimestamp,
        maxTimestamp,
        createdAt: Date.now(),
        createdBy: this.state.myPeerId,
      };
    }

    return null;
  }

  private requestCustodyRecovery(peerId: string): void {
    for (const workspace of this.workspaceManager.getAllWorkspaces()) {
      if (!workspace.members.some((member: any) => member.peerId === peerId)) continue;
      this.transport.send(peerId, {
        type: 'custody.fetch_index',
        workspaceId: workspace.id,
        recipientPeerId: this.state.myPeerId,
      });
    }
  }

  private selectCustodianPeers(workspaceId: string, recipientPeerId: string, limit = 2): string[] {
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    if (!workspace) return [];

    return workspace.members
      .map((member: any) => member.peerId)
      .filter((peerId: string) => peerId !== this.state.myPeerId && peerId !== recipientPeerId)
      .filter((peerId: string) => this.state.readyPeers.has(peerId))
      .map((peerId: string) => {
        let score = 100;
        const alias = this.getDisplayNameForPeer(peerId).toLowerCase();
        if (alias.includes('mobile') || alias.includes('iphone') || alias.includes('android')) score -= 20;
        if (alias.includes('desktop') || alias.includes('server') || alias.includes('bot')) score += 20;
        const connectAt = this.peerConnectedAt.get(peerId) ?? 0;
        const disconnects = this.peerDisconnectCount.get(peerId) ?? 0;
        score += Math.min(20, Math.floor((Date.now() - connectAt) / 60_000));
        score -= Math.min(20, disconnects * 2);
        return { peerId, score };
      })
      .sort((a, b) => b.score - a.score || a.peerId.localeCompare(b.peerId))
      .slice(0, Math.max(0, limit))
      .map((entry) => entry.peerId);
  }

  private async replicateToCustodians(
    recipientPeerId: string,
    params: {
      workspaceId?: string | null;
      channelId?: string | null;
      opId?: string | null;
      domain?: SyncDomain;
    },
  ): Promise<void> {
    const workspaceId = params.workspaceId ?? undefined;
    const opId = params.opId ?? undefined;
    if (!workspaceId || !opId) return;

    const custodians = this.selectCustodianPeers(workspaceId, recipientPeerId);
    if (custodians.length === 0) return;

    const pending = await this.custodyStore.getPendingForRecipient(recipientPeerId);
    const envelopes = pending.filter((envelope) => {
      if (envelope.opId !== opId || envelope.workspaceId !== workspaceId) return false;
      if (params.domain && envelope.domain !== params.domain) return false;
      if (params.channelId && envelope.channelId !== params.channelId) return false;
      return true;
    });
    if (envelopes.length === 0) return;

    for (const envelope of envelopes) {
      this.pendingCustodyOffers.set(envelope.envelopeId, custodians);
      for (const custodianPeerId of custodians) {
        this.transport.send(custodianPeerId, {
          type: 'custody.offer',
          workspaceId,
          recipientPeerId,
          ...(envelope.channelId ? { channelId: envelope.channelId } : {}),
          envelope: {
            envelopeId: envelope.envelopeId,
            opId: envelope.opId,
            workspaceId: envelope.workspaceId,
            channelId: envelope.channelId,
            threadId: envelope.threadId,
            domain: envelope.domain,
            createdAt: envelope.createdAt,
            expiresAt: envelope.expiresAt,
            replicationClass: envelope.replicationClass,
          },
        });
      }
    }
  }

  private async handleCustodyControl(peerId: string, data: any): Promise<void> {
    if (data?.type === 'custody.offer') {
      const workspaceId = typeof data?.workspaceId === 'string' ? data.workspaceId : '';
      const canAccept = !workspaceId || this.isWorkspaceMember(this.state.myPeerId, workspaceId);
      this.transport.send(peerId, {
        type: canAccept ? 'custody.accept' : 'custody.reject',
        workspaceId,
        envelopeId: data?.envelope?.envelopeId,
        recipientPeerId: data?.recipientPeerId,
        reason: canAccept ? undefined : 'not-a-member',
      });
      return;
    }

    if (data?.type === 'custody.accept') {
      const envelopeId = typeof data?.envelopeId === 'string' ? data.envelopeId : '';
      const recipientPeerId = typeof data?.recipientPeerId === 'string' ? data.recipientPeerId : '';
      const offered = this.pendingCustodyOffers.get(envelopeId) ?? [];
      if (!envelopeId || !recipientPeerId || !offered.includes(peerId)) return;

      const envelopes = await this.custodyStore.listAllForRecipient(recipientPeerId);
      const envelope = envelopes.find((entry) => entry.envelopeId === envelopeId);
      if (!envelope) return;

      this.transport.send(peerId, {
        type: 'custody.store',
        workspaceId: envelope.workspaceId,
        recipientPeerId,
        envelope,
      });
      return;
    }

    if (data?.type === 'custody.reject') {
      const envelopeId = typeof data?.envelopeId === 'string' ? data.envelopeId : '';
      if (!envelopeId) return;
      const offered = this.pendingCustodyOffers.get(envelopeId) ?? [];
      this.pendingCustodyOffers.set(envelopeId, offered.filter((id) => id !== peerId));
      return;
    }

    if (data?.type === 'custody.store') {
      const envelope = data?.envelope;
      if (!this.isCustodyEnvelope(envelope)) return;
      this.custodianInbox.set(envelope.envelopeId, envelope);
      await this.persistCustodianInbox();
      this.transport.send(peerId, {
        type: 'custody.ack',
        envelopeIds: [envelope.envelopeId],
        stage: 'stored',
      });
      return;
    }

    if (data?.type === 'custody.fetch_index') {
      if (Array.isArray(data?.index)) {
        const envelopeIds = data.index
          .map((entry: any) => (typeof entry?.envelopeId === 'string' ? entry.envelopeId : null))
          .filter((value: string | null): value is string => Boolean(value));
        if (envelopeIds.length > 0) {
          this.transport.send(peerId, {
            type: 'custody.fetch_envelopes',
            workspaceId: data.workspaceId,
            envelopeIds,
          });
        }
        return;
      }

      const recipientPeerId = typeof data?.recipientPeerId === 'string' ? data.recipientPeerId : peerId;
      const workspaceId = typeof data?.workspaceId === 'string' ? data.workspaceId : undefined;
      const index = [...this.custodianInbox.values()]
        .filter((envelope) => envelope.recipientPeerIds.includes(recipientPeerId))
        .filter((envelope) => !workspaceId || envelope.workspaceId === workspaceId)
        .map((envelope) => ({
          envelopeId: envelope.envelopeId,
          opId: envelope.opId,
          workspaceId: envelope.workspaceId,
          channelId: envelope.channelId,
          domain: envelope.domain,
          createdAt: envelope.createdAt,
          expiresAt: envelope.expiresAt,
        }));

      this.transport.send(peerId, {
        type: 'custody.fetch_index',
        workspaceId: workspaceId ?? '',
        recipientPeerId,
        index,
      });
      return;
    }

    if (data?.type === 'custody.fetch_envelopes') {
      if (Array.isArray(data?.envelopes)) {
        const recovered = data.envelopes.filter((entry: any) => this.isCustodyEnvelope(entry)) as CustodyEnvelope[];
        const recoveredIds: string[] = [];

        for (const envelope of recovered) {
          if (!envelope.recipientPeerIds.includes(this.state.myPeerId)) continue;
          recoveredIds.push(envelope.envelopeId);
          await this.transport.onMessage?.(peerId, envelope.ciphertext as any);
        }

        if (recoveredIds.length > 0) {
          this.transport.send(peerId, {
            type: 'custody.ack',
            envelopeIds: recoveredIds,
            stage: 'delivered',
          });
        }
        return;
      }

      const envelopeIds = Array.isArray(data?.envelopeIds)
        ? data.envelopeIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];
      const envelopes = envelopeIds
        .map((id: string) => this.custodianInbox.get(id))
        .filter((entry: CustodyEnvelope | undefined): entry is CustodyEnvelope => Boolean(entry));

      this.transport.send(peerId, {
        type: 'custody.fetch_envelopes',
        workspaceId: typeof data?.workspaceId === 'string' ? data.workspaceId : '',
        envelopes,
      });
      return;
    }

    if (data?.type === 'custody.ack') {
      const envelopeIds = Array.isArray(data?.envelopeIds)
        ? data.envelopeIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];
      if (envelopeIds.length === 0) return;

      let changed = false;
      for (const envelopeId of envelopeIds) {
        if (this.custodianInbox.delete(envelopeId)) changed = true;
      }
      if (changed) {
        await this.persistCustodianInbox();
      }
    }
  }

  private async requestMessageSync(peerId: string): Promise<void> {
    if (!peerId) return;
    const inFlight = this.messageSyncInFlight.get(peerId);
    if (inFlight) {
      perfLog.debug(`requestMessageSync(${peerId.slice(0,8)}): returning existing in-flight promise`);
      return inFlight;
    }

    const now = Date.now();
    const last = this.lastMessageSyncRequestAt.get(peerId) ?? 0;
    if (now - last < ChatController.MESSAGE_SYNC_MIN_INTERVAL_MS) {
      perfLog.debug(`requestMessageSync(${peerId.slice(0,8)}): skipped (cooldown, ${now - last}ms since last)`);
      return;
    }

    const _syncTag = peerId.slice(0, 8);
    const _syncT0 = performance.now();
    perfLog.debug(`requestMessageSync(${_syncTag}): START`);

    const runOnce = async (): Promise<void> => {
      // Stagger syncs globally: wait for any prior sync's request to be sent before
      // starting ours.  With per-peer message queues, response chunks from different
      // peers process in parallel, but staggering requests still avoids flooding
      // the signaling/transport layer with simultaneous sync request sends.
      const _lockT0 = performance.now();
      await this._globalSyncLock;
      perfLog.debug(`requestMessageSync(${_syncTag}): waited for globalSyncLock=${(performance.now()-_lockT0).toFixed(1)}ms`);
      let releaseLock: () => void;
      this._globalSyncLock = new Promise<void>((resolve) => { releaseLock = resolve; });

      try {
        const workspaceId = this.resolveTopologyWorkspaceId(peerId);
        this.lastMessageSyncRequestAt.set(peerId, Date.now());

        // Use Negentropy (set reconciliation) when peer supports it — efficient
        // for reconnects where both sides have mostly the same data.
        // If Negentropy fails/times out, gracefully fall back to timestamp sync
        // instead of failing the entire sync for freshly joined/restored peers.
        if (this.peerSupportsCapability(peerId, NEGENTROPY_SYNC_CAPABILITY)) {
          perfLog.debug(`requestMessageSync(${_syncTag}): using Negentropy sync`);
          try {
            const _negT0 = performance.now();
            await this.requestNegentropyMessageSync(peerId);
            perfLog.debug(`requestMessageSync(${_syncTag}): Negentropy completed=${(performance.now()-_negT0).toFixed(1)}ms`);
          } catch (error) {
            if (this.shouldRetryNegentropyOnce(error)) {
              console.warn(`[Sync] Negentropy rejected for ${_syncTag}; retrying once with backoff:`, error);
              await new Promise<void>((resolve) => setTimeout(resolve, 600));
              try {
                const _retryT0 = performance.now();
                await this.requestNegentropyMessageSync(peerId);
                perfLog.debug(`requestMessageSync(${_syncTag}): Negentropy retry completed=${(performance.now()-_retryT0).toFixed(1)}ms`);
              } catch (retryError) {
                console.warn(`[Sync] Negentropy retry failed for ${_syncTag}, falling back to timestamp sync:`, retryError);
                const _tsT0 = performance.now();
                await this.requestTimestampMessageSync(peerId);
                perfLog.debug(`requestMessageSync(${_syncTag}): timestamp fallback=${(performance.now()-_tsT0).toFixed(1)}ms`);
              }
            } else {
              console.warn(`[Sync] Negentropy failed for ${_syncTag}, falling back to timestamp sync:`, error);
              const _tsT0 = performance.now();
              await this.requestTimestampMessageSync(peerId);
              perfLog.debug(`requestMessageSync(${_syncTag}): timestamp fallback=${(performance.now()-_tsT0).toFixed(1)}ms`);
            }
          }
        } else {
          perfLog.debug(`requestMessageSync(${_syncTag}): using timestamp sync (no Negentropy)`);
          const _tsT0 = performance.now();
          await this.requestTimestampMessageSync(peerId);
          perfLog.debug(`requestMessageSync(${_syncTag}): timestamp sync=${(performance.now()-_tsT0).toFixed(1)}ms`);
          // Give the first peer's response chunks time to flow through before
          // the next peer's sync request fires.  Timestamp sync is fire-and-forget
          // (responses arrive asynchronously), so a brief grace period here
          // significantly reduces interleaving.
          await new Promise<void>((resolve) => setTimeout(resolve, 500));
        }
        this.peerLastSuccessfulSyncAt.set(peerId, Date.now());
        this.recordTopologyPeerEvent({
          level: 'info',
          workspaceId,
          peerId,
          event: 'sync-succeeded',
          lastSyncAt: this.peerLastSuccessfulSyncAt.get(peerId),
        });
        perfLog.debug(`requestMessageSync(${_syncTag}): TOTAL=${(performance.now()-_syncT0).toFixed(1)}ms`);
      } catch (error) {
        this.recordTopologyPeerEvent({
          level: 'warn',
          workspaceId: this.resolveTopologyWorkspaceId(peerId),
          peerId,
          event: 'sync-failed',
          reason: (error as Error)?.message ?? String(error),
        });
        throw error;
      } finally {
        releaseLock!();
      }
    };

    const task = runOnce().finally(() => {
      if (this.messageSyncInFlight.get(peerId) === task) {
        this.messageSyncInFlight.delete(peerId);
      }
    });

    this.messageSyncInFlight.set(peerId, task);
    return task;
  }

  private peerSupportsCapability(peerId: string, capability: string): boolean {
    return this.peerCapabilities?.get(peerId)?.has(capability) === true;
  }

  private getPeerCapabilitySummary(peerId: string): {
    directoryShardPrefixes: string[];
    relayChannels: string[];
    archiveCapable: boolean;
    presenceAggregator: boolean;
  } {
    const capabilities = this.peerCapabilities?.get(peerId) ?? new Set<string>();
    const directoryShardPrefixes = [...capabilities]
      .filter((capability) => capability.startsWith(DIRECTORY_SHARD_CAPABILITY_PREFIX))
      .flatMap((capability) => capability.slice(DIRECTORY_SHARD_CAPABILITY_PREFIX.length).split(','))
      .map((value) => value.trim())
      .filter(Boolean);
    const relayChannels = [...capabilities]
      .filter((capability) => capability.startsWith(RELAY_CHANNEL_CAPABILITY_PREFIX))
      .flatMap((capability) => capability.slice(RELAY_CHANNEL_CAPABILITY_PREFIX.length).split(','))
      .map((value) => value.trim())
      .filter(Boolean);

    return {
      directoryShardPrefixes: [...new Set(directoryShardPrefixes)],
      relayChannels: [...new Set(relayChannels)],
      archiveCapable: capabilities.has(ARCHIVE_HISTORY_CAPABILITY),
      presenceAggregator: capabilities.has(PRESENCE_AGGREGATOR_CAPABILITY),
    };
  }

  private getAdvertisedControlCapabilities(workspaceId?: string): string[] {
    const capabilities = new Set<string>([
      NEGENTROPY_SYNC_CAPABILITY,
      WORKSPACE_SHELL_CAPABILITY,
      MEMBER_DIRECTORY_CAPABILITY,
    ]);
    if (!workspaceId) return [...capabilities];

    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    const advertised = workspace?.peerCapabilities?.[this.state.myPeerId];
    if (!advertised) return [...capabilities];

    // Workspace-scoped helper capabilities are only advertised for workspaces that
    // are explicitly large-workspace capable.
    if (!this.workspaceHasLargeWorkspaceCapability(workspace)) return [...capabilities];

    for (const shardPrefix of advertised.directory?.shardPrefixes ?? []) {
      if (shardPrefix) capabilities.add(`${DIRECTORY_SHARD_CAPABILITY_PREFIX}${shardPrefix}`);
    }
    for (const channel of advertised.relay?.channels ?? []) {
      if (channel) capabilities.add(`${RELAY_CHANNEL_CAPABILITY_PREFIX}${channel}`);
    }
    if (advertised.archive) capabilities.add(ARCHIVE_HISTORY_CAPABILITY);
    if (advertised.presenceAggregator) capabilities.add(PRESENCE_AGGREGATOR_CAPABILITY);

    return [...capabilities];
  }

  private async requestTimestampMessageSync(peerId: string): Promise<void> {
    // Find the workspace where this peer is a member, not activeWorkspaceId
    let wsId: string | null = null;
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      if (ws.members.some(m => m.peerId === peerId)) {
        wsId = ws.id;
        break;
      }
    }
    if (!wsId) wsId = this.state.activeWorkspaceId;
    if (!wsId) return;
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return;

    const channelTimestamps: Record<string, number> = {};
    for (const ch of ws.channels) {
      const msgs = this.messageStore.getMessages(ch.id);
      const last = msgs[msgs.length - 1];
      channelTimestamps[ch.id] = last?.timestamp ?? 0;
    }

    // Ask peer for messages we're missing
    this.sendControlWithRetry(peerId, {
      type: 'message-sync-request',
      workspaceId: wsId,
      channelTimestamps,
    }, { label: 'message-sync-request' });

    // Proactive push removed — Negentropy handles bidirectional sync efficiently.
    // Timestamp sync is now only a fallback for peers without Negentropy support.
  }

  /** Negentropy-based sync — efficient set reconciliation for reconnects. */
  private async requestNegentropyMessageSync(peerId: string): Promise<void> {
    const wsId = this.state.activeWorkspaceId;
    if (!wsId) return;
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return;

    const messageIdsByChannel: Record<string, string[]> = {};
    const pushMessages: any[] = [];
    for (const ch of ws.channels) {
      const localMessages = this.messageStore.getMessages(ch.id);
      const localItems = localMessages.map((m) => ({ id: m.id, timestamp: m.timestamp }));
      const negentropy = new Negentropy();
      await negentropy.build(localItems);

      const result = await negentropy.reconcile(
        async (query: NegentropyQuery) => this.sendNegentropyQuery(peerId, wsId, ch.id, query),
      );
      if (result.need.length > 0) {
        messageIdsByChannel[ch.id] = result.need;
      }

      // Push messages that remote is missing
      if (result.excess.length > 0) {
        const excessSet = new Set(result.excess);
        for (const m of localMessages) {
          if (excessSet.has(m.id)) {
            pushMessages.push({
              id: m.id,
              channelId: m.channelId,
              senderId: m.senderId,
              content: m.content,
              timestamp: m.timestamp,
              type: m.type,
              threadId: m.threadId,
              prevHash: m.prevHash,
              vectorClock: (m as any).vectorClock,
            });
          }
        }
      }
    }

    if (Object.keys(messageIdsByChannel).length > 0) {
      this.sendControlWithRetry(peerId, {
        type: 'message-sync-fetch-request',
        workspaceId: wsId,
        messageIdsByChannel,
      }, { label: 'message-sync-fetch-request' });
    }

    // Proactively push messages the remote is missing
    if (pushMessages.length > 0) {
      this.transport.send(peerId, {
        type: 'message-sync-response',
        workspaceId: wsId,
        messages: pushMessages,
      });
    }
  }

  private shouldRetryNegentropyOnce(error: unknown): boolean {
    const message = String((error as Error)?.message ?? error ?? '').toLowerCase();
    if (!message) return false;
    return message.includes('rejected')
      || message.includes('peer-not-member')
      || message.includes('workspace-not-found')
      || message.includes('channel-not-found')
      || message.includes('invalid-request');
  }

  private async sendNegentropyQuery(
    peerId: string,
    workspaceId: string,
    channelId: string,
    query: NegentropyQuery,
  ): Promise<NegentropyResponse> {
    const requestId = crypto.randomUUID();
    return await new Promise<NegentropyResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingNegentropyQueries.delete(requestId);
        reject(new Error(`Negentropy query timeout for ${peerId.slice(0, 8)}`));
      }, NEGENTROPY_QUERY_TIMEOUT_MS);
      this.pendingNegentropyQueries.set(requestId, { peerId, resolve, reject, timer });
      this.sendControlWithRetry(peerId, {
        type: 'message-sync-negentropy-query',
        requestId,
        workspaceId,
        channelId,
        query,
      }, { label: 'message-sync-negentropy-query' });
    });
  }

  private async handleNegentropySyncQuery(peerId: string, data: any): Promise<void> {
    const wsId = data.workspaceId as string | undefined;
    const channelId = data.channelId as string | undefined;
    const requestId = data.requestId as string | undefined;
    const query = data.query as NegentropyQuery | undefined;
    if (!wsId || !channelId || !requestId || !query) return;

    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return;
    if (!ws.members.some((m: any) => m.peerId === peerId)) return;
    if (!ws.channels.some((ch: any) => ch.id === channelId)) return;

    const localItems = this.messageStore.getMessages(channelId).map((m) => ({ id: m.id, timestamp: m.timestamp }));
    const negentropy = new Negentropy();
    await negentropy.build(localItems);
    const response = await negentropy.processQuery(query);

    this.transport.send(peerId, {
      type: 'message-sync-negentropy-response',
      requestId,
      workspaceId: wsId,
      channelId,
      response,
    });
  }

  private handleNegentropySyncResponse(peerId: string, data: any): void {
    const requestId = data.requestId as string | undefined;
    if (!requestId) return;

    const pending = this.pendingNegentropyQueries.get(requestId);
    if (!pending) return;
    if (pending.peerId !== peerId) return;

    clearTimeout(pending.timer);
    this.pendingNegentropyQueries.delete(requestId);
    if (typeof data.error === 'string' && data.error.length > 0) {
      pending.reject(new Error(`Negentropy query rejected by ${peerId.slice(0, 8)}: ${data.error}`));
      return;
    }
    pending.resolve(data.response as NegentropyResponse);
  }

  private async handleMessageSyncFetchRequest(peerId: string, data: any): Promise<void> {
    const wsId = data.workspaceId as string | undefined;
    if (!wsId) return;
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return;
    if (!ws.members.some((m: any) => m.peerId === peerId)) return;

    const requested: Record<string, string[]> = data.messageIdsByChannel || {};
    const allMessages: any[] = [];

    for (const ch of ws.channels) {
      const requestedIds = Array.isArray(requested[ch.id]) ? requested[ch.id] : [];
      if (requestedIds.length === 0) continue;
      const idSet = new Set(requestedIds.filter((id) => typeof id === 'string'));
      if (idSet.size === 0) continue;

      const channelMessages = this.messageStore.getMessages(ch.id)
        .filter((m) => idSet.has(m.id))
        .sort((a, b) => a.timestamp - b.timestamp);
      for (const m of channelMessages) {
        allMessages.push({
          id: m.id,
          channelId: m.channelId,
          senderId: m.senderId,
          content: m.content,
          timestamp: m.timestamp,
          type: m.type,
          threadId: m.threadId,
          prevHash: m.prevHash,
          vectorClock: (m as any).vectorClock,
        });
      }
    }

    this.transport.send(peerId, {
      type: 'message-sync-response',
      workspaceId: wsId,
      messages: allMessages,
    });
  }

  private async handleMessageSyncRequest(peerId: string, data: any): Promise<void> {
    const wsId = data.workspaceId;
    if (!wsId) return;
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (!ws) return;
    if (!ws.members.some((m: any) => m.peerId === peerId)) return;

    const allMessages: any[] = [];
    const channelTimestamps: Record<string, number> = data.channelTimestamps || {};
    const MAX_SYNC_MESSAGES = 10_000;

    for (const ch of ws.channels) {
      const since = channelTimestamps[ch.id] ?? 0;
      const msgs = this.messageStore.getMessages(ch.id);
      const newer = msgs.filter(m => m.timestamp > since);
      for (const m of newer) {
        allMessages.push({
          id: m.id,
          channelId: m.channelId,
          senderId: m.senderId,
          content: m.content,
          timestamp: m.timestamp,
          type: m.type,
          threadId: m.threadId,
          prevHash: m.prevHash,
          vectorClock: (m as any).vectorClock,
        });
      }
    }

    if (allMessages.length > MAX_SYNC_MESSAGES) {
      const originalCount = allMessages.length;
      allMessages.length = MAX_SYNC_MESSAGES;
      console.warn(`[Sync] Truncated message-sync-response for ${peerId.slice(0, 8)}: ${originalCount} -> ${MAX_SYNC_MESSAGES} messages`);
    }

    // Send in larger chunks (was 100, now 500) to reduce the number of separate
    // _messageQueue entries on the receiver.  Each chunk triggers a full
    // handleMessageSyncResponse call with dedup-set construction, so fewer chunks
    // = less redundant work.  Yield between sends so the event loop can breathe.
    const CHUNK_SIZE = 500;
    for (let i = 0; i < allMessages.length; i += CHUNK_SIZE) {
      this.transport.send(peerId, {
        type: 'message-sync-response',
        workspaceId: wsId,
        messages: allMessages.slice(i, i + CHUNK_SIZE),
      });
      if (i + CHUNK_SIZE < allMessages.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  private async handleMessageSyncResponse(_peerId: string, data: any): Promise<void> {
    const _msrT0 = performance.now();
    const _msrTag = _peerId.slice(0, 8);
    try {
      const wsId = data.workspaceId;
      if (!wsId) { syncLog.info('handleMessageSyncResponse: no wsId'); return; }
      const ws = this.workspaceManager.getWorkspace(wsId);
      if (!ws) { syncLog.info('handleMessageSyncResponse: no workspace for', wsId); return; }
      if (!ws.members.some((m: any) => m.peerId === _peerId)) { syncLog.info('handleMessageSyncResponse: peer not member', _msrTag); return; }

      const messages: any[] = data.messages || [];
      if (messages.length === 0) { perfLog.debug(`handleMessageSyncResponse(${_msrTag}): 0 messages, skipping`); return; }
      perfLog.debug(`handleMessageSyncResponse(${_msrTag}): START, ${messages.length} messages`);

      const channelIds = new Set(ws.channels.map((ch: any) => ch.id));

      // Track IDs seen in this chunk to dedup within the chunk itself.
      const seenInChunk = new Set<string>();

      const unknownChannelRemap = new Map<string, string>();
      let touchedActiveChannel = false;
      const toInsert: any[] = [];
      const toRepair: any[] = [];

      const _phase1T0 = performance.now();
      for (const msg of messages) {
        let targetChannelId = msg.channelId;
        if (!channelIds.has(targetChannelId)) {
          if (unknownChannelRemap.has(targetChannelId)) {
            targetChannelId = unknownChannelRemap.get(targetChannelId)!;
          } else if (ws.channels.length === 1) {
            const firstLocalCh = ws.channels[0]?.id;
            if (firstLocalCh) {
              unknownChannelRemap.set(targetChannelId, firstLocalCh);
              targetChannelId = firstLocalCh;
            } else {
              continue;
            }
          } else {
            continue;
          }
        }

        // O(1) dedup check via the per-channel CRDT (Map-based) instead of
        // scanning the entire message store across all workspace channels.
        const crdt = this.getOrCreateCRDT(targetChannelId);
        const alreadyKnown = crdt.hasMessage(msg.id) || seenInChunk.has(msg.id);

        if (alreadyKnown) {
          // Check if this is a stream-repair (partial → full content).
          // We only need the heavier Map lookup for messages that already exist.
          const existingMsgs = this.messageStore.getMessages(targetChannelId);
          const existing = existingMsgs.find(m => m.id === msg.id);
          if (existing) {
            const incomingContent = typeof msg.content === 'string' ? msg.content : '';
            const existingContent = typeof existing.content === 'string' ? existing.content : '';
            const shouldRepair = incomingContent !== existingContent && (
              incomingContent.length > existingContent.length ||
              Boolean((existing as any).streaming)
            );
            if (shouldRepair) {
              existing.content = incomingContent;
              existing.threadId = msg.threadId ?? existing.threadId;
              existing.timestamp = Math.max(existing.timestamp, msg.timestamp || existing.timestamp);
              existing.type = (msg.type || existing.type || 'text') as 'text' | 'file' | 'system';
              existing.status = 'delivered';
              (existing as any).streaming = false;
              if (msg.vectorClock) (existing as any).vectorClock = msg.vectorClock;
              toRepair.push(existing);
              if (targetChannelId === this.state.activeChannelId) touchedActiveChannel = true;
            }
          }
          continue;
        }

        const syncMsg = {
          id: msg.id,
          channelId: targetChannelId,
          senderId: msg.senderId,
          content: msg.content,
          timestamp: msg.timestamp,
          type: (msg.type || 'text') as 'text' | 'file' | 'system',
          threadId: msg.threadId,
          prevHash: msg.prevHash || '',
          status: 'delivered' as const,
          vectorClock: msg.vectorClock,
        };

        toInsert.push(syncMsg);
        seenInChunk.add(msg.id);
        if (targetChannelId === this.state.activeChannelId) touchedActiveChannel = true;
      }
      perfLog.debug(`handleMessageSyncResponse(${_msrTag}): phase1 dedup=${(performance.now()-_phase1T0).toFixed(1)}ms, toInsert=${toInsert.length}, toRepair=${toRepair.length}`);

      // Bulk-insert new messages — O(n log n) via push + sort, single call.
      const _bulkT0 = performance.now();
      this.messageStore.bulkAdd(toInsert);
      perfLog.debug(`handleMessageSyncResponse(${_msrTag}): bulkAdd=${(performance.now()-_bulkT0).toFixed(1)}ms`);

      // Yield to event loop so UI/connections can breathe between Phase 1 and Phase 2.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      // Phase 2: CRDT integration (synchronous but lightweight — Map-based dedup)
      const _crdtT0 = performance.now();
      const toSync = [...toInsert, ...toRepair];
      for (const msg of toSync) {
        try {
          const crdt = this.getOrCreateCRDT(msg.channelId);
          crdt.addMessage({
            id: msg.id, channelId: msg.channelId, senderId: msg.senderId,
            content: msg.content, type: msg.type,
            vectorClock: msg.vectorClock || {}, wallTime: msg.timestamp,
            prevHash: msg.prevHash || '',
          });
        } catch { /* CRDT dup safe to ignore */ }
      }
      perfLog.debug(`handleMessageSyncResponse(${_msrTag}): phase2 CRDT=${(performance.now()-_crdtT0).toFixed(1)}ms, synced=${toSync.length}`);

      // Phase 3: Batch-persist to IndexedDB in a single transaction instead of
      // N concurrent individual puts that saturate the IDB transaction pool.
      if (toSync.length > 0) {
        const _idbT0 = performance.now();
        try {
          await this.persistentStore.saveMessages(toSync);
          perfLog.debug(`handleMessageSyncResponse(${_msrTag}): phase3 IDB persist=${(performance.now()-_idbT0).toFixed(1)}ms`);
        } catch (err) {
          console.warn('[Sync] Batch persist error:', err);
        }
      }

      // Phase 3.5: Trim in-memory stores so a single long-running session
      // doesn't grow RAM unboundedly.  Evicted messages stay in IDB.
      const _trimT0 = performance.now();
      const trimmedChannels = new Set<string>();
      for (const msg of toSync) {
        if (!trimmedChannels.has(msg.channelId)) {
          trimmedChannels.add(msg.channelId);
          this.trimChannelMemory(msg.channelId);
        }
      }
      perfLog.debug(`handleMessageSyncResponse(${_msrTag}): phase3.5 trim=${(performance.now()-_trimT0).toFixed(1)}ms, channels=${trimmedChannels.size}`);

      if (touchedActiveChannel) {
        this.ui?.renderMessages();
      }

      // Record activity for synced thread replies + mentions (batch)
      if (toSync.length > 0) {
        const activityLenBefore = this.activityItems.length;
        const activityUnreadBefore = this.getActivityUnreadCount();
        for (const msg of toSync) {
          if (msg.senderId === this.state.myPeerId) continue;
          this.maybeRecordMentionActivity(msg as any, msg.channelId, wsId);
          if (msg.threadId) {
            this.maybeRecordThreadActivity(msg as any, msg.channelId);
          }
        }
        if (this.activityItems.length !== activityLenBefore
          || this.getActivityUnreadCount() !== activityUnreadBefore) {
          this.ui?.updateChannelHeader();
          this.ui?.updateWorkspaceRail?.();
        }
      }
      perfLog.debug(`handleMessageSyncResponse(${_msrTag}): TOTAL=${(performance.now()-_msrT0).toFixed(1)}ms`);
    } catch (err) {
      console.error('[Sync] handleMessageSyncResponse FATAL:', (err as any)?.message, (err as any)?.stack);
    }
  }

  // =========================================================================
  // CRDT / offline queue
  // =========================================================================

  getOrCreateCRDT(channelId: string): MessageCRDT {
    if (!this.messageCRDTs.has(channelId)) {
      this.messageCRDTs.set(channelId, new MessageCRDT(this.state.myPeerId));
    }
    return this.messageCRDTs.get(channelId)!;
  }

  /**
   * Trim a channel's in-memory data (MessageStore + CRDT) to
   * MAX_IN_MEMORY_MESSAGES_PER_CHANNEL.  Oldest messages are evicted from RAM
   * but remain in IndexedDB.
   */
  private trimChannelMemory(channelId: string): void {
    const cap = ChatController.MAX_IN_MEMORY_MESSAGES_PER_CHANNEL;
    const evicted = this.messageStore.trimChannel(channelId, cap);
    if (evicted > 0) {
      const crdt = this.messageCRDTs.get(channelId);
      if (crdt) crdt.trimChannel(channelId, cap);
    }
  }

  private extractQueuedOpId(item: any): string | null {
    const payload = item?.data ?? item;
    if (this.isCustodyEnvelope(payload)) {
      return typeof payload.opId === 'string' && payload.opId.length > 0 ? payload.opId : null;
    }

    const envelope = payload?.ciphertext ?? payload;
    const messageId = (envelope as any)?.messageId ?? (payload as any)?.messageId;
    return typeof messageId === 'string' && messageId.length > 0 ? messageId : null;
  }

  private async buildReplayEnvelopeForOutgoingMessage(
    peerId: string,
    msg: PlaintextMessage,
  ): Promise<{ envelope: any; queueWorkspaceId: string; metadata: Record<string, unknown> }> {
    const workspace = this.findWorkspaceByChannelId(msg.channelId);
    const convMap = (this.directConversationStore as any).conversations as Map<string, { contactPeerId: string; originWorkspaceId?: string }> | undefined;
    const directConversation = convMap?.get(msg.channelId);
    const isDirect = !workspace && directConversation?.contactPeerId === peerId;

    const encryptionWorkspaceId = workspace?.id ?? directConversation?.originWorkspaceId ?? this.resolveSharedWorkspaceIds(peerId)[0];
    const queueWorkspaceId = workspace?.id || directConversation?.originWorkspaceId || 'direct';

    const envelope = await this.encryptMessageWithPreKeyBootstrap(peerId, msg.content, encryptionWorkspaceId);
    (envelope as any).channelId = msg.channelId;
    if (workspace?.id) {
      (envelope as any).workspaceId = workspace.id;
    }
    (envelope as any).threadId = msg.threadId;
    (envelope as any).vectorClock = (msg as any).vectorClock;
    (envelope as any).messageId = msg.id;
    const gossipOriginSignature = await this.signGossipOrigin({
      messageId: msg.id,
      channelId: msg.channelId,
      content: msg.content,
      threadId: msg.threadId,
      replyToId: (msg as any).replyToId,
    });
    if (gossipOriginSignature) {
      (envelope as any)._gossipOriginSignature = gossipOriginSignature;
    }
    (envelope as any).timestamp = msg.timestamp;

    if ((msg as any).metadata) {
      (envelope as any).metadata = (msg as any).metadata;
    }

    const attachments = Array.isArray((msg as any).attachments) ? (msg as any).attachments : [];
    if (attachments.length > 0) {
      (envelope as any).attachments = attachments;
    }

    if (isDirect) {
      (envelope as any).isDirect = true;
      if (directConversation?.originWorkspaceId) {
        (envelope as any).workspaceContextId = directConversation.originWorkspaceId;
      }
    }

    if (msg.threadId) {
      const threadRoot = this.messageStore.getThreadRoot(msg.threadId);
      if (threadRoot) {
        (envelope as any).threadRootSnapshot = {
          senderId: threadRoot.senderId,
          senderIdentityId: (threadRoot as any).senderIdentityId,
          content: threadRoot.content,
          timestamp: threadRoot.timestamp,
          attachments: (threadRoot as any).attachments,
        };
      }
    }

    return {
      envelope,
      queueWorkspaceId,
      metadata: {
        messageId: msg.id,
        senderId: this.state.myPeerId,
        senderName: this.getDisplayNameForPeer(this.state.myPeerId),
        ...(isDirect ? { isDirect: true } : {}),
        ...(attachments.length > 0 ? { hasAttachment: true } : {}),
      },
    };
  }

  private async reconcileReplayedOutgoingMessage(peerId: string, messageId?: string): Promise<void> {
    if (!messageId) return;

    const msg = this.findMessageById(messageId);
    if (!msg || msg.senderId !== this.state.myPeerId) return;

    // Important: never persist the peer-specific fallback used by receipt validation.
    // During reconnect, workspace/direct metadata may not be fully hydrated yet; in that
    // case collapsing a multi-recipient message down to [peerId] would make everyone
    // except the first replayed peer look permanently pending.
    const recipients = this.getStableMessageRecipients(msg);

    const ackedBy = new Set<string>(Array.isArray((msg as any).ackedBy) ? (msg as any).ackedBy : []);
    const readBy = new Set<string>(Array.isArray((msg as any).readBy) ? (msg as any).readBy : []);
    const ackedAt: Record<string, number> = { ...((msg as any).ackedAt || {}) };
    const readAt: Record<string, number> = { ...((msg as any).readAt || {}) };

    const statusRecipients = this.getStatusMessageRecipients(msg, recipients);
    const deliveredToAll = statusRecipients.length > 0 && statusRecipients.every((id) => ackedBy.has(id));
    const readByAll = statusRecipients.length > 0 && statusRecipients.every((id) => readBy.has(id));
    const computedStatus: 'pending' | 'sent' | 'delivered' | 'read' = readByAll ? 'read' : (deliveredToAll ? 'delivered' : 'sent');
    const rank: Record<'pending' | 'sent' | 'delivered' | 'read', number> = {
      pending: 0,
      sent: 1,
      delivered: 2,
      read: 3,
    };
    const currentStatus = (msg.status ?? 'pending') as 'pending' | 'sent' | 'delivered' | 'read';
    const nextStatus = rank[currentStatus] > rank[computedStatus] ? currentStatus : computedStatus;
    const currentRecipients = Array.isArray((msg as any).recipientPeerIds)
      ? ((msg as any).recipientPeerIds as string[]).filter((value) => typeof value === 'string' && value.length > 0)
      : [];
    const normalizedCurrentRecipients = [...currentRecipients].sort();
    const normalizedNextRecipients = [...recipients].sort();
    const recipientsChanged = normalizedCurrentRecipients.length !== normalizedNextRecipients.length
      || normalizedCurrentRecipients.some((value, index) => value !== normalizedNextRecipients[index]);

    if (!recipientsChanged && nextStatus === currentStatus) {
      return;
    }

    if (recipients.length > 0) {
      (msg as any).recipientPeerIds = recipients;
    }
    (msg as any).status = nextStatus;

    const persistedMessage: Record<string, unknown> = {
      ...msg,
      status: nextStatus,
      ackedBy: Array.from(ackedBy),
      ackedAt,
      readBy: Array.from(readBy),
      readAt,
    };
    if (recipients.length > 0) {
      persistedMessage.recipientPeerIds = recipients;
    }

    await this.persistentStore.saveMessage(persistedMessage as unknown as PlaintextMessage);

    this.ui?.updateMessageStatus?.(msg.id, nextStatus, {
      acked: statusRecipients.filter((id) => ackedBy.has(id)).length,
      total: statusRecipients.length,
      read: statusRecipients.filter((id) => readBy.has(id)).length,
    });
  }

  private async retryUnackedOutgoingForPeer(peerId: string): Promise<void> {
    if (!this.state.readyPeers.has(peerId)) return;

    const inFlight = this.retryUnackedInFlight.get(peerId);
    if (inFlight) { perfLog.debug(`retryUnacked(${peerId.slice(0,8)}): returning existing in-flight`); return inFlight; }

    const _ruTag = peerId.slice(0, 8);
    const _ruT0 = performance.now();
    perfLog.debug(`retryUnacked(${_ruTag}): START`);

    // Serialize globally: wait for any other peer's scan to finish first
    // so we don't run N concurrent O(allMessages) scans.
    const prevGate = this._retryUnackedGlobalGate;

    const task = (async () => {
      const _gateT0 = performance.now();
      await prevGate;
      perfLog.debug(`retryUnacked(${_ruTag}): waited for globalGate=${(performance.now()-_gateT0).toFixed(1)}ms`);
      if (!this.state.readyPeers.has(peerId)) { perfLog.debug(`retryUnacked(${_ruTag}): peer left while waiting`); return; }

      const _qT0 = performance.now();
      const queued = typeof (this.offlineQueue as any).listQueued === 'function'
        ? await this.offlineQueue.listQueued(peerId)
        : await this.offlineQueue.getQueued(peerId);
      const queuedMessageIds = new Set<string>();
      for (const item of queued as any[]) {
        const opId = this.extractQueuedOpId(item);
        if (opId) queuedMessageIds.add(opId);
      }
      perfLog.debug(`retryUnacked(${_ruTag}): offlineQueue fetch=${(performance.now()-_qT0).toFixed(1)}ms, queuedIds=${queuedMessageIds.size}`);

      if (this.custodyStore && typeof this.custodyStore.listAllForRecipient === 'function') {
        const _cT0 = performance.now();
        const pendingEnvelopes = await this.custodyStore.listAllForRecipient(peerId);
        for (const envelope of pendingEnvelopes) {
          if (typeof envelope?.opId === 'string' && envelope.opId.length > 0) {
            queuedMessageIds.add(envelope.opId);
          }
        }
        perfLog.debug(`retryUnacked(${_ruTag}): custodyStore fetch=${(performance.now()-_cT0).toFixed(1)}ms, totalQueuedIds=${queuedMessageIds.size}`);
      }

      const candidates: PlaintextMessage[] = [];
      let scanned = 0;
      const _scanT0 = performance.now();
      let channelCount = 0;
      for (const channelId of this.messageStore.getAllChannelIds()) {
        channelCount++;
        const channelMessages = this.messageStore.getMessages(channelId) as PlaintextMessage[];
        for (const msg of channelMessages) {
          scanned += 1;
          if (scanned % ChatController.RETRY_UNACKED_SCAN_YIELD_EVERY === 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }

          if (msg.senderId !== this.state.myPeerId) continue;
          if (queuedMessageIds.has(msg.id)) continue;

          const recipients = this.getStableMessageRecipients(msg);
          if (!recipients.includes(peerId)) continue;

          const ackedBy = new Set<string>(Array.isArray((msg as any).ackedBy) ? (msg as any).ackedBy : []);
          const readBy = new Set<string>(Array.isArray((msg as any).readBy) ? (msg as any).readBy : []);
          if (ackedBy.has(peerId) || readBy.has(peerId)) continue;
          if (msg.status === 'delivered' || msg.status === 'read') continue;

          candidates.push(msg);
        }
      }
      perfLog.debug(`retryUnacked(${_ruTag}): scan=${(performance.now()-_scanT0).toFixed(1)}ms, channels=${channelCount}, scanned=${scanned}, candidates=${candidates.length}`);

      candidates.sort((a, b) => a.timestamp - b.timestamp);

      let replayed = 0;
      const _replayT0 = performance.now();
      for (const msg of candidates) {
        if (!this.state.readyPeers.has(peerId)) break;

        replayed += 1;
        if (replayed % 25 === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }

        try {
          const { envelope, queueWorkspaceId, metadata } = await this.buildReplayEnvelopeForOutgoingMessage(peerId, msg);
          (envelope as any)._offlineReplay = 1;
          const sent = this.transport.send(peerId, envelope);
          if (!sent) {
            await this.queueCustodyEnvelope(peerId, {
              envelopeId: typeof (envelope as any).id === 'string' ? (envelope as any).id : undefined,
              opId: msg.id,
              recipientPeerIds: [peerId],
              workspaceId: queueWorkspaceId,
              channelId: msg.channelId,
              ...(msg.threadId ? { threadId: msg.threadId } : {}),
              domain: 'channel-message',
              ciphertext: envelope,
              metadata,
            }, envelope);
            this.scheduleOfflineQueueFlush(peerId);
            continue;
          }

          await this.reconcileReplayedOutgoingMessage(peerId, msg.id);
        } catch (error) {
          console.warn('[OfflineQueue] resend/reconcile failed for', msg.id, (error as Error)?.message || error);
        }
      }
      perfLog.debug(`retryUnacked(${_ruTag}): replay=${(performance.now()-_replayT0).toFixed(1)}ms, replayed=${replayed}`);
      perfLog.debug(`retryUnacked(${_ruTag}): TOTAL=${(performance.now()-_ruT0).toFixed(1)}ms`);
    })().finally(() => {
      if (this.retryUnackedInFlight.get(peerId) === task) {
        this.retryUnackedInFlight.delete(peerId);
      }
    });

    this.retryUnackedInFlight.set(peerId, task);
    // Chain onto the global gate so the next peer waits for us to finish
    this._retryUnackedGlobalGate = task.catch(() => {});
    return task;
  }

  private async flushOfflineQueue(peerId: string, options?: { bypassCooldown?: boolean }): Promise<void> {
    if (!peerId) return;

    const inFlight = this.offlineQueueFlushInFlight.get(peerId);
    if (inFlight) return inFlight;

    const now = Date.now();
    const lastFlushAt = this.lastOfflineQueueFlushAt.get(peerId) ?? 0;
    if (!options?.bypassCooldown && now - lastFlushAt < ChatController.OFFLINE_QUEUE_FLUSH_MIN_MS) {
      return;
    }

    const task = (async () => {
      this.lastOfflineQueueFlushAt.set(peerId, Date.now());

      // Non-destructive replay: never dequeue before successful transport.send().
      // This prevents message loss during reconnect/refresh races.
      const queued = await this.offlineQueue.getQueued(peerId);

      let delivered = 0;
      let failed = 0;
      let hitBackpressure = false;
      const deliveredIds: number[] = [];  // Batch-remove after loop

      for (const item of queued as any[]) {
        const queuedPayload = item?.data ?? item;
        const custodyEnvelope = this.isCustodyEnvelope(queuedPayload) ? queuedPayload : null;
        let envelope = custodyEnvelope ? custodyEnvelope.ciphertext : queuedPayload;

        // Deferred plaintext fallback is intentional: these outbox entries were queued
        // only when encryption state was unavailable. Re-encrypt now that handshake is ready.
        if ((envelope as any)?._deferred) {
          try {
            const deferred = envelope as any;
            const encrypted = await this.encryptMessageWithPreKeyBootstrap(peerId, deferred.content, deferred.workspaceId);
            (encrypted as any).channelId = deferred.channelId;
            (encrypted as any).workspaceId = deferred.workspaceId;
            (encrypted as any).threadId = deferred.threadId;
            (encrypted as any).vectorClock = deferred.vectorClock;
            (encrypted as any).messageId = deferred.messageId;
            (encrypted as any).timestamp = deferred.timestamp;
            if (deferred.isDirect) {
              (encrypted as any).isDirect = true;
            }
            if (deferred.workspaceContextId) {
              (encrypted as any).workspaceContextId = deferred.workspaceContextId;
            }
            if (deferred.metadata) {
              (encrypted as any).metadata = deferred.metadata;
            }
            if (Array.isArray(deferred.attachments) && deferred.attachments.length > 0) {
              (encrypted as any).attachments = deferred.attachments;
            }
            if (deferred._originalMessageId) {
              (encrypted as any)._originalMessageId = deferred._originalMessageId;
            }
            if (deferred._gossipOriginalSender) {
              (encrypted as any)._gossipOriginalSender = deferred._gossipOriginalSender;
            }
            if (typeof deferred._gossipHop === 'number') {
              (encrypted as any)._gossipHop = deferred._gossipHop;
            }
            if (typeof deferred._gossipOriginSignature === 'string' && deferred._gossipOriginSignature.length > 0) {
              (encrypted as any)._gossipOriginSignature = deferred._gossipOriginSignature;
            }

            // Include thread root snapshot for thread messages
            if (deferred.threadId) {
              const threadRoot = this.messageStore.getThreadRoot(deferred.threadId);
              if (threadRoot) {
                (encrypted as any).threadRootSnapshot = {
                  senderId: threadRoot.senderId,
                  senderIdentityId: (threadRoot as any).senderIdentityId,
                  content: threadRoot.content,
                  timestamp: threadRoot.timestamp,
                  attachments: (threadRoot as any).attachments,
                };
              } else if (deferred.threadRootSnapshot) {
                (encrypted as any).threadRootSnapshot = deferred.threadRootSnapshot;
              }
            } else if (deferred.threadRootSnapshot) {
              (encrypted as any).threadRootSnapshot = deferred.threadRootSnapshot;
            }

            envelope = encrypted;
          } catch (encryptErr) {
            console.error('[OfflineQueue] deferred encrypt failed for', peerId, encryptErr);
            failed += 1;
            if (typeof item?.id === 'number') {
              await this.offlineQueue.markAttempt(peerId, item.id);
            }
            continue;
          }
        }

        if (!envelope || typeof envelope !== 'object') {
          if (typeof item?.id === 'number') {
            deliveredIds.push(item.id);
          }
          continue;
        }

        // Mark replayed outbox traffic so receiver can route it through trusted
        // replay lane instead of normal chat throttling.
        (envelope as any)._offlineReplay = 1;
        if (custodyEnvelope && !(envelope as any).envelopeId) {
          (envelope as any).envelopeId = custodyEnvelope.envelopeId;
        }

        try {
          const sent = this.transport.send(peerId, envelope);
          if (!sent) {
            // Transport backpressure/transient readiness race. Keep item queued
            // and retry shortly without increasing attempt counters.
            hitBackpressure = true;
            break;
          }
          // Collect for batch-remove after the loop.
          if (typeof item?.id === 'number') {
            deliveredIds.push(item.id);
          }
          delivered += 1;

          const msgId = custodyEnvelope?.opId ?? (envelope as any)?.messageId ?? (item?.data ?? item)?.messageId;
          const watchChannelId = custodyEnvelope?.channelId ?? (envelope as any)?.channelId ?? (item?.data ?? item)?.channelId;
          const watchWorkspaceId = custodyEnvelope?.workspaceId && custodyEnvelope.workspaceId !== 'direct'
            ? custodyEnvelope.workspaceId
            : ((item?.data ?? item)?.workspaceId || undefined);
          if (watchChannelId && msgId) {
            this.schedulePendingDeliveryWatch(peerId, watchChannelId, msgId, watchWorkspaceId);
          }
          await this.reconcileReplayedOutgoingMessage(peerId, msgId);
        } catch (err) {
          failed += 1;
          if (typeof item?.id === 'number') {
            await this.offlineQueue.markAttempt(peerId, item.id);
          }
          console.error('Failed to deliver queued message to', peerId, err);
        }
      }

      // Batch-remove all delivered/discarded items in a single IDB transaction
      if (deliveredIds.length > 0) {
        try {
          await this.offlineQueue.removeBatch(peerId, deliveredIds);
        } catch (batchErr) {
          console.error('[OfflineQueue] batch remove failed, falling back to individual:', batchErr);
          for (const id of deliveredIds) {
            await this.offlineQueue.remove(peerId, id).catch(() => {});
          }
        }
      }

      if (delivered > 0) {
        this.ui?.showToast(
          `📬 Delivered ${delivered} queued message${delivered > 1 ? 's' : ''} to ${peerId.slice(0, 8)}`,
          'success',
        );
      }
      if (failed > 0) {
        this.ui?.showToast(
          `⚠️ ${failed} queued message${failed > 1 ? 's' : ''} still pending for ${peerId.slice(0, 8)}`,
          'error',
        );
      }

      // Retry pending queue shortly while peer remains ready.
      // Use fast retry after transient backpressure, otherwise normal retry.
      if (failed > 0 || hitBackpressure) {
        setTimeout(() => {
          if (this.state.readyPeers.has(peerId)) {
            this.flushOfflineQueue(peerId, { bypassCooldown: hitBackpressure }).catch((err) => {
              console.warn('[OfflineQueue] retry flush failed:', (err as Error)?.message || err);
            });
          }
        }, hitBackpressure ? 250 : 1_500);
      }
    })().finally(() => {
      if (this.offlineQueueFlushInFlight.get(peerId) === task) {
        this.offlineQueueFlushInFlight.delete(peerId);
      }
    });

    this.offlineQueueFlushInFlight.set(peerId, task);
    return task;
  }

  private isPublicWorkspaceDeliveryChannel(workspaceId?: string, channelId?: string): boolean {
    if (!workspaceId || !channelId) return false;
    if (!this.workspaceManager || typeof (this.workspaceManager as any).getWorkspace !== 'function') return false;

    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (!ws) return false;

    const channel = ws.channels.find((candidate) => candidate.id === channelId);
    if (!channel) return false;

    const manager = this.workspaceManager as any;
    if (typeof manager.isPublicWorkspaceChannel === 'function') {
      return manager.isPublicWorkspaceChannel(channel) === true;
    }

    return channel.type === 'channel' && channel.accessPolicy?.mode === 'public-workspace';
  }

  /**
   * DEP-015: public-workspace channels use bounded sender fanout.
   *
   * First rollout keeps pairwise-encrypted envelopes but limits sender fanout to
   * a bounded relay set derived from the existing partial-mesh topology. Network-wide
   * delivery is completed via the existing gossip relay path (T3.2), not sender→all.
   */
  private getChannelDeliveryPeerIds(
    channelId = this.state.activeChannelId ?? undefined,
    workspaceId = this.state.activeWorkspaceId ?? undefined,
  ): string[] {
    const allWorkspaceRecipients = this.getWorkspaceRecipientPeerIds(workspaceId);
    if (!workspaceId || !channelId) return allWorkspaceRecipients;

    if (!this.isPublicWorkspaceDeliveryChannel(workspaceId, channelId)) {
      // Backward compatibility: explicit/small/private channels keep legacy direct fanout.
      return allWorkspaceRecipients;
    }

    const uniqueKnownRecipients = Array.from(new Set(
      allWorkspaceRecipients.filter((peerId) => typeof peerId === 'string' && peerId.length > 0 && peerId !== this.state.myPeerId),
    ));
    if (uniqueKnownRecipients.length === 0) return [];
    const knownRecipientSet = new Set(uniqueKnownRecipients);

    const connectedPeers = new Set<string>(this.getTransportConnectedPeerIds());

    const selected: string[] = [];
    const selectedSet = new Set<string>();
    const hardCap = Math.max(1, this.computeHardCap());
    const minSafe = Math.min(ChatController.PARTIAL_MESH_MIN_SAFE_PEERS, uniqueKnownRecipients.length);

    const pick = (peerId: string): void => {
      if (!peerId || selectedSet.has(peerId)) return;
      if (!knownRecipientSet.has(peerId)) return;
      if (selected.length >= hardCap) return;
      selectedSet.add(peerId);
      selected.push(peerId);
    };

    const desiredSelection = this.selectDesiredPeers(workspaceId, Date.now());
    const desiredPeers = Array.isArray(desiredSelection?.desiredPeerIds)
      ? desiredSelection.desiredPeerIds
      : [];

    // 1) Prefer currently ready desired peers.
    for (const peerId of desiredPeers) {
      if (this.state.readyPeers.has(peerId)) pick(peerId);
    }

    // 2) Then any connected desired peers.
    for (const peerId of desiredPeers) {
      if (connectedPeers.has(peerId)) pick(peerId);
    }

    // 3) Keep a bounded fallback using currently ready/connected workspace peers.
    for (const peerId of uniqueKnownRecipients) {
      if (this.state.readyPeers.has(peerId)) pick(peerId);
    }
    for (const peerId of uniqueKnownRecipients) {
      if (connectedPeers.has(peerId)) pick(peerId);
    }

    // 4) If online candidates are empty, queue a bounded desired/known subset.
    for (const peerId of desiredPeers) pick(peerId);
    for (const peerId of uniqueKnownRecipients) {
      if (selected.length >= minSafe) break;
      pick(peerId);
    }

    return selected;
  }

  private getWorkspaceRecipientPeerIds(workspaceId = this.state.activeWorkspaceId ?? undefined): string[] {
    const ws = workspaceId
      ? this.workspaceManager.getWorkspace(workspaceId)
      : null;

    if (!ws) {
      // SECURITY: Do NOT fallback to readyPeers — that sends to ALL connected peers
      // regardless of workspace membership, leaking messages across workspaces.
      return [];
    }

    // Build recipient set: for each member, include their primary peerId
    // plus all known device peerIds from the device registry.
    const myPeerId = this.state.myPeerId;
    const recipientSet = new Set<string>();

    for (const member of ws.members) {
      if (member.peerId === myPeerId) continue;

      // Add the member's primary peerId
      recipientSet.add(member.peerId);

      // Multi-device: if this member has a known identityId, add all their device peerIds
      if (member.identityId) {
        for (const devicePeerId of this.deviceRegistry.getAllPeerIds(member.identityId)) {
          if (devicePeerId !== myPeerId) {
            recipientSet.add(devicePeerId);
          }
        }
      }

      // Also include devices from workspace member data
      if (member.devices) {
        for (const device of member.devices) {
          if (device.peerId !== myPeerId) {
            recipientSet.add(device.peerId);
          }
        }
      }
    }

    return Array.from(recipientSet);
  }

  private ensurePeerInActiveWorkspace(peerId: string, _publicKey = ''): void {
    // Handshake readiness is not authoritative proof of workspace membership.
    // Peers can become connected through PEX / partial mesh even when they belong
    // only to some other workspace. Auto-adding them here leaks members and
    // presence across workspaces.
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      if (ws.members.some((m: any) => m.peerId === peerId)) return;
    }
  }

  /** Resolve a peer's display name given a channel context (looks through workspace members) */
  private getPeerAliasForChannel(peerId: string, channelId: string): string {
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      if (ws.channels.some((ch: any) => ch.id === channelId)) {
        const member = ws.members.find((m: any) => m.peerId === peerId);
        if (member?.alias) return member.alias;
        const directoryAlias = this.publicWorkspaceController?.getMemberAlias?.(peerId, ws.id);
        if (directoryAlias?.trim()) return directoryAlias;
      }
    }
    return peerId.slice(0, 8);
  }

  /**
   * Best available display name for a peer — checks all sources in priority order:
   * 1. Explicit contacts (user-chosen name)
   * 2. Any workspace member alias (synced via name-announce)
   * 3. Truncated peer ID fallback
   */
  getDisplayNameForPeer(peerId: string): string {
    // 1. Explicit contact (highest priority — user-named)
    const contact = this.contactStore.getSync?.(peerId);
    if (contact?.displayName) return contact.displayName;

    // 2. Any workspace member alias
    for (const ws of this.workspaceManager.getAllWorkspaces()) {
      const member = ws.members.find((m: any) => m.peerId === peerId);
      if (member?.alias && member.alias.trim()) return member.alias;
    }

    // 3. Directory-page alias (shell-first / paged workspace sync path)
    const pagedAlias = this.publicWorkspaceController?.getMemberAlias?.(peerId);
    if (pagedAlias?.trim()) return pagedAlias;

    // 4. Truncated peer ID
    return peerId.slice(0, 8);
  }

  getWorkspaceReliabilityState(workspaceId: string): {
    chatContinues: boolean;
    discoverySlower: boolean;
    deeperHistoryDelayed: boolean;
    directorySearchPartial: boolean;
    relayFallbackActive: boolean;
    underReplicatedShardCount: number;
  } {
    const ws = this.workspaceManager.getWorkspace(workspaceId);
    if (!ws) {
      return {
        chatContinues: false,
        discoverySlower: true,
        deeperHistoryDelayed: true,
        directorySearchPartial: true,
        relayFallbackActive: true,
        underReplicatedShardCount: 0,
      };
    }

    const workspaceMemberIds = new Set((ws.members ?? []).map((member) => member.peerId));
    const readyWorkspacePeers = this.getWorkspaceRecipientPeerIds(workspaceId)
      .filter((peerId) => this.state.readyPeers.has(peerId));
    const chatContinues = readyWorkspacePeers.length > 0;

    let relayHelperCount = 0;
    let archiveHelperCount = 0;
    for (const peerId of this.state.readyPeers) {
      if (!workspaceMemberIds.has(peerId)) continue;
      const summary = this.getPeerCapabilitySummary(peerId);
      if (summary.relayChannels.length > 0) relayHelperCount += 1;
      if (summary.archiveCapable) archiveHelperCount += 1;
    }

    const largeWorkspaceEnabled = this.workspaceHasLargeWorkspaceCapability(ws);
    const mediumWorkspace = largeWorkspaceEnabled
      && (ws.shell?.memberCount ?? ws.members.length) >= MEDIUM_WORKSPACE_MEMBER_THRESHOLD;
    const requiredReplicaCount = mediumWorkspace ? IMPORTANT_SHARD_MIN_REPLICAS : 1;

    const underReplicatedShardCount = largeWorkspaceEnabled
      ? (ws.directoryShards ?? []).filter((shard) => {
          const liveReplicas = [...new Set((shard.replicaPeerIds ?? []).filter((peerId) => this.state.readyPeers.has(peerId)))];
          return liveReplicas.length < requiredReplicaCount;
        }).length
      : 0;

    const directoryHelperCount = largeWorkspaceEnabled
      ? this.selectWorkspaceSyncTargetPeers(workspaceId, MEMBER_DIRECTORY_CAPABILITY).length
      : readyWorkspacePeers.length;
    const discoverySlower = largeWorkspaceEnabled
      ? directoryHelperCount < requiredReplicaCount || underReplicatedShardCount > 0
      : false;

    const snapshot = this.publicWorkspaceController.getSnapshot(workspaceId);
    const directorySearchPartial = largeWorkspaceEnabled && snapshot.hasMore && discoverySlower;
    const deeperHistoryDelayed = largeWorkspaceEnabled ? archiveHelperCount === 0 : false;
    const relayFallbackActive = largeWorkspaceEnabled ? relayHelperCount < requiredReplicaCount : false;

    return {
      chatContinues,
      discoverySlower,
      deeperHistoryDelayed,
      directorySearchPartial,
      relayFallbackActive,
      underReplicatedShardCount,
    };
  }

  getWorkspaceMemberDirectory(workspaceId: string): {
    members: Array<{
      peerId: string;
      alias: string;
      role: MemberSummary['role'];
      isBot: boolean;
      isOnline: boolean;
      isYou: boolean;
      allowWorkspaceDMs: boolean;
    }>;
    loadedCount: number;
    totalCount: number;
    hasMore: boolean;
    presence?: {
      onlineCount: number | null;
      sampledOnlineCount: number;
      sampledPeerCount: number;
      hasMore: boolean;
      nextCursor?: string;
      loadedPages: number;
      activeChannelId?: string;
      updatedAt?: number;
    };
  } {
    const snapshot = this.publicWorkspaceController.getSnapshot(workspaceId);
    const workspace = this.workspaceManager.getWorkspace(workspaceId);
    const workspaceMembers = workspace?.members ?? [];
    const localMemberByPeerId = new Map(workspaceMembers.map((member) => [member.peerId, member] as const));
    const largeWorkspaceEnabled = this.workspaceHasLargeWorkspaceCapability(workspace);
    const hasDirectoryCapablePeer = this.selectWorkspaceSyncTargetPeers(workspaceId, MEMBER_DIRECTORY_CAPABILITY).length > 0;
    const canPageDirectory = largeWorkspaceEnabled && hasDirectoryCapablePeer;

    const aggregatePresence = typeof (this.presence as any).getPresenceAggregate === 'function'
      ? this.presence.getPresenceAggregate(workspaceId)
      : undefined;
    const activePresenceChannelId = this.state.activeWorkspaceId === workspaceId
      ? this.state.activeChannelId || undefined
      : aggregatePresence?.activeChannelId;
    const pagePresence = activePresenceChannelId && typeof (this.presence as any).getPresencePageSnapshot === 'function'
      ? this.presence.getPresencePageSnapshot(workspaceId, activePresenceChannelId)
      : undefined;

    const identityState = new Map<string, { hasMe: boolean; hasOnline: boolean }>();
    const myKnownPeerIds = new Set<string>([this.state.myPeerId]);
    if (this.myIdentityId) {
      for (const peerId of this.deviceRegistry.getAllPeerIds(this.myIdentityId)) {
        if (peerId) myKnownPeerIds.add(peerId);
      }
    }

    for (const member of snapshot.members) {
      const identityKey = member.identityId || member.peerId;
      const aggregate = identityState.get(identityKey) || { hasMe: false, hasOnline: false };
      const localMember = localMemberByPeerId.get(member.peerId);

      // Aggregate online/me status across all known device peer IDs for this identity.
      const identityPeerIds = new Set<string>([member.peerId]);
      if (member.identityId) {
        for (const devicePeerId of this.deviceRegistry.getAllPeerIds(member.identityId)) {
          if (devicePeerId) identityPeerIds.add(devicePeerId);
        }
      }
      if (Array.isArray(localMember?.devices)) {
        for (const device of localMember.devices) {
          if (device?.peerId) identityPeerIds.add(device.peerId);
        }
      }

      if (
        [...identityPeerIds].some((peerId) => myKnownPeerIds.has(peerId)) ||
        (this.myIdentityId && (member.identityId === this.myIdentityId || localMember?.identityId === this.myIdentityId))
      ) {
        aggregate.hasMe = true;
      }

      const hasReadyPeerForIdentity = [...identityPeerIds].some((peerId) => this.state.readyPeers.has(peerId));
      const hasPresencePeerForIdentity = typeof (this.presence as any).getPeerPresence === 'function'
        ? [...identityPeerIds].some((peerId) => this.presence.getPeerPresence(workspaceId, peerId)?.online === true)
        : false;

      if (hasReadyPeerForIdentity || hasPresencePeerForIdentity) {
        aggregate.hasOnline = true;
      }

      identityState.set(identityKey, aggregate);
    }

    let members = snapshot.members.map((member) => {
      const localMember = localMemberByPeerId.get(member.peerId);
      const identityKey = member.identityId || member.peerId;
      const aggregate = identityState.get(identityKey);
      const localLooksLikeMe = (
        member.peerId === this.state.myPeerId
        || Boolean(this.myIdentityId && localMember?.identityId === this.myIdentityId)
        || Boolean(this.myPublicKey && localMember?.publicKey && localMember.publicKey === this.myPublicKey)
      );
      const isYou = aggregate?.hasMe === true || localLooksLikeMe;
      const isOnline = isYou || aggregate?.hasOnline === true;

      return {
        peerId: member.peerId,
        alias: member.alias,
        role: member.role,
        isBot: member.isBot === true,
        isOnline,
        isYou,
        allowWorkspaceDMs: localMember?.allowWorkspaceDMs ?? member.allowWorkspaceDMs ?? true,
        companySim: (localMember as any)?.companySim ?? (member as any).companySim,
      };
    });

    // If multiple entries resolve as self (multi-device migration edge case),
    // keep only one "you" badge — prefer current peerId, then an online one.
    const selfIndexes = members
      .map((member, index) => ({ member, index }))
      .filter(({ member }) => member.isYou);
    if (selfIndexes.length > 1) {
      const preferred = selfIndexes.find(({ member }) => member.peerId === this.state.myPeerId)
        || selfIndexes.find(({ member }) => member.isOnline)
        || selfIndexes[0];
      members = members.map((member, index) => (
        member.isYou && index !== preferred.index
          ? { ...member, isYou: false }
          : member
      ));
    }

    // Multi-device migration safety net:
    // if this workspace snapshot doesn't include the current device peer yet,
    // still show a local "you" row so presence doesn't look offline/stuck.
    if (!members.some((member) => member.isYou)) {
      const localSelfMember = localMemberByPeerId.get(this.state.myPeerId);
      members.push({
        peerId: this.state.myPeerId,
        alias: this.getMyAliasForWorkspace(workspaceId),
        role: localSelfMember?.role || 'member',
        isBot: false,
        isOnline: true,
        isYou: true,
        allowWorkspaceDMs: true,
        companySim: undefined,
      });
    }

    const effectiveLoadedCount = Math.max(snapshot.loadedCount, members.length);
    const effectiveTotalCount = Math.max(
      canPageDirectory ? snapshot.totalCount : snapshot.loadedCount,
      members.length,
    );

    return {
      members,
      loadedCount: effectiveLoadedCount,
      totalCount: effectiveTotalCount,
      hasMore: canPageDirectory ? snapshot.hasMore : false,
      presence: {
        onlineCount: aggregatePresence?.onlineCount ?? null,
        sampledOnlineCount: pagePresence?.onlinePeerCount ?? 0,
        sampledPeerCount: pagePresence?.loadedPeerCount ?? 0,
        hasMore: pagePresence?.hasMore ?? false,
        nextCursor: pagePresence?.nextCursor,
        loadedPages: pagePresence?.loadedPageCount ?? 0,
        activeChannelId: activePresenceChannelId,
        updatedAt: pagePresence?.updatedAt ?? aggregatePresence?.updatedAt,
      },
    };
  }

  async loadMoreWorkspaceMemberDirectory(workspaceId: string): Promise<ReturnType<ChatController['getWorkspaceMemberDirectory']> | null> {
    const initial = this.getWorkspaceMemberDirectory(workspaceId);
    if (!initial.hasMore) return initial;

    await this.prefetchWorkspaceMemberDirectory(workspaceId);

    const timeoutMs = 1500;
    const pollMs = 120;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const next = this.getWorkspaceMemberDirectory(workspaceId);
      if (next.loadedCount > initial.loadedCount || !next.hasMore) {
        return next;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    return this.getWorkspaceMemberDirectory(workspaceId);
  }

  getPresenceScopeState(workspaceId: string, channelId?: string | null): {
    onlineCount: number | null;
    sampledOnlineCount: number;
    sampledPeerCount: number;
    hasMore: boolean;
    nextCursor?: string;
    loadedPages: number;
    activeChannelId?: string;
    updatedAt?: number;
  } {
    const aggregate = typeof (this.presence as any).getPresenceAggregate === 'function'
      ? this.presence.getPresenceAggregate(workspaceId)
      : undefined;
    const effectiveChannelId = channelId || aggregate?.activeChannelId || undefined;
    const page = effectiveChannelId && typeof (this.presence as any).getPresencePageSnapshot === 'function'
      ? this.presence.getPresencePageSnapshot(workspaceId, effectiveChannelId)
      : undefined;

    return {
      onlineCount: aggregate?.onlineCount ?? null,
      sampledOnlineCount: page?.onlinePeerCount ?? 0,
      sampledPeerCount: page?.loadedPeerCount ?? 0,
      hasMore: page?.hasMore ?? false,
      nextCursor: page?.nextCursor,
      loadedPages: page?.loadedPageCount ?? 0,
      activeChannelId: effectiveChannelId,
      updatedAt: page?.updatedAt ?? aggregate?.updatedAt,
    };
  }

  async loadMorePresenceScope(workspaceId: string, channelId: string): Promise<ReturnType<ChatController['getPresenceScopeState']>> {
    const initial = this.getPresenceScopeState(workspaceId, channelId);
    if (!initial.hasMore || !initial.nextCursor) return initial;

    const requested = this.requestPresencePage(workspaceId, channelId, {
      cursor: initial.nextCursor,
    });
    if (!requested) return this.getPresenceScopeState(workspaceId, channelId);

    const timeoutMs = 1500;
    const pollMs = 120;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const next = this.getPresenceScopeState(workspaceId, channelId);
      if (
        next.sampledPeerCount > initial.sampledPeerCount
        || next.loadedPages > initial.loadedPages
        || !next.hasMore
      ) {
        return next;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    return this.getPresenceScopeState(workspaceId, channelId);
  }

  async onWorkspaceActivated(workspaceId: string): Promise<void> {
    await this.prefetchWorkspaceMemberDirectory(workspaceId);
    this.syncPresenceScopeForActiveChannel(this.state.activeChannelId);
  }

  /** Returns display name for the given workspace, falling back to global alias or peer ID slice */
  getMyAliasForWorkspace(wsId: string | null): string {
    if (wsId && this.state.workspaceAliases?.[wsId]) return this.state.workspaceAliases[wsId];
    return this.state.myAlias || this.state.myPeerId.slice(0, 8);
  }

  private findWorkspaceByChannelId(channelId: string): Workspace | null {
    const manager: any = this.workspaceManager as any;
    if (!manager || typeof manager.getAllWorkspaces !== 'function') return null;
    const workspaces = manager.getAllWorkspaces() as Workspace[];
    return workspaces.find((ws) => ws.channels.some((ch: Channel) => ch.id === channelId)) || null;
  }

  private getMessageRecipients(msg: PlaintextMessage, receiptPeerId?: string): string[] {
    const explicit = Array.isArray((msg as any).recipientPeerIds)
      ? (msg as any).recipientPeerIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
      : [];
    if (explicit.length > 0) return Array.from(new Set(explicit));

    const ws = this.findWorkspaceByChannelId(msg.channelId);
    if (ws) {
      return ws.members.map((m: any) => m.peerId).filter((id: string) => id !== this.state.myPeerId);
    }

    const convMap = (this.directConversationStore as any).conversations as Map<string, { contactPeerId: string }> | undefined;
    const dmPeer = convMap?.get(msg.channelId)?.contactPeerId;
    if (dmPeer) return [dmPeer];

    if (receiptPeerId) return [receiptPeerId];
    return [];
  }

  private getStableMessageRecipients(msg: PlaintextMessage): string[] {
    return this.getMessageRecipients(msg).filter((id) => id !== this.state.myPeerId);
  }

  private getOnlineRecipientPeerIds(recipientPeerIds: string[]): string[] {
    if (!Array.isArray(recipientPeerIds) || recipientPeerIds.length === 0) return [];
    const readyPeers = this.state.readyPeers instanceof Set ? this.state.readyPeers : new Set<string>();
    const connectedPeers = this.state.connectedPeers instanceof Set ? this.state.connectedPeers : new Set<string>();
    const connectedViaTransport = new Set<string>(this.getTransportConnectedPeerIds());
    const online = new Set<string>([
      ...Array.from(readyPeers),
      ...Array.from(connectedPeers),
      ...Array.from(connectedViaTransport),
    ]);
    return Array.from(new Set(
      recipientPeerIds.filter((id) => typeof id === 'string' && id.length > 0 && id !== this.state.myPeerId && online.has(id)),
    ));
  }

  private getStatusMessageRecipients(msg: PlaintextMessage, fallbackRecipients?: string[]): string[] {
    const explicit = Array.isArray((msg as any).statusRecipientPeerIds)
      ? (msg as any).statusRecipientPeerIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
      : [];
    if (explicit.length > 0) return Array.from(new Set(explicit));
    const baseline = Array.isArray(fallbackRecipients) && fallbackRecipients.length > 0
      ? fallbackRecipients
      : this.getStableMessageRecipients(msg);
    return Array.from(new Set(
      baseline.filter((id) => typeof id === 'string' && id.length > 0 && id !== this.state.myPeerId),
    ));
  }

  private getInboundReceiptPeerId(peerId: string, data: any): string {
    return typeof data?._receiptFromPeerId === 'string' && data._receiptFromPeerId.length > 0
      ? data._receiptFromPeerId
      : peerId;
  }

  private shouldForwardInboundReceipt(data: any): boolean {
    return typeof data?._receiptTargetPeerId === 'string'
      && data._receiptTargetPeerId.length > 0
      && data._receiptTargetPeerId !== this.state.myPeerId;
  }

  private forwardInboundReceipt(messageId: string, channelId: string, logicalPeerId: string, type: 'ack' | 'read'): void {
    const route = this._gossipReceiptRoutes.get(messageId);
    if (!route?.upstreamPeerId) {
      console.warn(`[ReceiptRelay] Missing gossip route for ${messageId}; dropping forwarded ${type}`);
      return;
    }

    const payload: RoutedMessageReceiptPayload = {
      type,
      messageId,
      channelId,
      _receiptFromPeerId: logicalPeerId,
      _receiptTargetPeerId: route.originalSenderId,
    };
    this.transport.send(route.upstreamPeerId, payload);
  }

  private sendInboundReceipt(peerId: string, envelope: any, channelId: string, messageId: string, type: 'ack' | 'read'): void {
    const originalSenderId = typeof envelope?._gossipOriginalSender === 'string' && envelope._gossipOriginalSender.length > 0
      ? envelope._gossipOriginalSender
      : undefined;

    if (originalSenderId && originalSenderId !== peerId) {
      const payload: RoutedMessageReceiptPayload = {
        type,
        messageId,
        channelId,
        _receiptFromPeerId: this.state.myPeerId,
        _receiptTargetPeerId: originalSenderId,
      };
      this.transport.send(peerId, payload);
      return;
    }

    const payload: RoutedMessageReceiptPayload = { type, messageId, channelId };
    this.transport.send(peerId, payload);
  }

  private isValidInboundReceipt(peerId: string, channelId: string, messageId: string, type: 'ack' | 'read'): { valid: true; msg: PlaintextMessage; recipients: string[] } | { valid: false } {
    const msgs = this.messageStore.getMessages(channelId) as PlaintextMessage[];
    const msg = msgs.find((m) => m.id === messageId);
    if (!msg) {
      console.warn(`[Security] Rejecting ${type}: message ${messageId} not found in ${channelId}`);
      return { valid: false };
    }
    if (msg.channelId !== channelId) {
      console.warn(`[Security] Rejecting ${type}: channel mismatch for message ${messageId}`);
      return { valid: false };
    }
    if (msg.senderId !== this.state.myPeerId) {
      console.warn(`[Security] Rejecting ${type}: message ${messageId} is not outgoing`);
      return { valid: false };
    }

    const recipients = this.getStableMessageRecipients(msg);
    if (!recipients.includes(peerId)) {
      console.warn(`[Security] Rejecting ${type}: peer ${peerId.slice(0, 8)} is not an intended recipient for ${messageId}`);
      return { valid: false };
    }

    const ws = this.findWorkspaceByChannelId(channelId);
    if (ws && !ws.members.some((m: any) => m.peerId === peerId)) {
      console.warn(`[Security] Rejecting ${type}: peer ${peerId.slice(0, 8)} is not member of workspace ${ws.id}`);
      return { valid: false };
    }

    return { valid: true, msg, recipients };
  }

  async onChannelViewed(channelId: string): Promise<void> {
    this.syncPresenceScopeForActiveChannel(channelId);

    if (this.state.activeWorkspaceId) {
      const scope = this.getPresenceScopeState(this.state.activeWorkspaceId, channelId);
      if (scope.hasMore && scope.nextCursor) {
        this.requestPresencePage(this.state.activeWorkspaceId, channelId, {
          cursor: scope.nextCursor,
        });
      }
    }

    if (!this.channelViewInFlight) this.channelViewInFlight = new Map<string, Promise<void>>();
    if (!this.pendingReadReceiptKeys) this.pendingReadReceiptKeys = new Set<string>();

    const current = this.channelViewInFlight.get(channelId);
    if (current) {
      await current;
      return;
    }

    const run = (async () => {
      const messages = this.messageStore.getMessages(channelId);
      for (const msg of messages as any[]) {
        if (msg.channelId !== channelId) continue;
        // Only receipt incoming messages from other peers.
        if (msg.senderId === this.state.myPeerId) continue;
        if ((msg as any).localReadAt) continue;

        // Mark in-memory first to avoid race duplicates.
        (msg as any).localReadAt = Date.now();

        const payload = { type: 'read', messageId: msg.id, channelId };
        const dedupeKey = `${msg.senderId}:${msg.id}:${channelId}`;

        try {
          const workspaceId = this.findWorkspaceByChannelId(channelId)?.id || this.state.activeWorkspaceId || 'direct';
          if (this.state.readyPeers.has(msg.senderId)) {
            const sent = this.transport.send(msg.senderId, payload);
            if (sent === false && !this.pendingReadReceiptKeys.has(dedupeKey)) {
              this.pendingReadReceiptKeys.add(dedupeKey);
              await this.queueCustodyEnvelope(msg.senderId, {
                opId: msg.id,
                recipientPeerIds: [msg.senderId],
                workspaceId,
                channelId,
                domain: 'receipt',
                ciphertext: payload,
                metadata: { kind: 'read' },
              }, payload);
            }
          } else if (!this.pendingReadReceiptKeys.has(dedupeKey)) {
            this.pendingReadReceiptKeys.add(dedupeKey);
            await this.queueCustodyEnvelope(msg.senderId, {
              opId: msg.id,
              recipientPeerIds: [msg.senderId],
              workspaceId,
              channelId,
              domain: 'receipt',
              ciphertext: payload,
              metadata: { kind: 'read' },
            }, payload);
          }
          this.recordManifestDomain('receipt', workspaceId, {
            channelId,
            operation: 'create',
            subject: msg.id,
            data: { kind: 'read', senderId: this.state.myPeerId },
          });
          await this.persistentStore.saveMessage({ ...(msg as any), localReadAt: (msg as any).localReadAt });
        } catch (err) {
          console.warn('[ReadReceipt] Failed to emit late read receipt', err);
        }
      }
    })();

    this.channelViewInFlight.set(channelId, run);
    try {
      await run;
    } finally {
      this.channelViewInFlight.delete(channelId);
    }
  }

  getMessageReceiptInfo(messageId: string): {
    messageId: string;
    channelId: string;
    recipients: Array<{ peerId: string; name: string; at?: number }>;
    delivered: Array<{ peerId: string; name: string; at?: number }>;
    read: Array<{ peerId: string; name: string; at?: number }>;
    pending: Array<{ peerId: string; name: string; at?: number }>;
  } | null {
    const channelId = this.state.activeChannelId;
    if (!channelId) return null;

    const msg = this.messageStore.getMessages(channelId).find((m: any) => m.id === messageId);
    if (!msg) return null;

    const recipients: string[] = this.getMessageRecipients(msg as PlaintextMessage);
    const deliveredSet = new Set<string>(Array.isArray((msg as any).ackedBy) ? (msg as any).ackedBy : []);
    const readSet = new Set<string>(Array.isArray((msg as any).readBy) ? (msg as any).readBy : []);
    const ackedAt: Record<string, number> = (msg as any).ackedAt || {};
    const readAt: Record<string, number> = (msg as any).readAt || {};

    const toUser = (peerId: string, at?: number) => ({ peerId, name: this.getDisplayNameForPeer(peerId), at });

    return {
      messageId,
      channelId,
      recipients: recipients.map((p) => toUser(p)),
      delivered: recipients.filter((p) => deliveredSet.has(p)).map((p) => toUser(p, ackedAt[p])),
      read: recipients.filter((p) => readSet.has(p)).map((p) => toUser(p, readAt[p])),
      pending: recipients.filter((p) => !deliveredSet.has(p)).map((p) => toUser(p)),
    };
  }

  /** Set a workspace-specific display name and persist it */
  setWorkspaceAlias(wsId: string, alias: string): void {
    if (!this.state.workspaceAliases) this.state.workspaceAliases = {};
    this.state.workspaceAliases[wsId] = alias;
    this.persistentStore.saveSetting('workspaceAliases', JSON.stringify(this.state.workspaceAliases));

    // Update our own member entry in the workspace
    const ws = this.workspaceManager.getWorkspace(wsId);
    if (ws) {
      const myMember = ws.members.find((m: any) => m.peerId === this.state.myPeerId);
      if (myMember) myMember.alias = alias;
      this.persistWorkspace(wsId).catch(() => {});
    }

    // Announce updated name to all connected peers in this workspace
    const targets = this.getWorkspaceRecipientPeerIds();
    for (const peerId of targets) {
      if (this.state.readyPeers.has(peerId)) {
        this.sendControlWithRetry(peerId, {
          type: 'name-announce',
          workspaceId: wsId,
          alias,
          allowWorkspaceDMs: (
            this.workspaceManager.getWorkspace(wsId)
              ?.members.find((m: any) => m.peerId === this.state.myPeerId)
              ?.allowWorkspaceDMs
          ) !== false,
        }, { label: 'name-announce' });
      }
    }
  }
}
