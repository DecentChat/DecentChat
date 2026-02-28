/**
 * IdentityVerifier — PeerId↔PublicKey Binding Verification (DEP-003)
 *
 * Verifies that a peer's claimed peerId actually matches their ECDH public key
 * using the DEP-003 algorithm: SHA-256(SPKI(publicKey))[0:9].hex() === peerId
 *
 * This prevents impersonation by ensuring a peer can only claim a peerId
 * that is cryptographically derived from their actual public key.
 */

export interface PeerIdBindingResult {
  valid: boolean;
  reason?: string;
}

/**
 * Verify that a claimed peerId matches the DEP-003 derivation from a public key.
 *
 * @param claimedPeerId  The peerId the peer claims to own (18-char hex string)
 * @param publicKeySPKI  The peer's ECDH public key in SPKI format (ArrayBuffer or base64 string)
 * @returns Verification result with valid flag and optional reason for rejection
 */
export async function verifyPeerIdBinding(
  claimedPeerId: string,
  publicKeySPKI: ArrayBuffer | string,
): Promise<PeerIdBindingResult> {
  // Validate peerId format: must be 18-char hex (9 bytes)
  if (!claimedPeerId || claimedPeerId.length !== 18) {
    return {
      valid: false,
      reason: `Invalid peerId length: ${claimedPeerId?.length ?? 0}, expected 18`,
    };
  }

  // Decode base64 if string was provided
  const spkiBuffer =
    typeof publicKeySPKI === 'string'
      ? base64ToArrayBuffer(publicKeySPKI)
      : publicKeySPKI;

  // Derive peerId from public key using DEP-003 algorithm
  const hash = await crypto.subtle.digest('SHA-256', spkiBuffer);
  const derivedPeerId = Array.from(new Uint8Array(hash).slice(0, 9))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (claimedPeerId !== derivedPeerId) {
    return {
      valid: false,
      reason: `PeerId↔PublicKey mismatch. Claimed: ${claimedPeerId}, derived: ${derivedPeerId}`,
    };
  }

  return { valid: true };
}

/** Decode a base64 string to ArrayBuffer */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
