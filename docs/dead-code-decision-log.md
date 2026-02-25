# Dead Code / Dead Test Decision Log

Date: 2026-02-25  
Owner: Alex + Xena

Purpose: classify current dead/stale code findings into **KEEP**, **MODIFY**, or **REMOVE** with rationale.

---

## Decision Policy

- **KEEP** = clearly part of current architecture/MVP and should remain.
- **MODIFY** = intended, but currently stale/drifted/noisy and needs implementation or alignment.
- **REMOVE** = not needed for roadmap, not wired, or redundant.

---

## A) Core implementation (`decent-protocol/src`) 

### A1. KEEP + MODIFY (intended features, incomplete/noisy)

1. `src/workspace/SyncProtocol.ts`
   - Items: `PEXServer` import unused, `pendingJoins` field unused
   - Decision: **MODIFY**
   - Why: sync/join lifecycle is core behavior; this looks like partially implemented flow.
   - Action: either wire join-tracking + PEX usage, or remove these symbols from code path if design changed.

2. `src/workspace/WorkspaceManager.ts`
   - Item: `SyncMessage` import unused
   - Decision: **MODIFY**
   - Why: workspace manager is active core; this is likely API drift.
   - Action: align imports/types with current sync flow.

3. `src/crypto/DoubleRatchet.ts`
   - Item: `CHAIN_KDF_INFO` unused
   - Decision: **MODIFY**
   - Why: ratchet is a strategic security feature; constant suggests planned derivation context.
   - Action: either implement KDF info usage or remove constant + track follow-up issue.

4. `src/security/MessageGuard.ts`
   - Item: `KNOWN_TYPES` unused
   - Decision: **MODIFY**
   - Why: type-allowlist checks are security relevant; dangling constant suggests unfinished guard logic.
   - Action: implement validation or remove dead allowlist if no longer required.

5. `src/crypto/CryptoManager.ts`
   - Item: `usages` local unused
   - Decision: **MODIFY**
   - Why: crypto API parameters should be explicit and minimal.
   - Action: remove or apply in key import/generation path.

6. `src/identity/Identity.ts`
   - Item: `deviceLabel` arg unused
   - Decision: **MODIFY**
   - Why: likely part of multi-device UX, but currently ignored.
   - Action: store/use label in identity metadata OR drop arg.

### A2. KEEP + REMOVE (pure dead noise, low risk)

7. `src/contacts/DirectConversation.ts`
   - Item: `Contact` import unused
   - Decision: **REMOVE** (symbol only)
   - Why: trivial dead import, no feature impact.

8. `src/identity/SeedPhrase.ts`
   - Item: `HDPurpose` import unused
   - Decision: **REMOVE** (if not needed in this file)
   - Why: dead import noise.

9. `src/media/ChunkedTransfer.ts`
   - Item: `startTime` local unused
   - Decision: **REMOVE** or **MODIFY**
   - Why: either leftover telemetry or unfinished perf measurement.
   - Action: remove now unless you want transfer timing metrics.

---

## B) Test suite (`decent-protocol/tests`) 

### B1. KEEP + MODIFY (high-value tests with API drift)

1. `tests/unit/message-store.test.ts`
   - Errors: uses message type `"image"` where allowed union is `"text" | "file" | "system"`
   - Decision: **MODIFY**
   - Why: store tests are core; test contract drifted from runtime model.

2. `tests/unit/message-sync.test.ts`
3. `tests/unit/queue-sync-dedup.test.ts`
   - Errors: `MockTransport` missing `isConnectingToPeer`
   - Decision: **MODIFY**
   - Why: transport contract changed; tests must track current interface.

4. `tests/unit/sync-perf.test.ts`
   - Errors: uses removed `MessageCRDT.addReceived`
   - Decision: **MODIFY**
   - Why: perf/sync tests are valuable; update to current CRDT API.

5. `tests/unit/workspace-roles.test.ts`
   - Errors: invalid role literals vs `WorkspaceRole`
   - Decision: **MODIFY**
   - Why: permissions are core protocol behavior.

6. `tests/setup.ts`
   - Error: missing `fake-indexeddb/lib/FDBKeyRange.js`
   - Decision: **MODIFY**
   - Why: test harness breakage blocks confidence.

### B2. KEEP + REMOVE (test-only dead locals/imports)

- Multiple tests contain unused vars/imports (`TS6133`, `TS6196`, `TS6192`) without behavior value.
- Decision: **REMOVE** (just dead bindings), keep test intent.
- Why: reduce noise so real failures are visible.
- Representative files:
  - `chunk-transfer-resilience.test.ts`
  - `clock-skew-extreme.test.ts`
  - `crdt.test.ts`
  - `direct-conversation.test.ts`
  - `dm-ux.test.ts`
  - `double-ratchet.test.ts`
  - `e2e-integration.test.ts`
  - `encryption-key-mismatch.test.ts`
  - `hd-derivation.test.ts`
  - `media.test.ts`
  - `negentropy.test.ts`
  - `offline-queue.test.ts`
  - `security.test.ts`
  - `split-brain-channels.test.ts`
  - `storage-pressure.test.ts`
  - `sync-edge-cases.test.ts`
  - `sync.test.ts`
  - `three-peer-join.test.ts`
  - `workspace-isolation.test.ts`
  - `workspace-sync-security.test.ts`

---

## C) Build / project structure

1. `decent-transport-webrtc/tsconfig.json` reference errors (`TS6306`, `TS6310`)
   - Decision: **MODIFY**
   - Why: project references are misconfigured (`composite`/emit constraints), causing toolchain noise and masking true dead code.
   - Action: choose one:
     - Option A: remove TS project reference and rely on package-level typecheck
     - Option B: enable proper project refs (`composite: true`, declaration emit strategy)

---

## D) Immediate execution order (for implementation)

1. Fix toolchain blocker (tsconfig reference mismatch).
2. Fix high-value API-drift tests (B1).
3. Clean low-risk dead symbols in `src` (A2 first, then A1 decisions).
4. Sweep unused test locals/imports (B2).
5. Re-run full checks and produce final keep/remove diff.

---

## E) Acceptance criteria for this classification phase

- Every current `typecheck` error is tagged KEEP/MODIFY/REMOVE.
- No item is left ambiguous without owner decision.
- We can start implementation without re-triaging.

---

## F) Open decisions requiring Alex sign-off

1. `SyncProtocol.pendingJoins` and `PEXServer`:
   - Keep and implement now, or simplify and remove?

2. `DoubleRatchet.CHAIN_KDF_INFO`:
   - Implement KDF context in this sprint, or remove/defer?

3. `Identity.deviceLabel`:
   - Required for near-term device UX, or drop from API?

4. TS project references:
   - Keep strict project refs now, or temporarily flatten typecheck path?
