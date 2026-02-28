/**
 * DeviceManager — Multi-device registration and verification
 *
 * Handles device announcements with cryptographic proof.
 * A device proves it belongs to an identity by signing
 * (identityId + deviceId + timestamp) with the identity's master ECDSA signing key.
 *
 * Sync messages:
 *   device-announce: new device joining with cryptographic proof
 *   device-ack: peer acknowledges a new device
 */

export interface DeviceInfo {
  deviceId: string;
  peerId: string;
  deviceLabel: string;
  lastSeen: number;
}

export interface DeviceProof {
  identityId: string;
  deviceId: string;
  timestamp: number;
  /** ECDSA signature over (identityId + deviceId + timestamp), base64-encoded */
  signature: string;
}

export interface DeviceAnnouncement {
  type: 'device-announce';
  identityId: string;
  device: DeviceInfo;
  proof: DeviceProof;
}

export interface DeviceAck {
  type: 'device-ack';
  identityId: string;
  deviceId: string;
}

export interface VerificationResult {
  valid: boolean;
  reason?: string;
}

const ECDSA_SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;
const PROOF_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

export class DeviceManager {

  /**
   * Create a cryptographic proof that a device belongs to an identity.
   * Signs (identityId + deviceId + timestamp) with the identity's ECDSA signing key.
   *
   * @param identityId  The canonical identity ID
   * @param deviceId    The device's peer ID
   * @param signingKey  The identity's ECDSA private signing key (from m/0'/identity/0)
   * @param timestamp   Optional timestamp (defaults to now, used for testing expired proofs)
   */
  static async createDeviceProof(
    identityId: string,
    deviceId: string,
    signingKey: CryptoKey,
    timestamp?: number
  ): Promise<DeviceProof> {
    const ts = timestamp ?? Date.now();
    const payload = `${identityId}:${deviceId}:${ts}`;
    const data = new TextEncoder().encode(payload);
    const sig = await crypto.subtle.sign(ECDSA_SIGN_PARAMS, signingKey, data);
    const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));

    return { identityId, deviceId, timestamp: ts, signature };
  }

  /**
   * Verify a device proof against the identity's public signing key.
   *
   * Checks:
   * 1. Proof is not expired (< 5 minutes)
   * 2. ECDSA signature is valid over (identityId + deviceId + timestamp)
   */
  static async verifyDeviceProof(
    proof: DeviceProof,
    signingPublicKey: CryptoKey
  ): Promise<VerificationResult> {
    // Check expiry
    const age = Date.now() - proof.timestamp;
    if (age > PROOF_MAX_AGE_MS) {
      return { valid: false, reason: `Device proof expired (${Math.round(age / 1000)}s > ${PROOF_MAX_AGE_MS / 1000}s)` };
    }

    // Verify signature
    const payload = `${proof.identityId}:${proof.deviceId}:${proof.timestamp}`;
    const data = new TextEncoder().encode(payload);
    const sigBytes = Uint8Array.from(atob(proof.signature), c => c.charCodeAt(0));

    try {
      const valid = await crypto.subtle.verify(ECDSA_SIGN_PARAMS, signingPublicKey, sigBytes, data);
      if (!valid) {
        return { valid: false, reason: 'Invalid signature: device proof signature verification failed' };
      }
    } catch {
      return { valid: false, reason: 'Invalid signature: device proof signature could not be verified' };
    }

    return { valid: true };
  }

  /**
   * Create a full device announcement message for sync.
   */
  static async createDeviceAnnouncement(
    identityId: string,
    devicePeerId: string,
    deviceLabel: string,
    signingKey: CryptoKey
  ): Promise<DeviceAnnouncement> {
    const proof = await DeviceManager.createDeviceProof(identityId, devicePeerId, signingKey);
    return {
      type: 'device-announce',
      identityId,
      device: {
        deviceId: devicePeerId,
        peerId: devicePeerId,
        deviceLabel,
        lastSeen: Date.now(),
      },
      proof,
    };
  }

  /**
   * In-memory device registry for tracking known devices per identity.
   */
  static DeviceRegistry = class DeviceRegistry {
    private devices = new Map<string, DeviceInfo[]>();

    /**
     * Add or update a device for an identity.
     * If a device with the same deviceId exists, it's updated.
     */
    addDevice(identityId: string, device: DeviceInfo): void {
      const existing = this.devices.get(identityId) || [];
      const idx = existing.findIndex(d => d.deviceId === device.deviceId);
      if (idx >= 0) {
        existing[idx] = device;
      } else {
        existing.push(device);
      }
      this.devices.set(identityId, existing);
    }

    /**
     * Remove a device from an identity.
     */
    removeDevice(identityId: string, deviceId: string): void {
      const existing = this.devices.get(identityId) || [];
      this.devices.set(identityId, existing.filter(d => d.deviceId !== deviceId));
    }

    /**
     * Get all devices for an identity.
     */
    getDevices(identityId: string): DeviceInfo[] {
      return this.devices.get(identityId) || [];
    }

    /**
     * Get all known peerIds for an identity (for multi-device message delivery).
     */
    getAllPeerIds(identityId: string): string[] {
      return this.getDevices(identityId).map(d => d.peerId);
    }
  };
}
