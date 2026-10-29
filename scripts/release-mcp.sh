#!/usr/bin/env bash
# Release the MCP server and CLI from this machine (there is no CI).
#
#   scripts/release-mcp.sh 4.1.0          # full release
#   scripts/release-mcp.sh 4.1.0 --dry-run  # checks only, changes nothing
#
# Steps: preflight → bump mcp/package.json + mcp/manifest.json → move the
# mcp/CHANGELOG.md "Unreleased" section under the new version → full checks →
# personal-data scan of a trimpath binary → commit, tag vX.Y.Z, push →
# GoReleaser (binaries) from a clean worktree → .mcpb bundle, scanned, then
# uploaded → npm tarball scanned and smoke-tested by prepublishOnly → npm
# publish (asks for 2FA in the browser). Re-running after a failure is safe up to the push; after that,
# finish the remaining steps by hand.
set -euo pipefail

VERSION="${1:-}"
DRY_RUN="${2:-}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: $0 X.Y.Z [--dry-run]" >&2
  exit 1
fi
TAG="v$VERSION"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
step() { printf '\n\033[1m>> %s\033[0m\n' "$*"; }

step "Preflight"
[ "$(git branch --show-current)" = "main" ] || { echo "not on main" >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "tracked files have uncommitted changes" >&2; exit 1; }
git fetch -q origin main --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "main is not in sync with origin/main" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && { echo "tag $TAG already exists" >&2; exit 1; }
npm view "ga4-manager-mcp@$VERSION" version >/dev/null 2>&1 && { echo "ga4-manager-mcp@$VERSION is already on npm" >&2; exit 1; }
UNRELEASED="$(awk '/^## \[Unreleased\]/{f=1;next} /^## \[/{f=0} f' mcp/CHANGELOG.md | grep -c '[^[:space:]]' || true)"
[ "$UNRELEASED" -gt 0 ] || { echo "mcp/CHANGELOG.md has nothing under [Unreleased]" >&2; exit 1; }
[ "$(git config core.hooksPath)" = ".githooks" ] || { echo "git hooks are off: run make install-hooks" >&2; exit 1; }
if [ "$DRY_RUN" != "--dry-run" ]; then
  npm whoami >/dev/null 2>&1 || { echo "not logged in to npm: run npm login first" >&2; exit 1; }
fi

step "Checks"
(cd mcp && pnpm run lint && pnpm exec tsc --noEmit && pnpm run test:run)
go test ./...
make lint
SCAN="$(mktemp -d)"
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "$SCAN/ga4" .
git archive --format=tar.gz -o "$SCAN/tree.tar.gz" HEAD
(cd mcp && npm pack --ignore-scripts --silent --pack-destination "$SCAN" >/dev/null)
scripts/scan-private.sh "$SCAN/ga4" "$SCAN/tree.tar.gz" "$SCAN"/ga4-manager-mcp-*.tgz
rm -rf "$SCAN"
(cd mcp && pnpm run build >/dev/null && pnpm run smoke:pack)
if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "dry run: checks passed, nothing changed"
  exit 0
fi

step "Bump to $VERSION"
node -e '
  const fs = require("fs"), v = process.argv[1]
  for (const f of ["mcp/package.json", "mcp/manifest.json"]) {
    const j = JSON.parse(fs.readFileSync(f, "utf8")); j.version = v
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n")
  }' "$VERSION"
perl -0pi -e "s/^## \\[Unreleased\\]\\n/## [Unreleased]\\n\\n## [$VERSION] - $(date +%Y-%m-%d)\\n/m" mcp/CHANGELOG.md

step "Commit, tag and push"
git add mcp/package.json mcp/manifest.json mcp/CHANGELOG.md
git commit -q -m "chore(mcp): release $VERSION"
git tag -a "$TAG" -m "ga4-manager $VERSION"
git push -q origin main "$TAG"

step "GitHub release (GoReleaser, clean worktree)"
WT="$(mktemp -d)/release"
git worktree add -q --detach "$WT" "$TAG"
trap 'git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true' EXIT
(cd "$WT" && GITHUB_TOKEN="$(gh auth token)" go run github.com/goreleaser/goreleaser/v2@latest release --clean)

step ".mcpb bundle"
(cd mcp && pnpm run pack:mcpb && rm -rf build)   # build/ is staging; left behind it trips eslint
scripts/scan-private.sh mcp/dist-mcpb/*.mcpb
gh release upload "$TAG" mcp/dist-mcpb/*.mcpb --clobber

step "npm publish: press ENTER at the link and approve 2FA right away (it expires in minutes)"
(cd mcp && npm publish --access public)

step "Done: $TAG"
echo "npm can take a few minutes to show the version: npm view ga4-manager-mcp version"
