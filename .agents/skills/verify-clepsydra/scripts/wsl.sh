#!/usr/bin/env bash

win_localappdata() {
  wslpath "$(cd /mnt/c && cmd.exe /d /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')"
}

win_browser() {
  local candidate
  for candidate in \
    "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
    "/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe" \
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"; do
    [ -x "$candidate" ] && { printf '%s\n' "$candidate"; return; }
  done
  return 1
}

win_kill_profile_browsers() {
  local profile_win="$1"
  (cd /mnt/c && powershell.exe -NoProfile -NonInteractive -Command \
    "Get-CimInstance Win32_Process | Where-Object { \$_.CommandLine -like '*$profile_win*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }") >/dev/null 2>&1 || true
}
