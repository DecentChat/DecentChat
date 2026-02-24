# Protocol

This section tracks DecentChat protocol features against the current codebase.

Status labels used in these pages:

- `fully implemented`: implemented and wired in normal runtime paths
- `partially implemented`: implemented in some paths, but with important gaps/limits
- `planned`: specified or scaffolded, but not wired for real runtime use

## Feature status snapshot

| Feature | Status |
| --- | --- |
| Identity / seed | Partially implemented |
| Crypto | Partially implemented |
| Sync / negentropy | Partially implemented |
| CRDT / vector clocks | Partially implemented |
| Hash chain integrity | Partially implemented |
| Gossip | Partially implemented |
| Delivery ACK | Partially implemented |
| At-rest encryption | Partially implemented |
| Invites | Partially implemented |

## Protocol feature pages

- [Identity / seed](./identity-seed)
- [Crypto](./crypto)
- [Sync / negentropy](./sync-negentropy)
- [CRDT / vector clocks](./crdt-vector-clocks)
- [Hash chain integrity](./hash-chain-integrity)
- [Gossip](./gossip)
- [Delivery ACK](./delivery-ack)
- [At-rest encryption](./at-rest-encryption)
- [Invites](./invites)

## Specs and references

- `decent-protocol/spec/PROTOCOL.md`
- `decent-protocol/spec/MESSAGE-FORMAT.md`
- `decent-protocol/spec/CRYPTO.md`
- `decent-protocol/spec/SYNC.md`
- `specs/deps/`
