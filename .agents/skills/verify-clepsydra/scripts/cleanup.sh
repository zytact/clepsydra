#!/usr/bin/env bash
# Stops what launch.sh started. Evidence in $VERIFY_EVIDENCE_DIR is kept.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
STATE_DIR="${VERIFY_STATE_DIR:-/tmp/verify-clepsydra}"
[ -f "$STATE_DIR/session.env" ] && source "$STATE_DIR/session.env"

[ -n "${CDP_PORT:-}" ] && node "$HERE/drive.mjs" close >/dev/null 2>&1
for pidfile in vite.pid relay.pid browser.pid; do
  if [ -f "$STATE_DIR/$pidfile" ]; then
    kill -- -"$(cat "$STATE_DIR/$pidfile")" 2>/dev/null || kill "$(cat "$STATE_DIR/$pidfile")" 2>/dev/null
    rm -f "$STATE_DIR/$pidfile"
  fi
done
if [ -n "${WSL_DISTRO_NAME:-}" ] && [ -n "${PROFILE_WIN:-}" ]; then
  source "$HERE/wsl.sh"
  win_kill_profile_browsers "$PROFILE_WIN"
fi
rm -f "$STATE_DIR/session.env" "$STATE_DIR/vite.log" "$STATE_DIR/browser.log" "$STATE_DIR/emulation.json"
echo "cleaned up"
