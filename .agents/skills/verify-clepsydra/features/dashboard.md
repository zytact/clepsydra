# Dashboard

The landing page: server version, connection, and summary counts.

## Sub-features

- Server version and build from the `X-CPA-VERSION` headers.
- Counts of credentials and providers.

## How to get to it (user POV)

- Sidebar "Dashboard".
- `#/` and `#/dashboard`.

## Driving it with drive.mjs

```bash
node $V/drive.mjs route /dashboard
node $V/drive.mjs shot "$EVIDENCE/dashboard.png"
```

Proof: the page shows the proxy version that `curl -D-` of `/v8/management/config` reports in `X-Cpa-Version`.

## Gotchas

- None known.
