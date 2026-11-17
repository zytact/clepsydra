# Quota

Per-account quota for every OAuth provider the proxy holds, read through the Management API's `api-call` passthrough.

## Sub-features

- Provider tabs with account counts, search, sort and layout switches.
- Account cards: plan, reset credits, extra usage, quota windows with percent remaining and reset time, Reset limits and Refresh quota actions.
- "Refresh all credentials" loads every card.
- The quota windows timeline with ‹ Today ›, Weekly and 5-hour.

## How to get to it (user POV)

- Sidebar "Quota Management".
- `#/quota`.

## Driving it with drive.mjs

```bash
node $V/drive.mjs route /quota
node $V/drive.mjs click 'text=Refresh all credentials'
node $V/drive.mjs wait 'text=5-hour limit' 30000
node $V/drive.mjs redact
node $V/drive.mjs shot "$EVIDENCE/quota.png"
```

Proof: the header reads `N credentials · N loaded`, every card shows its windows with a percent, and the numbers match `/v8/management/requests/api-call` reads for the same accounts.

## Gotchas

- Cards start unloaded ("Click here to refresh quota"). Nothing reads quota until a click.
- "Reset limits" spends a real reset credit on the live account. Never click it during verification.
- The live proxy holds Claude accounts only, so other provider tabs show 0.
