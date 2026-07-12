#!/usr/bin/env bash
#
# Build the optaris-gateway sidecar binary into resources/bin/.
#
# Usage:
#   build-gateway.sh               Build for the host platform (used by `predev` so
#                                  the binary is in place before dev boots).
#   build-gateway.sh <os>/<arch>   Cross-compile one target, e.g. linux/amd64,
#                                  windows/amd64, darwin/arm64, darwin/amd64.
#
# The packaging phase (package.json build:<os>[:arch] scripts) drives the platform
# matrix by passing the right target here before electron-builder runs. macOS ships
# as two separate per-arch artifacts (arm64 and amd64), each built with its matching
# binary — not a universal fat binary.
#
# The build is static (CGO_ENABLED=0) so it needs no C toolchain and cross-compiles
# cleanly, including the pure-Go modernc.org/sqlite dependency.
#
# The output binary is always named optaris-gateway (optaris-gateway.exe on Windows)
# to match resolveBinaryPath() in src/main/gateway.ts. Only one binary is kept in
# resources/bin at a time (stale targets are removed) so packaging never bundles a
# binary for the wrong OS/arch.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATEWAY_DIR="$ROOT/gateway"
OUT_DIR="$ROOT/resources/bin"

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

BIN_NAME="optaris-gateway"
if [ "$OS" = "windows" ]; then
  BIN_NAME="optaris-gateway.exe"
fi

mkdir -p "$OUT_DIR"
# Drop any binary from a previous target so extraResources ships only this one.
rm -f "$OUT_DIR/optaris-gateway" "$OUT_DIR/optaris-gateway.exe"

build_one "$OS" "$ARCH" "$OUT_DIR/$BIN_NAME"

echo "[build-gateway] wrote $OUT_DIR/$BIN_NAME"
