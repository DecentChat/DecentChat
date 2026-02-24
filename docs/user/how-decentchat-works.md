# How DecentChat Works

DecentChat is a **decentralized, end-to-end encrypted, peer-to-peer chat**.

## No central chat server

Messages are exchanged directly between peers over transport (currently WebRTC).

That means:
- no single database with all chats
- no central authority owning your identity
- no mandatory cloud account

## Identity = seed phrase

Your 12-word seed phrase deterministically generates your cryptographic keys.

- same seed => same identity on any device
- lose seed => lose identity recovery

## End-to-end encryption

Messages are encrypted so only intended participants can read them.

Core cryptography includes:
- ECDH key exchange
- AES-GCM encryption
- digital signatures

## Why chats still sync without a server

DecentChat uses data structures/protocols designed for distributed systems:

- **CRDTs**: replicas converge even after offline edits
- **Vector clocks**: preserve causal order between events
- **Negentropy set reconciliation**: peers compare set summaries and exchange only missing data
- **Range fingerprinting**: efficient state comparison and minimal delta exchange

Result: devices can go offline, reconnect later, and converge.

## Message integrity

History integrity uses hash-linked message structures to detect tampering.

## Practical decentralization model

DecentChat is decentralized at the messaging/state layer. Some helper infrastructure (e.g., signaling/bootstrap paths) can still exist, but does not become a plaintext message authority.
