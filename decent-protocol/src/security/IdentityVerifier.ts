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
 * Accepts the public key in multiple formats:
 *   - ArrayBuffer: raw SPKI bytes
 *   - string: either base64-encoded SPKI, or base64-encoded JWK (as used in handshakes)
 *
 * JWK detection: if the decoded base64 starts with '{' it's treated as JWK,
 * imported as an ECDH P-256 key, and re-exported as SPKI for hashing.
 *
 * @param claimedPeerId  The peerId the peer claims to own (18-char hex string)
 * @param publicKey      The peer's ECDH public key (ArrayBuffer SPKI, base64 SPKI, or base64 JWK)
 * @returns Verification result with valid flag and optional reason for rejection
 */
export async function verifyPeerIdBinding(
  claimedPeerId: string,
  publicKey: ArrayBuffer | string,
): Promise<PeerIdBindingResult> {
  // Validate peerId format: must be 18-char hex (9 bytes)
  if (!claimedPeerId || claimedPeerId.length !== 18) {
    return {
      valid: false,
      reason: `Invalid peerId length: ${claimedPeerId?.length ?? 0}, expected 18`,
    };
  }

  let spkiBuffer: ArrayBuffer;

  if (typeof publicKey === 'string') {
    // Decode the base64 string
    const decoded = atob(publicKey);
    if (decoded.startsWith('{')) {
      // It's a JWK — import as ECDH key and re-export as SPKI
      try {
        const jwk = JSON.parse(decoded) as JsonWebKey;
        const cryptoKey = await crypto.subtle.importKey(
          'jwk',
          jwk,
          { name: 'ECDH', namedCurve: 'P-256' },
          true,
          [],
        );
        spkiBuffer = await crypto.subtle.exportKey('spki', cryptoKey);
      } catch (err) {
        return {
          valid: false,
          reason: `Failed to import JWK public key: ${err}`,
        };
      }
    } else {
      // It's base64-encoded SPKI bytes
      spkiBuffer = base64ToArrayBuffer(publicKey);
    }
  } else {
    spkiBuffer = publicKey;
  }

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
