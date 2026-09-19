# Famdash feed

`feed-serve` exposes a read-only JSON feed so famdash can show a few bookkeeping signals. It follows the same split as FamPoll: pure mappers in `src/feed/feed.mjs`, and the HTTP process owns auth plus cache reads.

The dashboard (`serve`) is a different process. It stays on `127.0.0.1` with no auth and is not a feed. Do not point famdash at it — `/api/data` is the full cache.

## Endpoint

```
GET /api/feed/recent?limit=1–50
Authorization: Bearer <BUKZ_API_KEY>
```

- Missing or wrong bearer → `401` `{"error":"unauthorized"}`. The key is not accepted in the query string.
- Success → `{"items": FeedItem[], "fetchedAt": "<ISO>"}`.
- `limit` clamps to 1–50 (default 10). Non-numeric values use the default.
- GET only. No YNAB or Xero calls. The handler re-reads the cache file each request.

`FeedItem` matches famdash `src/lib/feeds/types.ts`:

| Field | v0 |
|---|---|
| `id` | opaque, `bukz:<kind>:…` |
| `source` | `"bukz"` |
| `title` | no dollar amounts, no liability wording |
| `summary` | optional, same deny list |
| `occurredAt` | ISO timestamp |
| `href` | omitted |
| `status` | `ok` \| `stub` \| `error` |
| `meta` | string values only |

`status` on the item is freshness. `meta.status` on a cash item is the traffic light (`green` \| `yellow` \| `red`). They are different fields.

## Kinds (`meta.kind`)

Locked enums. The feed does not invent others.

1. `cash_outlook` — `meta.status` `green`\|`yellow`\|`red`, `meta.windowDays`, `meta.asOf`. Worst account light from `outlook` (14-day window).
2. `uncategorized` — `meta.count`, `meta.month` (`YYYY-MM`, newest transaction's month). Uses `isUncategorized`: null or blank category, the label `Uncategorized`, or a null/blank `categoryId`. Transfers are excluded.
3. `bill_coverage` — `meta.coverage` `covered`\|`watch`\|`short`. Red outlook → `short`; yellow, an unmatched bill, or a non-autopay bill in the manual window → `watch`; otherwise `covered`. No amounts, no account names.
4. `budget_funding` — `meta.band` `hold`\|`partial`\|`funded`, from `monthAhead` funded percent (`0` or unknown → `hold`, `1–99` → `partial`, `100+` → `funded`).
5. `variance_flag` — category **group** label and `meta.direction` `over`\|`under`. No category names and no amounts. One item per group that is off its plan, over first.

## Freshness

The feed serves the last successful cache. It does not block on a live pull.

- Cache age ≤ 6 hours → item `status: "ok"` and `meta.cacheAge` (whole seconds).
- Older than 6 hours → the same kinds, computed from that cache, with `status: "stub"`.
- No cache, or a cache with no transactions → five placeholder items, `status: "stub"`. The variance placeholder is not a spending signal (`summary` says so).

## Deny list

Never put these in titles, summaries, meta, errors, or logs: payees, merchants, account names or ids, last4, institutions, dollar amounts, balances, Ready to Assign, projections, bill totals, person names, emails, phones, addresses, receipt text, tokens, `.env`, raw transaction ids.

`buildFeed` drops a payload that trips those checks and returns generic `error` placeholders instead. It does not echo what matched.

## Run

```sh
# key in .env or the environment — never in the command line of a shared log
node bin/bukz.mjs feed-serve --in fixtures/sample.json --bills fixtures/bills.json
curl -H "Authorization: Bearer $BUKZ_API_KEY" \
  "http://127.0.0.1:7801/api/feed/recent?limit=10"
```

`node bin/bukz.mjs check` reports `BUKZ_API_KEY` as a boolean only.

Default bind is `127.0.0.1:7801` (`--host` / `BUKZ_FEED_HOST`, `--port` / `BUKZ_FEED_PORT`). This repository is **public**. Cipher must CLEAR before any non-loopback or public URL.
