#!/usr/bin/env node
import { loadEnv } from '../src/env.mjs';

const COMMANDS = {
  check: () => import('../src/commands/check.mjs'),
  budgets: () => import('../src/commands/budgets.mjs'),
  pull: () => import('../src/commands/pull.mjs'),
  'sync-config': () => import('../src/commands/sync-config.mjs'),
  categories: () => import('../src/commands/categories.mjs'),
  'spot-check': () => import('../src/commands/spot-check.mjs'),
  anomalies: () => import('../src/commands/anomalies.mjs'),
  mismatches: () => import('../src/commands/mismatches.mjs'),
  rules: () => import('../src/commands/rules.mjs'),
  'rule-check': () => import('../src/commands/rule-check.mjs'),
  uncategorized: () => import('../src/commands/uncategorized.mjs'),
  match: () => import('../src/commands/match.mjs'),
  recategorize: () => import('../src/commands/recategorize.mjs'),
  assign: () => import('../src/commands/assign.mjs'),
  pl: () => import('../src/commands/pl.mjs'),
  cashflow: () => import('../src/commands/cashflow.mjs'),
  balances: () => import('../src/commands/balances.mjs'),
  variance: () => import('../src/commands/variance.mjs'),
  outlook: () => import('../src/commands/outlook.mjs'),
  serve: () => import('../src/commands/serve.mjs'),
  'feed-serve': () => import('../src/commands/feed-serve.mjs'),
};

const USAGE = `bukz — the AI bookkeeper's toolbelt

Usage: node bin/bukz.mjs <command> [options]

Setup & data
  check           Verify config and API connectivity (never prints secrets)
  budgets         List YNAB budgets / Xero organisations
  pull            Fetch transactions + categories into data/transactions.json
                  Incremental by default (deltas only); --full re-fetches everything
  sync-config     Hydrate config/bills.json + config/rules.json from hub Sheet
                    (atomic write). Prefer CLI flags (no .env edit):
                      --service-account FILE --spreadsheet-id ID
                      [--bills-tab Bills] [--rules-tab Rules]
                    Demo/CI: --from fixtures/sheets-hub.json
                    Then outlook/rule-check keep using local config/*.json
                    Column layouts: docs/sheets-config.md
  categories      List categories from the local cache

Analysis (read from the cache; all output is JSON)
  spot-check      Stratified sample of transactions per category for review
                    --per-category N (default 5)  --seed N
  anomalies       Duplicates, amount outliers, sign flips, missing recurring,
                  new large payees, largest transactions
                    --z N (default 3.5)  --window DAYS (default 3)  --top N
  mismatches      Payees whose category usage diverges from their usual one
                    --min-history N (default 3)  --dominance 0..1 (default 0.8)
  rules           Payee→category rule candidates from history, plus the
                  uncategorized rows each rule would fix
                    --min-support N (default 3)  --min-confidence 0..1 (default 0.8)
  rule-check      Check transactions against curated config/rules.json
                    (exact payee match; leads only — flag, don't verdict)
                    --rules FILE (demo: fixtures/rules.json)
                    --violations-only  omit correct matches from output
  uncategorized   Inbox rows (null/empty/"Uncategorized"/null categoryId) + unapproved
  match           Find transactions matching a receipt
                    --amount 42.50 --date YYYY-MM-DD [--window DAYS] [--payee TEXT]

Reporting (read from the cache; all output is JSON)
  pl              Profit & loss by category for a period (sign-based:
                  positive = income); excludes transfers
                    default period: month of the newest transaction
  cashflow        Cash in/out/net by month and account — includes transfers
                  (cash movement), the one deliberate exception
  balances        Account balances as of the last pull (YNAB)
  variance        Budget vs actual by category for one month
                    --month YYYY-MM (default: newest transaction's month,
                    else the newest budgeted month)
  outlook         N-day cash look-ahead per account: balance minus bills due,
                  red/yellow/green coverage + worst-of rollup
                    --days N (default 14)  --bills FILE (default config/bills.json;
                    demo: --bills fixtures/bills.json)

Visualization (read-only, localhost only)
  serve           Dashboard SPA over the cache: checkpoint traffic lights,
                  P&L, cashflow, budget variance — same analysis code, drawn
                    --port N (default 7800)  --in FILE  --bills FILE
                    demo: node bin/bukz.mjs serve --in fixtures/sample.json
                            --bills fixtures/bills.json

Feed (read-only; for famdash — not the dashboard)
  feed-serve      GET /api/feed/recent  (Bearer BUKZ_API_KEY; 401 if missing
                  or wrong). Last cache only — never calls YNAB/Xero.
                  No dollar figures in v0. ?amounts=1 is the only future
                  unlock and does not add figures yet. fundedPct is never
                  emitted. One cash_outlook; light is in the summary only.
                    --port N (default 7801, or BUKZ_FEED_PORT)
                    --host HOST (default 127.0.0.1, or BUKZ_FEED_HOST)
                    --allow-non-loopback
                      Required for any host other than 127.0.0.1, localhost,
                      or ::1. Same opt-in: BUKZ_FEED_ALLOW_NON_LOOPBACK=1.
                      Without it, feed-serve refuses to start. This repo is
                      public — Cipher must CLEAR before that flag. The
                      refusal does not include secrets.
                    --in FILE  --bills FILE
                  Demo: set BUKZ_API_KEY in the environment (never in chat),
                  then node bin/bukz.mjs feed-serve --in fixtures/sample.json
                       --bills fixtures/bills.json
                  Contract: docs/feed.md

Write (mutating — YNAB only; DRY-RUN by default, --yes to apply)
  recategorize    Change one transaction's category
                    --txn <id> --category "<name>" [--yes|--apply]
                    Refuses splits; category must exist in the cache.
  assign          Budget work: assign dollars to a category in a month
                    --month YYYY-MM --category "<name>" --amount N   (one)
                    --month YYYY-MM --copy-from YYYY-MM              (whole
                    month: repeat the source budget; shows the plan first)
                    Amount is the new budgeted total, zero or positive.

Common options
  --provider ynab|xero   Default: BUKZ_PROVIDER in .env, else ynab
  --since YYYY-MM-DD     pull (full only): initial fetch window (default 365 days back)
                         analysis: filter cached transactions to >= this date
  --until YYYY-MM-DD     analysis: filter cached transactions to <= this date
                         (bounds a range with --since; ignored by pull)
  --full                 pull: ignore the cache cursor and re-fetch everything
                         (also forced when switching providers)
  --in FILE              Analyze a file instead of the cache
                         (demo mode: --in fixtures/sample.json)
`;

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || ['help', '--help', '-h'].includes(cmd)) {
  console.log(USAGE);
  process.exit(0);
}
if (!COMMANDS[cmd]) {
  console.error(`Unknown command: ${cmd}\n\n${USAGE}`);
  process.exit(1);
}

loadEnv();
try {
  const mod = await COMMANDS[cmd]();
  await mod.run(rest);
} catch (err) {
  console.error(`bukz ${cmd} failed: ${err.message}`);
  process.exit(1);
}
