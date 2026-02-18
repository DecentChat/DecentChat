/**
 * Attachment — Media metadata that lives in the hash chain
 * 
 * Design: Only METADATA + THUMBNAIL are synced in the message.
 * The actual blob (full image, voice recording, file) is transferred
 * separately via chunked DataChannel transfer.
 * 
 * This keeps the hash chain lightweight while still providing:
 * - Previews (thumbnails) without downloading full media
 * - Integrity verification (hash of full blob)
 * - Pruning support (delete blob, keep metadata + thumbnail)
 */

/** Supported attachment types */
export type AttachmentType = 'image' | 'video' | 'audio' | 'voice' | 'file';

/** Where the blob currently lives */
export type AttachmentStatus =
  | 'available'    // Full blob stored locally
  | 'downloading'  // Currently being fetched from a peer
  | 'pruned'       // Blob deleted locally, can re-fetch from peers
  | 'unavailable'  // No peer has it anymore
  | 'pending';     // Uploading / not yet sent

/** Attachment metadata — this goes into the message (and hash chain) */
export interface AttachmentMeta {
  /** Unique attachment ID */
  id: string;
  /** MIME type (image/jpeg, audio/ogg, application/pdf, etc.) */
  mimeType: string;
  /** Inferred type category */
  type: AttachmentType;
  /** Original filename */
  name: string;
  /** File size in bytes */
  size: number;
  /** SHA-256 hash of the full unencrypted blob (for integrity) */
  hash: string;
  /** SHA-256 hash of the encrypted blob (for transfer verification) */
  encryptedHash?: string;
  /** Base64-encoded thumbnail (JPEG, max ~5KB for images, waveform for audio) */
  thumbnail?: string;
  /** Image/video dimensions */
  width?: number;
  height?: number;
  /** Audio/video duration in seconds */
  durationSec?: number;
  /** Encryption IV used for this attachment (hex) */
  iv?: string;
}

/** Full attachment with local status tracking */
export interface Attachment extends AttachmentMeta {
  /** Current local status */
  status: AttachmentStatus;
  /** When the blob was last accessed locally (for LRU pruning) */
  lastAccessedAt?: number;
  /** Peer IDs known to have this attachment */
  availableFrom?: string[];
}

/** Chunk for streaming large files over DataChannel */
export interface MediaChunk {
  /** Attachment ID */
  attachmentId: string;
  /** Chunk index (0-based) */
  index: number;
  /** Total number of chunks */
  total: number;
  /** Encrypted chunk data (base64) */
  data: string;
  /** SHA-256 hash of this chunk's data */
  chunkHash: string;
}

/** Request to download an attachment from a peer */
export interface MediaRequest {
  type: 'media-request';
  attachmentId: string;
  /** Optional: request specific chunk range (for resume) */
  fromChunk?: number;
}

/** Response indicating media availability */
export interface MediaResponse {
  type: 'media-response';
  attachmentId: string;
  available: boolean;
  totalChunks?: number;
  /** If not available, suggest other peers */
  suggestedPeers?: string[];
}

// ── Helper Functions ────────────────────────────────────────────────────────

/** Default chunk size: 64KB */
export const CHUNK_SIZE = 64 * 1024;

/** Max thumbnail size: 5KB */
export const MAX_THUMBNAIL_SIZE = 5 * 1024;

/** Infer attachment type from MIME type */
export function inferAttachmentType(mimeType: string): AttachmentType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/ogg') || mimeType === 'audio/webm') return 'voice'; // Voice messages
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

/** Calculate number of chunks for a given file size */
export function calculateChunkCount(fileSize: number, chunkSize: number = CHUNK_SIZE): number {
  return Math.ceil(fileSize / chunkSize);
}

/** Create attachment metadata from a file */
export async function createAttachmentMeta(
  file: { name: string; size: number; type: string },
  hash: string,
  options?: { thumbnail?: string; width?: number; height?: number; durationSec?: number }
): Promise<AttachmentMeta> {
  return {
    id: crypto.randomUUID(),
    mimeType: file.type || 'application/octet-stream',
    type: inferAttachmentType(file.type),
    name: file.name,
    size: file.size,
    hash,
    thumbnail: options?.thumbnail,
    width: options?.width,
    height: options?.height,
    durationSec: options?.durationSec,
  };
}

/** SHA-256 hash of an ArrayBuffer */
export async function hashBlob(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
