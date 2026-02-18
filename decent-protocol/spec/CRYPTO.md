# DecentChat — Cryptography Specification

**Version:** 0.1.0  
**Status:** Draft

## Overview

DecentChat provides end-to-end encryption between peers with forward integrity via hash chains. All cryptographic operations use the Web Crypto API (SubtleCrypto), ensuring implementations are portable across browsers and runtimes.

## Algorithm Choices

| Purpose | Algorithm | Parameters |
|---|---|---|
| Key Exchange | ECDH | P-256 (secp256r1) |
| Message Encryption | AES-GCM | 256-bit key, 96-bit IV |
| Key Derivation | HKDF | SHA-256, 256-bit output |
| Message Integrity | SHA-256 | Hash chain linking |
| Digital Signatures | ECDSA | P-256, SHA-256 |

## 1. Key Exchange (ECDH)

### 1.1 Key Generation

Each peer generates an ECDH key pair on first launch:

```
algorithm: ECDH
namedCurve: P-256
usage: [deriveKey, deriveBits]
extractable: true (public key must be shareable)
```

The public key is exported as `spki` format, base64-encoded, for transmission.

### 1.2 Handshake

When two peers connect, they exchange public keys:

```json
{
  "type": "handshake",
  "publicKey": "<base64-encoded SPKI public key>",
  "signingKey": "<base64-encoded SPKI signing key>"
}
```

Both peers perform this exchange simultaneously. Neither peer is "initiator" or "responder" — symmetry is a design goal.

### 1.3 Shared Secret Derivation

After receiving a peer's public key:

1. **ECDH deriveBits**: Combine local private key + remote public key → raw shared secret (256 bits)
2. **HKDF extraction**: 
   ```
   algorithm: HKDF
   hash: SHA-256
   salt: empty ArrayBuffer
   info: UTF-8 encode("decent-protocol-v1")
   length: 256 bits
   ```
3. **Output**: AES-GCM CryptoKey (256-bit) for message encryption

The same shared secret is derived by both peers (ECDH property), so both can encrypt/decrypt messages to/from each other.

### 1.4 Key Storage

Keys SHOULD be persisted across sessions (IndexedDB, filesystem, etc.). Key storage is client-specific and NOT part of the protocol.

Minimum stored keys:
- Own ECDH key pair
- Own ECDSA signing key pair
- Per-peer: public key + derived shared secret

## 2. Message Encryption (AES-GCM)

### 2.1 Encryption

For each message:

1. Generate a random 96-bit (12-byte) IV
2. Encrypt plaintext with AES-GCM-256 using the shared secret
3. AES-GCM produces ciphertext + 128-bit authentication tag

```json
{
  "ciphertext": "<base64>",
  "iv": "<base64, 12 bytes>",
  "tag": "<included in ciphertext by Web Crypto>"
}
```

**Note:** Web Crypto API appends the GCM tag to the ciphertext automatically. Implementations using other libraries may need to handle tag separately.

### 2.2 Decryption

1. Import the shared secret for the sender peer
2. Decode IV from base64
3. Decrypt with AES-GCM using IV + shared secret
4. If decryption fails (tag mismatch) → message is tampered or from wrong sender

### 2.3 IV Requirements

- MUST be unique per message (random generation satisfies this)
- MUST be exactly 96 bits (12 bytes)
- MUST be transmitted alongside ciphertext (IV is not secret)
- MUST NOT be reused with the same key (catastrophic security failure)

## 3. Hash Chain Integrity

### 3.1 Purpose

Every message in a channel is linked to the previous message via a SHA-256 hash, forming an immutable chain. This provides:

- **Tamper detection**: Modifying any message breaks the chain
- **Ordering proof**: Messages have a cryptographic ordering
- **Deletion detection**: Removing a message breaks the chain

### 3.2 Hash Computation

The hash of a message is computed over its canonical fields:

```javascript
canonical = JSON.stringify({
  id: message.id,
  channelId: message.channelId,
  senderId: message.senderId,
  timestamp: message.timestamp,
  content: message.content,
  type: message.type,
  prevHash: message.prevHash
});

hash = SHA-256(UTF8_encode(canonical))
```

**Output format:** 64-character lowercase hexadecimal string.

### 3.3 Chain Rules

1. **Genesis**: The first message in any channel MUST have `prevHash` equal to the genesis hash:
   ```
   0000000000000000000000000000000000000000000000000000000000000000
   ```
   (64 zero characters)

2. **Linking**: Every subsequent message MUST set `prevHash = SHA-256(canonical(previous_message))`

3. **Verification**: A chain is valid if and only if:
   - First message has genesis prevHash
   - For every message N (where N > 0): `message[N].prevHash === SHA-256(canonical(message[N-1]))`

4. **Immutability**: Messages MUST NOT be edited or deleted. The hash chain enforces this — any modification breaks verification.

### 3.4 Verification Failure

If chain verification fails, the implementation MUST:
1. Report the index of the broken link
2. Reject the entire message set (do not partially accept)
3. Optionally: request re-sync from another peer

## 4. Digital Signatures (ECDSA)

### 4.1 Signing Key

Separate from the ECDH key pair. Each peer generates an ECDSA key pair:

```
algorithm: ECDSA
namedCurve: P-256
hash: SHA-256
usage: [sign] (private), [verify] (public)
```

### 4.2 Message Signing

Messages SHOULD be signed by the sender:

```
signature = ECDSA-sign(privateKey, SHA-256(canonical(message)))
```

The signature is base64-encoded and included in the message envelope.

### 4.3 Verification

Recipients verify signatures using the sender's public signing key (received during handshake). Verification failure indicates either:
- Message was not sent by the claimed sender (impersonation)
- Message was modified in transit

## 5. Security Properties

| Property | Provided | Mechanism |
|---|---|---|
| Confidentiality | ✅ | AES-GCM encryption |
| Integrity | ✅ | GCM auth tag + hash chain |
| Authentication | ✅ | ECDSA signatures + ECDH shared secrets |
| Non-repudiation | ✅ | ECDSA signatures |
| Tamper detection | ✅ | Hash chain |
| Replay detection | ✅ | Unique message IDs + timestamps + hash chain |
| Forward secrecy | ❌ | Not in v0.1 (planned: Double Ratchet in v0.2) |

## 6. Future: Double Ratchet (v0.2)

Version 0.2 will add forward secrecy via key ratcheting:
- Each message uses a fresh encryption key
- Compromising one key does not expose past or future messages
- Based on Signal Protocol's Double Ratchet algorithm, adapted for P2P (3-DH instead of X3DH)

## 7. Implementation Notes

- All base64 encoding uses standard base64 (not URL-safe)
- JSON serialization for hashing MUST use `JSON.stringify` with keys in the exact order specified (id, channelId, senderId, timestamp, content, type, prevHash)
- Implementations MUST use constant-time comparison for hash/signature verification where available
- Key material SHOULD be stored in non-extractable CryptoKey objects when possible
