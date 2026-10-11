#!/bin/bash
# Manage the launchd job that runs scripts/version-watch.mjs daily at 10:00 and at login.
#   scripts/watcher.sh install | uninstall | status
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL=dev.photoshop-mcp.version-watch
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$(command -v node)"

case "${1:-status}" in
  install)
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/photoshop-mcp"
    cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/scripts/version-watch.mjs</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/photoshop-mcp/version-watch.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/photoshop-mcp/version-watch.log</string>
</dict></plist>
PL
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "  watcher installed ($PLIST)";;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    rm -f "$PLIST"; echo "  watcher removed";;
  status)
    launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 && echo "watcher: installed" || echo "watcher: not installed"
    cat "$HOME/Library/Caches/photoshop-mcp/version-watch.json" 2>/dev/null || true;;
esac
