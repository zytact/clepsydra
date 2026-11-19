# Quota

Per-account quota for every OAuth provider the proxy holds, read through the Management API's `api-call` passthrough.

## Sub-features

- Provider tabs with account counts, search, sort and layout switches.
- Provider pool cards: stats per window (Pool empty, First empty, Next reset, Burn), chart with Recorded, Projected, Usable capacity, reset and empty markers, and a blocked notice under the card.
- The projection splits future traffic the way the proxy routes it: only the highest priority tier with a ready account serves, round-robin splits it evenly, weighted-round-robin by Weight (weight 0 gets nothing), fill-first sends it all to the first ready account by file name. The strategy comes from `routing.strategy` in the config.
- Next reset is the earliest reset time among accounts that are not blocked, with the projected gain at that time, which can be +0%. It reads "None scheduled" only when no such account has a reset time.
- Controls: Remaining/Drain rate, Burn rate 1h/3h/6h (6h by default), Future usage (Same as now, Usual, Stop now) and Accounts (stacked) on one row. The "Nov 14 to Nov 28" label with ‹ Earlier/Today/Later › always sits on its own row below them.
- Accounts table: Account, Plan, Weight, one column per window, Status, Actions (Refresh, Details). Details expands the upstream quota card.
- Plan cell: a Claude account with banked manual resets shows a second line under the plan, such as "1 reset, 21d left" (count, then whole days until the soonest one expires). It shows nothing when no grant has resets left, and appears about 2s after that row's quota loads.
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
- Range: read `[class*=PoolQuota-module__range]`; `click 'role=button:Earlier'`, `role=button:Later`, `text=Today`. Earlier shifts the range back seven days. The card's top (`[class*=PoolQuota-module__card]`) stays put across ranges at any width; `size 1450 1000` is where a label change used to wrap the row.
- Chart keyboard: `click 'text=Today'`, then `key Tab` twice reaches the 5-hour chart (`[class*=PoolQuota-module__chart]`, `aria-label` "Claude 5-hour limit Remaining"). `key ArrowRight`, `ArrowLeft`, `PageUp`, `PageDown` move the tooltip (`[class*=tip]` inside the chart); `key Escape` hides it. The tooltip includes the projected pool and usable capacity, and names an account blocked by a longer window, such as "TH blocked by Weekly limit", when one is blocked.
- Mouse hover: `click` on a chart sends a mouse move and shows the same tooltip.
- Details: `click 'text=Details'` turns rows 2 to 3 and shows the upstream quota card; `click 'text=Hide details'` returns to 2.
- Row Refresh: `click 'text=Refresh'`; the row status returns as "Updated 0m ago".
- Reset grants: after Refresh all, `wait '[class*=PoolQuota-module__planCell] small' 15000` and read its text. The count should match the reset credits in that account's Details panel. That panel reads `Resets remaining --` until its own grant read returns, so `wait 'text=Manual reset expiry' 10000` before reading it.
- Header pill: scroll `.content` to about 714. `.header-actions` is opaque `rgb(18, 18, 18)` with 16px radius over the card.
- Capacity line: the 5-hour chart has `path[class*=capacity]` with dash `2px 4px`. It starts at the first recorded timestamp and sits near 100%, never on the 0% baseline before it.
- Markers: annotation texts live in `text[class*=ann]`, the empty marker reads "Empty <day time>", the blocked notice is `[role=note]`.

Proof: the header reads `N credentials · N loaded`, every card shows its windows with a percent, the chart tooltip states pool and usable capacity, and the details panel shows the upstream plan and reset credits.

## Gotchas

- Cards start unloaded ("Click here to refresh quota"). Nothing reads quota until a click.
- "Reset limits" spends a real reset credit on the live account. Never click it during verification.
- The live proxy holds Claude accounts only, so other provider tabs show 0.
- Live data here has two Claude accounts whose pools empty in the future. "Empty now" and a chart "XX blocked" marker need a pool already at 0 or a block that starts during the projection, so they are often not reachable. While an account is blocked by its weekly limit, the tooltip's "blocked by Weekly limit" line is the visible alternative.
- "Usual" needs a day of history. With hours of history it shows the learning hint and mirrors the current burn.
