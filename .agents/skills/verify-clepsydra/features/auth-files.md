# Auth files

The proxy's OAuth credentials: list, status, enable or disable, weight, refresh, upload and delete.

## Sub-features

- Credential cards with provider, status and identity.
- Weight and priority editing.
- Manual refresh, disable, delete, upload.
- Quota-only entries (Antigravity CLI login): a "From Antigravity CLI" tag whose `title` is the hint "Managed by Antigravity CLI. Used only to read quota.", the quota section, and no toggle, download, delete, prefix edit, cooldown reset or bulk selection. The backend answers 409 to those actions anyway.

## How to get to it (user POV)

- Sidebar "Auth Files".
- `#/auth-files`.

## Driving it with drive.mjs

```bash
node $V/drive.mjs route /auth-files
node $V/drive.mjs wait 'text=claude' 15000
node $V/drive.mjs shot "$EVIDENCE/auth-files.png"
```

- Quota-only card: `eval` that the card with the tag has no `input[type=checkbox]` toggle and no Download or Delete buttons, and that `[class*=LoginSourceTag-module__tag]` has the hint as its `title`. Needs the quota-only backend described in quota.md.

Proof: one card per file the proxy reports at `GET /v8/management/credentials`.

## Gotchas

- Disable, delete and weight edits change the live proxy. Read-only proofs only, unless the user agreed.
