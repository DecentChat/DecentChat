/**
 * InviteAuth — Cryptographic signing/verification for invite links
 *
 * Uses ECDSA (P-256, SHA-256) — the same curve and algorithm already used
 * throughout the protocol (PeerAuth, MessageCipher).
 *
 * Signatures are encoded as base64url (URL-safe, no padding) so they
 * fit cleanly in invite URLs without extra encoding.
 */

import { InviteURI } from './InviteURI';
import type { InviteData } from './InviteURI';

const ECDSA_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;

// ── Base64url helpers (URL-safe, no padding) ──────────────────────────────

function toBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(str: string): Uint8Array {
  // Restore standard base64
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding
  while (b64.length % 4 !== 0) b64 += '=';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Sign an invite's payload with an ECDSA private key.
 *
 * @param privateKey  ECDSA P-256 private key (sign usage)
 * @param data        Invite data to sign (uses getSignPayload for deterministic content)
 * @returns           base64url-encoded signature
 */
export async function signInvite(privateKey: CryptoKey, data: InviteData): Promise<string> {
  const payload = InviteURI.getSignPayload(data);
  const encoded = new TextEncoder().encode(payload);
  const signature = await crypto.subtle.sign(ECDSA_PARAMS, privateKey, encoded);
  return toBase64url(signature);
}

/**
 * Verify the ECDSA signature on an invite.
 *
 * @param publicKey  ECDSA P-256 public key — either a CryptoKey or a Base64-encoded JWK string
 *                   (the format already used for publicKey in InviteData and member records)
 * @param data       Invite data including the `signature` field
 * @returns          true if signature is valid, false otherwise
 */
export async function verifyInviteSignature(
  publicKey: CryptoKey | string,
  data: InviteData,
): Promise<boolean> {
  if (!data.signature) return false;

  try {
    // Resolve public key
    let key: CryptoKey;
    if (typeof publicKey === 'string') {
      const jwk = JSON.parse(atob(publicKey));
      key = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['verify'],
      );
    } else {
      key = publicKey;
    }

    const payload = InviteURI.getSignPayload(data);
    const encoded = new TextEncoder().encode(payload);
    const sigBytes = fromBase64url(data.signature);
    // Normalize into a fresh ArrayBuffer-backed view for stricter TS/WebCrypto typings.
    const sigBuffer = new Uint8Array(sigBytes).buffer;

    return await crypto.subtle.verify(ECDSA_PARAMS, key, sigBuffer, encoded);
  } catch {
    return false;
  }
}
