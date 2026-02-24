/**
 * MockTransport — Drop-in replacement for PeerTransport that uses a WebSocket
 * relay instead of WebRTC. Designed for Playwright E2E tests where WebRTC
 * doesn't work reliably in headless mode.
 *
 * Each MockTransport connects to a tiny WS relay server. Messages go:
 *   Browser A -> WS relay -> Browser B
 *
 * The relay is started by the Playwright test fixture on a random port.
 */

/**
 * Returns the JS source code to inject into a browser page via addInitScript().
 * The relay URL is baked in at injection time.
 */
export function getMockTransportScript(relayUrl: string): string {
  // This is a self-contained IIFE — no imports, no TypeScript syntax.
  return `
(function() {
  class MockTransport {
    constructor() {
      this.onConnect = null;
      this.onDisconnect = null;
      this.onMessage = null;
      this.onError = null;
      this._ws = null;
      this._myPeerId = null;
      this._connectedPeers = new Set();
      this._relayUrl = '${relayUrl}';
      this._pendingInit = null;
      this._pendingConnects = new Map();
      this._manualDestroy = false;
      this._reconnectTimer = null;
      this._reconnectDelayMs = 300;
    }

    _tracePrefix() {
      const id = String(this._myPeerId || '');
      if (/alice/i.test(id)) return '[TRACE Alice]';
      if (/bob/i.test(id)) return '[TRACE Bob]';
      return '[TRACE ' + (id ? id.slice(0, 8) : 'unknown') + ']';
    }

    async init(peerId) {
      const id = peerId || crypto.randomUUID();
      this._myPeerId = id;
      this._manualDestroy = false;
      console.log('[MockTransport] init called, peerId=' + id);

      return new Promise((resolve, reject) => {
        this._pendingInit = { resolve, reject };
        this._openSocket();
      });
    }

    _openSocket() {
      if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) {
        return;
      }

      this._ws = new WebSocket(this._relayUrl);

      this._ws.onopen = () => {
        this._reconnectDelayMs = 300;
        console.log('[MockTransport] WS open, registering as ' + this._myPeerId);
        this._ws.send(JSON.stringify({ type: '__register', peerId: this._myPeerId }));
      };

      this._ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        console.log(this._tracePrefix(), 'WS relay onmessage', {
          relayType: msg && msg.type,
          from: msg && msg.from,
          targetPeerId: msg && msg.targetPeerId,
          innerType: msg && msg.data && msg.data.type,
        });
        this._handleRelayMessage(msg);
      };

      this._ws.onerror = () => {
        if (this._pendingInit) {
          this._pendingInit.reject(new Error('MockTransport: WebSocket connection failed'));
          this._pendingInit = null;
        }
      };

      this._ws.onclose = () => {
        for (const peer of this._connectedPeers) {
          this._connectedPeers.delete(peer);
          if (this.onDisconnect) this.onDisconnect(peer);
        }

        // Auto-reconnect for offline/online test scenarios.
        if (!this._manualDestroy) {
          this._scheduleReconnect();
        }
      };
    }

    _scheduleReconnect() {
      if (this._reconnectTimer) return;
      const delay = this._reconnectDelayMs;
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        if (this._manualDestroy) return;
        this._openSocket();
      }, delay);
      this._reconnectDelayMs = Math.min(Math.floor(this._reconnectDelayMs * 1.8), 2500);
    }

    _handleRelayMessage(msg) {
      switch (msg.type) {
        case '__registered':
          if (this._pendingInit) {
            this._pendingInit.resolve(this._myPeerId);
            this._pendingInit = null;
          }
          break;

        case '__peer_connected': {
          console.log('[MockTransport] Peer connected: ' + msg.peerId);
          this._connectedPeers.add(msg.peerId);
          if (this.onConnect) this.onConnect(msg.peerId);
          const pending = this._pendingConnects.get(msg.peerId);
          if (pending) {
            pending.resolve();
            this._pendingConnects.delete(msg.peerId);
          }
          break;
        }

        case '__peer_disconnected':
          this._connectedPeers.delete(msg.peerId);
          if (this.onDisconnect) this.onDisconnect(msg.peerId);
          break;

        case '__connect_request':
          // Another peer wants to connect — auto-accept
          console.log('[MockTransport] Incoming connect request from: ' + msg.peerId);
          this._connectedPeers.add(msg.peerId);
          this._ws.send(JSON.stringify({
            type: '__connect_accept',
            peerId: msg.peerId,
          }));
          if (this.onConnect) this.onConnect(msg.peerId);
          break;

        case '__data':
          console.log(this._tracePrefix(), 'WebSocket __data relay', {
            from: msg.from,
            type: msg.data && msg.data.type,
            channelId: msg.data && msg.data.channelId,
          });
          console.log('[MockTransport] Data from ' + msg.from + ', type=' + (msg.data && msg.data.type));
          if (this.onMessage) {
            console.log(this._tracePrefix(), 'onMessage callback', {
              from: msg.from,
              type: msg.data && msg.data.type,
            });
            this.onMessage(msg.from, msg.data);
          }
          break;

        case '__error':
          console.log('[MockTransport] Error: ' + msg.message);
          if (this.onError) this.onError(new Error(msg.message));
          break;
      }
    }

    async connect(peerId) {
      console.log('[MockTransport] connect() called for ' + peerId + ', ws.readyState=' + (this._ws && this._ws.readyState));
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
        throw new Error('MockTransport not initialized — call init() first');
      }
      if (this._connectedPeers.has(peerId)) {
        console.log('[MockTransport] Already connected to ' + peerId);
        return;
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this._pendingConnects.delete(peerId);
          reject(new Error('MockTransport: connect to ' + peerId + ' timed out'));
        }, 10000);

        this._pendingConnects.set(peerId, {
          resolve: () => { clearTimeout(timeout); resolve(); },
          reject: (err) => { clearTimeout(timeout); reject(err); },
        });

        this._ws.send(JSON.stringify({
          type: '__connect',
          targetPeerId: peerId,
        }));
      });
    }

    disconnect(peerId) {
      if (this._connectedPeers.has(peerId)) {
        this._connectedPeers.delete(peerId);
        if (this._ws) {
          this._ws.send(JSON.stringify({
            type: '__disconnect',
            targetPeerId: peerId,
          }));
        }
        if (this.onDisconnect) this.onDisconnect(peerId);
      }
    }

    send(peerId, data) {
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return false;
      if (!this._connectedPeers.has(peerId)) return false;
      console.log(this._tracePrefix(), 'send()', {
        targetPeerId: peerId,
        type: data && data.type,
        channelId: data && data.channelId,
      });

      this._ws.send(JSON.stringify({
        type: '__data',
        targetPeerId: peerId,
        data: data,
      }));
      return true;
    }

    getConnectedPeers() {
      return Array.from(this._connectedPeers);
    }

    getMyPeerId() {
      return this._myPeerId;
    }

    destroy() {
      this._manualDestroy = true;
      this._connectedPeers.clear();
      if (this._reconnectTimer) {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
      }
      if (this._ws) {
        this._ws.close();
        this._ws = null;
      }
      this._myPeerId = null;
    }

    getSignalingStatus() {
      return [{
        url: this._relayUrl,
        label: 'mock-relay',
        connected: this._ws && this._ws.readyState === WebSocket.OPEN,
      }];
    }

    getConnectedServerCount() {
      return (this._ws && this._ws.readyState === WebSocket.OPEN) ? 1 : 0;
    }

    async addSignalingServer() {
      return true;
    }
  }

  // Expose globally so ChatController can pick it up
  window.__MockTransport = MockTransport;
})();
`;
}
