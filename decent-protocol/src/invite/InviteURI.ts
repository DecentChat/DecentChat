/**
 * InviteURI — Self-contained connection tickets
 * 
 * Like BitTorrent magnet links: everything needed to join is in the URI.
 * No external infrastructure required.
 * 
 * Format:
 *   decent://HOST:PORT/INVITE_CODE?fallback=wss://public.server&turn=turn:relay.com&pk=PUBLIC_KEY
 * 
 * Examples (web URL format - recommended):
 *   https://decentchat.app/join/ABCD1234?signal=192.168.1.50:9000                   (LAN)
 *   https://decentchat.app/join/ABCD1234?signal=signal.alice.com:443&secure=1       (domain)
 *   https://decentchat.app/join/ABCD1234?signal=localhost:9000                      (local dev)
 * 
 * Legacy decent:// protocol (still supported for decode):
 *   decent://192.168.1.50:9000/ABCD1234                          (LAN)
 *   decent://signal.alice.com:443/ABCD1234                       (domain)
 */

export interface InviteData {
  /** Primary signaling host (IP, domain, or IPv6) */
  host: string;
  /** Signaling port */
  port: number;
  /** Workspace invite code */
  inviteCode: string;
  /** Use TLS/WSS (default: true for port 443, false otherwise) */
  secure: boolean;
  /** PeerJS path on the signaling server (default: /peerjs) */
  path: string;
  /** Fallback public signaling servers */
  fallbackServers: string[];
  /** TURN relay servers for NAT traversal */
  turnServers: string[];
  /** Inviter's peer ID (for direct connection) */
  peerId?: string;
  /** Additional workspace member peer IDs for multi-peer join resilience */
  peers?: string[];
  /** Inviter's public key (for verification before connecting) */
  publicKey?: string;
  /** Canonical workspace ID (recommended; avoids provisional-ID join races) */
  workspaceId?: string;
  /** Workspace name (display only) */
  workspaceName?: string;
  /** Optional expiration timestamp (ms since epoch) */
  expiresAt?: number;
  /** Optional maximum number of uses (0 or undefined = unlimited) */
  maxUses?: number;
  /** Stable per-invite identifier (for revocation) */
  inviteId?: string;
  /** Inviter peer identity (for auditing/UX) */
  inviterId?: string;
  /** Optional cryptographic signature over canonical payload */
  signature?: string;
}

/** Default public signaling servers (bootstrap nodes) */
export const DEFAULT_PUBLIC_SERVERS = [
  'wss://0.peerjs.com/peerjs',
];

export class InviteURI {
  /**
   * Create an invite URI from invite data
   * 
   * Generates a web URL format (https://...) for easier sharing.
   * Use encodeNative() for the decent:// protocol format.
   */
  static encode(data: InviteData, webDomain = 'decentchat.app'): string {
    const {
      host,
      port,
      inviteCode,
      secure,
      peerId,
      publicKey,
      workspaceName,
      workspaceId,
      path,
      expiresAt,
      maxUses,
      inviteId,
      inviterId,
      signature,
    } = data;

    // Build web URL: https://decentchat.app/join/CODE?signal=host:port&...
    const params = new URLSearchParams();
    params.set('signal', `${host}:${port}`);
    
    if (peerId) params.set('peer', peerId);
    if (publicKey) params.set('pk', publicKey);
    if (workspaceName) params.set('name', workspaceName);
    if (workspaceId) params.set('ws', workspaceId);
    if (secure) params.set('secure', '1');
    if (path && path !== '/peerjs') params.set('path', path);
    if (typeof expiresAt === 'number' && expiresAt > 0) params.set('exp', String(expiresAt));
    if (typeof maxUses === 'number' && maxUses > 0) params.set('max', String(maxUses));
    if (inviteId) params.set('i', inviteId);
    if (inviterId) params.set('inviter', inviterId);
    if (signature) params.set('sig', signature);

    if (data.fallbackServers && data.fallbackServers.length > 0) {
      for (const server of data.fallbackServers) {
        params.append('fallback', server);
      }
    }

    if (data.turnServers && data.turnServers.length > 0) {
      for (const server of data.turnServers) {
        params.append('turn', server);
      }
    }

    // Append additional peer IDs for multi-peer join resilience
    if (data.peers && data.peers.length > 0) {
      for (const p of data.peers) {
        // Don't duplicate the primary peer
        if (p !== peerId) params.append('peer', p);
      }
    }

    return `https://${webDomain}/join/${inviteCode}?${params.toString()}`;
  }

  /**
   * Create a native decent:// protocol URI (for advanced use)
   */
  static encodeNative(data: InviteData): string {
    const { host, port, inviteCode, secure } = data;

    // Build host string (wrap IPv6 in brackets)
    const hostStr = host.includes(':') ? `[${host}]` : host;
    const uri = `decent://${hostStr}:${port}/${inviteCode}`;

    // Build query params
    const params = new URLSearchParams();

    if (data.fallbackServers && data.fallbackServers.length > 0) {
      for (const server of data.fallbackServers) {
        params.append('fallback', server);
      }
    }

    if (data.turnServers && data.turnServers.length > 0) {
      for (const server of data.turnServers) {
        params.append('turn', server);
      }
    }

    if (data.peerId) params.set('peer', data.peerId);
    if (data.publicKey) params.set('pk', data.publicKey);
    if (data.workspaceName) params.set('name', data.workspaceName);
    if (data.workspaceId) params.set('ws', data.workspaceId);
    if (secure) params.set('secure', '1');
    if (data.path && data.path !== '/peerjs') params.set('path', data.path);
    if (typeof data.expiresAt === 'number' && data.expiresAt > 0) params.set('exp', String(data.expiresAt));
    if (typeof data.maxUses === 'number' && data.maxUses > 0) params.set('max', String(data.maxUses));
    if (data.inviteId) params.set('i', data.inviteId);
    if (data.inviterId) params.set('inviter', data.inviterId);
    if (data.signature) params.set('sig', data.signature);

    // Append additional peer IDs for multi-peer join resilience
    if (data.peers && data.peers.length > 0) {
      for (const p of data.peers) {
        if (p !== data.peerId) params.append('peer', p);
      }
    }

    const queryStr = params.toString();
    return queryStr ? `${uri}?${queryStr}` : uri;
  }

  /**
   * Parse an invite URI back into invite data
   */
  static decode(uri: string): InviteData {
    // Normalize: handle decent:// and https:// (for web links)
    let normalizedUri = uri.trim();

    // Handle web URL format: https://decentchat.org/join/CODE?signal=host:port&...
    if (normalizedUri.startsWith('https://') || normalizedUri.startsWith('http://')) {
      return this.decodeWebURL(normalizedUri);
    }

    if (!normalizedUri.startsWith('decent://')) {
      throw new Error(`Invalid invite URI: must start with decent:// — got: ${normalizedUri.slice(0, 20)}`);
    }

    // Parse: decent://HOST:PORT/CODE?params
    const withoutScheme = normalizedUri.slice('decent://'.length);

    // Extract query string
    const queryIdx = withoutScheme.indexOf('?');
    const pathPart = queryIdx >= 0 ? withoutScheme.slice(0, queryIdx) : withoutScheme;
    const queryStr = queryIdx >= 0 ? withoutScheme.slice(queryIdx + 1) : '';

    // Parse host:port/code
    const { host, port, path: codePath } = this.parseHostPort(pathPart);
    const inviteCode = codePath.replace(/^\//, '');

    if (!inviteCode) {
      throw new Error('Invalid invite URI: missing invite code');
    }

    // Parse query params
    const params = new URLSearchParams(queryStr);

    const fallbackServers = params.getAll('fallback');
    const turnServers = params.getAll('turn');
    const secure = params.get('secure') === '1' || port === 443;
    const peerPath = params.get('path') || '/peerjs';
    const expRaw = params.get('exp');
    const maxRaw = params.get('max');
    const expiresAt = expRaw ? Number(expRaw) : undefined;
    const maxUses = maxRaw ? Number(maxRaw) : undefined;
    const inviteId = params.get('i') || undefined;
    const inviterId = params.get('inviter') || undefined;
    const signature = params.get('sig') || undefined;

    // Read all peer params — first is primary, rest are additional
    const allPeers = params.getAll('peer');
    const primaryPeer = allPeers[0] || undefined;
    const additionalPeers = allPeers.length > 1 ? allPeers.slice(1) : undefined;

    return {
      host,
      port,
      inviteCode,
      secure,
      path: peerPath,
      fallbackServers,
      turnServers,
      peerId: primaryPeer,
      peers: additionalPeers,
      publicKey: params.get('pk') || undefined,
      workspaceName: params.get('name') || undefined,
      workspaceId: params.get('ws') || undefined,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
      maxUses: Number.isFinite(maxUses) ? maxUses : undefined,
      inviteId,
      inviterId,
      signature,
    };
  }

  /**
   * Decode a web URL format:
   * https://decentchat.org/join/ABCD1234?signal=192.168.1.50:9000
   */
  private static decodeWebURL(url: string): InviteData {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/').filter(Boolean);

    // Expect /join/CODE
    const joinIdx = pathParts.indexOf('join');
    if (joinIdx < 0 || joinIdx + 1 >= pathParts.length) {
      throw new Error('Invalid web invite URL: expected /join/CODE path');
    }
    const inviteCode = pathParts[joinIdx + 1];

    // Signal server from query
    const signalParam = parsed.searchParams.get('signal') || '';
    let host = parsed.hostname;
    let port = 443;
    let secure = true;

    if (signalParam) {
      const { host: sHost, port: sPort } = this.parseHostPort(signalParam);
      host = sHost;
      port = sPort;
      secure = parsed.searchParams.get('secure') === '1' || sPort === 443;
    }

    // Read all peer params — first is primary, rest are additional
    const allPeers = parsed.searchParams.getAll('peer');
    const primaryPeer = allPeers[0] || undefined;
    const additionalPeers = allPeers.length > 1 ? allPeers.slice(1) : undefined;
    const expRaw = parsed.searchParams.get('exp');
    const maxRaw = parsed.searchParams.get('max');
    const expiresAt = expRaw ? Number(expRaw) : undefined;
    const maxUses = maxRaw ? Number(maxRaw) : undefined;
    const inviteId = parsed.searchParams.get('i') || undefined;

    return {
      host,
      port,
      inviteCode,
      secure,
      path: parsed.searchParams.get('path') || '/peerjs',
      fallbackServers: parsed.searchParams.getAll('fallback'),
      turnServers: parsed.searchParams.getAll('turn'),
      peerId: primaryPeer,
      peers: additionalPeers,
      publicKey: parsed.searchParams.get('pk') || undefined,
      workspaceName: parsed.searchParams.get('name') || undefined,
      workspaceId: parsed.searchParams.get('ws') || undefined,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
      maxUses: Number.isFinite(maxUses) ? maxUses : undefined,
      inviteId,
      inviterId: parsed.searchParams.get('inviter') || undefined,
      signature: parsed.searchParams.get('sig') || undefined,
    };
  }

  /**
   * Parse host:port from string, handling IPv6 brackets
   */
  private static parseHostPort(str: string): { host: string; port: number; path: string } {
    let host: string;
    let rest: string;

    if (str.startsWith('[')) {
      // IPv6: [2001:db8::1]:9000/code
      const closeBracket = str.indexOf(']');
      if (closeBracket < 0) throw new Error('Invalid IPv6 address: missing ]');
      host = str.slice(1, closeBracket);
      rest = str.slice(closeBracket + 1); // :9000/code
    } else {
      // IPv4 or domain: Find the port separator
      // Need to handle host:port/path
      const slashIdx = str.indexOf('/');
      const hostPortPart = slashIdx >= 0 ? str.slice(0, slashIdx) : str;
      const pathPart = slashIdx >= 0 ? str.slice(slashIdx) : '';

      const lastColon = hostPortPart.lastIndexOf(':');
      if (lastColon >= 0) {
        host = hostPortPart.slice(0, lastColon);
        const portAndPath = hostPortPart.slice(lastColon);
        rest = portAndPath + pathPart;
      } else {
        host = hostPortPart;
        rest = pathPart;
      }
    }

    // Parse :port/path
    let port = 9000; // default
    let path = '';

    if (rest.startsWith(':')) {
      rest = rest.slice(1);
      const slashIdx = rest.indexOf('/');
      if (slashIdx >= 0) {
        port = parseInt(rest.slice(0, slashIdx), 10);
        path = rest.slice(slashIdx);
      } else {
        port = parseInt(rest, 10);
      }
    } else if (rest.startsWith('/')) {
      path = rest;
    }

    if (isNaN(port)) port = 9000;

    return { host, port, path };
  }

  /**
   * Canonical payload used for signing/verification.
   * Keep this deterministic and stable across versions.
   */
  static getSignPayload(data: InviteData): string {
    const base = `${data.inviteCode}:${data.workspaceId || ''}:${data.expiresAt || 0}:${data.maxUses || 0}`;
    // Backward-compat: old signed invites omitted inviteId entirely.
    return data.inviteId ? `${base}:${data.inviteId}` : base;
  }

  /**
   * Whether invite has expired based on `expiresAt` (if provided).
   */
  static isExpired(data: InviteData, now = Date.now()): boolean {
    if (!data.expiresAt) return false;
    return now > data.expiresAt;
  }

  /**
   * Create an invite for the current instance
   * Convenience method for the common case
   */
  static create(opts: {
    host: string;
    port: number;
    inviteCode: string;
    peerId?: string;
    publicKey?: string;
    workspaceName?: string;
    workspaceId?: string;
    secure?: boolean;
  }): string {
    return this.encode({
      host: opts.host,
      port: opts.port,
      inviteCode: opts.inviteCode,
      secure: opts.secure ?? (opts.port === 443),
      path: '/peerjs',
      fallbackServers: DEFAULT_PUBLIC_SERVERS,
      turnServers: [],
      peerId: opts.peerId,
      publicKey: opts.publicKey,
      workspaceName: opts.workspaceName,
      workspaceId: opts.workspaceId,
    });
  }

  /**
   * Validate an invite URI (returns true if parseable)
   */
  static isValid(uri: string): boolean {
    try {
      this.decode(uri);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate a shareable text version of the invite
   */
  static toShareText(data: InviteData): string {
    const name = data.workspaceName || 'a workspace';
    const uri = this.encode(data);
    return `Join ${name} on DecentChat:\n${uri}`;
  }
}
