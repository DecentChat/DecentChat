# Sync Fix Plan

## Current State (Feb 25, 2026)

**Git:** `6691cb0` — bidirectional Negentropy with excess push

### What works
- ✅ Negentropy algorithm: 22/22 unit tests pass (upstream-style rewrite)
- ✅ `reconcile()` returns both `need` (what I'm missing) and `excess` (what remote is missing)
- ✅ Tests 1-3: real-time sync, bidirectional, ordering (2s each)
- ✅ Protocol correctly identifies all 1000 excess items in ONE reconcile call (verified)

### What's broken
| Test | Result | Root Cause |
|------|--------|------------|
| 4. Burst 50 | ❌ timeout | UI assertion (`waitForTextInMessages`) checks DOM, but messages may be in store without rendering |
| 5. Offline queue 100 | ❌ 30/100 | Only 30 msgs delivered — offline queue flush + Negentropy together only push 30 |
| 6. Offline catchup 1k | ❌ 881/1000 (was 0) | Too slow: ~5 msg/s, 180s timeout hit |
| 7. Chaos reconnect 1k | ❌ 0/1000 | Vite crashed (ERR_CONNECTION_REFUSED) — infrastructure, not sync |
| 8-11 | ❌ ERR_CONNECTION_REFUSED | Same Vite crash cascading from test 6/7 |

## Root Cause Analysis

### Problem 1: Sync is too slow for bulk catch-up
Each Negentropy `reconcile()` correctly finds all 1000 excess IDs. Alice pushes them via `message-sync-response`. But `handleMessageSyncResponse` processes each message **sequentially**:
```
for each message:
  await createMessage()    ← SHA-256 hash (async)
  await addMessage()       ← validation + store
  await persistMessage()   ← IndexedDB write
```
At ~5ms per message × 1000 = 5 seconds for processing alone. But the actual bottleneck is that maintenance only runs every 10-20s, and each cycle re-does the full Negentropy reconciliation before pushing the next batch.

**Key insight:** Alice pushes ALL 1000 in one `transport.send()`, but Bob's handler processes them one-by-one with 3 awaits each. Meanwhile, maintenance fires again, triggers another reconcile, pushes duplicates. The dedup (`existing.some(m => m.id === msg.id)`) is O(n) per message, making it O(n²) total.

### Problem 2: MockTransport reconnection incomplete
When Bob goes offline→online, `_scheduleReconnect()` re-registers on relay but doesn't `__connect` to Alice. Fix was added (save `_previousPeers`, reconnect on `__registered`) but the reconnect may race with the test's `runPeerMaintenanceNow()`.

### Problem 3: Test assertions use DOM queries
Test 4 (burst) uses `waitForTextInMessages` which checks `.message-content` DOM elements. If the UI virtualizes or doesn't render all messages, the assertion fails even though messages ARE in the store.

## Fix Plan

### Phase 1: Fast bulk message import (fixes tests 5, 6, 7)
**File:** `decent-client-web/src/app/ChatController.ts` — `handleMessageSyncResponse()`

1. **O(1) dedup:** Pre-build `Set<string>` of existing IDs per channel ONCE before the loop
2. **Batch persist:** Collect all new messages, then `Promise.all(persistTasks)` (already done, but remove per-message awaits where possible)
3. **Skip hash chain for synced messages:** Synced messages already have `id` and `prevHash` — don't recompute SHA-256. Use `messageStore.forceAdd()` instead of `createMessage() + addMessage()`
4. **Batch UI render:** Only call `renderMessages()` once at the end (already done)

Expected impact: 1000 messages in <2 seconds instead of 180+.

### Phase 2: Ensure reconnection triggers sync (fixes test 5)
**File:** `decent-client-web/tests/mocks/MockTransport.ts`

1. ✅ Already fixed: save `_previousPeers` on WS close, reconnect on `__registered`
2. **Add:** After reconnection, both peers should call `requestMessageSync()` — currently only Alice's side is nudged by test

**File:** `decent-client-web/src/app/ChatController.ts`

3. In `onConnect` handler: ensure `requestMessageSync(peerId)` fires on RECONNECT (not just first connect). Check if `readyPeers` gate blocks reconnect sync.

### Phase 3: Fix test assertions (fixes test 4)
**File:** `decent-client-web/tests/e2e/sync-reliability.spec.ts`

1. Test 4 (burst): Use `getMessageCountViaController` (store-level) instead of `waitForTextInMessages` (DOM-level)
2. All bulk tests: Already use store-level assertions — good

### Phase 4: Prevent Vite crash (fixes tests 7-11)
**File:** `decent-client-web/playwright.config.ts`

1. Increase Vite server timeout or add retry
2. Consider running tests with `--workers=1` and reusing server (already doing this)
3. The crash is likely memory pressure from 3+ minutes of headless Chrome. Consider shorter test timeouts or lighter test data.

## Implementation Order

```
1. Phase 1 (handleMessageSyncResponse optimization) — highest impact
   - Replace createMessage+addMessage with forceAdd for synced messages
   - Pre-build dedup Set
   - Expected: 1000 msgs in <5s
   
2. Phase 3 (test 4 assertion fix) — quick win
   - Change burst test to use store-level check
   
3. Phase 2 (reconnection flow) — reliability
   - Verify both peers initiate sync on reconnect
   
4. Phase 4 (Vite stability) — infrastructure
   - Address memory/timeout issues
```

## Success Criteria
- [ ] All 11 sync-reliability tests pass
- [ ] 1000-message offline sync completes in <30 seconds
- [ ] No Vite crashes during test suite
- [ ] Protocol unit tests still pass (22/22)

## Key Files
```
decent-protocol/src/crdt/Negentropy.ts          — algorithm (DONE)
decent-client-web/src/app/ChatController.ts      — sync flow (Phase 1-2)
decent-client-web/tests/e2e/sync-reliability.spec.ts  — test assertions (Phase 3)
decent-client-web/tests/mocks/MockTransport.ts   — reconnection (Phase 2)
decent-client-web/playwright.config.ts           — Vite config (Phase 4)
```
