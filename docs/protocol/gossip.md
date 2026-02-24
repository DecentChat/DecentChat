# Gossip

## 1) What it is

Best-effort relay of workspace messages across partial meshes, so peers can still receive messages when direct links are missing.

## 2) How it works

- On receiving a workspace message, the app can relay it to other connected workspace members.
- Relayed envelopes carry original-message metadata for dedup.
- A seen-set plus hop limit (TTL) prevents replay loops.

## 3) Current implementation status

**Partially implemented**

## 4) Limitations / gaps

- Gossip is implemented in the web app controller, not as a protocol-SDK sync primitive.
- Relay is best-effort: no guaranteed fanout, no retransmit contract, no anti-entropy reconciliation tie-in.
- Scope is workspace message paths; it is not a generic transport-layer gossip subsystem.

## 5) Where in code it lives

- `decent-client-web/src/app/ChatController.ts`
