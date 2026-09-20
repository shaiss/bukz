# Famdash feed

`feed-serve` exposes a read-only JSON feed so famdash can show a few bookkeeping signals. It follows the same split as FamPoll: pure mappers in `src/feed/feed.mjs`, and the HTTP process owns auth plus cache reads.

The dashboard (`serve`) is a different process. It stays on `127.0.0.1` with no auth and is not a feed. Do not point famdash at it — `/api/data` is the full cache.

## Endpoint

```
GET /api/feed/recent?limit=1–50
Authorization: Bearer <BUKZ_API_KEY>
```

- `GET /healthz` and `GET /` return `{"ok":true}` with no auth — liveness only, not the finance feed.
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

`status` on the item is freshness (`ok` / `stub` / `error`). The cash traffic light is **not** a meta field. It is one sentence in `summary` (`Overall light is green|yellow|red`). `meta.liabilityWatch` is `true` or `false` for engineering only, and only on that item. The words "liability", "debt", "owe", and similar never appear in `title` or `summary`.

There is one `cash_outlook` item. Checkpoint and outlook are not split into two feed rows.

`?amounts=1` is the only switch that may ever add rounded aggregates. These v0 kinds have no amount fields, so the flag does not add figures. Any other value (including omitting it) is scrubbed of `$`. `fundedPct` is never a key; it is mapped to `meta.band` inside the process.

## Kinds (`meta.kind`)

Locked set. The feed does not invent others.

1. `cash_outlook` — summary carries the overall light. `meta.liabilityWatch` is `true` only when that light is red. No account names.
2. `uncategorized` — `meta.count` and `meta.month` (`YYYY-MM`) only. `isUncategorized`: null or blank category, the label `Uncategorized`, or a null/blank `categoryId`. Transfers are excluded.
3. `bill_coverage` — `meta.coverage` `covered`|`watch`|`short` and `meta.windowDays`. No amounts, no account names.
4. `budget_funding` — `meta.band` `hold`|`partial`|`funded` only. The percent is mapped internally and is not emitted.
5. `variance_flag` — category **group** label and `meta.direction` `over`|`under`. No amounts. One item per group that is off its plan, over first.

`meta.cacheAge` (whole seconds) is freshness, not a kind field. It is present when the cache has a `pulledAt`.

## Freshness

The feed serves the last successful cache. It does not block on a live pull.

- Cache age ≤ 6 hours → item `status: "ok"` and `meta.cacheAge` (whole seconds).
- Older than 6 hours → the same kinds, computed from that cache, with `status: "stub"`.
- No cache, or a cache with no transactions → five placeholder items, `status: "stub"`. The variance placeholder is not a spending signal (`summary` says so).

## Deny list

Never put these in titles, summaries, meta, errors, or logs: payees, merchants, account names or ids, last4, institutions, dollar amounts (including rounded aggregates, unless a future schema is behind `amounts=1`), balances, Ready to Assign, `fundedPct`, projections, bill totals, budget ids, person names, emails, phones, addresses, receipt text, tokens, `.env`, raw transaction ids.

`buildFeed` drops a payload that trips those checks and returns generic `error` placeholders instead. It does not echo what matched.

## Run

```sh
# key in .env or the environment — never in the command line of a shared log
node bin/bukz.mjs feed-serve --in fixtures/sample.json --bills fixtures/bills.json
curl -H "Authorization: Bearer $BUKZ_API_KEY" \
  "http://127.0.0.1:7801/api/feed/recent?limit=10"
```

`node bin/bukz.mjs check` reports `BUKZ_API_KEY` as a boolean only.

Default bind is `127.0.0.1:7801` (`--host` / `BUKZ_FEED_HOST`, `--port` / `BUKZ_FEED_PORT`).

Loopback (`127.0.0.1`, `localhost`, `::1`) starts with no extra flag. Any other host is refused before the process listens. Pass `--allow-non-loopback` or set `BUKZ_FEED_ALLOW_NON_LOOPBACK=1` to opt in. Either one is enough; the env value must be exactly `1`. This repository is **public**. Cipher must CLEAR before that flag. Do not publish a URL until then. The refusal names the flag and the host you asked for. It does not include secrets, tokens, or `.env` contents.
