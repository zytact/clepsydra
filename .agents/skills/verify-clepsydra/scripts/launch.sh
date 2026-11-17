#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
STATE_DIR="${VERIFY_STATE_DIR:-/tmp/verify-clepsydra}"
DEV_PORT="${VERIFY_DEV_PORT:-5199}"
CDP_LOCAL_PORT="${VERIFY_CDP_PORT:-9339}"
mkdir -p "$STATE_DIR"

if [ -f "$STATE_DIR/session.env" ]; then
  echo "A session already exists in $STATE_DIR. Run cleanup.sh first." >&2
  exit 1
fi

(cd "$REPO" && setsid bash -c 'echo $$ >"$0/vite.pid"; exec bun run dev --port "$1" --strictPort --host 127.0.0.1' \
  "$STATE_DIR" "$DEV_PORT" >"$STATE_DIR/vite.log" 2>&1 &)
for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$DEV_PORT/" >/dev/null && break
  sleep 0.5
done
curl -sf "http://127.0.0.1:$DEV_PORT/" >/dev/null || { echo "Vite did not start, see $STATE_DIR/vite.log" >&2; exit 1; }

if [ -n "${WSL_DISTRO_NAME:-}" ]; then
  source "$HERE/wsl.sh"
  BROWSER="$(win_browser)" || { echo "No Windows Chromium browser found" >&2; exit 1; }
  BASE="$(win_localappdata)/verify-clepsydra"
  mkdir -p "$BASE/profile"
  PROFILE_WIN="$(wslpath -w "$BASE/profile")"
  echo "PROFILE_WIN='$PROFILE_WIN'" >>"$STATE_DIR/session.env"
  (cd /mnt/c && "$BROWSER" --headless=new --remote-debugging-port=0 \
    --user-data-dir="$PROFILE_WIN" --no-first-run --no-default-browser-check \
    --window-size=1440,1000 about:blank >"$STATE_DIR/browser.log" 2>&1 &)
  for _ in $(seq 1 40); do
    WIN_PORT="$(grep -o 'DevTools listening on ws://127.0.0.1:[0-9]*' "$STATE_DIR/browser.log" | grep -o '[0-9]*$' || true)"
    [ -n "$WIN_PORT" ] && break
    sleep 0.5
  done
  [ -n "${WIN_PORT:-}" ] || { echo "Browser did not report a DevTools port, see $STATE_DIR/browser.log" >&2; exit 1; }
  (setsid bash -c 'echo $$ >"$0/relay.pid"; exec node "$1" "$2" "$3"' \
    "$STATE_DIR" "$HERE/cdp-relay.mjs" "$WIN_PORT" "$CDP_LOCAL_PORT" >/dev/null 2>&1 &)
else
  BROWSER="${VERIFY_BROWSER:-$(command -v chromium || command -v google-chrome)}"
  mkdir -p "$STATE_DIR/profile"
  (setsid bash -c 'echo $$ >"$0/browser.pid"; shift; exec "$@"' "$STATE_DIR" _ "$BROWSER" --headless=new --remote-debugging-port="$CDP_LOCAL_PORT" \
    --user-data-dir="$STATE_DIR/profile" --no-first-run --window-size=1440,1000 about:blank \
    >"$STATE_DIR/browser.log" 2>&1 &)
fi

for _ in $(seq 1 40); do
  curl -sf "http://127.0.0.1:$CDP_LOCAL_PORT/json/version" >/dev/null && break
  sleep 0.5
done
curl -sf "http://127.0.0.1:$CDP_LOCAL_PORT/json/version" >/dev/null || { echo "CDP not reachable on $CDP_LOCAL_PORT" >&2; exit 1; }

{
  echo "DEV_URL='http://localhost:$DEV_PORT/'"
  echo "CDP_PORT='$CDP_LOCAL_PORT'"
} >>"$STATE_DIR/session.env"
node "$HERE/drive.mjs" size 1440 1000 >/dev/null
echo "ready: panel http://localhost:$DEV_PORT/  cdp 127.0.0.1:$CDP_LOCAL_PORT"
