# P2P Chat PWA - v2 Plan (Workspaces, Channels, Threads, DMs)

## What We Learned from Signal Protocol (libsignal)

### Concepts We're Adopting

**1. Double Ratchet Algorithm (Future Enhancement)**
- Currently: Single ECDH shared secret per peer (static)
- Signal approach: Ratchet keys forward with every message → forward secrecy
- **For v2:** Keep current ECDH. Plan Double Ratchet for v3 (complex, not needed for MVP)

**2. Message Integrity (Adopting NOW)**
- Messages are **immutable** — no editing, no deleting
- Each message includes a hash chain: `prevHash` links to prior message
- Any tampering breaks the chain → detectable
- This is simpler than Signal's full signing but effective for P2P

**3. P2P-adapted X3DH Handshake (Partial)**
- Signal uses 4 DH operations with pre-keys stored on server
- We do real-time 3-DH over WebRTC (no server, no pre-keys)
- Both peers must be online simultaneously (acceptable for P2P)

**4. What We Skip (Not Applicable to P2P)**
- Pre-key bundles (need a server)
- Sealed sender (need a server relay)
- Offline message queue (both must be online)
- Zero-knowledge groups (overkill for our use case)

---

## Architecture: Workspaces, Channels, Threads, DMs

### Data Model

```
Workspace
├── id: string (UUID)
├── name: string
├── inviteCode: string (shareable code to join)
├── members: PeerId[]
├── channels: Channel[]
├── createdBy: PeerId
└── createdAt: number

Channel
├── id: string (UUID)
├── workspaceId: string
├── name: string (e.g. "general", "random")
├── type: 'channel' | 'dm'
├── members: PeerId[] (for DMs, exactly 2)
├── messages: Message[]
└── createdAt: number

Message
├── id: string (UUID)
├── channelId: string
├── senderId: PeerId
├── timestamp: number
├── content: string (encrypted)
├── type: 'text' | 'file' | 'system'
├── threadId?: string (parent message ID if in thread)
├── prevHash: string (hash of previous message → integrity chain)
├── encrypted: { ciphertext, iv, tag }
└── status: 'pending' | 'sent' | 'delivered'

Thread = messages with same threadId, sorted by timestamp
DM = channel with type 'dm' and exactly 2 members
```

### How P2P Workspaces Work (No Server!)

**Key insight:** Every peer stores the full workspace state locally. Changes propagate via P2P sync.

1. **Creating a workspace:**
   - Creator generates workspace ID + invite code
   - Creator is first member
   - Workspace data stored in creator's IndexedDB

2. **Joining a workspace:**
   - New peer connects to any existing member (via PeerJS)
   - Sends join request with invite code
   - Existing member validates code, sends full workspace state
   - New peer stores workspace state locally

3. **Syncing:**
   - When peers connect, they exchange workspace state
   - Conflict resolution: message ordering by timestamp + hash chain
   - New messages broadcast to all connected workspace members

4. **Channels:**
   - Any member can create a channel
   - Channel creation is a system message broadcast to all members
   - Each member stores channel list locally

5. **DMs:**
   - Direct encrypted channel between exactly 2 peers
   - Same encryption as before (ECDH per-peer shared secret)
   - Not visible to other workspace members

6. **Threads:**
   - Reply to a message → creates a thread
   - Thread = messages with `threadId` pointing to parent message
   - Displayed inline (collapsed) in channel, expandable

### Message Integrity & Anti-Tampering

```
Message N:
  content: "Hello"
  prevHash: hash(Message N-1)
  
Message N+1:
  content: "World"
  prevHash: hash(Message N)
```

**Security properties:**
- ✅ Messages form a hash chain (like a mini blockchain)
- ✅ Tampering with any message breaks the chain
- ✅ No editing allowed (immutable messages)
- ✅ No deleting (messages are permanent in local store)
- ✅ Each peer can independently verify the chain

**Tests needed:**
- Peer A sends modified message history → Peer B detects tampering
- Peer A tries to insert/remove messages → hash chain breaks
- Peer A tries to replay old messages → detected by timestamp + hash
- Peer A sends message claiming to be Peer B → signature mismatch

---

## Implementation Phases

### Phase 6: Message Integrity (Anti-Tampering)
1. Add `prevHash` field to messages
2. Hash chain computation (SHA-256 of previous message)
3. Chain verification on receive
4. Tests: tamper detection, replay attack, impersonation

### Phase 7: Workspace System
1. Workspace CRUD (create, join via invite code)
2. Member management (join, leave)
3. Workspace state sync between peers
4. IndexedDB schema for workspaces

### Phase 8: Channels
1. Channel CRUD within workspace
2. Channel-scoped messaging (messages belong to a channel)
3. Default "general" channel on workspace creation
4. Channel list UI

### Phase 9: DMs
1. DM creation (select a workspace member)
2. DM = private channel with 2 members
3. DM messages encrypted with peer-specific shared secret
4. DM list in sidebar

### Phase 10: Threads
1. Reply to message → thread
2. Thread messages linked via `threadId`
3. Thread view (expand/collapse)
4. Thread notification (unread count)

### Phase 11: UI Overhaul (Slack-like)
1. Sidebar: Workspaces → Channels → DMs
2. Main area: Message list with threads
3. Top bar: Channel name, member count
4. Mobile-responsive with slide-out sidebar

### Phase 12: Comprehensive Tests
1. Message integrity tests (tampering, replay, impersonation)
2. Workspace sync tests (join, leave, state consistency)
3. Channel/DM creation and messaging tests
4. Thread tests
5. E2E encryption tests (updated for channels)
6. Offline/reconnection tests

---

## File Structure (Updated)

```
src/
├── main.ts
├── connection/
│   ├── PeerManager.ts      # (existing)
│   └── types.ts
├── crypto/
│   ├── CryptoManager.ts    # (existing)
│   ├── MessageCipher.ts    # (existing)
│   ├── KeyStore.ts         # (existing)
│   ├── HashChain.ts        # NEW: message integrity
│   └── types.ts
├── messages/
│   ├── MessageProtocol.ts  # (updated: channel-scoped)
│   ├── MessageStore.ts     # NEW: message persistence
│   └── types.ts            # NEW: message types
├── workspace/
│   ├── WorkspaceManager.ts # NEW: workspace CRUD
│   ├── ChannelManager.ts   # NEW: channel/DM CRUD
│   ├── SyncProtocol.ts     # NEW: P2P state sync
│   └── types.ts
├── storage/
│   ├── Database.ts         # (updated: new schemas)
│   └── types.ts
├── ui/
│   ├── App.ts              # NEW: main app component
│   ├── components/
│   │   ├── Sidebar.ts      # NEW: workspace/channel nav
│   │   ├── ChatView.ts     # NEW: channel messages
│   │   ├── ThreadView.ts   # NEW: thread panel
│   │   ├── ConnectView.ts  # NEW: peer connection
│   │   └── WorkspaceSetup.ts # NEW: create/join workspace
│   └── styles/
│       └── main.css        # (updated)
└── utils/
    ├── logger.ts
    └── qrcode.ts
```

---

## Priority Order

1. **Message Integrity** (Phase 6) — security foundation
2. **Workspaces** (Phase 7) — organizational structure
3. **Channels** (Phase 8) — topic-based conversations
4. **DMs** (Phase 9) — private messaging
5. **Threads** (Phase 10) — conversation depth
6. **UI Overhaul** (Phase 11) — Slack-like interface
7. **Tests** (Phase 12) — comprehensive coverage

---

## Open Questions

1. **Workspace persistence:** When all members go offline, workspace exists only in their IndexedDBs. First member back online becomes the "seed" for others.
2. **Member removal:** Who can kick? Creator only? Majority vote? → Start with creator-only.
3. **Channel permissions:** Public (all workspace members) vs private (invite-only)? → Start with all public.
4. **Message history sync:** New members get full history or only from join time? → Full history (simpler, more useful).
5. **Max members:** P2P mesh gets expensive at N>20. Consider hub-spoke for larger workspaces? → Start with mesh, cap at ~20 members.
