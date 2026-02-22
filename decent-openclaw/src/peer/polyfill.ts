/**
 * polyfill.ts — install node-datachannel globals so PeerJS works in Node.js
 * MUST be imported before any peerjs or decent-transport-webrtc import.
 */
export function installWebRTCPolyfill(): void {
  if (typeof RTCPeerConnection !== 'undefined') return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dc = require('node-datachannel/polyfill');

    if (dc.RTCPeerConnection) {
      (globalThis as any).RTCPeerConnection = dc.RTCPeerConnection;
    }
    if (dc.RTCIceCandidate) {
      (globalThis as any).RTCIceCandidate = dc.RTCIceCandidate;
    }
    if (dc.RTCSessionDescription) {
      (globalThis as any).RTCSessionDescription = dc.RTCSessionDescription;
    }
    if (dc.MediaStream) {
      (globalThis as any).MediaStream = dc.MediaStream;
    }
  } catch (e) {
    throw new Error(`node-datachannel not available. Run: bun add node-datachannel\nOriginal: ${e}`);
  }
}
