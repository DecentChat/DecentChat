# DEP-007: Workspace Snapshot Protocol

```
Number:  DEP-007
Title:   Workspace Snapshot Protocol
Author:  Alex + Xena
Status:  Draft
Type:    Protocol
Created: 2026-02-20
Requires: DEP-001
```

## Abstract

Replace the full `messageHistory` payload in `join-accepted` with a compact workspace snapshot combined with Negentropy (DEP-001) delta sync. New joiners receive only the messages they are missing — O(diff) bytes instead of O(total) bytes — dramatically improving join performance for workspaces with long history.

## Motivation

**Current problem:**  
When a new peer joins, the existing peer sends the full `messageHistory: Record<string, any[]>` — every encrypted message in every channel, for every channel. For a workspace with 50,000 messages this means hundreds of megabytes transferred over WebRTC, taking 30–60+ seconds on typical connections. The joiner also has to process and store all of it before they can chat.

**With workspace snapshot + Negentropy:**
1. Existing peer sends a compact snapshot: channel list + member list + message count + head hash per channel.
2. New joiner compares the snapshot against their local state (empty on first join, partial on reconnect).
3. New joiner initiates a Negentropy set-reconciliation exchange per channel to request only missing messages.
4. Only the diff is transferred — O(differences), not O(total).

**Benefits:**
- First join of an empty client: transfers only the metadata + latest N messages (configurable "fast-start" window), then lazily syncs older history in background.
- Reconnect after going offline: transfers only messages missed during the offline period.
- Large workspaces become practical.

## Specification

### Snapshot Message

Replaces `messageHistory` in `join-accepted`:

```typescript
interface WorkspaceSnapshot {
  type: 'workspace-snapshot';
  workspaceId: string;
  snapshotVersion: 1;
  /** Compact channel summary — no message content */
  channels: ChannelSummary[];
  /** Full member list (same as before) */
  members: WorkspaceMember[];
  /** Timestamp when this snapshot was generated */
  snapshotAt: number;
}

interface ChannelSummary {
  id: string;
  name: string;
  type: 'channel' | 'dm';
  /** Total number of messages in this channel (for UI display) */
  messageCount: number;
  /** SHA-256 hash of the most recent message in the chain */
  headHash: string;
  /** Negentropy fingerprint of the full message set (DEP-001 format) */
  negentropyFingerprint: string;
  /** Timestamp of most recent message (for quick "nothing new" check) */
  lastMessageAt: number;
}
```

### Updated `join-accepted` Shape

```typescript
// Old (deprecated):
{ type: 'join-accepted'; workspace: Workspace; messageHistory: Record<string, any[]>; pexServers?: PEXServer[] }

// New (snapshotVersion: 1):
{ type: 'join-accepted'; workspace: Workspace; snapshot: WorkspaceSnapshot; pexServers?: PEXServer[] }
```

### Snapshot-Based Sync Flow

```
Alice (new joiner)                    Bob (existing peer)
       |                                      |
       |--- join-request ------------------>  |
       |                                      |
       |<-- join-accepted (snapshot) ------   |
       |    { workspace, snapshot, pexServers }
       |                                      |
       |  [Alice compares local vs snapshot]  |
       |                                      |
       | (for each channel with diff):        |
       |--- sync-request (negentropy init) -> |
       |<-- sync-response (negentropy diff)   |
       |--- sync-ack (negentropy complete) -> |
       |                                      |
       |  [Alice inserts received messages]   |
       |  [UI shows channel as ready]         |
```

### Fast-Start Window

For first-time joiners (empty local state), requesting the full history via Negentropy may be slow for large workspaces. The sender SHOULD include the most recent `FAST_START_COUNT` (default: 100) messages per channel directly in the `sync-response`, even before Negentropy completes. This gives the joiner something to see immediately.

```typescript
interface SyncResponse {
  type: 'sync-response';
  channelId: string;
  workspaceId: string;
  /** Negentropy protocol message (DEP-001) */
  negentropy?: string;
  /** Fast-start: last N messages for immediate display */
  recentMessages?: EncryptedMessage[];
  /** Whether full sync is complete */
  done: boolean;
}
```

### Lazy Background Sync

After displaying recent messages (fast-start), the joiner requests older messages in batches in the background — lowest priority, doesn't block the UI. Batch size: 500 messages per request. Oldest channels synced last.

### Reconnect Optimisation

A peer reconnecting after a brief offline period:
1. Has existing local state.
2. Sends `sync-request` with their local Negentropy state immediately (skip `join-request`).
3. Receives only messages missed during offline window.

### Backward Compatibility

- Peers check for `snapshot` field in `join-accepted`. If absent (old peer), fall back to processing `messageHistory` as before.
- `snapshotVersion: 1` — future snapshot format changes increment this.
- Old peers receiving a snapshot-based `join-accepted` (sent to them by a new peer) will ignore unknown fields gracefully.

Migration path:
- v0.1.x: full `messageHistory` (current)
- v0.2.0: snapshot + Negentropy delta (this DEP) — both formats supported
- v0.3.0: `messageHistory` removed, snapshot only

## Rationale

**Why Negentropy instead of just "send messages after timestamp X"?**  
Negentropy handles the general case: partial sync, reordered messages, history gaps from network splits. Timestamp-based sync misses messages that arrived out-of-order. Negentropy gives a provably correct set diff in O(log n) rounds.

**Why a separate snapshot message instead of embedding in join-accepted?**  
Keeps the message size predictable (snapshot is always compact). The full sync happens asynchronously via separate `sync-request`/`sync-response` exchanges, allowing progressive rendering.

**Why 100-message fast-start?**  
Most users only ever read recent messages. 100 messages covers typical session history. Full sync happens in background without blocking the UI.

## Security Considerations

- **Snapshot integrity**: The `headHash` allows the receiver to verify that the messages they receive form a valid chain anchored to the known head. Gaps or substitutions are detectable.
- **Negentropy fingerprint forgery**: The Negentropy fingerprint is a hash of message IDs — a malicious peer providing a wrong fingerprint will cause incorrect sync, but cannot inject new messages (signature verification catches that).
- **Withholding attack**: A malicious existing peer can refuse to send certain messages. This is mitigated by requesting the same channel from multiple connected peers.

## Implementation Status

**DEFERRED** — requires:
1. Negentropy integration into the active sync flow (currently DEP-001 is implemented but not wired into `join-accepted`)
2. Fast-start message rendering (partial channel load)
3. Background sync scheduler
4. Migration from `messageHistory` to `snapshot`

Estimated effort: 2–3 weeks. Target: v0.2.0.

## References

- [DEP-001: Negentropy Set Reconciliation](./DEP-001.md)
- [Negentropy Protocol](https://github.com/hoytech/negentropy)
- [Signal's Sealed Sender](https://signal.org/blog/sealed-sender/) (inspiration for snapshot metadata approach)

## Copyright

This document is placed in the public domain (CC0-1.0).
