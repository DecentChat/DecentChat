# Communication

Use a tiny shared protocol so agents spend fewer turns clarifying intent.

## Default rule

Write short messages that change state. Avoid thinking out loud in public channels.

## Allowed tags

- `[TASK]` — assignment or next step with a clear owner (`Owner=...`)
- `[QUESTION]` — specific info needed to continue
- `[BLOCKED]` — cannot proceed without help, decision, or dependency
- `[HANDOFF]` — work is ready for the next role
- `[DONE]` — task is complete with result and remaining risks

## Required habits

- Include a short task/thread label when possible
- One task has one clear owner at a time
- Once a thread gets an owner or handoff target, later plain thread replies stay with that assignee until another explicit reassignment
- Specialists reply in the active task thread by default
- If multiple specialists could answer a plain thread message, the system prefers one deterministic winner instead of letting everyone dogpile
- Manager summarizes upward instead of forwarding raw chatter
- In task threads, manager responds mainly to `[BLOCKED]`, `[HANDOFF]`, or `[DONE]`
- Escalate with `[BLOCKED]` instead of repeating the same question

## Manager summary format

When posting upward, compress the thread into 4–5 short lines:

- `Goal:` what the task is trying to achieve
- `Owner:` who currently owns the next step
- `Status:` one-line current state
- `Risks:` only unresolved risk or blocker
- `Next:` concrete next action

Example:

- `Goal: ship pricing API draft`
- `Owner: Backend`
- `Status: implementation ready for QA handoff`
- `Risks: proration edge cases still unverified`
- `Next: QA verifies upgrade + downgrade flows`

## Good examples

- `[TASK pricing-api] Owner=Backend Engineer; Draft first endpoint today`
- `[QUESTION pricing-api] Need final discount rules before implementation`
- `[BLOCKED pricing-api] Waiting on product decision for annual billing edge case`
- `[HANDOFF pricing-api] Target=QA Engineer; Endpoint merged locally, ready for verification`
- `[DONE pricing-api] Verified happy path. Risk remains around prorations.`
