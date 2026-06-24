#!/usr/bin/env bash
#
# Build a packaged MCPB bundle for the GA4 Manager MCP server.
#
# The bundle ships its own runtime: the compiled Node server, its production
# node_modules, and a prebuilt `ga4` Go binary for ONE target platform. The
# manifest points GA4_BINARY_PATH at the bundled binary, so the user installs a
# single .mcpb file and needs neither Node nor Go.
#
# Usage:
#   scripts/build-mcpb.sh                # build for the host platform
#   scripts/build-mcpb.sh linux/amd64    # cross-compile for another platform
#   scripts/build-mcpb.sh darwin/arm64
#
# Output: dist-mcpb/ga4-manager-mcp-<goos>-<goarch>.mcpb
set -euo pipefail

# ---- paths -----------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$MCP_DIR/.." && pwd)"
STAGE="$MCP_DIR/build/mcpb"
DEPLOY="$MCP_DIR/build/deploy"
OUT_DIR="$MCP_DIR/dist-mcpb"

# ---- resolve target platform ----------------------------------------------
TARGET="${1:-$(go env GOOS)/$(go env GOARCH)}"
GOOS="${TARGET%%/*}"
GOARCH="${TARGET##*/}"

# Map Go's GOOS to the MCPB platform vocabulary (darwin/linux/win32).
case "$GOOS" in
  darwin) MCPB_PLATFORM="darwin" ;;
  linux)  MCPB_PLATFORM="linux" ;;
  windows) MCPB_PLATFORM="win32" ;;
  *) echo "Unsupported GOOS: $GOOS" >&2; exit 1 ;;
esac

GA4_BIN="ga4"
[ "$GOOS" = "windows" ] && GA4_BIN="ga4.exe"

echo ">> Building MCPB for $GOOS/$GOARCH (mcpb platform: $MCPB_PLATFORM)" >&2

# ---- 1. compile the Node server -------------------------------------------
echo ">> tsc build" >&2
( cd "$MCP_DIR" && pnpm run build >/dev/null )

# ---- 2. stage the server + production deps ---------------------------------
# `pnpm deploy` resolves the production dependency closure from the workspace
# lockfile and materialises it as real files (hoisted linker → no store
# symlinks), so the bundle is self-contained and portable. It copies the whole
# package dir, though, so we deploy to a temp dir and cherry-pick just the
# runtime bits (compiled JS + package.json + node_modules) into the bundle.
echo ">> staging server/ via pnpm deploy (prod, hoisted)" >&2
rm -rf "$STAGE" "$DEPLOY"
mkdir -p "$STAGE/server" "$STAGE/bin"
( cd "$MCP_DIR" && pnpm --filter ga4-manager-mcp deploy --prod --legacy \
    --config.node-linker=hoisted "$DEPLOY" >/dev/null 2>&1 )
mv "$DEPLOY/node_modules" "$STAGE/server/node_modules"
cp "$DEPLOY/package.json" "$STAGE/server/package.json"
cp -R "$MCP_DIR/dist" "$STAGE/server/dist"
rm -rf "$STAGE/server/node_modules/.bin"   # dev CLI shims; the server needs none
rm -rf "$DEPLOY"

# ---- 3. cross-compile the ga4 Go binary -----------------------------------
echo ">> go build ga4 -> bin/$GA4_BIN" >&2
( cd "$REPO_ROOT" && GOOS="$GOOS" GOARCH="$GOARCH" CGO_ENABLED=0 \
    go build -trimpath -ldflags="-s -w" -o "$STAGE/bin/$GA4_BIN" . )
chmod +x "$STAGE/bin/$GA4_BIN" 2>/dev/null || true

# ---- 4. stage the manifest (sync version, pin platform, handle icon) -------
echo ">> assembling manifest.json" >&2
cp "$MCP_DIR/manifest.json" "$STAGE/manifest.json"
if [ -f "$MCP_DIR/icon.png" ]; then
  cp "$MCP_DIR/icon.png" "$STAGE/icon.png"
  HAS_ICON=1
else
  HAS_ICON=0
fi
MCP_DIR="$MCP_DIR" STAGE="$STAGE" MCPB_PLATFORM="$MCPB_PLATFORM" GA4_BIN="$GA4_BIN" \
HAS_ICON="$HAS_ICON" node <<'NODE'
const fs = require('fs');
const path = require('path');
const { MCP_DIR, STAGE, MCPB_PLATFORM, GA4_BIN, HAS_ICON } = process.env;
const pkg = JSON.parse(fs.readFileSync(path.join(MCP_DIR, 'package.json'), 'utf8'));
const manifestPath = path.join(STAGE, 'manifest.json');
const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
m.version = pkg.version;                       // single source of truth: package.json
m.compatibility.platforms = [MCPB_PLATFORM];   // this bundle ships one platform's binary
m.server.mcp_config.env.GA4_BINARY_PATH = `\${__dirname}/bin/${GA4_BIN}`;
if (HAS_ICON !== '1') delete m.icon;           // no icon file -> drop the reference
fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
console.error(`   version ${m.version}, platforms ${JSON.stringify(m.compatibility.platforms)}`);
NODE

# ---- 5. validate + pack ----------------------------------------------------
echo ">> validating bundle" >&2
npx --yes @anthropic-ai/mcpb validate "$STAGE/manifest.json" >&2

mkdir -p "$OUT_DIR"
OUTFILE="$OUT_DIR/ga4-manager-mcp-$GOOS-$GOARCH.mcpb"
echo ">> packing -> $OUTFILE" >&2
npx --yes @anthropic-ai/mcpb pack "$STAGE" "$OUTFILE" >&2

echo "$OUTFILE"
