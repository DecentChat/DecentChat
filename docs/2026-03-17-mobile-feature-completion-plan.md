# Mobile Feature Completion Plan — 2026-03-17

## Scope
Implement mobile parity gaps in `decent-client-mobile` using protocol-consistent flows from web client where applicable.

Priority order:
- P0: message sync (Negentropy + timestamp fallback), offline outbox, Capacitor iOS init/sync + splash color
- P1: attachments, read receipts, connection banner state fix
- P2 (if time permits): typing, edit/delete, reply/thread

## Execution Strategy

### Phase 0 — Baseline + design mapping
- [x] Inspect `MobileController.ts`, `ChatDetailScreen.svelte`, and app connection banner logic.
- [x] Inspect web `ChatController.ts` reference behavior for sync/receipts/attachments/typing.
- [x] Confirm protocol primitives exist (`Negentropy`, media chunking, persistent outbox APIs).

### Phase 1 — P0 implementation
1. Message sync protocol for mobile
   - [x] Add control message types for sync request/response + negentropy query/response.
   - [x] Implement `requestMessageSync()` in mobile controller.
   - [x] Trigger sync on reconnect and handshake completion.
   - [x] Add timestamp-fallback sync for peers without negentropy support.
   - [x] Persist/import synced messages safely and update stores.

2. Offline outbox queue
   - [x] Persist outbound envelopes to `PersistentStore` outbox when recipient not ready.
   - [x] Auto-flush queue on peer ready/reconnect.
   - [x] Add explicit flush helper + attempt accounting.
   - [x] Ensure outbox survives reload by loading queued items from persistence (implicit via store).

3. Capacitor iOS init
   - [x] Run `npx cap add ios` in mobile package.
   - [x] Set `SplashScreen.backgroundColor` to `#0f0f23`.
   - [x] Run `cap sync ios`.

4. P0 tests
   - [x] Add/extend unit tests for sync + outbox behavior.

5. P0 verification
   - [x] `bun run --cwd decent-protocol test`
   - [x] `bun run --cwd decent-client-core typecheck`
   - [x] `bun run --cwd decent-client-mobile typecheck`
   - [x] `bun run --cwd decent-client-mobile test:e2e`
   - [x] `bun run --cwd decent-client-web typecheck`
   - [x] `bun test --cwd decent-client-mobile bun-tests`

### Phase 2 — P1 implementation
4. File/media attachments
   - [x] Add attachment button behavior in `ChatDetailScreen`.
   - [x] Implement file picker -> send as attachment message.
   - [x] Include attachment metadata on outbound messages.
   - [x] Implement media-request/media-response/media-chunk handlers.

5. Read receipts to peers
   - [x] Extend `markChannelRead()` to emit `read` receipts per sender/message.
   - [x] Handle inbound `ack`/`read` control messages and update local status counters.

6. Connection banner fix
   - [x] Fix `bannerState` derivation to surface disconnected/error.

7. P1 tests
   - [x] Add unit tests for attachments + read receipt signaling + banner-state logic.

8. P1 verification
   - [x] Re-run full verification matrix.

### Phase 3 — P2 (if time permits)
7. Typing indicators
   - [x] Emit throttled typing true/false events from composer.
   - [x] Receive typing events and expose per-channel typing peers.

8. Message editing
   - [x] Add UI affordance to edit own message.
   - [x] Emit/receive edit events and update persisted message content with edited marker.

9. Message deletion
   - [x] Add UI affordance to delete own message.
   - [x] Emit/receive delete events and update persisted message tombstone.

10. Thread/reply support
   - [x] Add reply target UI.
   - [x] Include `threadId` on outbound reply messages.

11. P2 tests
   - [x] Add unit/e2e coverage for typing, edit, delete, reply metadata.

12. Final verification
   - [x] Run full verification matrix.

## Notes / Constraints
- Avoid destructive git operations.
- Keep protocol compatibility with current web client message/control shapes.
- Keep fallback paths for mixed-version peers.
