# Mobile Next-Phase Hardening Plan (Execution Notes)

Date: 2026-03-15

## Quick Gap Assessment

1. **Call interop signaling robustness**
   - `CallManager` accepts `call-accept/call-busy/call-decline` by peer only; stale/mismatched channel responses can affect current ring state.
   - If microphone access fails while accepting an incoming call or after receiving `call-accept`, no explicit termination signal is sent back, leaving remote peer in an ambiguous state.
   - Remote audio playback failures (autoplay / gesture gate) are swallowed without retry strategy.

2. **Runtime robustness (QR/camera + ringtone/audio)**
   - Recovery QR scanning can trigger duplicate imports while the same code remains in frame.
   - Camera errors surface raw/technical messages and don’t distinguish denied permission vs missing API/insecure context.
   - Incoming call ringtone has no explicit UX hint/retry path when autoplay/audio context is blocked.

3. **Release-quality tests**
   - No focused unit tests currently cover call signaling edge-cases in mobile `CallManager`.
   - Recovery camera failure fallback behavior is not asserted in e2e.

## Execution Plan

1. Harden call signaling state-machine in `CallManager`:
   - Channel-aware response matching.
   - Explicit decline signaling on local microphone failures.
   - Idempotent duplicate ring handling.
   - Remote audio autoplay retry on user gesture.
2. Improve scanner/camera and ringtone UX:
   - Friendly camera error mapping and retry affordances.
   - Debounce/guard recovery QR auto-import.
   - Ringtone blocked-state messaging + gesture unlock.
3. Add/extend tests:
   - New Bun unit tests for `CallManager` signaling edge-cases.
   - New mobile e2e test for recovery camera-permission failure fallback.
4. Run required verification suite + targeted tests and record outputs.
