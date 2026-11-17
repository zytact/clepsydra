# Quota

Per-account quota for every OAuth provider the proxy holds, read through the Management API's `api-call` passthrough.

## Sub-features

- Provider tabs with account counts, search, sort and layout switches.
- Provider pool cards: stats per window (Pool empty, First empty, Next reset, Burn), chart with Recorded, Projected, Usable capacity, reset and empty markers, and a blocked notice under the card.
- Controls: Remaining/Drain rate, Burn rate 1h/3h/6h, Future usage (Same as now, Usual, Stop now), Accounts (stacked), and the ‹ Earlier/Today/Later › range with a "Nov 14 to Nov 28" label.
- Accounts table: Account, Plan, Weight, one column per window, Status, Actions (Refresh, Details). Details expands the upstream quota card.
- "Refresh all credentials" loads every card.

## How to get to it (user POV)

- Sidebar "Quota Management".
- `#/quota`.

## Driving it with drive.mjs

```bash
node $V/drive.mjs route /quota
node $V/drive.mjs click 'text=Refresh all credentials'
node $V/drive.mjs wait 'text=First empty' 30000
node $V/drive.mjs shot "$EVIDENCE/quota.png"
```

- Future usage is a `<select aria-labelledby="pool-future-label">`. No select command exists; set its value to `same`, `usual` or `stop` in `eval` and dispatch a bubbling `change`.
- Accounts toggle: `click 'text=Accounts'`, read its `aria-pressed`, and expect the legend to add `AR TH` when stacked.
- Range: read `[class*=PoolQuota-module__range]`; `click 'role=button:Earlier'`, `role=button:Later`, `text=Today`. Earlier shifts the range back seven days.
- Chart keyboard: `click 'text=Today'`, then `key Tab` twice reaches the 5-hour chart (`[class*=PoolQuota-module__chart]`, `aria-label` "Claude 5-hour limit Remaining"). `key ArrowRight`, `ArrowLeft`, `PageUp`, `PageDown` move the tooltip (`[class*=tip]` inside the chart); `key Escape` hides it. The tooltip includes the projected pool, usable capacity and "TH blocked by Weekly limit".
- Mouse hover: `click` on a chart sends a mouse move and shows the same tooltip.
- Details: `click 'text=Details'` turns rows 2 to 3 and shows the upstream quota card; `click 'text=Hide details'` returns to 2.
- Row Refresh: `click 'text=Refresh'`; the row status returns as "Updated 0m ago".
- Header pill: scroll `.content` to about 714. `.header-actions` is opaque `rgb(18, 18, 18)` with 10px radius over the card.
- Capacity line: the 5-hour chart has `path[class*=capacity]` with dash `2px 4px`. It starts at the first recorded timestamp and sits near 100%, never on the 0% baseline before it.
- Markers: annotation texts live in `text[class*=ann]`, the empty marker reads "Empty <day time>", the blocked notice is `[role=note]`.

Proof: the header reads `N credentials · N loaded`, every card shows its windows with a percent, the chart tooltip states pool and usable capacity, and the details panel shows the upstream plan and reset credits.

## Gotchas

- Cards start unloaded ("Click here to refresh quota"). Nothing reads quota until a click.
- "Reset limits" spends a real reset credit on the live account. Never click it during verification.
- The live proxy holds Claude accounts only, so other provider tabs show 0.
- Live data here has two Claude accounts, one blocked by its weekly limit, and both pools empty in the future. "Empty now" and a chart "XX blocked" marker need a pool already at 0 or a block that starts during the projection, so they are not reachable; the tooltip's "TH blocked by Weekly limit" is the visible alternative.
- "Usual" needs a day of history. With hours of history it shows the learning hint and mirrors the current burn.
