# DEP-005: Message Delivery Acknowledgment

```
Number:  DEP-005
Title:   Message Delivery Acknowledgment
Author:  Alex + Xena
Status:  Active
Type:    Protocol
Created: 2026-02-20
```

## Abstract

Define an application-level delivery acknowledgment (ACK) so that message senders know when their message has been received and persisted by a recipient. This enables UI indicators showing message delivery status (sent vs. delivered).

## Motivation

Currently, when a user sends a message, the UI shows it immediately (optimistic local insert) but has no feedback on whether the recipient actually received it. This is confusing in P2P networks where:

- The recipient may have silently disconnected.
- The message may be queued in the offline queue but never delivered.
- WebRTC `send()` returning `true` only means the data channel accepted the data — not that the remote peer processed it.

With delivery ACKs, the sender gets confirmation that the message was received and persisted, enabling a familiar messaging UX: single checkmark (sent) → double checkmark (delivered).

## Specification

### Message Format

```typescript
interface DeliveryAck {
  type: 'ack';
  messageId: string;   // ID of the message being acknowledged
  channelId: string;   // Channel the message belongs to
}
```

### Sender Behavior

1. When a message is sent, its `status` field is set to `'sent'`.
2. On receiving an `ack` for that message:
   - Update the in-memory message status from `'sent'` to `'delivered'`.
   - Persist the status update to IndexedDB.
   - Re-render the message in the UI to show the delivery indicator.
3. If no `ack` arrives within 30 seconds, the message remains `'sent'`. No retry is attempted — message retry is handled by the offline queue (DEP-002).

### Receiver Behavior

1. After successfully receiving, decrypting, and persisting a user message, send an `ack` back to the sender.
2. The `ack` is sent using the transport's `send()` method (unencrypted control message, not passed through the encryption pipeline).

### Message Status Lifecycle

```
'pending' → 'sent' → 'delivered'
     │
     └── Message created locally, not yet transmitted
              │
              └── Transmitted via transport.send() or queued
                       │
                       └── ACK received from recipient
```

### UI Indicators

| Status | Indicator | Description |
|--------|-----------|-------------|
| `pending` | (none) | Message being composed or queued |
| `sent` | ✓ | Message sent to peer (or queued) |
| `delivered` | ✓✓ | Recipient confirmed receipt |

### Message Interception

`ack` messages are **control messages**. They MUST be handled before the encrypted message decryption pipeline in the `onMessage` handler. They do not carry encrypted content and should not be passed to `MessageProtocol.decryptMessage()`.

### Existing Type Support

The `PlaintextMessage` and `ChatMessage` interfaces already include the `status` field with type `'pending' | 'sent' | 'delivered'`. No type changes are required.

## Rationale

**Why not use WebRTC data channel `bufferedAmount`?**
- It only indicates local buffer state, not remote receipt.
- No guarantee the remote application processed the message.

**Why no retry on missing ACK?**
- Message delivery retries are already handled by the offline queue.
- Adding a separate ACK-based retry would create duplicate delivery complexity.
- The ACK is purely informational for the sender's UI.

**Why a separate `ack` type instead of extending existing messages?**
- Keeps the control plane separate from the data plane.
- ACKs are small (no content to encrypt) and frequent — separate handling avoids unnecessary crypto overhead.

**Why not end-to-end encrypt ACKs?**
- ACKs contain only message IDs and channel IDs, which are not sensitive.
- Encrypting them would require a ratchet step per ACK, wasting forward-secrecy chain keys.
- The transport layer (WebRTC DTLS) already provides encryption in transit.

## Backward Compatibility

- Peers that do not implement DEP-005 will not send ACKs. Messages from those peers will remain in `'sent'` status indefinitely — this is functionally identical to the current behavior.
- Peers that do not understand `ack` messages will ignore them (unknown type handling).
- No protocol version bump required.

## Reference Implementation

**Files:**
- `decent-client-web/src/app/ChatController.ts` — ACK send/receive in message handler

## Security Considerations

**ACK spoofing:**
- A malicious peer could send ACKs for messages they never received.
- Mitigation: ACKs are only processed from peers with an established encrypted connection (post-handshake). The `messageId` must correspond to an existing sent message.

**ACK flood:**
- A peer could flood ACKs to waste processing.
- Mitigation: The `MessageGuard` rate limiter applies. ACK processing is O(1) per message (lookup by ID).

**Privacy:**
- ACKs reveal that a message was read/stored (delivery receipt).
- Acceptable: This is standard messaging behavior. A future DEP could add opt-out for delivery receipts.

## Test Vectors

### Scenario 1: Normal delivery acknowledgment
```
T=0s: Alice sends message {id: "msg-1", channelId: "ch-1"} to Bob
      Alice's message status: 'sent'
T=0.1s: Bob receives, decrypts, and persists the message
T=0.1s: Bob sends {type: 'ack', messageId: 'msg-1', channelId: 'ch-1'} to Alice
T=0.2s: Alice receives ACK, updates msg-1 status to 'delivered'
        UI shows ✓✓
```

### Scenario 2: Peer offline — no ACK
```
T=0s: Alice sends message to Bob (Bob is offline)
      Message queued in offline queue
      Alice's message status: 'sent'
T=30s: No ACK received — status stays 'sent'
       UI shows ✓
T=5m: Bob comes online, receives queued message
T=5m: Bob sends ACK
T=5m: Alice updates status to 'delivered'
```

### Scenario 3: Old peer without ACK support
```
T=0s: Alice sends message to Charlie (old client)
      Alice's message status: 'sent'
      Charlie receives and processes message but sends no ACK
      Alice's status stays 'sent' — same as current behavior
```

## References

- Signal Protocol delivery receipts: https://signal.org/docs/
- Matrix read receipts: https://spec.matrix.org/latest/client-server-api/#receipts
- WhatsApp message ticks: blue/grey tick system

## Copyright

This document is placed in the public domain (CC0-1.0).
