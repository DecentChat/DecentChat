# DEP-011: Message Encryption at Rest

```
Number:  DEP-011
Title:   Message Encryption at Rest
Author:  Alex + Xena
Status:  Active
Type:    Application
Created: 2026-02-21
Requires: DEP-003
```

## Abstract

Encrypt message content in IndexedDB using AES-GCM-256, with the key derived from the user's master seed phrase via HKDF-SHA-256. Messages are decrypted transparently on read. A device compromised at rest (stolen laptop, forensic analysis) exposes only ciphertext — not conversation history.

## Motivation

DecentChat messages are encrypted in transit (Double Ratchet) but stored as plaintext in IndexedDB. A compromised device reveals the full conversation history to anyone with access to the browser profile. This includes:

- Stolen laptop (unencrypted disk)
- Malicious browser extension with `storage` permission
- Forensic analysis of disk images
- Browser profile exfiltration

At-rest encryption closes this gap without requiring a separate passphrase — the existing seed phrase provides the key material.

## Specification

### Key Derivation

```
masterSeed = SeedPhrase.deriveKeys(mnemonic).masterSeed  (ArrayBuffer, 32 bytes)

hkdfKey = importKey('HKDF', masterSeed)
atRestKey = deriveKey(HKDF-SHA-256, salt=0x00…, info='decent-at-rest-v1', AES-GCM-256)
```

The `atRestKey` is non-extractable and lives only in memory. It is cleared when the app is idle/locked (future: lock screen feature).

### Storage Format

Only the `content` field of each message record is encrypted. Metadata (id, channelId, timestamp, senderId, threadId, etc.) stays plaintext for IndexedDB indexing.

**Encrypted content format:**
```
enc:v1:<base64url-iv>:<base64url-ciphertext>
```

- `v1` — format version for future migration
- `iv` — 12 random bytes (AES-GCM standard)
- `ciphertext` — AES-GCM-256 ciphertext + 16-byte auth tag

**Example:**
```
enc:v1:dGhpcyBpcyBhbiBJVg==:5Z1k8O...base64...
```

### Read Path

`PersistentStore.getChannelMessages()` checks each message's `content` field. If it starts with `enc:v1:`, it decrypts before returning. Otherwise it returns the content as-is (backward compat).

### Write Path

`PersistentStore.saveMessage()` and `saveMessages()` encrypt the `content` field before writing if the at-rest key is initialized.

### Backward Compatibility

- **Existing messages**: stored as plaintext. On first read with encryption enabled, returned as plaintext (prefix absent — legacy path). New writes are encrypted.
- **Key not available** (seed phrase missing): `encrypt()` is a no-op, `decrypt()` returns `[encrypted — unlock required]` for encrypted records.
- **Format detection**: `AtRestEncryption.isEncrypted(content)` checks for the `enc:v1:` prefix.

### Initialization

On app startup (after seed phrase is loaded):
```typescript
const derivedKeys = await spm.deriveKeys(seedPhrase);
const atRest = new AtRestEncryption();
await atRest.init(derivedKeys.masterSeed);
persistentStore.setAtRestEncryption(atRest);
```

Also called when the user restores a seed phrase (onSeedRestored callback).

## Rationale

**Why derive from master seed instead of a separate passphrase?**  
UX: users already have a seed phrase; adding a second passphrase creates friction. The seed phrase already secures the identity key pair — using it for at-rest encryption is consistent.

**Why encrypt only `content`?**  
Metadata is needed for IndexedDB indexing (channelId index, timestamp sort). Encrypting metadata would require full-table scans or a separate unencrypted index — impractical. The highest-value sensitive data is message content.

**Why AES-GCM instead of AES-CBC?**  
GCM provides authenticated encryption (detects tampered ciphertext). Same cipher already used in the transport layer. Reuses existing crypto infrastructure.

**Why HKDF with a zero salt?**  
The `masterSeed` already has high entropy (derived from 12 random words via PBKDF2). HKDF's role here is context separation (`info = 'decent-at-rest-v1'`), not entropy extraction. A zero salt is the standard choice when the input key material already has sufficient entropy.

## Security Considerations

- **Key in memory**: the `atRestKey` is a non-extractable `CryptoKey`. It cannot be serialised by JS code. However, it is recoverable via memory dump on a fully compromised machine — this is an inherent limitation of in-browser crypto.
- **Same key across sessions**: derived deterministically from seed — predictable but required for persistence. Future: add per-session salt stored in sessionStorage (cleared on browser close).
- **Metadata leakage**: channelId, timestamp, senderId are still plaintext. An attacker knows who talked to whom and when, but not what was said.
- **No re-encryption of old messages**: upgrading from v0.1.x to v0.2.x (this DEP) does not retroactively encrypt existing plaintext messages. Users concerned about this should clear local data.

## Reference Implementation

- `decent-protocol/src/storage/AtRestEncryption.ts` — encryption class
- `decent-protocol/src/storage/PersistentStore.ts` — `setAtRestEncryption()`, `saveMessage()`, `getChannelMessages()`
- `decent-client-web/src/main.ts` — init on startup

## Copyright

This document is placed in the public domain (CC0-1.0).
