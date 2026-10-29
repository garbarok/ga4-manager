#!/usr/bin/env bash
# Fail when personal data would leave this machine.
#
#   scripts/scan-private.sh --staged        # added lines + names of staged files (pre-commit)
#   scripts/scan-private.sh --msg FILE      # a commit message (commit-msg)
#   scripts/scan-private.sh PATH...         # files, dirs, binaries, .tgz/.tar.gz/.zip/.mcpb (release)
#
# Patterns: your $HOME path (it leaks the username through build paths) plus
# every non-comment line of .githooks/denylist.local, matched as fixed,
# case-insensitive strings. That file is gitignored: list your site names,
# account IDs and emails there, one per line.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
DENYLIST="$ROOT/.githooks/denylist.local"
PATTERNS="$(mktemp)"
WORK="$(mktemp -d)"
trap 'rm -rf "$PATTERNS" "$WORK"' EXIT

[ -n "${HOME:-}" ] && [ "$HOME" != "/" ] && printf '%s/\n' "$HOME" >"$PATTERNS"
if [ -f "$DENYLIST" ]; then
  grep -vE '^[[:space:]]*(#|$)' "$DENYLIST" | sed 's/[[:space:]]*$//' >>"$PATTERNS" || true
else
  echo "scan-private: no $DENYLIST yet; only checking for \$HOME paths" >&2
fi

report() {
  echo "scan-private: personal data found in $1:" >&2
  sed 's/^/  /' >&2
  echo "Remove it, or edit .githooks/denylist.local if this is a false positive." >&2
  exit 1
}

case "${1:-}" in
  --staged)
    hits="$( { git diff --cached --name-only --diff-filter=ACMR; git diff --cached -U0 --no-color | grep -E '^\+' | grep -vE '^\+\+\+ '; } | grep -iF -f "$PATTERNS" || true)"
    [ -z "$hits" ] || report "staged changes" <<<"$hits"
    ;;
  --msg)
    hits="$(grep -vE '^#' "$2" | grep -iF -f "$PATTERNS" || true)"
    [ -z "$hits" ] || report "the commit message" <<<"$hits"
    ;;
  "")
    echo "usage: $0 --staged | --msg FILE | PATH..." >&2
    exit 2
    ;;
  *)
    n=0
    for p in "$@"; do
      n=$((n + 1))
      dest="$WORK/$n"
      mkdir -p "$dest"
      case "$p" in
        *.tgz | *.tar.gz) tar xzf "$p" -C "$dest" ;;
        *.zip | *.mcpb) unzip -q "$p" -d "$dest" ;;
        *) cp -R "$p" "$dest/" ;;
      esac
    done
    # -a reads binaries as text, so embedded build paths show up too.
    hits="$(grep -raliF -f "$PATTERNS" "$WORK" | sed "s#^$WORK/[0-9]*/##" || true)"
    [ -z "$hits" ] || report "these files" <<<"$hits"
    ;;
esac
