/**
 * decent-protocol — Public API
 *
 * An embeddable, transport-agnostic protocol SDK for serverless,
 * E2E-encrypted, CRDT-based peer-to-peer messaging.
 *
 * @packageDocumentation
 */

// ─── Crypto ────────────────────────────────────────────────────────────────
export { HashChain, GENESIS_HASH } from './crypto/HashChain';
export { CryptoManager } from './crypto/CryptoManager';
export { MessageCipher } from './crypto/MessageCipher';

// ─── CRDT ───────────────────────────────────────────────────────────────────
export { VectorClock } from './crdt/VectorClock';
export { MessageCRDT } from './crdt/MessageCRDT';
export { Negentropy } from './crdt/Negentropy';

// ─── Workspace ──────────────────────────────────────────────────────────────
export { WorkspaceManager } from './workspace/WorkspaceManager';
export { SyncProtocol } from './workspace/SyncProtocol';
export { WorkspaceDeltaProtocol } from './workspace/WorkspaceDeltaProtocol';
export { DirectoryProtocol } from './workspace/DirectoryProtocol';
export { DirectoryShardPlanner } from './workspace/DirectoryShardPlanner';
export { PresenceProtocol } from './workspace/PresenceProtocol';
export { HistoryPageProtocol } from './history/HistoryPageProtocol';
export { ServerDiscovery } from './workspace/ServerDiscovery';
export type { ServerStats } from './workspace/ServerDiscovery';

// ─── Messages ───────────────────────────────────────────────────────────────
export { MessageStore } from './messages/MessageStore';
export { OfflineQueue } from './messages/OfflineQueue';

// ─── Storage ────────────────────────────────────────────────────────────────
export { PersistentStore } from './storage/PersistentStore';
export { AtRestEncryption } from './storage/AtRestEncryption';

// ─── Identity ───────────────────────────────────────────────────────────────
export { IdentityManager } from './identity/Identity';
export { SeedPhraseManager } from './identity/SeedPhrase';
export { HDKeyDerivation, HDPurpose } from './identity/HDKeyDerivation';
export { WORDLIST } from './identity/wordlist';
export { DeviceManager } from './identity/DeviceManager';

// ─── Media ──────────────────────────────────────────────────────────────────
export {
  inferAttachmentType, calculateChunkCount, createAttachmentMeta, hashBlob,
  CHUNK_SIZE, MAX_THUMBNAIL_SIZE,
  MediaStore, MemoryBlobStorage,
  ChunkedSender, ChunkedReceiver,
  generateWaveform, encodeWaveform, decodeWaveform, waveformToSVG, getFileTypeIcon, generateImageThumbnail,
} from './media';
export type {
  AttachmentType, AttachmentStatus, AttachmentMeta, Attachment,
  MediaChunk, MediaRequest, MediaResponse,
  BlobStorage, MediaStoreConfig, AutoDownloadConfig, StorageStats, WorkspaceStorageStats,
  TransferProgress, ThumbnailResult,
} from './media';

// ─── Time ───────────────────────────────────────────────────────────────────
export { ClockSync } from './time/ClockSync';
export type { TimeSyncRequest, TimeSyncResponse, PeerClockInfo } from './time/ClockSync';

// ─── Invite ─────────────────────────────────────────────────────────────────
export { InviteURI, DEFAULT_PUBLIC_SERVERS } from './invite/InviteURI';
export type { InviteData } from './invite/InviteURI';
export { signInvite, verifyInviteSignature } from './invite/InviteAuth';

// ─── Transport ──────────────────────────────────────────────────────────────
// ─── Security ───────────────────────────────────────────────────────────────
export { RateLimiter, DEFAULT_LIMITS, MessageGuard, verifyHandshakeKey, verifyHandshake, verifyPeerIdBinding, PeerAuth } from './security';
export type { HandshakeVerificationResult, VerifyHandshakeParams, PeerIdBindingResult, AuthChallenge, AuthResponse } from './security';
export type {
  RateLimitAction, BucketConfig, ViolationSeverity,
  Violation, PeerReputation, RateLimitResult,
  SizeLimits, GuardResult,
} from './security';

// ─── Double Ratchet ─────────────────────────────────────────────────────────
export { DoubleRatchet, serializeRatchetState, deserializeRatchetState } from './crypto/DoubleRatchet';
export type { RatchetState, RatchetHeader, RatchetMessage, SerializedRatchetState } from './crypto/DoubleRatchet';

// ─── Migrations ─────────────────────────────────────────────────────────────
export { MigrationRunner } from './storage/Migration';
export type { Migration, MigrationContext, MigrationResult } from './storage/Migration';
export { ALL_MIGRATIONS, CURRENT_SCHEMA_VERSION } from './storage/migrations';

export type { Transport } from './transport/Transport';

// ─── Contacts ──────────────────────────────────────────────────────────────
export { MemoryContactStore, MemoryDirectConversationStore, ContactURI } from './contacts';
export type {
  Contact, ContactStore, ContactURIData,
  DirectConversation, DirectConversationStore,
} from './contacts';

// ─── Types ──────────────────────────────────────────────────────────────────
export type { KeyPair, SerializedKeyPair, EncryptedData, SignedMessage } from './crypto/types';
export type { HashableMessage, ChainVerificationResult } from './crypto/HashChain';
export type { CRDTMessage } from './crdt/MessageCRDT';
export type {
  NegentropyItem,
  NegentropyRange,
  NegentropyQuery,
  NegentropyResponse,
} from './crdt/Negentropy';
export { WorkspaceRole, DEFAULT_WORKSPACE_PERMISSIONS } from './workspace/types';
export type {
  Workspace,
  WorkspaceMember,
  Channel,
  WorkspaceInvite,
  WorkspacePermissions,
  SyncMessage,
  WorkspaceDelta,
  WorkspaceDeltaOp,
  PEXServer,
  WorkspaceShell,
  MemberSummary,
  MemberDirectoryPage,
  DirectoryShardRef,
  ChannelAccessPolicy,
  PresenceAggregate,
  HistoryPageRef,
  HistoryPageSnapshot,
  HistoryPageDirection,
  HistoryReplicaTier,
  HistoryReplicaSelectionPolicy,
  HistoryReplicaHint,
  HistorySyncCapabilities,
  PeerCapabilities,
} from './workspace/types';
export type {
  PresenceMessage,
  PresenceSubscribeMessage,
  PresenceUnsubscribeMessage,
  PresenceAggregateMessage,
  PresencePageResponseMessage,
  PresencePeerSlice,
} from './workspace/PresenceProtocol';
export type { SyncEvent, SendFn, OnEvent } from './workspace/SyncProtocol';
export type { ChatMessage, PlaintextMessage, MessageMetadata, AssistantMessageMetadata } from './messages/types';
export type {
  DecentIdentity,
  IdentityBundle,
  DeviceLinkChallenge,
  SafetyNumber,
} from './identity/Identity';
export type { SeedPhraseResult, DerivedKeys } from './identity/SeedPhrase';
export type { HDDerivedKeys } from './identity/HDKeyDerivation';
export type { DeviceInfo, DeviceProof, DeviceAnnouncement, DeviceAck } from './identity/DeviceManager';
