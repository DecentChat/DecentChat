/**
 * Transport - Abstract transport interface for decent protocol
 *
 * The @decentchat/protocol SDK is transport-agnostic. Any networking layer
 * (WebRTC, WebSocket, Bluetooth, localhost) can be plugged in by
 * implementing this interface.
 *
 * Implementations:
 *   - @decentchat/transport-webrtc: PeerJS/WebRTC implementation
 *   - Future: mesh-transport-ws, mesh-transport-bt, etc.
 */

export interface Transport {
  /**
   * Initialize the transport layer and register with the network.
   *
   * @param peerId - Optional desired peer ID. If not provided, a random ID
   *                 is assigned by the signaling/discovery mechanism.
   * @returns The actual peer ID assigned to this node.
   */
  init(peerId?: string): Promise<string>;

  /**
   * Establish a connection to a remote peer.
   *
   * @param peerId - The ID of the peer to connect to.
   * @throws If the connection cannot be established.
   */
  connect(peerId: string): Promise<void>;

  /**
   * Gracefully close the connection to a remote peer.
   *
   * @param peerId - The ID of the peer to disconnect from.
   */
  disconnect(peerId: string): void;

  /**
   * Send data to a connected peer.
   *
   * @param peerId - The ID of the recipient peer.
   * @param data  - Any JSON-serializable payload.
   * @returns true if the message was dispatched; false if the peer is not
   *          currently connected.
   */
  send(peerId: string, data: unknown): boolean;

  /**
   * Called when a new peer connects to us.
   * Set this before calling init() to avoid missing early events.
   */
  onConnect: ((peerId: string) => void) | null;

  /**
   * Called when a peer disconnects (either side-initiated).
   */
  onDisconnect: ((peerId: string) => void) | null;

  /**
   * Called when a data message arrives from a peer.
   *
   * @param peerId - The sender's peer ID.
   * @param data  - The deserialized payload (whatever was passed to send()).
   */
  onMessage: ((peerId: string, data: unknown) => void | Promise<void>) | null;

  /**
   * Called when a transport-level error occurs.
   * Non-fatal errors (e.g. failed connection attempts) should be reported
   * here rather than thrown.
   */
  onError: ((error: Error) => void) | null;

  /**
   * Return the IDs of all currently connected peers.
   */
  getConnectedPeers(): string[];

  /**
   * Return true if a connection attempt to this peer is currently in flight
   * (i.e. connect() was called but has not resolved/rejected yet, OR a
   * scheduled auto-reconnect timer is pending). Used by maintenance routines
   * to avoid queuing duplicate attempts without relying on app-level state.
   */
  isConnectingToPeer(peerId: string): boolean;

  /**
   * Tear down all connections and release resources.
   * After calling this, the transport instance must not be reused.
   */
  destroy(): void;
}
