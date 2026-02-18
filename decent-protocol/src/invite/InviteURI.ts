/**
 * InviteURI — Self-contained connection tickets
 * 
 * Like BitTorrent magnet links: everything needed to join is in the URI.
 * No external infrastructure required.
 * 
 * Format:
 *   decent://HOST:PORT/INVITE_CODE?fallback=wss://public.server&turn=turn:relay.com&pk=PUBLIC_KEY
 * 
 * Examples:
 *   decent://192.168.1.50:9000/ABCD1234                          (LAN)
 *   decent://85.237.42.100:9000/ABCD1234?fallback=wss://signal.decentchat.org  (public IP + fallback)
 *   decent://signal.alice.com:443/ABCD1234                       (domain)
 *   decent://[2001:db8::1]:9000/ABCD1234                         (IPv6)
 *   decent://localhost:9000/ABCD1234                              (local dev)
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
  /** Inviter's public key (for verification before connecting) */
  publicKey?: string;
  /** Workspace name (display only) */
  workspaceName?: string;
}

/** Default public signaling servers (bootstrap nodes) */
export const DEFAULT_PUBLIC_SERVERS = [
  'wss://0.peerjs.com/peerjs',
];

export class InviteURI {
  /**
   * Create an invite URI from invite data
   */
  static encode(data: InviteData): string {
    const { host, port, inviteCode, secure } = data;

    // Build host string (wrap IPv6 in brackets)
    const hostStr = host.includes(':') ? `[${host}]` : host;
    const uri = `decent://${hostStr}:${port}/${inviteCode}`;

    // Build query params
    const params = new URLSearchParams();

    if (data.fallbackServers.length > 0) {
      for (const server of data.fallbackServers) {
        params.append('fallback', server);
      }
    }

    if (data.turnServers.length > 0) {
      for (const server of data.turnServers) {
        params.append('turn', server);
      }
    }

    if (data.peerId) params.set('peer', data.peerId);
    if (data.publicKey) params.set('pk', data.publicKey);
    if (data.workspaceName) params.set('name', data.workspaceName);
    if (secure) params.set('secure', '1');
    if (data.path && data.path !== '/peerjs') params.set('path', data.path);

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

    return {
      host,
      port,
      inviteCode,
      secure,
      path: peerPath,
      fallbackServers,
      turnServers,
      peerId: params.get('peer') || undefined,
      publicKey: params.get('pk') || undefined,
      workspaceName: params.get('name') || undefined,
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

    return {
      host,
      port,
      inviteCode,
      secure,
      path: parsed.searchParams.get('path') || '/peerjs',
      fallbackServers: parsed.searchParams.getAll('fallback'),
      turnServers: parsed.searchParams.getAll('turn'),
      peerId: parsed.searchParams.get('peer') || undefined,
      publicKey: parsed.searchParams.get('pk') || undefined,
      workspaceName: parsed.searchParams.get('name') || undefined,
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
