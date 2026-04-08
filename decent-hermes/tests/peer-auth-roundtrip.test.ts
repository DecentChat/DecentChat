/**
 * Full peer-auth signature round-trip test using the actual seed-derivation
 * path the bridge uses in production.
 *
 * Reproduces the live failure:
 *   bridge → web client: handshake { signingPublicKey }
 *   web client → bridge: auth-challenge { nonce }
 *   bridge → web client: auth-response { signature = sign(nonce + webPeerId, ourPriv) }
 *   web client: verify(signature, nonce + webPeerId, importSigningPublicKey(handshake.signingPublicKey))
 *               → returns false in production
 *
 * This test uses the EXACT same APIs the production code uses:
 *   - SeedPhraseManager.deriveAll() → ECDSA keypair
 *   - CryptoManager.exportPublicKey() → base64 JWK
 *   - CryptoManager.importSigningPublicKey() → re-import as ECDSA
 *   - PeerAuth.respondToChallenge() / PeerAuth.verifyResponse()
 *
 * If this round-trip returns false, it tells us exactly which step is corrupting
 * the key. If it returns true, the bug is somewhere else (e.g. wrong peerId
 * being signed, message corruption in transit, mismatched nonces).
 */
import { describe, expect, test } from 'bun:test';
import { CryptoManager, PeerAuth, SeedPhraseManager } from '@decentchat/protocol';

describe('peer-auth signature round-trip with seed-derived ECDSA keys', () => {
  test('exportPublicKey → importSigningPublicKey → verify(sign(payload)) round-trips', async () => {
    const cm = new CryptoManager();
    const seedMgr = new SeedPhraseManager();
    const { mnemonic } = seedMgr.generate();
    const { peerId: bridgePeerId, keys: { ecdsaKeyPair } } = await seedMgr.deriveAll(mnemonic);

    // Bridge side: export the signing public key the way createHandshake() does
    const exportedSigningPubB64 = await cm.exportPublicKey(ecdsaKeyPair.publicKey);
    expect(typeof exportedSigningPubB64).toBe('string');

    // Web-client side: import it back as an ECDSA verification key
    const reimportedPub = await cm.importSigningPublicKey(exportedSigningPubB64);
    expect(reimportedPub).toBeDefined();

    // Web-client side: build a fresh challenge
    const challenge = PeerAuth.createChallenge();
    const webClientPeerId = 'peer-37603fd5-d5a8b7acce';

    // Bridge side: respond to the challenge
    const response = await PeerAuth.respondToChallenge(
      challenge.nonce,
      webClientPeerId,
      ecdsaKeyPair.privateKey,
    );
    expect(typeof response.signature).toBe('string');

    // Web-client side: verify the response with the re-imported key
    const ok = await PeerAuth.verifyResponse(
      challenge.nonce,
      webClientPeerId,
      response.signature,
      reimportedPub,
    );

    // If this is false, the export/import round-trip is corrupting the key
    // (different x/y coordinates, lost ext flag, wrong alg, etc.)
    expect(ok).toBeTrue();

    // Sanity: same signature also verifies with the ORIGINAL non-roundtripped key
    const okOriginal = await PeerAuth.verifyResponse(
      challenge.nonce,
      webClientPeerId,
      response.signature,
      ecdsaKeyPair.publicKey,
    );
    expect(okOriginal).toBeTrue();

    // For diagnostics: print bridgePeerId so we can compare with the live trace
    expect(bridgePeerId.length).toBeGreaterThan(0);
  });
});
