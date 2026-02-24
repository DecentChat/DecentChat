# Identity / Seed

## 1) What it is

Identity and recovery primitives based on a 12-word seed phrase, ECDH identity keys, and ECDSA signing keys.

## 2) How it works

- `SeedPhraseManager` can generate and validate a mnemonic, derive key material, and derive a deterministic peer ID.
- `IdentityManager` can create an identity object and export/import encrypted identity bundles.
- On web app startup, the app derives `peerId` from the stored seed phrase and uses that as the canonical peer ID.

## 3) Current implementation status

**Partially implemented**

## 4) Limitations / gaps

- Startup still loads or generates messaging keypairs from `KeyStore`; those keys are not currently derived from seed phrase material.
- Seed-derived key material is used for peer ID derivation and at-rest encryption key derivation, but not as the sole source of long-term messaging identity keys.
- The `IdentityManager` export/import flow exists, but is not the main runtime identity path used by the web app bootstrap.

## 5) Where in code it lives

- `decent-protocol/src/identity/SeedPhrase.ts`
- `decent-protocol/src/identity/Identity.ts`
- `decent-client-web/src/main.ts`
- `decent-protocol/src/crypto/KeyStore.ts`
