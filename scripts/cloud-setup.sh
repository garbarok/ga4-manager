#!/usr/bin/env bash
#
# Setup script for a Claude Code cloud environment: installs the ga4 CLI and the
# ga4-manager-mcp package, so the MCP server starts with no downloads.
#
# Paste this line as the environment's "Setup script" (claude.ai/code → the
# environment → Edit → Setup script):
#
#   curl -fsSL https://raw.githubusercontent.com/garbarok/ga4-manager/main/scripts/cloud-setup.sh | bash
#
# Pin a version instead of the latest npm release:
#
#   curl -fsSL https://raw.githubusercontent.com/garbarok/ga4-manager/main/scripts/cloud-setup.sh | GA4M_VERSION=5.0.1 bash
#
# Cloud setup scripts run as root on Ubuntu 24.04 (x86_64) BEFORE the
# environment's variables are set, so this script reads no credentials or API
# keys. The server reads those from the environment when it starts
# (GA4_CREDENTIALS_B64 and the rest; see mcp/CLOUD.md).
#
# The ga4 binary comes from the GitHub release, checked against checksums.txt.
# If the release download is blocked, it is built from source with
# `go install` through proxy.golang.org, at the commit npm recorded for that
# version (gitHead). Both hosts are on the cloud environments' default allowlist.
#
# Nothing here is tied to one account: it only downloads public releases. A fork
# that publishes its own builds sets GA4M_REPO (owner/name for releases),
# GA4M_NPM_PACKAGE and, if it renamed the Go module, GA4M_GO_MODULE.
set -euo pipefail

REPO="${GA4M_REPO:-garbarok/ga4-manager}"
NPM_PACKAGE="${GA4M_NPM_PACKAGE:-ga4-manager-mcp}"
GO_MODULE="${GA4M_GO_MODULE:-github.com/garbarok/ga4-manager}"
VERSION="${GA4M_VERSION:-$(npm view "$NPM_PACKAGE" version)}"
VERSION="${VERSION#v}"
BIN_DIR="${GA4M_BIN_DIR:-/usr/local/bin}"

case "$(uname -s)/$(uname -m)" in
  Linux/x86_64 | Linux/amd64) ARCH=amd64 ;;
  Linux/aarch64 | Linux/arm64) ARCH=arm64 ;;
  *) echo "cloud-setup: unsupported platform $(uname -s)/$(uname -m)" >&2; exit 1 ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
log() { printf 'cloud-setup: %s\n' "$*" >&2; }

install_from_release() {
  local base="https://github.com/$REPO/releases/download/v$VERSION"
  local tarball="ga4-manager-$VERSION-linux-$ARCH.tar.gz"
  curl -fsSL --retry 3 -o "$TMP/$tarball" "$base/$tarball" || return 1
  curl -fsSL --retry 3 -o "$TMP/checksums.txt" "$base/checksums.txt" || return 1
  (cd "$TMP" && grep "  $tarball\$" checksums.txt | sha256sum -c --quiet -) || { log "checksum mismatch for $tarball"; return 1; }
  tar -xzf "$TMP/$tarball" -C "$TMP" ga4
  install -m 0755 "$TMP/ga4" "$BIN_DIR/ga4"
}

install_from_source() {
  command -v go >/dev/null || { log "go is not installed"; return 1; }
  # The module path has no /vN suffix, so Go rejects v2+ tags; install the
  # release commit instead. npm records it as gitHead when the package is published.
  local commit
  commit="$(npm view "$NPM_PACKAGE@$VERSION" gitHead)"
  [ -n "$commit" ] || { log "npm has no gitHead for $NPM_PACKAGE@$VERSION"; return 1; }
  GOTOOLCHAIN=auto GOFLAGS= GOBIN="$TMP/gobin" go install -trimpath \
    -ldflags "-s -w -X '$GO_MODULE/cmd.Version=v$VERSION'" \
    "$GO_MODULE@$commit"
  install -m 0755 "$TMP/gobin/${GO_MODULE##*/}" "$BIN_DIR/ga4"
}

log "ga4-manager $VERSION (linux/$ARCH) -> $BIN_DIR"
mkdir -p "$BIN_DIR"
if ! install_from_release; then
  log "release download failed; building from source with go install"
  install_from_source
fi
"$BIN_DIR/ga4" --version >&2

# The MCP server and the ga4m CLI. Installed globally so `npx ga4-manager-mcp`
# in a repo's .mcp.json finds it without a registry round trip.
npm install --global --no-fund --no-audit "$NPM_PACKAGE@$VERSION" >&2
log "done: $(command -v ga4-manager-mcp) and $(command -v ga4m)"
