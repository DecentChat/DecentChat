# Cryptographic Identity & Multi-Device Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Make identity cryptographically anchored so nobody can impersonate anyone, and enable one identity across multiple devices.

**Architecture:** Three-phase approach. Phase 1 closes the impersonation gap by verifying peerId↔publicKey binding on every connection. Phase 2 introduces `identityId` as the canonical identity layer (decoupled from transport peerId), making WorkspaceMember keyed by identityId. Phase 3 adds multi-device: same seed → per-device sub-keys → multiple transport connections under one identity.

**Tech Stack:** Web Crypto API (ECDSA P-256, HKDF, SHA-256), existing HDKeyDerivation, PeerJS transport, Bun test runner

---

## Current State (What Exists)

| Component | Status | Gap |
|-----------|--------|-----|
| DEP-003: seed → deterministic peerId | ✅ Implemented | No verification that peerId matches the key |
| Handshake: swap ECDH + ECDSA keys | ✅ Working | Only checks pre-stored key (invite URL). TOFU otherwise |
| HandshakeVerifier | ✅ Working | Doesn't verify peerId↔publicKey binding |
| Message signing (ECDSA) | ✅ Working | Signatures exist but peerId authenticity isn't proven |
| HDKeyDerivation device path m/3'/device/<index> | ✅ Code exists | Not wired to anything |
| DecentIdentity.deviceGroup | ✅ Types exist | Not used by client |
| WorkspaceMember | ✅ Working | Keyed by peerId, not identityId |

**The core problem:** An attacker can connect with any peerId they want. DEP-003 derives peerId from the seed, but nobody *verifies* this on the receiving end. The handshake swaps keys but never proves "I own this peerId because here's the cryptographic proof."

---

## Phase 1: Anti-Impersonation (Identity Authentication)

### Task 1: PeerId↔PublicKey Binding Verification

**Files:**
- Create: `decent-protocol/src/security/IdentityVerifier.ts`
- Create: `decent-protocol/tests/unit/identity-verifier.test.ts`
- Modify: `decent-protocol/src/security/index.ts`
- Modify: `decent-protocol/src/index.ts`

**What:** A function that verifies a peer's claimed peerId actually matches their ECDH public key using the DEP-003 algorithm: `SHA-256(SPKI(publicKey))[0:9].hex() === peerId`.

1. Write failing test:
```typescript
// decent-protocol/tests/unit/identity-verifier.test.ts
import { describe, test, expect } from 'bun:test';
import { verifyPeerIdBinding } from '../../src/security/IdentityVerifier';

describe('IdentityVerifier', () => {
  test('valid binding: peerId matches publicKey hash', async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
    const spki = await crypto.subtle.exportKey('spki', kp.publicKey);
    const hash = await crypto.subtle.digest('SHA-256', spki);
    const expectedPeerId = Array.from(new Uint8Array(hash).slice(0, 9))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    
    const result = await verifyPeerIdBinding(expectedPeerId, spki);
    expect(result.valid).toBe(true);
  });

  test('invalid binding: peerId does not match publicKey', async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
    const spki = await crypto.subtle.exportKey('spki', kp.publicKey);
    const result = await verifyPeerIdBinding('000000000000000000', spki);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('mismatch');
  });

  test('rejects peerId that is wrong length', async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
    const spki = await crypto.subtle.exportKey('spki', kp.publicKey);
    const result = await verifyPeerIdBinding('abc', spki);
    expect(result.valid).toBe(false);
  });
});
```

2. Run: `cd decent-protocol && bun test tests/unit/identity-verifier.test.ts` → expect fail
3. Implement `IdentityVerifier.ts`:
```typescript
export interface PeerIdBindingResult {
  valid: boolean;
  reason?: string;
}

export async function verifyPeerIdBinding(
  claimedPeerId: string,
  publicKeySPKI: ArrayBuffer | string, // ArrayBuffer or base64
): Promise<PeerIdBindingResult> {
  if (!claimedPeerId || claimedPeerId.length !== 18) {
    return { valid: false, reason: `Invalid peerId length: ${claimedPeerId?.length ?? 0}, expected 18` };
  }
  
  const spkiBuffer = typeof publicKeySPKI === 'string'
    ? base64ToArrayBuffer(publicKeySPKI)
    : publicKeySPKI;
  
  const hash = await crypto.subtle.digest('SHA-256', spkiBuffer);
  const expectedPeerId = Array.from(new Uint8Array(hash).slice(0, 9))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  
  if (claimedPeerId !== expectedPeerId) {
    return {
      valid: false,
      reason: `PeerId↔PublicKey mismatch. Claimed: ${claimedPeerId}, derived: ${expectedPeerId}`,
    };
  }
  return { valid: true };
}
```
4. Run → pass
5. Export from `security/index.ts` and `src/index.ts`
6. Commit: `feat(protocol): add peerId↔publicKey binding verification`

---

### Task 2: Challenge-Response Authentication

**Files:**
- Create: `decent-protocol/src/security/PeerAuth.ts`
- Create: `decent-protocol/tests/unit/peer-auth.test.ts`
- Modify: `decent-protocol/src/security/index.ts`

**What:** A challenge-response protocol where connecting peers prove they own the private key behind their peerId. Prevents replaying someone else's public key.

Protocol:
```
Alice → Bob: handshake { publicKey, signingKey, peerId }
Bob → Alice: auth-challenge { nonce: random 32 bytes }
Alice → Bob: auth-response { signature: ECDSA.sign(nonce + bobPeerId, aliceSigningKey) }
Bob verifies: ECDSA.verify(signature, nonce + bobPeerId, aliceSigningKey) 
  AND verifyPeerIdBinding(alicePeerId, alicePublicKey)
```

Including `bobPeerId` in the signed payload prevents replay attacks (Alice's response is only valid for Bob's specific challenge).

1. Write failing tests:
```typescript
describe('PeerAuth', () => {
  test('generate challenge → sign → verify round-trip', async () => {
    const challenge = PeerAuth.createChallenge();
    expect(challenge.nonce).toHaveLength(44); // 32 bytes base64
    
    const signingKeys = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
    );
    const response = await PeerAuth.respondToChallenge(
      challenge.nonce, 'bob-peer-id', signingKeys.privateKey
    );
    const valid = await PeerAuth.verifyResponse(
      challenge.nonce, 'bob-peer-id', response.signature, signingKeys.publicKey
    );
    expect(valid).toBe(true);
  });

  test('reject wrong nonce', async () => { /* ... */ });
  test('reject wrong bobPeerId (replay prevention)', async () => { /* ... */ });
  test('reject wrong signing key', async () => { /* ... */ });
  test('challenge expires after 30 seconds', async () => { /* ... */ });
});
```

2. Run → fail
3. Implement `PeerAuth.ts`
4. Run → pass
5. Commit: `feat(protocol): challenge-response peer authentication`

---

### Task 3: Wire Authentication into Handshake

**Files:**
- Modify: `decent-client-web/src/app/ChatController.ts` (~lines 333-345, 575-610)
- Modify: `decent-client-web/src/messages/MessageProtocol.ts` (HandshakeData interface)
- Create: `decent-protocol/tests/unit/handshake-auth-integration.test.ts`

**What:** Extend existing handshake flow with challenge-response.

Current flow:
```
Alice connects → Bob
Bob sends: handshake { publicKey, signingKey, peerId }
Alice sends: handshake { publicKey, signingKey, peerId }
→ Done, start messaging
```

New flow:
```
Alice connects → Bob
Bob sends: handshake { publicKey, signingKey, peerId }
Alice sends: handshake { publicKey, signingKey, peerId }
Both sides simultaneously:
  1. verifyPeerIdBinding(peerPeerId, peerPublicKey) — reject if mismatch
  2. Send auth-challenge { nonce }
  3. Receive auth-challenge, respond with auth-response { signature }
  4. Verify auth-response
  5. Mark peer as authenticated
→ Only now accept messages from this peer
```

1. Write integration test proving unauthenticated messages are rejected
2. Run → fail
3. Add `authenticated: Set<string>` to ChatController state
4. Extend `onConnect` to run peerId binding check + challenge-response
5. Gate message processing on `authenticated.has(peerId)`
6. Add `auth-challenge` and `auth-response` message types to transport layer
7. Run → pass
8. Commit: `feat(client): wire challenge-response auth into handshake flow`

**Backward compatibility:** Peers running old code won't respond to challenges. Add a 5-second timeout: if no auth-response, log a warning and fall back to current TOFU behavior. Add setting `requireAuthentication: boolean` (default false initially, flip to true once all clients upgrade).

---

### Task 4: Update HandshakeVerifier

**Files:**
- Modify: `decent-protocol/src/security/HandshakeVerifier.ts`
- Modify: `decent-protocol/tests/unit/handshake-verifier.test.ts`

**What:** Extend `verifyHandshakeKey` to also check peerId↔publicKey binding.

1. Add test: `verifyHandshakeKey` rejects when peerId doesn't match the public key hash
2. Run → fail
3. Add `peerId` parameter to `verifyHandshakeKey`, call `verifyPeerIdBinding` internally
4. Run → pass
5. Commit: `feat(protocol): handshake verifier checks peerId↔key binding`

---

## Phase 2: Identity Layer Separation

### Task 5: Introduce identityId as Canonical Identity

**Files:**
- Modify: `decent-protocol/src/workspace/types.ts`
- Create: `decent-protocol/tests/unit/identity-id.test.ts`
- Modify: `decent-protocol/src/identity/Identity.ts`

**What:** Add `identityId` (hash of identity public key) to WorkspaceMember.

```typescript
export interface WorkspaceMember {
  identityId: string;      // NEW: canonical identity (hash of ECDH pubkey, permanent)
  peerId: string;           // Transport address (kept for backward compat)
  alias: string;
  publicKey: string;
  signingPublicKey?: string;
  joinedAt: number;
  role: 'owner' | 'admin' | 'member';
  addedBy?: string;
  devices?: DeviceInfo[];   // NEW: Phase 3 preparation
}

export interface DeviceInfo {
  deviceId: string;
  peerId: string;
  deviceLabel: string;
  publicKey: string;
  lastSeen: number;
}
```

1. Write tests for identityId derivation consistency
2. Run → fail
3. Add `identityId` to WorkspaceMember (optional initially for migration)
4. Derive and set on workspace join/create
5. Run → pass
6. Commit: `feat(protocol): add identityId to WorkspaceMember`

---

### Task 6: Member Lookup by identityId

**Files:**
- Modify: `decent-protocol/src/workspace/WorkspaceManager.ts`
- Modify: `decent-protocol/tests/unit/workspace-manager.test.ts`

**What:** Add `getMemberByIdentity(workspaceId, identityId)` alongside existing `getMember(workspaceId, peerId)`.

1. Write test: both lookups work
2. Run → fail
3. Implement
4. Run → pass
5. Commit: `feat(protocol): member lookup by identityId`

---

### Task 7: UI Member List Dedup by Identity

**Files:**
- Modify: `decent-client-web/src/ui/UIRenderer.ts` (~line 810-830)
- Modify: `decent-client-web/src/app/ChatController.ts`

**What:** Member sidebar shows unique *identities*, not *connections*. Bob with 2 devices = 1 entry.

1. Group members by `identityId` in rendering
2. `getPeerAlias` resolves via identityId first
3. Online = any device connected
4. Commit: `feat(client): member list grouped by identity`

---

### Task 8: Message senderIdentityId

**Files:**
- Modify: `decent-client-web/src/messages/MessageProtocol.ts`
- Modify: `decent-client-web/src/app/ChatController.ts`

**What:** Messages include `senderIdentityId` for attribution (display name, avatar color), `sender` (peerId) for routing.

1. Add `senderIdentityId` to outgoing envelopes
2. Use for display, fall back to `sender` for old messages
3. Commit: `feat(client): messages include senderIdentityId`

---

## Phase 3: Multi-Device

### Task 9: Device Key Derivation

**Files:**
- Modify: `decent-protocol/src/identity/SeedPhrase.ts`
- Create: `decent-protocol/tests/unit/device-keys.test.ts`

**What:** Per-device transport keys from master seed.

```
seed → masterKey
  → m/0'/identity/0 → identity ECDH key → identityId (canonical, permanent)
  → m/3'/device/0   → device 0 ECDH key → device0 peerId (transport)
  → m/3'/device/1   → device 1 ECDH key → device1 peerId (transport)
```

1. Test: same seed → same identityId regardless of device index
2. Test: different device indices → different peerIds
3. Run → fail
4. Implement `deriveDevicePeerId(seed, deviceIndex)` and `deriveIdentityId(seed)`
5. Run → pass
6. Commit: `feat(protocol): per-device key derivation with shared identityId`

---

### Task 10: Device Registration Protocol

**Files:**
- Create: `decent-protocol/src/identity/DeviceManager.ts`
- Create: `decent-protocol/tests/unit/device-manager.test.ts`
- Modify: `decent-protocol/src/workspace/types.ts` (SyncMessage)

**What:** Second device announces itself with cryptographic proof.

New sync messages:
```typescript
| { type: 'device-announce'; identityId: string; device: DeviceInfo; 
    proof: string /* ECDSA sig over (identityId + deviceId + timestamp) with master signing key */ }
| { type: 'device-ack'; identityId: string; deviceId: string }
```

Verification: `identityId` matches known member + signature valid against their signing key.

1. Test: valid proof → accepted
2. Test: forged proof → rejected
3. Test: unknown identity → rejected
4. Run → fail
5. Implement
6. Run → pass
7. Commit: `feat(protocol): device registration with cryptographic proof`

---

### Task 11: Device Selection on Startup

**Files:**
- Modify: `decent-client-web/src/main.ts` (~line 385-475)
- Modify: `decent-client-web/src/ui/SettingsPanel.ts`

**What:** First launch = device 0. Settings shows device info. Adding second device: import seed → detect device 0 exists → prompt → use device index 1 → different peerId, same identityId.

1. Add `deviceIndex` to settings (default: 0)
2. Derive peerId from `m/3'/device/<deviceIndex>`
3. Derive identityId from `m/0'/identity/0` (stable)
4. Settings panel shows device info
5. Commit: `feat(client): device selection on startup`

---

### Task 12: Message Delivery to All Devices

**Files:**
- Modify: `decent-client-web/src/app/ChatController.ts`
- Modify: `decent-protocol/src/workspace/SyncProtocol.ts`

**What:** Send to all of Bob's devices. Dedup by message ID.

1. On send: lookup target identity's devices, send to all connected
2. On receive: resolve senderIdentityId, dedup by message ID
3. Include device list in workspace sync state
4. Commit: `feat(client): multi-device message delivery and dedup`

---

## Phase 4: DEP Spec

### Task 13: Write DEP-013 (Cryptographic Identity & Multi-Device)

**Files:**
- Create: `specs/deps/DEP-013-cryptographic-identity.md`

Formal spec covering all of the above. Should ideally be written before Phase 2 implementation — this plan serves as working draft.

---

## Execution Order & Dependencies

```
Phase 1 (anti-impersonation, ~2-3 days):
  Task 1 → Task 2 → Task 3 → Task 4

DEP:
  Task 13 (write formal spec before Phase 2)

Phase 2 (identity layer, ~2-3 days):
  Task 5 → Task 6 → Task 7 (can parallel Task 8)
  Task 8

Phase 3 (multi-device, ~3-4 days):
  Task 9 → Task 10 → Task 11 → Task 12
```

**Total estimate:** ~8-10 days

## Migration Strategy

- **Phase 1:** Backward compatible. Old clients timeout on challenges → TOFU fallback.
- **Phase 2:** `identityId` added as optional field. Auto-populates from public key on load.
- **Phase 3:** Device-announce ignored by old clients. No breaking change.
- **Breaking point:** `requireAuthentication = true` blocks old clients (flip after all updated).

## Security Properties Gained

| Threat | Before | After |
|--------|--------|-------|
| PeerId impersonation | ❌ Anyone can claim any peerId | ✅ Must match public key hash |
| Key impersonation | ⚠️ TOFU only | ✅ Challenge-response proves key ownership |
| Device spoofing | N/A | ✅ Device announce needs master key signature |
| Replay attacks | ⚠️ No nonce | ✅ Nonce + recipient peerId in challenge |
| Multi-device identity | ❌ Each device = separate user | ✅ One identityId, multiple device peerIds |
