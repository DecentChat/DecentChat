/**
 * polyfill.ts — install node-datachannel globals so PeerJS works in Node.js
 *
 * This file SELF-INSTALLS as a side effect when imported.
 * Import it first so RTCPeerConnection is set before PeerJS loads.
 *
 * Under jiti (OpenClaw's TypeScript loader), all static imports are hoisted
 * to require() calls in order — so the FIRST import wins. Keep this as the
 * very first import in DecentChatNodePeer.ts.
 */

if (typeof RTCPeerConnection === 'undefined') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dc = require('node-datachannel/polyfill') as Record<string, unknown>;

    const globals: Record<string, unknown> = {
      RTCPeerConnection: dc['RTCPeerConnection'],
      RTCIceCandidate: dc['RTCIceCandidate'],
      RTCSessionDescription: dc['RTCSessionDescription'],
      RTCDataChannel: dc['RTCDataChannel'],
      RTCDataChannelEvent: dc['RTCDataChannelEvent'],
      RTCIceTransport: dc['RTCIceTransport'],
      RTCPeerConnectionIceEvent: dc['RTCPeerConnectionIceEvent'],
      MediaStream: dc['MediaStream'],
    };

    for (const [key, val] of Object.entries(globals)) {
      if (val !== undefined) {
        (globalThis as Record<string, unknown>)[key] = val;
      }
    }
  } catch (e) {
    throw new Error(
      `node-datachannel not available. Run: npm install node-datachannel\nOriginal: ${e}`,
    );
  }
}

// Legacy export for backward compatibility
export function installWebRTCPolyfill(): void {
  // No-op: installation happens at module load time (side effect above)
}
