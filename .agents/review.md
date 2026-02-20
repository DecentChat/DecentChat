# Code Review Workflow

AI-powered code review using local LLM agents. No GitHub, no CI, no SaaS.

## When to Run

- Before deploying (`scripts/deploy.sh` will remind you)
- After a significant feature or refactor
- Before tagging a release

## Quick Review

```bash
# Review all changes since last commit
scripts/review.sh

# Review staged changes only
scripts/review.sh --staged

# Review specific commit range
scripts/review.sh main..HEAD
```

## What Gets Checked

The review agent looks for:

- **Bugs** — logic errors, off-by-ones, race conditions
- **Security** — XSS, injection, key exposure, insecure defaults
- **Protocol correctness** — crypto usage, message format, CRDT invariants
- **Missing error handling** — unhandled promises, missing try/catch
- **API misuse** — wrong method calls, incorrect argument order
- **Test coverage gaps** — new code paths with no tests
- **Dead code** — unreachable branches, unused vars

## Output

Results go to stdout and `review-output/YYYY-MM-DD-HH-MM.md`.

If no issues are found, the file is not created (exit 0 means clean).

## Skipping Review

If you want to skip:

```bash
SKIP_REVIEW=1 ./scripts/deploy.sh
```

Or just don't run `review.sh` manually. It's not enforced — it's a tool, not a gate.
