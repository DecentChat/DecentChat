/**
 * Thumbnail — Generate small previews for media attachments
 * 
 * Images: Resized JPEG (~5KB, max 200x200)
 * Audio/Voice: Waveform visualization (base64 SVG or data points)
 * Video: First frame (requires canvas in browser)
 * Files: Icon/type indicator
 * 
 * Thumbnails are included in the message metadata (hash chain).
 * They're always available even when the full blob is pruned.
 * 
 * Note: Image/video thumbnail generation requires canvas (browser only).
 * This module provides the interface + audio waveform (works everywhere).
 */

import { MAX_THUMBNAIL_SIZE } from './Attachment';

/** Thumbnail result */
export interface ThumbnailResult {
  /** Base64-encoded thumbnail data */
  data: string;
  /** MIME type of the thumbnail */
  mimeType: string;
  /** Size in bytes */
  size: number;
  /** Width (for images) */
  width?: number;
  /** Height (for images) */
  height?: number;
}

/**
 * Generate a waveform representation for audio data.
 * Works in any JS runtime (no canvas needed).
 * Returns an array of normalized amplitude values (0-1).
 */
export function generateWaveform(audioSamples: Float32Array, bars: number = 50): number[] {
  const samplesPerBar = Math.floor(audioSamples.length / bars);
  const waveform: number[] = [];

  for (let i = 0; i < bars; i++) {
    let sum = 0;
    const start = i * samplesPerBar;
    for (let j = start; j < start + samplesPerBar && j < audioSamples.length; j++) {
      sum += Math.abs(audioSamples[j]);
    }
    waveform.push(sum / samplesPerBar);
  }

  // Normalize to 0-1
  const max = Math.max(...waveform, 0.001);
  return waveform.map(v => Math.round((v / max) * 100) / 100);
}

/**
 * Encode waveform as compact base64 string.
 * 50 bars × 1 byte each = 50 bytes → ~68 chars base64.
 */
export function encodeWaveform(waveform: number[]): string {
  const bytes = new Uint8Array(waveform.map(v => Math.round(v * 255)));
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decode waveform from base64 back to normalized values.
 */
export function decodeWaveform(encoded: string): number[] {
  const binary = atob(encoded);
  const values: number[] = [];
  for (let i = 0; i < binary.length; i++) {
    values.push(Math.round((binary.charCodeAt(i) / 255) * 100) / 100);
  }
  return values;
}

/**
 * Generate an SVG waveform visualization (for embedding).
 */
export function waveformToSVG(waveform: number[], width: number = 200, height: number = 40): string {
  const barWidth = width / waveform.length;
  const bars = waveform.map((v, i) => {
    const barHeight = Math.max(2, v * height);
    const x = i * barWidth;
    const y = (height - barHeight) / 2;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barWidth * 0.8).toFixed(1)}" height="${barHeight.toFixed(1)}" rx="1" fill="#4A9EFF"/>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${bars}</svg>`;
}

/**
 * Generate image thumbnail (BROWSER ONLY — requires canvas).
 * Returns null in non-browser environments.
 */
export async function generateImageThumbnail(
  blob: Blob,
  maxSize: number = 200,
  quality: number = 0.6
): Promise<ThumbnailResult | null> {
  // Check for browser environment
  if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') {
    return null;
  }

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);

      // Calculate dimensions (fit within maxSize × maxSize)
      let width = img.width;
      let height = img.height;
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);

      // Convert to JPEG
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const base64 = dataUrl.split(',')[1];
      const size = Math.ceil(base64.length * 3 / 4); // Approximate decoded size

      // If too large, reduce quality
      if (size > MAX_THUMBNAIL_SIZE) {
        const reducedUrl = canvas.toDataURL('image/jpeg', 0.3);
        const reducedBase64 = reducedUrl.split(',')[1];
        resolve({
          data: reducedBase64,
          mimeType: 'image/jpeg',
          size: Math.ceil(reducedBase64.length * 3 / 4),
          width,
          height,
        });
        return;
      }

      resolve({ data: base64, mimeType: 'image/jpeg', size, width, height });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    img.src = url;
  });
}

/**
 * Get a file type icon/emoji for non-image attachments
 */
export function getFileTypeIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎬';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType === 'application/pdf') return '📄';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
  if (mimeType.includes('document') || mimeType.includes('word')) return '📝';
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('rar')) return '📦';
  if (mimeType.includes('text/')) return '📃';
  return '📎';
}
