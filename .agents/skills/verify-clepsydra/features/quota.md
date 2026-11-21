# Quota

Per-account quota for every OAuth provider the proxy holds, read through the Management API's `api-call` passthrough.

## Sub-features

- Provider tabs with account counts, search, sort and layout switches.
- Provider pool cards: stats per window (Pool empty, First empty, Next reset, Burn), chart with Recorded, Projected, Usable capacity, reset and empty markers, and a blocked notice under the card.
- The projection splits future traffic the way the proxy routes it: only the highest priority tier with a ready account serves, round-robin splits it evenly, weighted-round-robin by Weight (weight 0 gets nothing), fill-first sends it all to the first ready account by file name. The strategy comes from `routing.strategy` in the config.
- Use it all, in Remaining mode only: one more stat after Burn. "Use it all at" is the pace that uses every account's remaining quota before its reset, as a multiple of the current burn with %/h dim. When a longer window's own Use it all at is slower, that pace replaces it, as "0.5x capped by Weekly limit". It reads "out of reach <window> runs out first" when a longer window would run out first and has no pace of its own, or "all used", "nothing due", "blocked by <window>". It does not change with Future usage.
- Each window cell in the accounts table adds one line under "resets in": "needs 1.2x (0.6%/h) to use it all", "needs 0.6%/h to use it all, idle now", or "<window> runs out first" (also when that account's longer window needs a slower pace). Blocked, unstarted and used-up windows show no line.
- Next reset is the earliest reset time among accounts that are not blocked, with the projected gain at that time, which can be +0%. It reads "None scheduled" only when no such account has a reset time.
- Controls: Remaining/Drain rate, Burn rate 1h/3h/6h (6h by default), Future usage (Same as now, Usual, Stop now) and Accounts (stacked) on one row. The "Nov 14 to Nov 28" label with ‹ Earlier/Today/Later › always sits on its own row below them.
- Accounts table: Account, Plan, Weight, one column per window, Status, Actions (Refresh, Details). Details expands the upstream quota card.
- Plan cell: a Claude account with banked manual resets shows a second line under the plan, such as "1 reset, 21d left" (count, then whole days until the soonest one expires). It shows nothing when no grant has resets left, and appears about 2s after that row's quota loads.
- "Refresh all credentials" loads every card.
- Antigravity pool: one window per quota bucket, labeled "<group> · <window>" such as "Gemini models · Weekly limit", including windows known only from recorded history. Disabled buckets are skipped. Recorded history lines up with live windows by bucket id. Windows are ordered by group then shortest duration: Gemini models (5-hour, Weekly), Gemini Argon (Weekly), then Claude and GPT models (5-hour, Weekly).
- Quota-only accounts (the backend's Antigravity CLI login, `quota_only: true` with `login_source: "antigravity-cli"`): they stay in the pool and the chart, and the projection drains each one at its own burn without spreading routed traffic onto it. Pool empty, First empty, Pool burn, and Use it all at include all accounts in the pool (routed and quota-only alike, scaling each quota-only account by its own burn rate). In the accounts table the row shows a "From Antigravity CLI" tag under the account and "- not routed" in the Weight cell, even before it has any readings.

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
- Accounts toggle: `click 'text=Accounts'`, read its `aria-pressed`, and, when the pool has more than one account, expect the legend to add their labels (such as `AR TH`) when stacked.
- Range: read `[class*=PoolQuota-module__range]`; `click 'role=button:Earlier'`, `role=button:Later`, `text=Today`. Earlier shifts the range back seven days. The card's top (`[class*=PoolQuota-module__card]`) stays put across ranges at any width; `size 1450 1000` is where a label change used to wrap the row.
- Chart keyboard: `click 'text=Today'`, then `key Tab` twice reaches the 5-hour chart (`[class*=PoolQuota-module__chart]`, `aria-label` "Claude 5-hour limit Remaining"). `key ArrowRight`, `ArrowLeft`, `PageUp`, `PageDown` move the tooltip (`[class*=tip]` inside the chart); `key Escape` hides it. The tooltip includes the projected pool and usable capacity, and names an account blocked by a longer window, such as "TH blocked by Weekly limit", when one is blocked.
- Mouse hover: `click` on a chart sends a mouse move and shows the same tooltip.
- Details: `click 'text=Details'` turns rows 2 to 3 and shows the upstream quota card; `click 'text=Hide details'` returns to 2.
- Row Refresh: `click 'text=Refresh'`; the row status returns as "Updated 0m ago".
- Reset grants: after Refresh all, `wait '[class*=PoolQuota-module__planCell] small' 15000` and read its text. The count should match the reset credits in that account's Details panel. That panel reads `Resets remaining --` until its own grant read returns, so `wait 'text=Manual reset expiry' 10000` before reading it.
- Header pill: scroll `.content` to about 714. `.header-actions` is opaque `rgb(18, 18, 18)` with 16px radius over the card.
- Capacity line: the 5-hour chart has `path[class*=capacity]` with dash `2px 4px`. It starts at the first recorded timestamp and sits near 100%, never on the 0% baseline before it.
- Use it all: in Remaining mode, `text '[class*=PoolQuota-module__stats]'` lists Use it all at after Burn and nothing after it. Switch to Drain rate and it disappears. Set Future usage to Stop now and its value stays the same. Read the cells with `eval` over `[class*=PoolQuota-module__windowCell] small`.
- Markers: annotation texts live in `text[class*=ann]`, the empty marker reads "Empty <day time>", the blocked notice is `[role=note]`.

- Quota-only rows: `eval` over `[class*=LoginSourceTag-module__tag]` for the tag and read the Weight cell text for "not routed". Routed rows show a number and no tag.
- Antigravity windows: `click 'text=Antigravity'` on the provider tabs, then read `[class*=PoolQuota-module__chart]` `aria-label`s; expect them in order: Gemini models 5-hour, Gemini models Weekly, Gemini Argon Weekly, Claude and GPT models 5-hour, Claude and GPT models Weekly, with live Pool empty, First empty, and Use it all at stats (no `-` placeholders).

Proof: the header reads `N credentials · N loaded`, every card shows its windows with a percent, the chart tooltip states pool and usable capacity, and the details panel shows the upstream plan and reset credits.

## Gotchas

- Cards start unloaded ("Click here to refresh quota"). Nothing reads quota until a click.
- "Reset limits" spends a real reset credit on the live account. Never click it during verification.
- The live proxy holds one Claude account and one Antigravity CLI quota-only account, so the Claude and Antigravity tabs have data and other provider tabs show 0.
- Live data here has one Claude account whose pools empty in the future. "Empty now" and a chart "XX blocked" marker need a pool already at 0 or a block that starts during the projection, so they are often not reachable. While an account is blocked by its weekly limit, the tooltip's "blocked by Weekly limit" line is the visible alternative.
- "Usual" needs a day of history. With hours of history it shows the learning hint and mirrors the current burn.

## Quota-only backend

The live proxy already has a quota-only account. For a backend without one, run clepsydra-proxy's `feat/antigravity-cli-quota-source` branch:

1. In the clepsydra-proxy checkout of that branch, run its `verify-clepsydra-proxy` launch (`127.0.0.1:18317`, own key in `/tmp/verify-clepsydra-proxy/session.env`). It reads the machine's Antigravity CLI login read-only; set `oauth.providers.antigravity.cli-login-quota: false` in its config to run without it.
2. Check `GET /v8/management/credentials` lists `antigravity-cli` with `quota_only: true` before driving the panel.
3. Here: `source /tmp/verify-clepsydra-proxy/session.env; VERIFY_BACKEND="$BASE" CLIPROXY_MANAGEMENT_KEY="$KEY" node $V/drive.mjs login`. On WSL the Windows browser reaches WSL's `127.0.0.1:18317` through localhost forwarding.
4. Drive `#/quota` Antigravity tab and `#/auth-files` as described in this file and in auth-files.md.
