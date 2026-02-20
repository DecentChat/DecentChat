# DEP-004: Application Heartbeat Protocol

```
Number:  DEP-004
Title:   Application Heartbeat Protocol
Author:  Alex + Xena
Status:  Active
Type:    Transport
Created: 2026-02-20
Requires: DEP-002
```

## Abstract

Define an application-level ping/pong heartbeat on each WebRTC data channel with a 30-second interval. This enables fast detection of silent connection drops that WebRTC's built-in ICE keepalive misses, and triggers automated recovery (ICE restart or reconnection).

## Motivation

WebRTC's native ICE keepalive (`iceKeepAliveTimeout`) uses STUN binding requests at the transport layer. In practice:

- Default intervals are too long (15–30 seconds) and the timeout before declaring failure can exceed 60 seconds.
- Network transitions (Wi-Fi → cellular, sleep/wake, VPN toggling) can silently break the DTLS/SCTP layer while ICE reports the connection as alive.
- PeerJS does not expose ICE connection state changes reliably across all browsers.

The result: peers appear connected but data channels are dead, and neither side detects the failure for minutes. An application-level heartbeat detects these silent drops within 40 seconds (30s interval + 10s timeout) and triggers recovery.

## Specification

### Message Format

```typescript
interface HeartbeatPing {
  type: 'heartbeat:ping';
  ts: number;  // Date.now() of the sender
}

interface HeartbeatPong {
  type: 'heartbeat:pong';
  ts: number;  // Echoes the ping ts (for RTT measurement)
}
```

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `PING_INTERVAL_MS` | 30,000 | Time between pings per peer |
| `PONG_TIMEOUT_MS` | 10,000 | Max wait for a pong reply |

### Sender Behavior

1. After a data channel enters the `connected` state, start a repeating interval timer for that peer.
2. Every `PING_INTERVAL_MS`, send a `heartbeat:ping` with `ts = Date.now()`.
3. Start a one-shot `PONG_TIMEOUT_MS` timer.
4. On receiving `heartbeat:pong` whose `ts` matches the pending ping, cancel the timeout. The peer is alive.

### Receiver Behavior

1. On receiving `heartbeat:ping`, immediately reply with `heartbeat:pong` echoing the same `ts`.
2. No state tracking required on the receiver side.

### Timeout / Recovery

If no pong arrives within `PONG_TIMEOUT_MS`:

1. **ICE Restart (preferred):** Call `conn.peerConnection.restartIce()` if the underlying `RTCPeerConnection` is accessible. This attempts to re-establish connectivity without tearing down the data channel.
2. **Reconnect (fallback):** If ICE restart is unavailable or the `RTCPeerConnection` is not exposed, close the connection. The existing auto-reconnect mechanism (DEP-002 backoff) will handle reconnection.

### Network Change Events

On browser events that indicate network state changes:

- `online` (window)
- `offline` (window)
- `visibilitychange` (document, when transitioning to `visible`)

The heartbeat manager should:

1. Immediately send a `heartbeat:ping` to all connected peers (resets the interval).
2. This accelerates detection after sleep/wake or network transitions.

### Message Interception

Heartbeat messages (`heartbeat:ping` and `heartbeat:pong`) are **transport-internal control messages**. They MUST NOT be forwarded to the application `onMessage` callback. The transport layer intercepts and handles them before any application-level processing.

### Cleanup

When a peer disconnects (by any means), stop the heartbeat interval and clear any pending pong timeout for that peer.

## Rationale

**Why 30 seconds?**
- Balances battery/bandwidth cost against detection speed.
- 30s + 10s timeout = 40s worst-case detection, vs 2–5 minutes with native ICE keepalive.
- Low enough overhead: 2 small JSON messages per peer per 30s (~100 bytes/msg).

**Why application-level instead of relying on SCTP heartbeats?**
- SCTP heartbeats are not configurable in the browser.
- PeerJS does not expose SCTP-level events.
- Application-level pings also validate that the PeerJS data channel serialization layer is functional.

**Why echo `ts` in pong?**
- Enables RTT measurement (for future latency-aware routing).
- Prevents stale pong replies from a previous ping from being misinterpreted.

**Alternatives considered:**
- **WebRTC `getStats()` polling:** Unreliable across browsers, high overhead.
- **Shorter ping interval (5s):** Too aggressive for mobile devices.
- **Longer timeout (30s):** Defeats the purpose — no improvement over native keepalive.

## Backward Compatibility

- Peers that do not implement DEP-004 will ignore `heartbeat:ping` messages (unknown type handling is already enforced by the message guard).
- Peers that do not reply with `heartbeat:pong` will trigger the timeout path, resulting in a reconnect attempt — this is the desired behavior for peers that have silently dropped.
- No protocol version bump required.

## Reference Implementation

**Files:**
- `decent-transport-webrtc/src/PeerTransport.ts` — Heartbeat manager integrated into connection lifecycle

## Security Considerations

**Ping flood:**
- A malicious peer could flood `heartbeat:ping` messages.
- Mitigation: The `MessageGuard` rate limiter applies to all incoming messages, including heartbeat pings.

**Timing side-channel:**
- RTT measurements from pong replies could reveal network topology.
- Acceptable: This information is already available via `RTCPeerConnection.getStats()`.

## Test Vectors

### Scenario 1: Normal heartbeat cycle
```
T=0s:   Alice connects to Bob
T=0s:   Alice starts heartbeat interval
T=30s:  Alice sends heartbeat:ping {ts: 1708000030000}
T=30.1s: Bob receives ping, sends heartbeat:pong {ts: 1708000030000}
T=30.2s: Alice receives pong, clears timeout
T=60s:  Next ping cycle
```

### Scenario 2: Silent drop detected
```
T=0s:   Alice connected to Bob
T=30s:  Alice sends heartbeat:ping
        (Bob's network dropped at T=25s)
T=40s:  Pong timeout fires
T=40s:  Alice calls restartIce() or closes connection
T=40s:  Auto-reconnect kicks in
```

### Scenario 3: Network change recovery
```
T=0s:   Alice on Wi-Fi, connected to Bob
T=15s:  Alice switches to cellular
T=15s:  Browser fires 'online' event
T=15s:  Alice immediately pings all peers
T=15.1s: Bob pongs — connection is alive
```

## References

- WebRTC ICE keepalive: RFC 8445 §11
- PeerJS DataConnection API: https://peerjs.com/docs/#dataconnection
- DEP-002: Peer Exchange for signaling server discovery

## Copyright

This document is placed in the public domain (CC0-1.0).
