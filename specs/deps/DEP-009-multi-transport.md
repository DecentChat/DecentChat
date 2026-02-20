# DEP-009: Multi-Transport Fallback

```
Number:  DEP-009
Title:   Multi-Transport Fallback
Author:  Alex + Xena
Status:  Draft
Type:    Transport
Created: 2026-02-21
```

## Abstract

Enable peers to communicate even when WebRTC is unavailable by automatically falling back to WebSocket relay and, as a last resort, HTTP long-polling. A transport negotiation handshake selects the best available transport for each peer pair.

## Motivation

WebRTC requires successful ICE negotiation, which fails in ~15% of real-world environments (deep symmetric NAT, enterprise firewalls with UDP blocked, aggressive mobile carrier NAT). TURN mitigates most cases but adds latency and requires server infrastructure. Some environments block TURN too.

A multi-transport architecture ensures a viable communication channel exists in all network conditions.

## Specification

### Transport Priority

```
1. WebRTC (lowest latency, true P2P, no server after establishment)
2. WebSocket relay (requires always-on relay server, low latency)
3. HTTP long-poll (works through any proxy, highest latency)
```

### Transport Capability Advertisement

Peers include their supported transports in the handshake:

```typescript
interface TransportCapabilities {
  webrtc: true;         // always supported
  wsRelay?: string[];   // list of relay URLs that can forward for this peer
  httpPoll?: string;    // polling endpoint (relay server must proxy)
}
```

### WebSocket Relay Protocol

The relay server opens a named inbox per peerId:
```
WS → relay.example.com/ws/:myPeerId
  ← { type: 'envelope', from: 'alicePeerId', data: <same JSON format as WebRTC> }
  → { type: 'send', to: 'bobPeerId', data: <envelope> }
```

The relay is end-to-end encrypted (same envelope format, just different transport). The relay server sees ciphertext only.

### Transport Negotiation

1. Alice initiates WebRTC connection to Bob via signaling server (existing flow).
2. If ICE fails after 15s timeout, Alice checks Bob's `wsRelay` capability.
3. Alice connects to a shared relay URL and establishes a WebSocket channel to Bob.
4. Both peers send subsequent messages via the WebSocket channel.
5. WebRTC re-attempt every 30s in background; promoted back if successful.

### HTTP Long-Poll Fallback

Only used when WebSocket is also unavailable (very restrictive proxies):
- Alice POSTs messages to relay: `POST /messages/:toBobId { from, encrypted }`
- Bob polls for messages: `GET /messages/:bobId?after=<timestamp>`
- Poll interval: 5s idle, 1s active (when messages seen recently)

### Transport Abstraction

The `Transport` interface in `decent-protocol` already abstracts `send()` and `onMessage`. `PeerTransport` implements it for WebRTC. New implementations:
- `WSRelayTransport` — WebSocket relay
- `PollTransport` — HTTP long-poll

`MultiTransport` wraps these with fallback logic.

## Rationale

**Why WebSocket relay before HTTP poll?** WebSocket supports server-push, enabling real-time delivery without polling overhead. HTTP poll is a last resort for deeply restrictive environments (HTTPS-only proxies).

**Why keep WebRTC in the loop?** P2P is always preferred. WebSocket relay adds latency and relay server dependency. Once WebRTC succeeds, relay overhead disappears.

## Implementation Status

**DEFERRED** — requires:
1. Relay server with WebSocket and HTTP endpoints
2. `WSRelayTransport` and `PollTransport` implementations
3. `MultiTransport` orchestrator
4. Transport capability exchange in handshake

Estimated effort: 3–4 weeks. Target: v0.4.0.

## Copyright

This document is placed in the public domain (CC0-1.0).
