#!/usr/bin/env bash
# Build Tickr (Electron) and install it to ~/Applications/Tickr.app.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v npm >/dev/null; then
  echo "npm is required" >&2
  exit 1
fi

npm install
npm run pack:mac

APP_SRC="$(find "$ROOT/release/mac"* -maxdepth 2 -name 'Tickr.app' -type d 2>/dev/null | head -1 || true)"
if [[ -z "${APP_SRC}" ]]; then
  APP_SRC="$(find "$ROOT/release" -maxdepth 3 -name 'Tickr.app' -type d | head -1 || true)"
fi
if [[ -z "${APP_SRC}" ]]; then
  echo "Tickr.app not found under release/" >&2
  exit 1
fi

DEST="$HOME/Applications/Tickr.app"

# Quit the running copy (Swift or Electron) so the bundle can be replaced.
pkill -f "Tickr.app/Contents/MacOS/Tickr" 2>/dev/null || true
sleep 1

mkdir -p "$HOME/Applications"
rm -rf "$DEST"
ditto "$APP_SRC" "$DEST"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
codesign --force --deep --sign - --identifier com.krsimmons.tickr "$DEST" >/dev/null 2>&1 || true

mkdir -p "$HOME/bin"
ln -sfn "$ROOT/tickr" "$HOME/bin/tickr"

open -a "$DEST"
echo "Installed ${DEST}"
echo "CLI: tickr status|start|stop|enable|disable (ensure ~/bin is on PATH)"
