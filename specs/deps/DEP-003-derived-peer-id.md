# DEP-003: Derived Peer ID from Seed Phrase

```
Number:  DEP-003
Title:   Derived Peer ID from Seed Phrase
Author:  Alex + Xena
Status:  Active
Type:    Core
Created: 2026-02-19
Updated: 2026-02-19
Requires: DEP-000
```

## Abstract

This DEP makes DecentChat peer IDs deterministic and cryptographically bound to the seed phrase identity. Instead of relying on randomly assigned PeerJS IDs, clients derive a stable 18-character hex peer ID from the seed phrase's ECDH public key material.

This closes an impersonation gap where transport-level identity (PeerJS ID) was not tied to cryptographic identity (seed phrase -> keypair). With DEP-003, the same seed phrase always yields the same peer ID across devices.

## Motivation

Current behavior uses random PeerJS IDs (UUID-like or server-assigned), which are not tied to the seed phrase and can be changed arbitrarily. This enables straightforward impersonation at the transport identifier layer.

We need a deterministic commitment so:
- Seed phrase is the root of identity.
- Peer ID is reproducible across devices and reinstalls.
- Changing peer ID requires changing key material.

## Specification

### Derivation Algorithm

Input: 12-word seed phrase.

1. Validate mnemonic.
2. Derive master seed via PBKDF2-SHA256:
   - Password: UTF-8 seed phrase
   - Salt: `decent-protocol-seed-v1`
   - Iterations: `100000`
   - Output: 64 bytes
3. Derive ECDH private scalar bytes via HKDF-SHA256:
   - Info: `mesh-ecdh-key-v1`
   - Salt: empty
   - Output: 32 bytes
4. Import deterministic P-256 ECDH key pair (existing `SeedPhraseManager` flow).
5. Export ECDH public key as SPKI bytes.
6. Compute `SHA-256(spkiBytes)`.
7. Take first 9 bytes (72 bits).
8. Hex encode lowercase to produce 18-character peer ID.

### API

Add:

```ts
derivePeerId(seedPhrase: string): Promise<string>
```

to `SeedPhraseManager`.

### Startup Reconciliation

On app startup:
- If a seed phrase exists, derive peer ID via DEP-003.
- Use this derived value as canonical for transport initialization.
- If stored `settings.myPeerId` differs from derived value, overwrite stored value with derived/canonical ID.

### Invite URI Generation

Invite links must use the current canonical peer ID (`state.myPeerId`), now deterministic under seed phrase mode.

### PeerJS Compatibility

PeerJS IDs accept short ASCII identifiers. DEP-003 output is:
- lowercase hex only `[0-9a-f]`
- fixed length 18 chars

This is PeerJS-compatible and URL-safe without additional encoding.

## Rationale

- Hashing SPKI (not mnemonic text directly) commits to the actual transport public key.
- 72-bit truncated identifier is short enough for UX while preserving negligible random-collision probability in real deployments.
- Reusing existing key derivation path avoids parallel identity pipelines and drift.

Alternatives considered:
- Full 64-char SHA-256 hex: strong but too verbose for UX.
- Random IDs + signed binding: adds handshake complexity and migration burden.
- Hashing mnemonic string directly: weaker coupling to active key material.

## Backward Compatibility

This is a behavioral identity change for users with seed phrases:
- Existing stored random peer IDs are replaced by derived IDs at startup.
- Existing invites containing old random IDs become stale.
- Re-pairing/re-invite is required.

This is acceptable for current stage because there are no real production users yet.

## Reference Implementation

Implemented in this repository:
- `decent-protocol/src/identity/SeedPhrase.ts` (`derivePeerId`)
- `decent-client-web/src/main.ts` (startup canonicalization to derived peer ID)
- `decent-client-web/src/commands/registerCommands.ts` (invite uses canonical generator path)
- `decent-protocol/tests/unit/seed-phrase.test.ts` (DEP-003 vectors)

## Security Considerations

- Impersonation resistance improves because peer IDs are commitments to seed-derived public keys.
- Attackers can no longer pick arbitrary peer IDs while keeping different seed/key material.
- Collisions:
  - Output space is 72 bits.
  - Accidental collisions are highly unlikely at DecentChat scale.
  - This is an identifier commitment, not a standalone authentication primitive.
- Seed phrase confidentiality remains critical: seed compromise implies full identity compromise, including deterministic peer ID.

## Test Vectors

Using current `SeedPhraseManager` implementation:

1. `attitude modify quote style debate search blouse crumble explain silly memory wheat`
   - peer ID: `698c9749f0552f151f`
2. `dawn summer salmon cute apology drop just letter cruel canal key bronze`
   - peer ID: `b13332faa592c7c01c`
3. `profit primary erase year more trust broccoli same nasty accident emerge verify`
   - peer ID: `3744b357105b3cdba1`

## References

- DEP-000 process: `specs/deps/DEP-000.md`
- Web Crypto API PBKDF2/HKDF
- SEC 1 / PKCS#8 / SPKI encodings for EC keys

## Copyright

This document is placed in the public domain (CC0-1.0).
