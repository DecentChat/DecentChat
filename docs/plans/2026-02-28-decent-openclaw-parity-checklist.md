# Decent OpenClaw Parity Checklist

Plan reference: `docs/plans/2026-02-28-decent-openclaw-parity-threading.md`

## Batch 1 (Tasks 1-3)

- [x] Add planning/checklist docs for parity work.
- [x] Add config contract for `replyToModeByChatType` (`direct|group|channel`).
- [x] Wire per-chat-type reply mode into runtime thread-session routing.
- [x] Add/extend tests for reply mode resolution + runtime behavior.

## Batch 2 (Tasks 4-5)

- [x] Add `getThreadHistory` API on `NodeXenaPeer` with bounded/filtered retrieval.
- [x] Enforce `thread.initialHistoryLimit` for first thread turn bootstrap in monitor runtime.
- [x] Add tests for thread-history API and initial-history-limit behavior.

## Deferred to next batches

- [ ] Directory adapters and messaging target normalization.
- [ ] Upstream design doc for full thread-bound session bindings.
