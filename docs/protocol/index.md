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
| Adaptive public workspace sync (shell/delta/pages) | Partially implemented (gated) |

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

## Adaptive public-workspace rollout notes

Large-workspace protocol behavior is guarded by workspace capability flags.

- Workspace gate: `large-workspace-v1` in `WorkspaceShell.capabilityFlags`
- Peer gates: `workspace-shell-v1`, `member-directory-v1` (plus helper capabilities)
- Downgrade rule: when workspace or peer gates are missing, clients must stay on legacy snapshot/workspace-state sync paths.

Migration playbook: `docs/plans/2026-03-11-public-workspace-migration.md`

## Specs and references

- `decent-protocol/spec/PROTOCOL.md`
- `decent-protocol/spec/MESSAGE-FORMAT.md`
- `decent-protocol/spec/CRYPTO.md`
- `decent-protocol/spec/SYNC.md`
- `specs/deps/`
