#!/usr/bin/env bash
#
# Build the optaris-gateway sidecar binary into resources/bin/<arch>/.
#
# Usage:
#   build-gateway.sh               Build for the host platform (used by `predev` so
#                                  the binary is in place before dev boots).
#   build-gateway.sh <os>/<arch>   Cross-compile one target, e.g. linux/amd64,
#                                  windows/amd64, darwin/arm64, darwin/amd64.
#
# The packaging phase (package.json build:<os>[:arch] scripts) drives the platform
# matrix by passing the right target here before electron-builder runs. macOS ships
# as two separate per-arch artifacts (arm64 and x64), each built with its matching
# binary — not a universal fat binary.
#
# The build is static (CGO_ENABLED=0) so it needs no C toolchain and cross-compiles
# cleanly, including the pure-Go modernc.org/sqlite dependency.
#
# Output layout: the binary lands in resources/bin/<electron-arch>/ (arm64 or x64,
# electron-builder's arch naming — not Go's amd64). This per-arch directory lets a
# single `electron-builder --mac --arm64 --x64` invocation pick the matching binary
# via `extraResources: from: resources/bin/${arch}`, so both mac architectures ship
# in one build pass and share a single auto-update feed (latest-mac.yml). It also
# lets both mac binaries coexist on disk; each build only clears its own arch dir so
# a prior arch is never overwritten. The dev/packaged path resolution lives in
# resolveBinaryPath() in src/main/gateway.ts.
#
# The output binary is always named optaris-gateway (optaris-gateway.exe on Windows).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATEWAY_DIR="$ROOT/gateway"

# Compile a single GOOS/GOARCH into the given output path.
build_one() {
  local goos="$1" goarch="$2" out="$3"
  echo "[build-gateway] building GOOS=$goos GOARCH=$goarch -> $out"
  (
    cd "$GATEWAY_DIR"
    CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
      go build -trimpath -ldflags="-s -w" -o "$out" .
  )
  # Preserve the executable bit (matters for Linux/macOS packaging).
  chmod +x "$out" 2>/dev/null || true
}

# Resolve the target OS/arch. An explicit "<os>/<arch>" arg wins; otherwise fall back
# to any GOOS/GOARCH in the environment, then to the host toolchain defaults.
TARGET="${1:-}"
if [ -n "$TARGET" ]; then
  OS="${TARGET%%/*}"
  ARCH="${TARGET##*/}"
else
  OS="${GOOS:-$(cd "$GATEWAY_DIR" && go env GOOS)}"
  ARCH="${GOARCH:-$(cd "$GATEWAY_DIR" && go env GOARCH)}"
fi

# Map Go's arch naming to electron-builder's, so the output dir matches the ${arch}
# macro used in electron-builder.yml (Go amd64 -> electron x64; arm64 is the same).
case "$ARCH" in
  amd64) ELECTRON_ARCH="x64" ;;
  arm64) ELECTRON_ARCH="arm64" ;;
  *) ELECTRON_ARCH="$ARCH" ;;
esac

OUT_DIR="$ROOT/resources/bin/$ELECTRON_ARCH"

BIN_NAME="optaris-gateway"
if [ "$OS" = "windows" ]; then
  BIN_NAME="optaris-gateway.exe"
fi

# Clear only this arch's dir so a previously-built sibling arch (e.g. arm64 when we
# now build x64) survives — a single mac publish builds both before packaging.
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

build_one "$OS" "$ARCH" "$OUT_DIR/$BIN_NAME"

echo "[build-gateway] wrote $OUT_DIR/$BIN_NAME"
