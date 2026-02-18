/**
 * ContactURI — Compact URI format for sharing contact identity via QR codes.
 *
 * Format: decent://contact?pub=<base64-public-key>&name=<display-name>&sig=<signaling-server-url>
 *
 * Designed to be compact (QR codes have limited capacity), while containing
 * everything needed to establish a P2P connection with a contact.
 */

export interface ContactURIData {
  /** ECDH public key (base64 SPKI) */
  publicKey: string;
  /** Human-readable display name */
  displayName: string;
  /** Peer ID for direct connection */
  peerId?: string;
  /** Signaling servers the contact can be reached through */
  signalingServers?: string[];
}

export class ContactURI {
  /**
   * Encode contact data into a compact URI for QR codes.
   */
  static encode(data: ContactURIData): string {
    const params = new URLSearchParams();
    params.set('pub', data.publicKey);
    params.set('name', data.displayName);
    if (data.peerId) params.set('peer', data.peerId);
    if (data.signalingServers) {
      for (const server of data.signalingServers) {
        params.append('sig', server);
      }
    }
    return `decent://contact?${params.toString()}`;
  }

  /**
   * Decode a contact URI back into structured data.
   */
  static decode(uri: string): ContactURIData {
    const trimmed = uri.trim();

    if (!trimmed.startsWith('decent://contact')) {
      throw new Error('Invalid contact URI: must start with decent://contact');
    }

    const queryStart = trimmed.indexOf('?');
    if (queryStart < 0) {
      throw new Error('Invalid contact URI: missing parameters');
    }

    const params = new URLSearchParams(trimmed.slice(queryStart + 1));
    const publicKey = params.get('pub');
    const displayName = params.get('name');

    if (!publicKey) {
      throw new Error('Invalid contact URI: missing public key');
    }
    if (!displayName) {
      throw new Error('Invalid contact URI: missing display name');
    }

    return {
      publicKey,
      displayName,
      peerId: params.get('peer') || undefined,
      signalingServers: params.getAll('sig').filter(Boolean),
    };
  }

  /**
   * Check if a string is a valid contact URI.
   */
  static isValid(uri: string): boolean {
    try {
      this.decode(uri);
      return true;
    } catch {
      return false;
    }
  }
}
