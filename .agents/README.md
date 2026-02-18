# .agents — Workflow Documentation

This directory contains workflow guides for AI agents (and humans) working on DecentChat.

## Why This Exists

AI agents wake up fresh each session. Without explicit workflow documentation, they might:
- Make protocol changes without updating DEPs
- Skip test coverage
- Deploy without proper checks
- Repeat mistakes from past sessions

These workflows capture institutional knowledge and ensure consistency.

## Available Workflows

| File | Purpose | When to Use |
|------|---------|-------------|
| [protocol-changes.md](protocol-changes.md) | DEP creation & maintenance | Changing message types, sync, crypto, transport |
| [storage-migrations.md](storage-migrations.md) | Storage migration strategy | Changing IndexedDB schema or data format |
| testing.md | Test coverage checklist | Adding features, refactoring |
| deployment.md | Build + deploy workflow | Shipping to production |
| code-review.md | Review checklist | Before merging PRs |

## How to Use

1. **Before making changes:** Read the relevant workflow
2. **Follow the checklist:** Don't skip steps
3. **Update the workflow:** If you find missing steps or better approaches, improve it

## For Agents

**On every session where you modify code:**

1. Check `git status` — what files changed?
2. If protocol files (`src/workspace/*`, `src/messages/*`, `src/crypto/*`):
   - Read [protocol-changes.md](protocol-changes.md)
   - Check if DEP exists or needs creation
3. If tests needed:
   - Read [testing.md](testing.md) (when it exists)
   - Write comprehensive tests
4. Before deploying:
   - Read [deployment.md](deployment.md) (when it exists)
   - Run full test suite

## For Humans

These workflows are written for AI agents but useful for anyone:
- Onboarding new contributors
- Ensuring consistent code review
- Reducing "how do I...?" questions

## Evolution

This directory should grow as we learn:
- Add new workflows as needed
- Refine existing ones based on experience
- Delete workflows that become obsolete

**Principle:** If you find yourself explaining the same process twice, write it down here.

## Contributing

To add a new workflow:

1. Copy an existing workflow as template
2. Use clear headings and checklists
3. Include examples (code snippets, commit messages)
4. Link to relevant docs (`specs/deps/`, main `README.md`)
5. Update this index

---

**Remember:** Workflows are guidelines, not laws. Use judgment. When rules conflict with getting things done, choose pragmatism—then update the workflow to reflect reality.
