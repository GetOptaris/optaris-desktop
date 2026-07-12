#!/usr/bin/env bash
#
# Build the macOS arm64 app and install it into /Applications in one shot.
#
# This is the local "edit code -> run it" loop, replacing the manual
# build-then-drag-into-Applications dance:
#   1. build the arm64 gateway sidecar
#   2. compile main/renderer with electron-vite
#   3. package with electron-builder --dir (only the .app, no dmg/zip -> faster)
#   4. quit any running instance, overwrite /Applications, relaunch
#
# macOS / arm64 only. It does not sign, notarize, or produce a dmg — for
# distribution use the build:mac:arm64 script instead.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Make the locally-installed CLIs resolvable even when run directly (not via pnpm).
export PATH="$ROOT/node_modules/.bin:$PATH"

APP_NAME="Optaris"
APP_ID="com.getoptaris.desktop"
SRC="$ROOT/dist/mac-arm64/$APP_NAME.app"
DEST="/Applications/$APP_NAME.app"

# --- build ---------------------------------------------------------------------
echo "[deploy-mac] building arm64 gateway sidecar"
bash "$ROOT/scripts/build-gateway.sh" darwin/arm64

echo "[deploy-mac] compiling main/renderer (electron-vite build)"
electron-vite build

echo "[deploy-mac] packaging .app (electron-builder --mac --arm64 --dir)"
electron-builder --mac --arm64 --dir

if [ ! -d "$SRC" ]; then
  echo "[deploy-mac] expected build output missing: $SRC" >&2
  exit 1
fi

# --- install -------------------------------------------------------------------
# Quit a running instance so it does not hold the bundle open during the overwrite.
# Ignore the error AppleScript raises when the app is not currently running.
echo "[deploy-mac] quitting running $APP_NAME (if any)"
osascript -e "tell application id \"$APP_ID\" to quit" 2>/dev/null || true

# Give the process a moment to exit and release the bundle before we replace it.
for _ in 1 2 3 4 5; do
  pgrep -x "$APP_NAME" >/dev/null 2>&1 || break
  sleep 1
done

echo "[deploy-mac] installing to $DEST"
rm -rf "$DEST"
# ditto preserves macOS metadata, symlinks and code signatures that `cp -R` mangles.
ditto "$SRC" "$DEST"

echo "[deploy-mac] launching $DEST"
open "$DEST"

echo "[deploy-mac] done -> $DEST"
