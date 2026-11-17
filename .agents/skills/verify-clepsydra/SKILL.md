---
name: verify-clepsydra
description: Drive the Clepsydra management panel (React web UI in this repo) in a real headless browser against the live CLIProxyAPI, and capture screenshot evidence. Use to prove a UI change works, to capture before/after evidence for a PR, or whenever a panel behavior must be seen rather than unit tested.
---

# Verify Clepsydra

The panel is a single-page app with hash routes (`#/quota`, `#/dashboard`, ...). It has no backend of its own. Every screen reads the v8 Management API of a CLIProxyAPI instance, so verification runs the local Vite dev server and logs it in to the live proxy.

The live proxy is the user's own CLIProxyAPI; `~/dotfiles/AGENTS.md` says where it runs and how each machine reaches it. On WSL the Windows browser logs in to `http://127.0.0.1:8317`. Elsewhere set `VERIFY_BACKEND` to the proxy URL first. Its management key is `CLIPROXY_MANAGEMENT_KEY` in `~/.secrets`.

**The proxy bans an address after five wrong management keys.** Never type, guess or retry a key by hand. `drive.mjs login` reads the key from the environment, and after any failed or timed out login it writes `/tmp/verify-clepsydra/login-failed` and refuses to try again. Ask the user to check the key and the proxy address. Delete the marker only after they confirm.

The proxy is the user's real one with real accounts. Read freely. Do not click actions that change it (Reset limits, Delete, Disable, Save config, plugin install) unless the task is that action and the user agreed.

All commands below run from the repo root. `$V` is `.agents/skills/verify-clepsydra/scripts`.

## Launch

```bash
bun install --frozen-lockfile      # once per checkout
source ~/.secrets
V=.agents/skills/verify-clepsydra/scripts
$V/launch.sh
```

Ready when it prints `ready: panel http://localhost:5199/  cdp 127.0.0.1:9339`. It starts Vite on port 5199 (`VERIFY_DEV_PORT`), a headless browser on its own profile, and on WSL a CDP relay on 9339 (`VERIFY_CDP_PORT`). Session state lives in `/tmp/verify-clepsydra/` (`VERIFY_STATE_DIR`). The viewport defaults to 1440x1000.

One session at a time per state dir. `launch.sh` refuses to start while `session.env` exists. Run cleanup first, or give a second run its own `VERIFY_STATE_DIR`, `VERIFY_DEV_PORT` and `VERIFY_CDP_PORT`.

On WSL the scripts drive a Windows Edge with the same commands. Read [wsl.md](wsl.md) when a WSL launch or cleanup fails.

## Doctor

Set `PROXY_URL` to the proxy as this shell reaches it. Off WSL that is `VERIFY_BACKEND`. On WSL the browser's `127.0.0.1` is Windows, so take the address WSL uses from `~/dotfiles/AGENTS.md`.

```bash
cat /tmp/verify-clepsydra/session.env && curl -sf http://localhost:5199/ >/dev/null && echo vite-ok
curl -sf http://127.0.0.1:9339/json/version | head -c 200; echo
source ~/.secrets; curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CLIPROXY_MANAGEMENT_KEY" "$PROXY_URL/v8/management/config"
```

Healthy: a session file, `vite-ok`, a JSON browser version, and `200` from the proxy. `000` means `PROXY_URL` is unset or unreachable. A `401` means the key is wrong. Stop and ask the user, do not retry. A `403` means the address is banned or remote management is off.

## Drive

`drive.mjs` sends one CDP command per call. Targets are a CSS selector, `text=<visible text>` for the smallest visible element with that text, or `role=<role>:<name>`.

| Command | Does |
| --- | --- |
| `login` | Logs in to the live proxy with `$CLIPROXY_MANAGEMENT_KEY` |
| `route <hash-path>` | Changes the hash route in place, keeping the session |
| `open <url>` | Navigates with a full load, which drops the session |
| `wait <target> [ms]` | Waits until a target is visible |
| `click <target>` | Clicks a target |
| `key <name>` | Presses Tab, Enter, Escape, an arrow, PageUp or PageDown on the focused element |
| `fill <target> <text>` | Replaces an input's value as typed text |
| `text <target>` | Prints a target's `innerText` |
| `eval <js>` | Prints the JSON result of a page expression |
| `scroll <target>` | Scrolls a target to the top of its scroll container |
| `shot <file.png> [target]` | Screenshots the viewport, or the visible part of one element, after masking emails |
| `redact` | Masks emails in text, titles, labels and inputs |
| `theme <auto\|light\|paper\|dark>` | Picks a theme from the header menu by its position |
| `size <width> <height>` | Sets the viewport; every later call reapplies it and waits for layout |
| `close` | Closes the browser |

```bash
node $V/drive.mjs login                       # fills the URL and key, submits, waits for the app
node $V/drive.mjs route /quota                # hash navigation, keeps the in-memory session
node $V/drive.mjs wait 'text=Claude' 20000
node $V/drive.mjs click 'text=Refresh all credentials'
node $V/drive.mjs text 'main'
node $V/drive.mjs eval 'document.title'
node $V/drive.mjs theme light                 # Pure White; paper is Wool Paper
node $V/drive.mjs size 390 844                # viewport, persists for the session
node $V/drive.mjs shot "$EVIDENCE/quota.png"  # masks emails first; VERIFY_UNREDACTED=1 skips that
```

Use `route`, never `open`, after login. A full page load drops the session, because login does not tick "Remember password", and the app goes back to `#/login`.

The feature map in [features/README.md](features/README.md) lists every feature, its entry points and its proof.

## Evidence

```bash
EVIDENCE=~/.cache/verify-clepsydra/evidence/<branch-or-task>
```

- Drive the real user path: log in through the form, navigate with the sidebar or `route`, click the visible controls.
- Capture the action and the result: a shot before the click and after it, plus `text` or `eval` output that states the end state in words.
- `shot` masks emails right before it captures, because the proxy's account names are real addresses and a re-render can bring them back. Check the image before attaching it anywhere public.
- Capture both themes for visual changes (`theme dark`, `theme light`) and a phone width (`size 390 844`) for layout changes.

## Cleanup

```bash
.agents/skills/verify-clepsydra/scripts/cleanup.sh
```

It closes the browser over CDP, kills only the Vite, relay and browser processes it started (by recorded PID group, and on Windows by the profile path), and removes the session files. Evidence under `~/.cache/verify-clepsydra/evidence/` stays. The login-failed marker also stays.

## Machines

Proven on WSL (Ubuntu, Windows Edge headless through `cdp-relay.mjs`). The Linux branch of `launch.sh` uses `chromium` from `PATH` and has not been proven yet.
