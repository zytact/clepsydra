# WSL notes

Read this when a launch, login or cleanup fails on WSL.

- The browser is Windows Edge, `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, run headless with its own profile at `%LOCALAPPDATA%\verify-clepsydra\profile`. It never touches the user's own browser.
- Edge prints `DevTools listening on ws://127.0.0.1:<port>` into `/tmp/verify-clepsydra/browser.log`. `cdp-relay.mjs` forwards local port 9339 to it through `powershell.exe`, about a second per connection.
- The Windows browser reaches Vite in WSL at `http://localhost:5199`, and the proxy at `http://127.0.0.1:8317`, which counts as local for `management.allow-remote: false`.
- Headless Edge ignores `--window-size`. `launch.sh` writes a 1440x1000 viewport into `emulation.json`, and `drive.mjs` applies it on every call.
- If cleanup leaves an Edge behind, it is the one whose command line holds the profile path. `cleanup.sh` kills only that one.
