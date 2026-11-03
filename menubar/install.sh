#!/bin/bash
# Builds Tickr.app, installs it to ~/Applications, and starts it at login (LaunchAgent).
set -euo pipefail
cd "$(dirname "$0")"

LABEL="com.krsimmons.tickr"
APP_DEST="$HOME/Applications/Tickr.app"
BIN="$APP_DEST/Contents/MacOS/Tickr"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

./make-app.sh
pkill -f "Tickr.app/Contents/MacOS/Tickr" 2>/dev/null || true
rm -rf "$APP_DEST"
cp -R "Tickr.app" "$APP_DEST"
codesign --force --deep --sign - --identifier "$LABEL" "$APP_DEST" >/dev/null 2>&1 || true

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$BIN</string></array>
  <key>WorkingDirectory</key><string>$HOME/Applications</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/tickr.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/tickr.err.log</string>
</dict>
</plist>
PLIST

DOMAIN="gui/$(id -u)"
launchctl enable "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "Installed $APP_DEST and enabled login start ($PLIST)"
