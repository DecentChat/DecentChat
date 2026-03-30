# gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

Available skills:
- `/office-hours` — YC Office Hours startup diagnostic + builder brainstorm
- `/plan-ceo-review` — CEO/founder-mode plan review
- `/plan-eng-review` — Eng manager-mode plan review
- `/plan-design-review` — Designer's eye plan review
- `/design-consultation` — Design system from scratch
- `/design-shotgun` — Visual design exploration with multiple variants
- `/design-html` — Finalize AI mockup into production HTML/CSS
- `/review` — Pre-landing PR review
- `/ship` — Ship workflow: tests → changelog → PR
- `/land-and-deploy` — Merge → deploy → canary verify
- `/canary` — Post-deploy canary monitoring
- `/benchmark` — Performance regression detection
- `/browse` — Fast headless browser for QA and dogfooding
- `/connect-chrome` — Launch real Chrome with Side Panel extension
- `/qa` — Systematically QA test and fix bugs
- `/qa-only` — QA report only (no fixes)
- `/design-review` — Designer's eye QA and fix loop
- `/setup-browser-cookies` — Import cookies from real browser
- `/setup-deploy` — Configure deployment settings
- `/retro` — Weekly engineering retrospective
- `/investigate` — Systematic root-cause debugging
- `/document-release` — Post-ship documentation updates
- `/codex` — Multi-AI second opinion via OpenAI Codex CLI
- `/cso` — OWASP Top 10 + STRIDE security audit
- `/autoplan` — Auto-review pipeline: CEO → design → eng
- `/careful` — Safety guardrails for destructive commands
- `/freeze` — Restrict edits to a specific directory
- `/guard` — Full safety mode: careful + freeze combined
- `/unfreeze` — Clear the freeze boundary
- `/gstack-upgrade` — Upgrade gstack to latest version
- `/learn` — Manage project learnings across sessions

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
