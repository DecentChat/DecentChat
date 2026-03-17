/**
 * RecoveryURI — URI format for cross-device account recovery via QR code.
 *
 * Format: decent://recover?seed=<base64url-encoded-seed>&peer=<peer-id>&sig=<signaling-servers>
 *
 * Contains everything needed to:
 * 1. Recover identity (seed phrase)
 * 2. Immediately sync messages from the source device (peer ID + signaling)
 */
export interface RecoveryURIData {
  seedPhrase: string;
  sourcePeerId?: string;
  signalingServers?: string[];
}

export class RecoveryURI {
  static encode(data: RecoveryURIData): string {
    const seedPhrase = this.normalizeSeedPhrase(data.seedPhrase);
    if (!seedPhrase) {
      throw new Error('Recovery URI requires a seed phrase');
    }

    const params = new URLSearchParams();
    params.set('seed', this.toBase64Url(seedPhrase));

    const sourcePeerId = data.sourcePeerId?.trim();
    if (sourcePeerId) {
      params.set('peer', sourcePeerId);
    }

    const signalingServers = (data.signalingServers ?? [])
      .map((server) => server.trim())
      .filter((server) => server.length > 0);

    if (signalingServers.length > 0) {
      params.set('sig', signalingServers.join(','));
    }

    return `decent://recover?${params.toString()}`;
  }

  static decode(uri: string): RecoveryURIData {
    const value = uri.trim();
    if (!value) {
      throw new Error('Recovery URI is empty');
    }

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error('Invalid recovery URI format');
    }

    if (parsed.protocol !== 'decent:') {
      throw new Error('Invalid recovery URI protocol');
    }

    const host = parsed.hostname.toLowerCase();
    if (host !== 'recover') {
      throw new Error('Invalid recovery URI host');
    }

    const encodedSeed = parsed.searchParams.get('seed');
    if (!encodedSeed) {
      throw new Error('Recovery URI is missing seed phrase');
    }

    const seedPhrase = this.normalizeSeedPhrase(this.fromBase64Url(encodedSeed));
    if (!seedPhrase) {
      throw new Error('Recovery URI contains an empty seed phrase');
    }

    const words = seedPhrase.split(' ').filter(Boolean);
    if (words.length !== 12) {
      throw new Error('Recovery URI seed phrase must contain 12 words');
    }

    const sourcePeerId = parsed.searchParams.get('peer')?.trim() || undefined;

    const signalingServers = parsed.searchParams
      .getAll('sig')
      .flatMap((value) => value.split(','))
      .map((server) => server.trim())
      .filter((server) => server.length > 0);

    return {
      seedPhrase,
      sourcePeerId,
      signalingServers: signalingServers.length > 0 ? signalingServers : undefined,
    };
  }

  static isValid(uri: string): boolean {
    try {
      this.decode(uri);
      return true;
    } catch {
      return false;
    }
  }

  private static normalizeSeedPhrase(seedPhrase: string): string {
    return seedPhrase.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private static toBase64Url(input: string): string {
    const bytes = new TextEncoder().encode(input);

    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    const base64 = btoa(binary);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  private static fromBase64Url(input: string): string {
    const base64 = input
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(input.length / 4) * 4, '=');

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return new TextDecoder().decode(bytes);
  }
}
