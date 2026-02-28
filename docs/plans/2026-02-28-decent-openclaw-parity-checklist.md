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

## Batch 3 (Tasks 6-8)

- [x] Capability signaling updated (`threads`, `media`) with guard test.
- [x] Messaging target normalization + resolver hints (`peerId`, `channel:<id>`, canonical forms).
- [x] Live directory adapter backed by NodeXenaPeer workspace cache.

## Batch 4 (Tasks 9-10)

- [x] Added structured route observability logs in monitor runtime.
- [x] Added tests covering thread/base routing log branches.
- [x] Added upstream design doc for DecentChat thread-bound session parity and linked it in docs.

## Batch 5 (Tasks 11-12)

- [x] Added full decent-openclaw regression command pack to `docs/testing.md`.
- [x] Executed verification pack + typecheck (all green).
- [x] Added rollout strategy docs (migration examples, staging dry-run, rollback toggles) in `decent-openclaw/README.md` and `docs/deployment.md`.

## Deferred to next batches

- [x] None — parity plan batches 1-5 completed.
