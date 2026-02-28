# DecentChat Thread-Bound Sessions Design (OpenClaw Parity)

## Status

Draft proposal for upstream OpenClaw + `decent-openclaw` parity with Discord thread-bound session UX.

## Context

`decent-openclaw` already supports thread-aware session keys (`:thread:<id>`) and reply-mode controls.
What is missing is full **thread-binding management** parity:

- `sessions_spawn({ thread: true, mode: "session" })` binding behavior
- `/focus` and `/unfocus` routing controls
- binding TTL / expiry semantics

Current Discord implementation has richer first-class thread binding ergonomics. This proposal generalizes that model so DecentChat can participate without Discord-specific assumptions.

---

## Goals

1. Channel-agnostic thread-binding manager in OpenClaw core.
2. Provider capability checks so unsupported channels degrade gracefully.
3. DecentChat plugin hooks for thread identity + session binding.
4. Explicit flows for spawn/focus/unfocus/expiry.

## Non-goals

- Replacing plugin-local routing fallback (`:thread:<id>`) already in place.
- Implementing Discord-only commands in DecentChat without generic core hooks.

---

## Proposed Core Changes (OpenClaw)

### 1) Provider-agnostic thread binding registry

Add a binding registry keyed by:

- `channel` (e.g. `discord`, `decentchat`)
- `chatId` / conversation id
- `threadId`
- `agentSessionKey`
- metadata: `createdAt`, `updatedAt`, `expiresAt`, `owner`

This replaces any implicit Discord-only assumptions.

### 2) Capability gate for thread binding

Core should only enable thread-bound commands/flows when plugin advertises:

- `capabilities.threads === true`
- and optional `threading.binding !== false` (new optional adapter guard)

### 3) Thread-binding adapter hooks (plugin contract)

Proposed optional hooks:

- `threading.resolveBindingKey({ inboundContext }) -> { chatId, threadId } | null`
- `threading.resolveThreadDisplay({ chatId, threadId }) -> string`
- `threading.canBindThread({ cfg, accountId, chatId, threadId }) -> boolean`

DecentChat can map:

- `chatId`: workspace/channel tuple for groups, peer id for directs
- `threadId`: root message id / reply thread id

### 4) Spawn semantics integration

For ACP/native spawn pathways (`spawnSubagentSessions` / `spawnAcpSessions`), when `thread: true`:

- resolve binding key from current inbound context
- create/refresh binding registry entry
- route subsequent thread replies to bound sub-session unless explicitly overridden

---

## Proposed DecentChat Plugin Changes

1. Advertise `threads: true` (already done).
2. Implement binding-key resolution from Decent inbound context:
   - group: `{ chatId: workspaceId:channelId, threadId }`
   - direct: `{ chatId: senderId, threadId }` (if threading enabled in DMs)
3. Provide stable thread display strings for diagnostics:
   - `decentchat:<workspaceId>:<channelId>#<threadId>`

---

## Sequence Diagrams

### A) `sessions_spawn({ thread: true, mode: "session" })`

```text
User thread message
  -> OpenClaw core receives inbound context
  -> plugin resolves binding key (chatId + threadId)
  -> core spawns session (mode=session)
  -> core writes binding registry: key -> spawned sessionKey
  -> assistant replies in same thread using bound session
```

### B) `/focus` bind flow

```text
User issues /focus <session>
  -> core validates plugin supports thread binding
  -> core resolves current binding key from inbound context
  -> core updates binding registry to chosen session
  -> confirmation reply in thread
  -> future thread messages route to focused session
```

### C) `/unfocus` + TTL expiry

```text
User issues /unfocus OR binding reaches expiresAt
  -> core deletes binding entry
  -> routing falls back to default channel session policy
  -> optional notice in thread (configurable)
```

---

## Migration Plan

1. **Core first**: add generic binding registry + capability gate.
2. **Plugin adapters**: add optional binding hooks (Discord + DecentChat).
3. **Command wiring**: route `/focus` `/unfocus` through generic manager.
4. **Safety defaults**:
   - if no binding key can be resolved -> no bind, fallback routing.
   - if plugin cannot bind -> command explains unsupported state.

---

## Risks and Mitigations

- **Risk:** cross-provider behavior divergence.
  - **Mitigation:** shared core registry contract, provider-specific resolver only.

- **Risk:** stale bindings after channel/thread archival.
  - **Mitigation:** TTL + lazy invalidation on send failure + periodic cleanup.

- **Risk:** accidental routing surprises.
  - **Mitigation:** explicit `/focus` confirmation + observable route logs in plugin runtime.

---

## Acceptance Criteria

1. DecentChat thread can be bound to a spawned session via generic thread-binding flow.
2. `/focus` and `/unfocus` work via core generic manager (not provider-specific code path).
3. Expired bindings fall back cleanly to default plugin routing.
4. Route/debug logs clearly show whether bound or fallback path was used.
