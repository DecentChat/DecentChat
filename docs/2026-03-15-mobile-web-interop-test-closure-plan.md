# Mobile + Web Call/Recovery Test Gap Closure Plan (2026-03-15)

## Quick gap analysis

Current coverage already includes:
- Mobile call signaling hardening/unit paths (`decent-client-mobile/bun-tests/call-manager-signaling.test.ts`), including some duplicate/busy/mic-failure paths.
- Mobile onboarding e2e happy-path + camera-permission fallback (`decent-client-mobile/tests/mobile-e2e.spec.ts`).
- Recovery URI protocol unit coverage for format and basic edge cases (`decent-protocol/tests/unit/recovery-uri.test.ts`).

Remaining important gaps to close:
1. **Mixed-client direct call interop matrix not fully explicit end-to-end** (all 6 directional ring outcomes not encoded as a complete matrix in automated tests).
2. **Reliability paths are partial** (timeout + disconnect + out-of-order ordering behaviors need explicit deterministic assertions).
3. **Recovery negative-path integration** needs explicit end-to-end tests for malformed URI payload and stale/unreachable source/signal hints with deterministic fallback assertions.

## Execution plan

1. **Augment mobile signaling integration tests** in `decent-client-mobile/bun-tests/call-manager-signaling.test.ts`:
   - Add explicit **mobile → web** ring outcome tests (accept/decline/busy).
   - Add explicit reliability tests for timeout cleanup, disconnect during ring/handshake cleanup, and out-of-order signal handling.

2. **Add web-side mixed-client interop tests** in `decent-client-web/tests/unit/direct-call-mobile-interop.test.ts`:
   - Verify web handling of incoming `call-ring` from mobile for accept/decline/busy behavior (response signals + state/toast side effects).

3. **Add recovery negative-path integration tests** in `decent-client-mobile/tests/mobile-e2e.spec.ts`:
   - malformed/invalid recovery URI is rejected with visible error and no recovery completion.
   - recovery with stale source-peer + unreachable signaling hints still completes onboarding with deterministic fallback (device index bump / app boot).

4. **Run targeted new tests first**, fix red → green.

5. **Run required verification suite**:
   - `bun run --cwd decent-protocol test tests/unit/recovery-uri.test.ts`
   - `bun run --cwd decent-client-core typecheck`
   - `bun run --cwd decent-client-mobile typecheck`
   - `bun run --cwd decent-client-mobile test:e2e`
   - `bun run --cwd decent-client-web typecheck`
   - Plus relevant web mixed-client suite containing new tests.
