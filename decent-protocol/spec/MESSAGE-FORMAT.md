# DecentChat — Message Format Reference

**Version:** 0.1  
**Status:** Draft

This document defines the JSON schemas for all wire messages in the decent protocol. All messages are transmitted as UTF-8 encoded JSON objects over the transport layer (after the handshake is complete, messages are AES-256-GCM encrypted; the outer transport payload carries the ciphertext).

---

## 1. Top-Level Envelope

Every message sent over the transport (after the handshake) is a **`MessageEnvelope`**:

```json
{
  "id":        "<string>",
  "timestamp": "<number — Unix ms>",
  "sender":    "<string — peerId>",
  "type":      "<'text' | 'file' | 'system' | 'handshake'>",
  "encrypted": {
    "ciphertext": "<Base64>",
    "iv":         "<Base64>",
    "tag":        "<Base64>"
  },
  "signature": "<Base64 ECDSA signature, may be empty string>",
  "metadata":  { ... }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✓ | Globally unique message ID. Format: `"<timestamp>-<random>"` |
| `timestamp` | number | ✓ | Unix epoch in milliseconds (sender's wall clock). For display only. |
| `sender` | string | ✓ | The sending peer's ID. |
| `type` | string | ✓ | One of `text`, `file`, `system`, `handshake`. |
| `encrypted` | object | ✓ | AES-256-GCM ciphertext fields (see §2). |
| `signature` | string | ✓ | Base64 ECDSA-P256-SHA256 signature over the plaintext. Empty string if signing not yet implemented. |
| `metadata` | object | ✗ | Optional message metadata. |

---

## 2. Encrypted Payload Fields

The `encrypted` object is always present (even for handshake, which is not encrypted but uses the same outer shape — see §4):

```json
{
  "ciphertext": "<Base64 — AES-256-GCM ciphertext WITHOUT the authentication tag>",
  "iv":         "<Base64 — 12-byte random IV>",
  "tag":        "<Base64 — 16-byte GCM authentication tag>"
}
```

**Reconstruction for decryption:**  
Concatenate `ciphertext || tag` and pass the result to `AES-256-GCM.decrypt(iv, combined)`.

**See [CRYPTO.md](./CRYPTO.md)** for the key derivation and encryption algorithm details.

---

## 3. Plaintext Message (`PlaintextMessage`)

After decryption the plaintext is a UTF-8 JSON string deserialised to:

```json
{
  "id":        "<string>",
  "channelId": "<string>",
  "senderId":  "<string — peerId>",
  "timestamp": "<number — Unix ms>",
  "content":   "<string — message body>",
  "type":      "<'text' | 'file' | 'system'>",
  "threadId":  "<string | undefined — parent message ID for thread replies>",
  "prevHash":  "<string — 64-char lowercase hex SHA-256 hash of previous message>",
  "status":    "<'pending' | 'sent' | 'delivered'>",
  "metadata":  { ... }
}
```

### 3.1 Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✓ | Message ID. Unique within the channel. Format: `"<peerId>-<vectorClockCount>"` or `"<timestamp>-<random>"`. |
| `channelId` | string | ✓ | The channel this message belongs to. |
| `senderId` | string | ✓ | Peer ID of the author. |
| `timestamp` | number | ✓ | Unix epoch ms. Must be strictly greater than the previous message's timestamp in the same channel. |
| `content` | string | ✓ | Message body. For `file` type, this is the file name or description; the binary is out-of-band. |
| `type` | string | ✓ | `text` — normal chat message. `file` — file attachment reference. `system` — server-generated event (e.g., "Alice joined"). |
| `threadId` | string | ✗ | If present, this is a reply within a thread; the value is the `id` of the thread's parent message. |
| `prevHash` | string | ✓ | SHA-256 hex digest of the previous message in this channel's hash chain. For the first message, this must equal `GENESIS_HASH`. |
| `status` | string | ✓ | `pending` — created locally, not yet confirmed. `sent` — delivered to at least one peer. `delivered` — all connected peers confirmed receipt. |
| `metadata` | object | ✗ | Type-specific extras (see §3.2). |

### 3.2 Metadata by Type

**`type: "file"`**

```json
{
  "metadata": {
    "fileName": "<string>",
    "fileSize":  "<number — bytes>",
    "mimeType":  "<string — MIME type>"
  }
}
```

**`type: "text"` or `"system"`** — `metadata` omitted.

### 3.3 Hash-Chaining Fields

The hash of a message is computed over its **canonical form** (deterministic JSON):

```json
{
  "id":        "...",
  "channelId": "...",
  "senderId":  "...",
  "timestamp": ...,
  "content":   "...",
  "type":      "...",
  "prevHash":  "..."
}
```

Only these seven fields are included. Fields like `status`, `threadId`, and `metadata` are excluded from the hash computation.

**Genesis hash** (first message in a channel):

```
prevHash = "0000000000000000000000000000000000000000000000000000000000000000"
```

---

## 4. Handshake Message

The handshake is sent **unencrypted** immediately after a transport connection opens, by **both sides**:

```json
{
  "type":      "handshake",
  "publicKey": "<Base64 JWK — ECDH P-256 public key>",
  "peerId":    "<string>"
}
```

After exchanging handshakes, both sides independently derive the shared AES-256-GCM key. **All subsequent messages are encrypted.**

---

## 5. Workspace Sync Messages

These are higher-level protocol messages transmitted inside an encrypted `MessageEnvelope`. The outer envelope's `type` field is `"workspace-sync"` (a special case not in the `PlaintextMessage` schema). The decrypted payload is a `SyncMessage`:

### 5.1 Outer Wrapper

```json
{
  "type":        "workspace-sync",
  "sync":        { ... SyncMessage ... },
  "workspaceId": "<string | undefined>"
}
```

### 5.2 `join-request`

Sent by a peer that wants to join a workspace:

```json
{
  "type":       "join-request",
  "inviteCode": "<string — 8 chars>",
  "member": {
    "peerId":    "<string>",
    "alias":     "<string>",
    "publicKey": "<Base64 JWK — ECDH P-256 public key>",
    "joinedAt":  "<number — Unix ms>",
    "role":      "member"
  }
}
```

### 5.3 `join-accepted`

Sent by the accepting peer in response to a valid `join-request`:

```json
{
  "type":      "join-accepted",
  "workspace": { ... Workspace ... },
  "messageHistory": {
    "<channelId>": [ ... PlaintextMessage[] ... ]
  }
}
```

### 5.4 `join-rejected`

```json
{
  "type":   "join-rejected",
  "reason": "<string — human-readable>"
}
```

### 5.5 `member-joined`

Broadcast to all connected workspace peers when a new member joins:

```json
{
  "type":   "member-joined",
  "member": { ... WorkspaceMember ... }
}
```

### 5.6 `member-left`

```json
{
  "type":   "member-left",
  "peerId": "<string>"
}
```

### 5.7 `channel-created`

Broadcast when a channel is created:

```json
{
  "type":    "channel-created",
  "channel": { ... Channel ... }
}
```

### 5.8 `channel-message`

Broadcast when a message is sent to a channel:

```json
{
  "type":      "channel-message",
  "channelId": "<string>",
  "message":   { ... PlaintextMessage ... }
}
```

### 5.9 `sync-request`

Peer requests a full workspace state dump:

```json
{
  "type":        "sync-request",
  "workspaceId": "<string>"
}
```

### 5.10 `sync-response`

```json
{
  "type":      "sync-response",
  "workspace": { ... Workspace ... },
  "messageHistory": {
    "<channelId>": [ ... PlaintextMessage[] ... ]
  }
}
```

---

## 6. Workspace & Channel Schemas

### 6.1 Workspace

```json
{
  "id":         "<string>",
  "name":       "<string>",
  "inviteCode": "<string — 8 chars, uppercase alphanumeric minus ambiguous>",
  "createdBy":  "<string — peerId>",
  "createdAt":  "<number — Unix ms>",
  "members":    [ ... WorkspaceMember[] ... ],
  "channels":   [ ... Channel[] ... ]
}
```

### 6.2 WorkspaceMember

```json
{
  "peerId":    "<string>",
  "alias":     "<string — display name>",
  "publicKey": "<Base64 JWK — ECDH P-256 public key>",
  "joinedAt":  "<number — Unix ms>",
  "role":      "<'owner' | 'member'>"
}
```

### 6.3 Channel

```json
{
  "id":          "<string>",
  "workspaceId": "<string>",
  "name":        "<string>",
  "type":        "<'channel' | 'dm'>",
  "members":     [ "<peerId>", ... ],
  "createdBy":   "<string — peerId>",
  "createdAt":   "<number — Unix ms>"
}
```

For `dm` channels: `members` always has exactly 2 entries.  
For `channel` type: `members` contains all workspace members at creation time, plus any added later.

---

## 7. Examples

### 7.1 Complete Chat Session

**Step 1: Transport opens, Alice sends handshake**

```json
{
  "type":      "handshake",
  "publicKey": "eyJrdHkiOiJFQyIsImNydiI6IlAtMjU2IiwieCI6Ii4uLiIsInkiOiIuLi4ifQ==",
  "peerId":    "alice-peer-uuid-1234"
}
```

**Step 2: Bob sends handshake**

```json
{
  "type":      "handshake",
  "publicKey": "eyJrdHkiOiJFQyIsImNydiI6IlAtMjU2IiwieCI6Ii4uLiIsInkiOiIuLi4ifQ==",
  "peerId":    "bob-peer-uuid-5678"
}
```

**Step 3: Alice sends encrypted "Hello Bob"**

```json
{
  "id":        "1739900000000-k3j9f2a",
  "timestamp": 1739900000000,
  "sender":    "alice-peer-uuid-1234",
  "type":      "text",
  "encrypted": {
    "ciphertext": "u3Fh8k2+Lm4nO9p...",
    "iv":         "aBcDeFgHiJkL",
    "tag":        "mNoPqRsTuVwX"
  },
  "signature": ""
}
```

**Decrypted payload of Step 3:**

```json
{
  "id":        "1739900000000-k3j9f2a",
  "channelId": "general-channel-uuid",
  "senderId":  "alice-peer-uuid-1234",
  "timestamp": 1739900000000,
  "content":   "Hello Bob!",
  "type":      "text",
  "prevHash":  "0000000000000000000000000000000000000000000000000000000000000000",
  "status":    "sent"
}
```

### 7.2 Join Flow

**Bob → Alice:**

```json
{
  "type": "workspace-sync",
  "sync": {
    "type":       "join-request",
    "inviteCode": "XKCD4567",
    "member": {
      "peerId":    "bob-peer-uuid-5678",
      "alias":     "Bob",
      "publicKey": "eyJrdHkiOiJFQyIsImNydiI6IlAtMjU2IiwieCI6Ii4uLiIsInkiOiIuLi4ifQ==",
      "joinedAt":  1739900001000,
      "role":      "member"
    }
  }
}
```

**Alice → Bob (acceptance):**

```json
{
  "type": "workspace-sync",
  "sync": {
    "type": "join-accepted",
    "workspace": {
      "id":         "ws-uuid-abcd",
      "name":       "My Team",
      "inviteCode": "XKCD4567",
      "createdBy":  "alice-peer-uuid-1234",
      "createdAt":  1739890000000,
      "members": [
        {
          "peerId":    "alice-peer-uuid-1234",
          "alias":     "Alice",
          "publicKey": "eyJrdHkiOiJFQyIsImNydiI6IlAtMjU2IiwieCI6Ii4uLiIsInkiOiIuLi4ifQ==",
          "joinedAt":  1739890000000,
          "role":      "owner"
        },
        {
          "peerId":    "bob-peer-uuid-5678",
          "alias":     "Bob",
          "publicKey": "eyJrdHkiOiJFQyIsImNydiI6IlAtMjU2IiwieCI6Ii4uLiIsInkiOiIuLi4ifQ==",
          "joinedAt":  1739900001000,
          "role":      "member"
        }
      ],
      "channels": [
        {
          "id":          "ch-general-uuid",
          "workspaceId": "ws-uuid-abcd",
          "name":        "general",
          "type":        "channel",
          "members":     ["alice-peer-uuid-1234", "bob-peer-uuid-5678"],
          "createdBy":   "alice-peer-uuid-1234",
          "createdAt":   1739890000000
        }
      ]
    },
    "messageHistory": {
      "ch-general-uuid": [
        {
          "id":        "1739890001000-abc",
          "channelId": "ch-general-uuid",
          "senderId":  "alice-peer-uuid-1234",
          "timestamp": 1739890001000,
          "content":   "Hello world!",
          "type":      "text",
          "prevHash":  "0000000000000000000000000000000000000000000000000000000000000000",
          "status":    "delivered"
        }
      ]
    }
  }
}
```

---

## 8. Invite Code Format

The invite code is an 8-character string drawn from the alphabet:

```
ABCDEFGHJKLMNPQRSTUVWXYZ23456789
```

(uppercase, no I/O/1/0 to avoid visual ambiguity)

The code is randomly generated at workspace creation. It is not time-limited or cryptographically signed in the current version. Future versions may add an HMAC-based expiring token.

---

## 9. ID Generation

| Entity | ID Format | Uniqueness Scope |
|--------|-----------|-----------------|
| Message | `"<timestamp>-<7-char random base36>"` | Within a channel |
| Workspace | `"<timestamp>-<9-char random base36>"` | Global |
| Channel | `"<timestamp>-<9-char random base36>"` | Within a workspace |
| Peer | Assigned by transport layer (PeerJS UUID) | Global |

IDs must be treated as **opaque strings** by receivers — do not parse the timestamp out of an ID.

---

## 10. Validation Rules for Receivers

When receiving a `PlaintextMessage` (either directly or via sync):

1. **Genesis check:** If this is the first message in `channelId`, `prevHash` MUST equal `GENESIS_HASH`.
2. **Chain check:** Otherwise, `SHA256(canonical(prev_message))` MUST equal `prevHash`.
3. **Timestamp check:** `message.timestamp` MUST be strictly greater than the previous message's `timestamp`.
4. **Duplicate check:** If `id` already exists in the store, silently discard.

When receiving a `join-request`:

1. Validate `inviteCode` against known workspaces.
2. Check `member.peerId` is not already a member.
3. If valid, add member and send `join-accepted`; otherwise send `join-rejected`.

When importing a full message history (`join-accepted` or `sync-response`):

1. Verify the **entire hash chain** before accepting any message.
2. If the chain is broken at any point, reject the entire import and emit an error.
