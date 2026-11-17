# Feature map

One file per user-facing feature of the Clepsydra panel. Each says how a user reaches it, how to drive it with `drive.mjs`, and what proves it works.

| Feature | File | Entry points |
| --- | --- | --- |
| Login | [login.md](login.md) | `#/login`, any route while logged out |
| App shell | [shell.md](shell.md) | Sidebar, collapse handle, header theme and language menus |
| Quota | [quota.md](quota.md) | Sidebar "Quota Management", `#/quota` |
| Auth files | [auth-files.md](auth-files.md) | Sidebar "Auth Files", `#/auth-files` |
| Dashboard | [dashboard.md](dashboard.md) | Sidebar "Dashboard", `#/`, `#/dashboard` |

A proof covers every entry point its feature lists.
