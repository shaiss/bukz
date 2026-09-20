# bukz — the AI bookkeeper's team

bukz turns [Claude Code](https://claude.com/claude-code) into a team of AI assistants for professional bookkeepers. It doesn't replace the bookkeeper — it does the tedious sweeps (category audits, anomaly hunts, receipt matching) so the human can spend their time on judgment and client work.

Works with **YNAB** and **Xero** out of the box. Zero dependencies — if you have Node 18+ and Claude Code, `git clone` is the whole install.

## Quickstart

```sh
git clone https://github.com/shaiss/bukz.git && cd bukz
cp .env.example .env     # then add your API keys IN YOUR EDITOR — never in a chat
claude
```

Then just talk to it:

> "set up bukz" · "spot check my categories" · "does anything look off in June?" · "I have receipts to log"

**No keys yet?** Ask for a demo — every check runs against `fixtures/sample.json`, a sample budget with planted bookkeeping errors.

## The team

| Skill | What it does |
|---|---|
| `bukz-setup` | First-run onboarding: keys, budget selection, first pull |
| `spot-check` | Samples transactions per category, reviews payee/category fit |
| `anomalies` | Duplicate charges, amount outliers, refund/sign flips, recurring payments that stopped, suspicious new payees |
| `mismatches` | Payees drifting out of their usual category |
| `rules` | Derives payee→category rules from history, lists the uncategorized rows each would fix |
| `triage` | Proposes categories for the uncategorized, reviews the unapproved |
| `receipts` | Extracts receipt images/PDFs → ledger CSV, matches them to transactions, flags receipts missing from the books |
| `weekly-checkpoint` | The weekly status row: balances, autopay check, 14-day cash coverage with 🔴/🟡/🟢 per account, flags, next actions |
| `budget` | YNAB budget work: month-ahead progress, Age of Money, goal targets, assigning dollars (dry-run first, `--yes` after your OK), funding next month like last month |
| `close-review` | Runs everything, delivers the month's P&L / budget-vs-actual / cashflow, synthesizes one month-end report with an action checklist |

Under the hood each skill drives a deterministic CLI (`node bin/bukz.mjs help`) and applies bookkeeper judgment to its JSON output. Numbers come from code; opinions come from the model; fixes come from **you** — bukz is strictly read-only against your books.

The reporting commands (`pl`, `cashflow`, `balances`, `variance`, `outlook`) turn the cached books into the month's statements and a 14-day cash look-ahead. `outlook` reads a local bills registry — copy `config/bills.example.json` to `config/bills.json` and list your recurring bills (gitignored, like all your data), or pull both bills and curated payee→category rules from a hub Google Sheet:

```sh
# Live hydrate — CLI flags preferred (no .env edit; skills must not touch .env)
node bin/bukz.mjs sync-config --service-account ./sa.json --spreadsheet-id <id>
node bin/bukz.mjs sync-config --from fixtures/sheets-hub.json    # demo / CI, no credentials
node bin/bukz.mjs rule-check --in fixtures/sample.json --rules fixtures/rules.json
```

After sync, commands keep reading local `config/*.json` via `loadConfig` — Sheets is
a hydrate step, not a live dependency. See `docs/sheets-config.md`.

## A dashboard, if you want one

```sh
node bin/bukz.mjs serve                                   # your books, at http://127.0.0.1:7800
node bin/bukz.mjs serve --in fixtures/sample.json --bills fixtures/bills.json   # demo
```

A read-only visualization layer over the same cache: the weekly checkpoint with per-account traffic lights, P&L, cashflow, and budget variance — every table drills down to the transactions behind it. Zero dependencies and no build step; the browser imports the exact analysis modules the CLI runs, so a number on screen and the same number in a report always agree. The server binds 127.0.0.1 only.

## A feed for famdash

```sh
node bin/bukz.mjs feed-serve --in fixtures/sample.json --bills fixtures/bills.json
```

`GET /api/feed/recent` (default `127.0.0.1:7801`) returns five signal kinds — one cash outlook (light in the summary only), uncategorized count, bill coverage, month-ahead funding band, category-group variance — with `Authorization: Bearer $BUKZ_API_KEY`. It reads the last cache only. No dollar amounts (not even rounded; `?amounts=1` is the future unlock and does not add figures in v0), no `fundedPct`, no payees, no account names. Loopback (`127.0.0.1`, `localhost`, `::1`) is the default. Any other `--host` or `BUKZ_FEED_HOST` is refused unless you pass `--allow-non-loopback` or set `BUKZ_FEED_ALLOW_NON_LOOPBACK=1`. This repo is public: Cipher must CLEAR before that flag. The refusal does not include secrets. See `docs/feed.md`.

## Your keys never meet the model

- Keys live in `.env`, which is **gitignored** and **permission-denied** to Claude in `.claude/settings.json`.
- Every skill is instructed never to read `.env` and never to ask you for a token in chat.
- `node bin/bukz.mjs check` diagnoses config by printing booleans only.
- Getting keys: **YNAB** — app.ynab.com → Account Settings → Developer Settings → Personal Access Token. **Xero** — developer.xero.com → New app → *Custom Connection* with the three `*.read` accounting scopes. **Google Sheets hub** — GCP service account JSON key + share the spreadsheet with that email (Viewer); see `docs/sheets-config.md`.

Honest caveat: no local setup can make secrets provably invisible to a tool that can execute code on your machine. These layers make access denied-by-default and auditable — and the code never prints secret values. Use read-only tokens where offered, and rotate anything you suspect was exposed.

## What's on the roadmap

- ~~Write-back (apply approved category fixes via the YNAB API)~~ — shipped: `recategorize` (dry-run by default, `--yes` to apply)
- ~~Reporting (P&L, cashflow, budget-vs-actual, 14-day cash outlook)~~ — shipped: `pl`, `cashflow`, `balances`, `variance`, `outlook` + the `weekly-checkpoint` and `close-review` skills
- ~~Visualization layer~~ — shipped: `serve` — a read-only localhost dashboard SPA over the cache
- ~~Google Sheets → config sync (bills + curated rules) + curated rule-check~~ — shipped: `sync-config`, `rule-check` (exact payee match; see `docs/sheets-config.md`)
- Entity-sliced P&L; Sheets write-back / richer hub sync
- Xero invoices/bills (ACCPAY/ACCREC), QuickBooks provider
- Fuzzy payee matching for curated rules (`SQ *SHOP` vs `SQ *SHOP #123`)
- Packaging as an installable Claude Code plugin
- ~~Famdash read-only feed~~ — shipped: `feed-serve` (`docs/feed.md`). Public URL still needs Cipher CLEAR.

## License

MIT
