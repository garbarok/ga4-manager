#!/usr/bin/env bash
#
# AFK runner for the MCP SEO/traffic tools issues (PRD #18).
#
# Implements the Ralph Wiggum loop pattern (https://ghuntley.com/ralph/) tailored
# to this repo: each iteration picks one OPEN issue from a topologically-sorted
# list, spawns a Claude Code session whose prompt embeds the 11 Ralph tips
# (scope, progress tracking, feedback loops, small steps, quality clause), and
# streams the session output live via stream-json + jq + tee.
#
# Walks issues #20–#29 in topological order. Issue #19 is HITL (manual curl);
# this script never auto-runs it. If #19 is still OPEN when we reach #28
# (which depends on it), #28 is skipped with a warning and the script exits 0.
#
# Recommended workflow per Ralph tip #2:
#   1. Use scripts/ralph-once.sh ISSUE_NUMBER first to verify the prompt works
#      on one issue with you watching (HITL).
#   2. Refine the prompt template in build_prompt() if needed.
#   3. Then run this script unattended (AFK).
#
# Usage:
#   ./scripts/afk-issues.sh                    # run with defaults
#   MAX_ITERS=3 ./scripts/afk-issues.sh        # cap retries per issue
#   DRY_RUN=1 ./scripts/afk-issues.sh          # print what would run, don't spawn claude
#   ONLY=20,25 ./scripts/afk-issues.sh         # restrict to specific issues
#   USE_SANDBOX=1 ./scripts/afk-issues.sh      # wrap claude in 'docker sandbox run' (Ralph tip #9)
#
# Requirements: claude CLI, gh CLI, jq, tee, grep
#   USE_SANDBOX=1 also requires: docker CLI with sandbox extension installed
#
set -uo pipefail

# ── Config ──────────────────────────────────────────────────────────────────

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
MAX_ITERS="${MAX_ITERS:-5}"
DRY_RUN="${DRY_RUN:-0}"
ONLY="${ONLY:-}"
USE_SANDBOX="${USE_SANDBOX:-0}"

# Topological order. #19 omitted (HITL — manual curl).
# #30 first: independent Go-side bug (tablewriter v1 break) that should land
# before MCP work to keep `make build` green. PRD #18 issues follow.
ALL_ISSUES=(30 20 21 22 24 23 25 26 27 29 28)

# Per-issue dependency map. Used only for "skip if dep still OPEN" check.
# Function-based to stay portable on macOS bash 3.2 (no associative arrays).
get_deps() {
  case "$1" in
    20) echo "" ;;
    21) echo "20" ;;
    22) echo "20" ;;
    23) echo "20 22" ;;
    24) echo "20" ;;
    25) echo "20" ;;
    26) echo "25" ;;
    27) echo "25" ;;
    28) echo "19 25" ;;   # 19 is HITL — script will skip 28 if 19 still open
    29) echo "25" ;;
    30) echo "" ;;        # tablewriter v1 build break — independent
  esac
}

# jq filters from the Ralph article.
STREAM_TEXT='select(.type == "assistant").message.content[]? | select(.type == "text").text // empty | gsub("\n"; "\r\n") | . + "\r\n\n"'
FINAL_RESULT='select(.type == "result").result // empty'

# ── Pre-flight ──────────────────────────────────────────────────────────────

for tool in claude gh jq tee grep mktemp; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: required tool '$tool' not found in PATH" >&2
    exit 127
  fi
done

cd "$REPO_DIR"

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
if [[ -z "$REPO" ]]; then
  echo "ERROR: could not detect repo via 'gh repo view' in $REPO_DIR" >&2
  exit 2
fi

echo "═══════════════════════════════════════════════════════════════════"
echo " AFK runner — repo: $REPO"
echo " issues:       ${ALL_ISSUES[*]}"
echo " max iters:    $MAX_ITERS  (per issue)"
echo " dry run:      $DRY_RUN"
echo " sandbox:      $USE_SANDBOX"
[[ -n "$ONLY" ]] && echo " ONLY filter:  $ONLY"
echo "═══════════════════════════════════════════════════════════════════"
echo

if [[ "$USE_SANDBOX" == "1" ]] && ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: USE_SANDBOX=1 but 'docker' not in PATH" >&2
  exit 127
fi

# ── Helpers ─────────────────────────────────────────────────────────────────

is_closed() {
  local n="$1"
  local state
  state=$(gh issue view "$n" --repo "$REPO" --json state -q .state 2>/dev/null || echo "OPEN")
  [[ "$state" == "CLOSED" ]]
}

in_only_filter() {
  local n="$1"
  [[ -z "$ONLY" ]] && return 0
  IFS=',' read -ra arr <<< "$ONLY"
  for x in "${arr[@]}"; do
    [[ "$x" == "$n" ]] && return 0
  done
  return 1
}

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

6. **Run ALL feedback loops appropriate to what you changed.** All must pass.

   If you changed Go files (\`cmd/\`, \`internal/\`, \`go.mod\`):
   - \`make build\`   (compiles \`./ga4\`; equivalent to \`go build ./...\`)
   - \`make test\`    (\`go test ./...\`)
   - \`make lint\`    (golangci-lint)

   If you changed TypeScript / MCP files (\`mcp/\`):
   - \`cd mcp && npm run build\`     (TypeScript typecheck)
   - \`cd mcp && npm run test:run\`  (Vitest, single-shot)
   - \`cd mcp && npm run lint\`      (ESLint)

   If you changed both: run both sets. Do NOT commit if any feedback loop
   fails. Fix issues first.

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

# ── Main loop ───────────────────────────────────────────────────────────────

for n in "${ALL_ISSUES[@]}"; do
  if ! in_only_filter "$n"; then
    continue
  fi

  if is_closed "$n"; then
    echo "▶ #$n already closed, skipping."
    continue
  fi

  # Dep check: skip if any dep is still OPEN.
  blocked_by=""
  for d in $(get_deps "$n"); do
    if ! is_closed "$d"; then
      blocked_by="$d"
      break
    fi
  done
  if [[ -n "$blocked_by" ]]; then
    echo "⏸  #$n blocked by open #$blocked_by, skipping."
    continue
  fi

  echo
  echo "═══ #$n ═══════════════════════════════════════════════════════════"

  if [[ "$DRY_RUN" == "1" ]]; then
    echo "(dry run — would spawn claude with prompt for #$n)"
    continue
  fi

  prompt=$(build_prompt "$n")
  result=""

  for ((i=1; i<=MAX_ITERS; i++)); do
    echo "── iteration $i/$MAX_ITERS ──"
    tmpfile=$(mktemp)
    trap 'rm -f "$tmpfile"' EXIT

    # The Ralph streaming pattern:
    #   stream-json → grep keeps only JSON lines → tee captures full stream
    #   to tmpfile → jq extracts assistant text and renders to terminal.
    #
    # USE_SANDBOX=1 wraps in 'docker sandbox run' (Ralph tip #9). Trades off
    # global ~/.claude config / skills for filesystem isolation.
    if [[ "$USE_SANDBOX" == "1" ]]; then
      claude_invoke=(docker sandbox run --credentials host claude)
    else
      claude_invoke=(claude)
    fi

    if "${claude_invoke[@]}" \
        --verbose \
        --print \
        --output-format stream-json \
        --dangerously-skip-permissions \
        "$prompt" \
      | grep --line-buffered '^{' \
      | tee "$tmpfile" \
      | jq --unbuffered -rj "$STREAM_TEXT"
    then
      :
    else
      echo
      echo "WARN: claude exited non-zero on iteration $i"
    fi

    result=$(jq -r "$FINAL_RESULT" "$tmpfile" 2>/dev/null || echo "")
    rm -f "$tmpfile"

    if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
      echo
      echo "✅ #$n complete after $i iteration(s)."
      break
    fi
    if [[ "$result" == *"<promise>BLOCKED:"* ]]; then
      echo
      echo "⚠️  #$n reported BLOCKED. Halting AFK run."
      echo "    Reason: $(echo "$result" | grep -o '<promise>BLOCKED:[^<]*</promise>' | head -1)"
      exit 4
    fi

    echo
    echo "(no COMPLETE marker; iteration $i finished without completion)"
  done

  if [[ "$result" != *"<promise>COMPLETE</promise>"* ]]; then
    echo
    echo "❌ #$n did not complete after $MAX_ITERS iteration(s). Halting AFK run."
    exit 3
  fi
done

echo
echo "═══════════════════════════════════════════════════════════════════"
echo " 🎉 All eligible issues processed."
echo "═══════════════════════════════════════════════════════════════════"

# Reminder if #19 is still open (it would have caused #28 to skip).
if ! is_closed 19; then
  echo
  echo "Reminder: issue #19 (GA4 Consent Mode dimension preflight) is HITL"
  echo "and still OPEN. #28 (ga4_consent_health implementation) was skipped."
  echo "Run the curl test from #19 manually, close #19 with the result, then"
  echo "rerun this script with ONLY=28 to ship #28."
fi
