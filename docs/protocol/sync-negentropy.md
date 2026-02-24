# Sync / Negentropy

## 1) What it is

Workspace membership/channel state sync plus message catch-up between peers. Runtime catch-up uses Negentropy reconciliation when both peers advertise support, and falls back to timestamp-based sync for compatibility.

## 2) How it works

- `SyncProtocol` handles join, join-accepted/rejected, channel/member events, sync-request, and sync-response.
- Web app runtime also uses `workspace-state` and `message-sync-request/response` flows for reconnect catch-up.
- Runtime catch-up path:
  - handshake advertises `negentropy-sync-v1` capability
  - peers reconcile per-channel message IDs via Negentropy query/response
  - requester fetches only missing message IDs
  - if capability negotiation/reconciliation fails, runtime falls back to timestamp sync
- `Negentropy` remains available as the protocol-SDK reconciliation primitive for set-difference sync.

## 3) Current implementation status

**Implemented with compatibility fallback**

## 4) Limitations / gaps

- Runtime Negentropy currently targets reconnect/message catch-up in `ChatController`; other sync surfaces may still use non-negentropy flows.
- Timestamp-based catch-up remains as a compatibility fallback path.
- Some sync flows intentionally omit plaintext content and therefore skip full-chain content verification on import.

## 5) Where in code it lives

- `decent-protocol/src/workspace/SyncProtocol.ts`
- `decent-client-web/src/app/ChatController.ts`
- `decent-protocol/src/crdt/Negentropy.ts`
- `decent-protocol/tests/unit/negentropy.test.ts`
