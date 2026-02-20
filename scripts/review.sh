#!/bin/bash
# AI code review using local claude agent
# Usage: ./scripts/review.sh [--staged | <git range>]
# e.g.:  ./scripts/review.sh           → diff since last commit
#        ./scripts/review.sh --staged   → staged changes only
#        ./scripts/review.sh main..HEAD → explicit range

set -e
cd "$(dirname "$0")/.."

OUTPUT_DIR="review-output"
TIMESTAMP=$(date +"%Y-%m-%d-%H-%M")
OUTPUT_FILE="$OUTPUT_DIR/$TIMESTAMP.md"

# Get the diff
if [[ "$1" == "--staged" ]]; then
  echo "🔍 Reviewing staged changes..."
  DIFF=$(git diff --cached)
  LABEL="staged"
elif [[ -n "$1" ]]; then
  echo "🔍 Reviewing range: $1"
  DIFF=$(git diff "$1")
  LABEL="$1"
else
  echo "🔍 Reviewing uncommitted changes (HEAD)..."
  DIFF=$(git diff HEAD)
  LABEL="HEAD"
fi

if [[ -z "$DIFF" ]]; then
  echo "✅ No changes to review."
  exit 0
fi

DIFF_LINES=$(echo "$DIFF" | wc -l | tr -d ' ')
echo "📄 Diff size: $DIFF_LINES lines"

PROMPT="You are reviewing code for the DecentChat project — a P2P encrypted chat protocol and PWA built with Bun/TypeScript/Vite/PeerJS/Web Crypto API.

Review the following git diff and flag ONLY real issues. Be concise. Skip praise.

Categories to check:
- Bugs (logic errors, race conditions, off-by-ones)
- Security (key exposure, XSS, injection, insecure defaults, crypto misuse)
- Protocol correctness (CRDT invariants, hash chain integrity, E2E encryption)
- Unhandled errors (missing try/catch, unhandled promises)
- API misuse (wrong method signatures, incorrect usage)
- Missing tests for new critical code paths

Format your response EXACTLY as follows (do not deviate from this structure):

## Summary
One sentence overall assessment.

## Issues Found

For each issue, use this block format:

---
**[SEVERITY: critical|high|medium|low]** \`file:line\`
**Issue:** Clear description of what is wrong and why it matters.
**Suggested fix:** What to change.

**🤖 Fix prompt:**
\`\`\`
In \`<file>\` around line <N>, <precise description of the problem using exact
variable/function names from the code>. Fix by <specific steps>. Reference
<relevant functions/constants> in the fix. Verify with <test or check>.
\`\`\`
---

## No Issues
(replace the Issues Found section with this if everything looks fine)

---
$DIFF"

echo ""
echo "🤖 Running review agent..."
echo ""

RESULT=$(claude -p "$PROMPT" --output-format text)

echo "$RESULT"

# Save if issues found
WORD_COUNT=$(echo "$RESULT" | wc -w | tr -d ' ')
if [[ "$WORD_COUNT" -gt 50 ]]; then
  mkdir -p "$OUTPUT_DIR"
  {
    echo "# Code Review — $LABEL ($TIMESTAMP)"
    echo ""
    echo "$RESULT"
  } > "$OUTPUT_FILE"
  echo ""
  echo "💾 Saved to $OUTPUT_FILE"
fi
