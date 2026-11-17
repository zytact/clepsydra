# Auth files

The proxy's OAuth credentials: list, status, enable or disable, weight, refresh, upload and delete.

## Sub-features

- Credential cards with provider, status and identity.
- Weight and priority editing.
- Manual refresh, disable, delete, upload.

## How to get to it (user POV)

- Sidebar "Auth Files".
- `#/auth-files`.

## Driving it with drive.mjs

```bash
node $V/drive.mjs route /auth-files
node $V/drive.mjs wait 'text=claude' 15000
node $V/drive.mjs shot "$EVIDENCE/auth-files.png"
```

Proof: one card per file the proxy reports at `GET /v8/management/credentials`.

## Gotchas

- Disable, delete and weight edits change the live proxy. Read-only proofs only, unless the user agreed.
