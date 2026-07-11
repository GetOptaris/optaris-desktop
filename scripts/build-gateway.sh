#!/usr/bin/env bash
#
# Build the optaris-gateway sidecar binary into resources/bin/.
#
# By default it builds for the current platform (used by `predev` so the binary is
# in place before `electron-vite dev` boots). Cross-compile by exporting GOOS/GOARCH
# before calling this script (the packaging phase drives the full platform matrix).
#
# The build is static (CGO_ENABLED=0) so it needs no C toolchain and cross-compiles
# cleanly.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATEWAY_DIR="$ROOT/gateway"
OUT_DIR="$ROOT/resources/bin"

BIN_NAME="optaris-gateway"
if [ "${GOOS:-}" = "windows" ]; then
  BIN_NAME="$BIN_NAME.exe"
fi

mkdir -p "$OUT_DIR"

echo "[build-gateway] building $BIN_NAME (GOOS=${GOOS:-native} GOARCH=${GOARCH:-native})"
cd "$GATEWAY_DIR"
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "$OUT_DIR/$BIN_NAME" .

# Ensure the binary is executable (matters for Linux/macOS packaging).
chmod +x "$OUT_DIR/$BIN_NAME" 2>/dev/null || true

echo "[build-gateway] wrote $OUT_DIR/$BIN_NAME"
