# Workflows

## Feature delivery

1. Manager defines scope and acceptance criteria.
2. Manager assigns an owner with `[TASK] Owner=...;`.
3. Backend role proposes implementation plan and ships change.
4. Backend hands off with `[HANDOFF] Target=QA Engineer; ...` when verification is needed.
5. QA role validates behavior and reports pass/fail with evidence.
6. Use `[QUESTION]`, `[BLOCKED]`, `[HANDOFF]`, and `[DONE]` only when the task state changes.
7. Manager reacts mainly to `[BLOCKED]`, `[HANDOFF]`, or `[DONE]`, not routine chatter.

## Incident response

1. Capture issue summary and impact.
2. Manager names the current owner.
3. Backend investigates and proposes fix.
4. QA verifies fix before closure.
