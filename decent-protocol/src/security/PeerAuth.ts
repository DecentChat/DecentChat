/**
 * PeerAuth — Challenge-Response Peer Authentication
 *
 * Implements a challenge-response protocol where connecting peers prove
 * they own the private key behind their peerId. Prevents replaying
 * someone else's public key.
 *
 * Protocol:
 *   Alice → Bob: handshake { publicKey, signingKey, peerId }
 *   Bob → Alice: auth-challenge { nonce: random 32 bytes }
 *   Alice → Bob: auth-response { signature: ECDSA.sign(nonce + bobPeerId, aliceSigningKey) }
 *   Bob verifies: ECDSA.verify(signature, nonce + bobPeerId, aliceSigningKey)
 *
 * Including bobPeerId in the signed payload prevents replay attacks
 * (Alice's response is only valid for Bob's specific challenge).
 */

export interface AuthChallenge {
  nonce: string;      // 32 random bytes, base64-encoded
  timestamp: number;  // When the challenge was created (for expiry)
}

export interface AuthResponse {
  signature: string;  // ECDSA signature, base64-encoded
}

const ECDSA_SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;

export class PeerAuth {
  /**
   * Create a new authentication challenge with a random 32-byte nonce.
   */
  static createChallenge(): AuthChallenge {
    const nonceBytes = new Uint8Array(32);
    crypto.getRandomValues(nonceBytes);
    const nonce = btoa(String.fromCharCode(...nonceBytes));
    return { nonce, timestamp: Date.now() };
  }

  /**
   * Check if a challenge has expired.
   * @param challenge  The challenge to check
   * @param maxAgeMs   Maximum age in milliseconds (default: 30 seconds)
   */
  static isChallengeExpired(challenge: AuthChallenge, maxAgeMs = 30_000): boolean {
    return Date.now() - challenge.timestamp > maxAgeMs;
  }

  /**
   * Respond to an authentication challenge by signing (nonce + challengerPeerId).
   *
   * @param nonce            The challenge nonce (base64)
   * @param challengerPeerId The peerId of the peer who sent the challenge
   * @param signingKey       Our ECDSA private signing key
   */
  static async respondToChallenge(
    nonce: string,
    challengerPeerId: string,
    signingKey: CryptoKey,
  ): Promise<AuthResponse> {
    const payload = buildPayload(nonce, challengerPeerId);
    const signatureBuffer = await crypto.subtle.sign(ECDSA_SIGN_PARAMS, signingKey, payload as BufferSource);
    const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
    return { signature };
  }

  /**
   * Verify a peer's response to our authentication challenge.
   *
   * @param nonce            The nonce we sent in the challenge
   * @param ourPeerId        Our own peerId (was included in the signed payload)
   * @param signature        The base64-encoded signature from the peer
   * @param peerSigningKey   The peer's ECDSA public signing key
   */
  static async verifyResponse(
    nonce: string,
    ourPeerId: string,
    signature: string,
    peerSigningKey: CryptoKey,
  ): Promise<boolean> {
    try {
      const payload = buildPayload(nonce, ourPeerId);
      const sigBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
      return await crypto.subtle.verify(ECDSA_SIGN_PARAMS, peerSigningKey, sigBytes as BufferSource, payload as BufferSource);
    } catch {
      return false;
    }
  }
}

/**
 * Build the challenge-response payload: nonce + peerId concatenated as UTF-8 bytes.
 */
function buildPayload(nonce: string, peerId: string): Uint8Array {
  return new TextEncoder().encode(nonce + peerId);
}
