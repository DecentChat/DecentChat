# Streaming Message Recovery on Refresh

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Ensure streamed messages are not lost when the client refreshes mid-stream.

**Architecture:** Two-pronged fix: (1) client-side — persist partial streaming messages to IndexedDB during streaming (not just on `stream-done`), so they survive a page refresh; (2) bot-side — after streaming completes, always send the final message as a normal encrypted message that participates in sync, so even if the client missed `stream-done`, the message arrives via reconnect sync. Client deduplicates by `messageId`.

**Tech Stack:** TypeScript, IndexedDB (PersistentStore), Playwright E2E tests

---

## Problem Analysis

### Current flow
1. Bot sends `stream-start` → client creates in-memory message (`messageStore.addMessage`)
2. Bot sends `stream-delta` (cumulative) → client updates in-memory `msg.content`
3. Bot sends `stream-done` → client persists to IndexedDB via `persistMessage(msg)`
4. Bot skips sending a normal message when `streamEnabled=true` (to avoid duplicates)

### The bug
If the user refreshes between steps 1-2 and step 3:
- The message only exists in RAM (messageStore) — never written to IndexedDB
- The bot already sent its response (streaming), so it won't send it again
- Reconnect sync (`message-sync-request`) only exchanges persisted messages
- **Result: message is permanently lost**

### Why sync doesn't help
The bot-side plugin (`decent-openclaw`) never persists the streamed message to its own store. It only sends stream envelopes over WebRTC. The web client is the only place the message could be persisted, and it only does so on `stream-done`. Reconnect sync has nothing to exchange.

---

## Task 1: Persist streaming messages incrementally (client)

**Files:**
- Modify: `decent-client-web/src/app/ChatController.ts` (stream-delta handler, ~line 532-550)
- Test: `decent-client-web/tests/e2e/streaming.spec.ts`

### 1.1 Write failing test

Add a test that refreshes DURING streaming (before `stream-done`) and verifies the partial message is recoverable:

```typescript
test('partial streamed message recoverable after mid-stream refresh', async ({ page }) => {
  const messageId = 'stream-msg-midrefresh';
  await injectStreamMessage(page, {
    peerId: 'assistant-peer-midrefresh',
    messageId,
    senderName: 'Assistant',
    content: 'partial content before refresh',
  });

  // DO NOT call finalizeStreamMessage — simulate refresh mid-stream
  await page.reload();
  await waitForApp(page);

  const recovered = await page.evaluate(async ({ id }) => {
    const ctrl = (window as any).__ctrl;
    const state = (window as any).__state;
    const channelId = state?.activeChannelId;
    if (!ctrl || !channelId) return null;
    const msgs = await ctrl.persistentStore.getChannelMessages(channelId);
    const found = msgs.find((m: any) => m.id === id);
    return found ? { content: found.content, streaming: found.streaming } : null;
  }, { id: messageId });

  expect(recovered).not.toBeNull();
  expect(recovered!.content).toBe('partial content before refresh');
});
```

### 1.2 Run and verify fail

```bash
cd ~/Projects/decent-chat/decent-client-web
npx playwright test tests/e2e/streaming.spec.ts --grep "mid-stream refresh"
```

Expected: FAIL — `recovered` is `null` because stream-delta never persists.

### 1.3 Implement: persist on stream-delta

In `ChatController.ts`, inside the `stream-delta` handler (after updating `existing.content`), add persist:

```typescript
// In stream-delta handler, after updating existing.content:
if (existing) {
  existing.content = normalizedContent;
  (existing as any).streaming = true;

  // Persist partial content so it survives refresh
  await this.persistMessage(existing);
}
```

**Performance note:** Each delta triggers an IndexedDB write. Acceptable because:
- IndexedDB writes are async and non-blocking
- Deltas arrive ~50-200ms apart (provider token rate)
- IndexedDB handles ~100 writes/sec easily
- Alternative (debounce) risks losing the last chunk before refresh

### 1.4 Also handle stream-start persistence

The `stream-start` handler creates the message and calls `messageStore.addMessage()` but never persists to IndexedDB. Add:

```typescript
// After msg is added in stream-start handler:
await this.messageStore.addMessage(msg);
await this.persistMessage(msg);  // <-- add this
```

### 1.5 Run and verify pass

```bash
npx playwright test tests/e2e/streaming.spec.ts --grep "mid-stream refresh"
```

### 1.6 Commit

```bash
git add -A && git commit -m "fix: persist streaming messages incrementally to survive refresh"
```

---

## Task 2: Clear streaming flag on recovered messages (client)

**Files:**
- Modify: `decent-client-web/src/app/ChatController.ts` (message loading/init)
- Test: `decent-client-web/tests/e2e/streaming.spec.ts`

### 2.1 Write failing test

```typescript
test('recovered mid-stream message has streaming flag cleared', async ({ page }) => {
  const messageId = 'stream-msg-incomplete';
  await injectStreamMessage(page, {
    peerId: 'assistant-peer-incomplete',
    messageId,
    senderName: 'Assistant',
    content: 'this was interrupted',
  });

  await page.reload();
  await waitForApp(page);

  const state = await page.evaluate(async ({ id }) => {
    const ctrl = (window as any).__ctrl;
    const channelId = (window as any).__state?.activeChannelId;
    const msgs = await ctrl.persistentStore.getChannelMessages(channelId);
    const found = msgs.find((m: any) => m.id === id);
    return found ? { streaming: found.streaming, content: found.content } : null;
  }, { id: messageId });

  expect(state).not.toBeNull();
  expect(state!.content).toBe('this was interrupted');
  expect(state!.streaming).toBeFalsy();
});
```

### 2.2 Implement

When loading messages from IndexedDB on startup, clear the `streaming` flag:

```typescript
// In the init/load path where messages are loaded from persistentStore:
if ((msg as any).streaming) {
  (msg as any).streaming = false;
  await this.persistMessage(msg);
}
```

### 2.3 Commit

```bash
git add -A && git commit -m "fix: clear streaming flag on recovered messages after reload"
```

---

## Task 3: Bot sends final message after streaming (bot-side)

**Files:**
- Modify: `decent-openclaw/src/monitor.ts` (~line 209-215, `finalizeStream`)
- Modify: `decent-openclaw/src/peer/NodeXenaPeer.ts` (`sendToChannel`, `sendMessage`)
- Modify: `decent-client-web/src/app/ChatController.ts` (ciphertext handler — dedup)

### 3.1 Problem

When `streamEnabled=true`, the bot skips sending a final normal message:

```typescript
// monitor.ts ~line 209
if (streamEnabled) {
  return;  // <-- skips sendToChannel/sendDirectToPeer
}
```

The message never enters any peer's persistent store → can't be synced.

### 3.2 Implement: always send final message with stream messageId

In `monitor.ts` `finalizeStream`, remove the early return and always send:

```typescript
// Replace:
// if (streamEnabled) { return; }

// With: always send final message for persistence & sync.
// Reuse stream messageId so client deduplicates.
```

### 3.3 Modify sendToChannel to accept optional messageId

In `NodeXenaPeer.ts`:

```typescript
async sendToChannel(
  channelId: string, content: string,
  threadId?: string, replyToId?: string,
  messageId?: string
): Promise<void> {
  // ...pass messageId to sendMessage
}
```

In `sendMessage`, use provided `messageId` instead of `randomUUID()` when present.

### 3.4 Client-side dedup

In the ciphertext message handler, check if message already exists:

```typescript
const existingMsg = this.findMessageById(incomingMessageId);
if (existingMsg) {
  // Already received via streaming — update content and persist
  existingMsg.content = decryptedContent;
  (existingMsg as any).streaming = false;
  await this.persistMessage(existingMsg);
  return;
}
```

### 3.5 Commit

```bash
git add -A && git commit -m "fix: bot sends final message after streaming for sync resilience"
```

---

## Task 4: E2E tests for full recovery scenarios

**Files:**
- Test: `decent-client-web/tests/e2e/streaming.spec.ts`

### 4.1 Add tests

- Mid-stream refresh preserves partial content
- No duplicate messages after stream-done + normal message
- Recovered messages render without streaming cursor

### 4.2 Run full suite

```bash
cd ~/Projects/decent-chat/decent-client-web
npx playwright test tests/e2e/streaming.spec.ts
```

### 4.3 Commit

```bash
git add -A && git commit -m "test: add streaming recovery E2E tests"
```

---

## Task 5: beforeunload flush (belt-and-suspenders)

**Files:**
- Modify: `decent-client-web/src/app/ChatController.ts`

### 5.1 Implement

```typescript
window.addEventListener('beforeunload', () => {
  for (const [messageId] of this.pendingStreams) {
    const msg = this.findMessageById(messageId);
    if (msg?.content) {
      this.persistMessage(msg).catch(() => {});
    }
  }
});
```

Best-effort — may not complete before page unload. Task 1 is the real fix.

### 5.2 Commit

```bash
git add -A && git commit -m "fix: best-effort flush streaming messages on beforeunload"
```

---

## Summary

| Task | What | Where | Impact |
|------|------|-------|--------|
| 1 | Persist on every stream-delta | Client | **Primary fix** — partial messages survive refresh |
| 2 | Clear streaming flag on reload | Client | UX — recovered messages render cleanly |
| 3 | Bot sends final normal message | Bot + Client dedup | Sync resilience — recoverable from any peer |
| 4 | E2E tests | Tests | Verification |
| 5 | beforeunload flush | Client | Safety net |

## Success Criteria
- [ ] Refreshing mid-stream preserves the partial message content
- [ ] After `stream-done`, message is fully persisted and renders on reload
- [ ] No duplicate messages appear (dedup by messageId)
- [ ] Existing streaming tests still pass
- [ ] Reconnect sync can recover streamed messages from peers
