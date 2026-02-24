# Delivery ACK

## 1) What it is

Per-recipient delivery/read receipts used to drive message status (sent, delivered, read) in the UI.

## 2) How it works

- Sender stores recipient snapshot at send-time.
- Receiver sends `ack` when a message is accepted and `read` when message becomes visible.
- Sender validates inbound receipts and updates status counters/ticks.

## 3) Current implementation status

**Partially implemented**

## 4) Limitations / gaps

- Receipt signaling is best-effort and transport-dependent (no hard delivery guarantee).
- No dedicated receipt retransmission protocol when receipt packets are lost.
- Receipt handling is app-layer logic in `ChatController`, not a dedicated `decent-protocol` module.

## 5) Where in code it lives

- `decent-client-web/src/app/ChatController.ts`
- `decent-client-web/src/ui/UIRenderer.ts`
- `decent-client-web/src/ui/styles/main.css`
