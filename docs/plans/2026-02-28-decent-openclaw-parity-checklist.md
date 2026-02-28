# Decent OpenClaw Parity Checklist (Batch 1)

Plan reference: `docs/plans/2026-02-28-decent-openclaw-parity-threading.md`

## Batch 1 (Tasks 1-3)

- [x] Add planning/checklist docs for parity work.
- [x] Add config contract for `replyToModeByChatType` (`direct|group|channel`).
- [x] Wire per-chat-type reply mode into runtime thread-session routing.
- [x] Add/extend tests for reply mode resolution + runtime behavior.

## Deferred to next batches

- [ ] Enforce `thread.initialHistoryLimit` in runtime bootstrapping.
- [ ] Directory adapters and messaging target normalization.
- [ ] Upstream design doc for full thread-bound session bindings.
