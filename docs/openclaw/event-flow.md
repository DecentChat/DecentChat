# Event Flow

## Inbound message flow (DecentChat → OpenClaw)

1. **Peer receives transport payload**
   - `NodeXenaPeer.handlePeerMessage`
2. **Control message short-circuits**
   - handshake / sync / ack / media / name announce
3. **Encrypted payload decrypt + verify**
   - `NodeMessageProtocol.decryptMessage`
4. **Message stored in MessageStore + persisted**
   - `messageStore.addMessage` + `persistMessagesForChannel`
5. **ACK returned to sender**
6. **`onIncomingMessage(...)` callback**
7. **Relay into OpenClaw**
   - `relayInboundMessageToPeer` → `processInboundMessage`
8. **Session/thread key resolution**
   - thread derived from `threadId` or fallback `replyToId`
   - affected by `replyToMode`, `thread.historyScope`, `thread.inheritParent`
9. **Context envelope construction + session recording**
10. **OpenClaw dispatches assistant reply**

## Outbound reply flow (OpenClaw → DecentChat)

### Streaming enabled (`streamEnabled=true`)

1. `onPartialReply` receives cumulative model text
2. Relay converts cumulative → delta and accumulates full response
3. First token starts stream (`startStream` / `startDirectStream`)
4. Each update sends cumulative content via stream-delta
5. Debounced finalize emits stream-done once (`finalizePeerStream`)
6. Final non-stream send is skipped to avoid duplicates

### Streaming disabled (`streamEnabled=false`)

1. No stream-start/delta/done
2. Final reply delivered once via `sendDirectToPeer` or `sendToChannel`
3. Reply persisted as normal message

## Thread/session behavior matrix

- `replyToMode=off` → no per-thread session split
- `thread.historyScope=channel` → no per-thread session split
- otherwise thread session key suffix: `:thread:<threadId|replyToId>`
- first thread turn may bootstrap parent context from base channel session
- `thread.inheritParent=true` forces explicit `ParentSessionKey`

## Media/image flow

1. Inbound attachments metadata arrives with message
2. Relay requests full image from sender (`requestFullImage`)
3. If fetch fails, thumbnail fallback is used
4. Image buffers persisted to local temp media path (`~/.openclaw/media/inbound`)
5. Paths forwarded in OpenClaw context (`MediaPath`, `MediaPaths`)

## Reliability flow

- **Offline outbound queue:** if peer disconnected, message is queued and retried after handshake
- **Pending ACK resend:** sent messages are tracked; if no ack and reconnect occurs, envelopes are resent
- **Pending read receipt queue:** read events queued while offline and flushed on reconnect
