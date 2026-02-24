# Crypto

## 1) What it is

Peer-to-peer message confidentiality and authenticity using ECDH key agreement, AES-GCM encryption, ECDSA signatures, and Double Ratchet state.

## 2) How it works

- Peers exchange handshake data with ECDH public key, signing key, and protocol version.
- The app derives per-peer shared secrets for legacy encryption compatibility.
- When ratchet state exists, messages are encrypted with Double Ratchet (`protocolVersion: 2`).
- Messages are signed and signatures are verified on decrypt.

## 3) Current implementation status

**Partially implemented**

## 4) Limitations / gaps

- Metadata fields (for example channel/workspace routing fields) are sent outside encrypted payloads.
- Legacy non-ratchet fallback is still active for compatibility.
- Security model is online-handshake based (no X3DH-style offline prekey flow).
- Verification is strong for message signatures, but key trust still relies on local state and handshake validation logic rather than a full cross-device trust UX.

## 5) Where in code it lives

- `decent-client-web/src/messages/MessageProtocol.ts`
- `decent-protocol/src/crypto/DoubleRatchet.ts`
- `decent-protocol/src/crypto/CryptoManager.ts`
- `decent-protocol/src/crypto/MessageCipher.ts`
- `decent-protocol/src/security/HandshakeVerifier.ts`
