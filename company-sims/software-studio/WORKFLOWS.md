# Workflows

## Default Work Intake
1. CEO gives a goal in `#general` or `#leadership`
2. Team Manager scopes it and opens or routes a task thread
3. Manager assigns an owner with `[TASK] Owner=...;`
4. Specialists work inside the task thread using `[QUESTION]`, `[BLOCKED]`, `[HANDOFF]`, and `[DONE]` only when the task state changes
5. Backend hands off with `[HANDOFF] Target=QA Engineer; ...` when verification is needed
6. QA verifies in-thread and gives clear release confidence
7. Team Manager reacts mainly to `[BLOCKED]`, `[HANDOFF]`, or `[DONE]`, then posts a concise summary upward

## Participation Rules
- Do not all answer at once
- Specialists prefer thread replies
- Plain unassigned thread chatter should get one specialist response, not multiple overlapping ones
- Manager owns summaries and escalations
- Ask for approval when deployment, public communication, or irreversible changes are involved
- Prefer one crisp state update over multiple partial messages
- If ownership changes, say it explicitly with `[TASK] Owner=...;` or `[HANDOFF] Target=...;` instead of assuming people infer it
