#!/usr/bin/env bash
#
# HITL (human-in-the-loop) companion to scripts/afk-issues.sh.
#
# Runs ONE Claude Code iteration on ONE specific GitHub issue, with you
# watching live. Use this to validate the prompt template before going AFK
# (Ralph tip #2: "Start With HITL, Then Go AFK").
#
# Same prompt template as afk-issues.sh — refining the prompt here means
# refining build_prompt() in that script too.
#
# Usage:
#   ./scripts/ralph-once.sh 20                 # run one iteration on issue #20
#   USE_SANDBOX=1 ./scripts/ralph-once.sh 20   # in docker sandbox
#
# Requirements: claude CLI, gh CLI, jq, tee, grep
#
set -uo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <issue-number>" >&2
  exit 1
fi

ISSUE="$1"
USE_SANDBOX="${USE_SANDBOX:-0}"
REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

cd "$REPO_DIR"

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

# Identical prompt to afk-issues.sh — keep these in sync.
build_prompt() {
  local n="$1"
  cat <<EOF
You are implementing GitHub issue #$n in the repo $REPO. This is a Ralph
Wiggum-style autonomous loop iteration: read state from git + progress file,
do one logical chunk of work, commit, then either declare COMPLETE or stop so
the next iteration can pick up where you left off.

# Quality bar (read this first)

This codebase will outlive you. Every shortcut becomes someone else's burden.
Every hack compounds into technical debt that slows the whole team down.

You are not just writing code. You are shaping the future of this project.
The patterns you establish will be copied. The corners you cut will be cut
again.

Fight entropy. Leave the codebase better than you found it.

# Scope (the contract)

Issue #$n is the scope. Its "Acceptance criteria" checklist is the contract.
You are NOT done until every box can be checked truthfully. Do not redefine
"done" to fit what you have built. Do not skip criteria you find inconvenient.

# Workflow

1. **Read scope:** \`gh issue view $n --repo $REPO\` — read body and every
   acceptance criterion. Then read \`gh issue view 18 --repo $REPO\` for the
   parent PRD context.

2. **Read repo standards:** \`CLAUDE.md\`, then \`docs/superpowers/specs/\` for
   any specs touching this work. Match existing conventions in \`mcp/src/\`.

3. **Pick up the branch:**
   - If a branch \`mcp-tools/issue-$n\` already exists, check it out and read
     \`progress-$n.txt\` (committed at branch root) to see what previous
     iterations have done.
   - Otherwise create the branch from default and create an empty
     \`progress-$n.txt\`.

4. **Pick the next acceptance criterion:** Look at the issue's checklist.
   Pick the highest-priority unchecked criterion that is not blocked by
   another. Risky/architectural criteria first, polish last.

5. **Implement small:** Do that ONE criterion. Take small steps. Prefer
   multiple small commits within this branch over one giant commit. Match
   existing patterns:
   - Tools follow the Vitest pattern in \`mcp/src/tools/*.test.ts\`
   - Use existing utility shape in \`mcp/src/utils/\`
   - Types defined in \`mcp/src/types/\`

6. **Run ALL feedback loops before committing.** All must pass:
   - \`cd mcp && npm run build\`     (TypeScript typecheck)
   - \`cd mcp && npm run test:run\`  (Vitest, single-shot)
   - \`cd mcp && npm run lint\`      (ESLint)

   Do NOT commit if any feedback loop fails. Fix issues first.

7. **Update progress:** append a brief entry to \`progress-$n.txt\`:
   - Acceptance criterion completed (paraphrased)
   - Files touched
   - Decisions made and reasoning (one line each)
   - Blockers or notes for next iteration
   Sacrifice grammar for concision. This file helps future iterations skip
   exploration.

8. **Commit:** message format
   \`\`\`
   <type>(scope): one-line summary

   refs #$n — <which acceptance criterion>
   \`\`\`
   Where <type> is feat|fix|test|docs|refactor|chore.

9. **Push the branch.**

10. **PR management:**
    - If no PR exists for \`mcp-tools/issue-$n\`, open one referencing #$n.
      Body: list acceptance criteria as a checklist; check the ones now
      complete.
    - If a PR exists, update its body checklist via \`gh pr edit\`.

11. **Stop condition:**
    - If every acceptance criterion is now checked AND all three feedback
      loops pass clean AND the PR is open with the up-to-date checklist,
      print on its own line:
      \`<promise>COMPLETE</promise>\`
    - Otherwise stop after this single criterion. The next iteration will
      pick up the next one.

# Hard rules

- Do NOT commit failing tests. Do NOT commit failing typecheck. Do NOT commit
  lint errors. If a feedback loop fails, fix it before committing.
- Do NOT redefine acceptance criteria. If you genuinely cannot satisfy one,
  print \`<promise>BLOCKED: <one-line reason></promise>\` and stop. Leave
  any partial work uncommitted unless tests pass on it.
- Do NOT skip the progress file. It is the only memory between iterations.
- Do NOT auto-merge the PR. Human reviews and merges.
- Dependencies of this issue should be merged already. If they are not but
  their work exists on another branch, branch this work off that branch and
  note it in the PR description.

# Dependency context

Read the "Blocked by" section of issue #$n. Those issues should be CLOSED.
If they are merged: branch off main as instructed. If they are open but their
work exists on a feature branch: branch off that branch and note it in the
PR description.
EOF
}

STREAM_TEXT='select(.type == "assistant").message.content[]? | select(.type == "text").text // empty | gsub("\n"; "\r\n") | . + "\r\n\n"'
FINAL_RESULT='select(.type == "result").result // empty'

prompt=$(build_prompt "$ISSUE")
tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT

echo "═══ HITL Ralph — issue #$ISSUE ═══"
echo "Watch the output. Step in if it goes off-rails."
echo

if [[ "$USE_SANDBOX" == "1" ]]; then
  claude_invoke=(docker sandbox run --credentials host claude)
else
  claude_invoke=(claude)
fi

"${claude_invoke[@]}" \
  --verbose \
  --print \
  --output-format stream-json \
  --dangerously-skip-permissions \
  "$prompt" \
| grep --line-buffered '^{' \
| tee "$tmpfile" \
| jq --unbuffered -rj "$STREAM_TEXT"

result=$(jq -r "$FINAL_RESULT" "$tmpfile" 2>/dev/null || echo "")

echo
echo "═══════════════════════════════════════════════════════════════════"
if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
  echo "✅ Iteration declared COMPLETE for #$ISSUE."
elif [[ "$result" == *"<promise>BLOCKED:"* ]]; then
  echo "⚠️  Iteration declared BLOCKED:"
  echo "$result" | grep -o '<promise>BLOCKED:[^<]*</promise>' | head -1
else
  echo "⏸  Iteration finished without COMPLETE marker."
  echo "   Inspect git status / progress-$ISSUE.txt and decide:"
  echo "   - rerun this script for next chunk"
  echo "   - edit build_prompt() in scripts/afk-issues.sh and ralph-once.sh"
  echo "   - or graduate to AFK with: ./scripts/afk-issues.sh"
fi
