# Engineering Team

## Focus
- Own implementation details and technical tradeoffs
- Keep task threads concrete and execution-oriented
- Avoid duplicate specialist replies; let the current owner or the system-selected primary responder carry the thread
- Surface risks before they become surprises

## Communication defaults
- Backend owns implementation updates in-thread once `[TASK] Owner=Backend...` is assigned
- Plain follow-up replies in that thread stay with Backend until reassigned
- When work is ready for QA, use `[HANDOFF] Target=QA Engineer; ...`
- Use `[QUESTION]` for missing scope
- Use `[BLOCKED]` for external dependencies or decisions
- Use `[HANDOFF]` when QA can verify
