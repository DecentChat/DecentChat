/**
 * HandshakeVerifier — Key verification for peer handshakes (DEP-003)
 *
 * When a peer connects via an invite URL containing a public key (`&pk=`),
 * that key is pre-stored as the "expected" key for the peer. On handshake,
 * we verify the received key matches. A mismatch indicates a possible MITM.
 */

export type HandshakeVerificationResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Verify a peer's handshake public key against a pre-stored expected key.
 *
 * @param preStoredKey  Public key stored prior to connection (e.g. from invite URL).
 *                      Pass undefined/empty if no key was pre-stored (TOFU applies).
 * @param handshakeKey  Public key received in the handshake message.
 * @returns { ok: true } if the handshake is acceptable, or { ok: false, reason } if rejected.
 */
export function verifyHandshakeKey(
  preStoredKey: string | undefined | null,
  handshakeKey: string | undefined | null,
): HandshakeVerificationResult {
  // No pre-stored key → TOFU: accept unconditionally
  if (!preStoredKey) return { ok: true };

  // Pre-stored key exists but handshake sent no key → suspicious; reject
  if (!handshakeKey) {
    return {
      ok: false,
      reason: 'Peer sent no public key in handshake despite having a pre-stored key.',
    };
  }

  // Both present — compare
  if (preStoredKey !== handshakeKey) {
    return {
      ok: false,
      reason:
        `Handshake key mismatch — possible impersonation attempt. ` +
        `Expected: ${preStoredKey.slice(0, 16)}… ` +
        `Received: ${handshakeKey.slice(0, 16)}…`,
    };
  }

  return { ok: true };
}


import { verifyPeerIdBinding } from './IdentityVerifier';

export interface VerifyHandshakeParams {
  /** Public key pre-stored from invite URL. Undefined = TOFU. */
  preStoredKey?: string | null;
  /** Public key received in the handshake message. */
  handshakeKey?: string | null;
  /** Claimed peerId. If provided, binding to handshakeKey is verified. */
  peerId?: string | null;
}

/**
 * Extended handshake verification: checks both key match AND peerId↔publicKey binding.
 *
 * 1. If preStoredKey is set, verify handshakeKey matches it (existing behavior).
 * 2. If peerId and handshakeKey are both set, verify peerId is derived from handshakeKey
 *    via the DEP-003 algorithm.
 *
 * Either check failing → rejection.
 */
export async function verifyHandshake(
  params: VerifyHandshakeParams,
): Promise<HandshakeVerificationResult> {
  const { preStoredKey, handshakeKey, peerId } = params;

  // Step 1: Existing key-match check
  const keyResult = verifyHandshakeKey(preStoredKey, handshakeKey);
  if (!keyResult.ok) return keyResult;

  // Step 2: PeerId↔PublicKey binding check (if both provided)
  if (peerId && handshakeKey) {
    const binding = await verifyPeerIdBinding(peerId, handshakeKey);
    if (!binding.valid) {
      return {
        ok: false,
        reason: `PeerId binding failed: ${binding.reason}`,
      };
    }
  }

  return { ok: true };
}
