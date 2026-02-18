export {
  inferAttachmentType,
  calculateChunkCount,
  createAttachmentMeta,
  hashBlob,
  CHUNK_SIZE,
  MAX_THUMBNAIL_SIZE,
} from './Attachment';
export type {
  AttachmentType,
  AttachmentStatus,
  AttachmentMeta,
  Attachment,
  MediaChunk,
  MediaRequest,
  MediaResponse,
} from './Attachment';

export { MediaStore, MemoryBlobStorage } from './MediaStore';
export type {
  BlobStorage,
  MediaStoreConfig,
  AutoDownloadConfig,
  StorageStats,
  WorkspaceStorageStats,
} from './MediaStore';

export { ChunkedSender, ChunkedReceiver } from './ChunkedTransfer';
export type { TransferProgress } from './ChunkedTransfer';

export {
  generateWaveform,
  encodeWaveform,
  decodeWaveform,
  waveformToSVG,
  generateImageThumbnail,
  getFileTypeIcon,
} from './Thumbnail';
export type { ThumbnailResult } from './Thumbnail';
