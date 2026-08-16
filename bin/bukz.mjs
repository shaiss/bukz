#!/usr/bin/env node
import { loadEnv } from '../src/env.mjs';

const COMMANDS = {
  check: () => import('../src/commands/check.mjs'),
  budgets: () => import('../src/commands/budgets.mjs'),
  pull: () => import('../src/commands/pull.mjs'),
  categories: () => import('../src/commands/categories.mjs'),
  'spot-check': () => import('../src/commands/spot-check.mjs'),
  anomalies: () => import('../src/commands/anomalies.mjs'),
  mismatches: () => import('../src/commands/mismatches.mjs'),
  rules: () => import('../src/commands/rules.mjs'),
  uncategorized: () => import('../src/commands/uncategorized.mjs'),
  match: () => import('../src/commands/match.mjs'),
  recategorize: () => import('../src/commands/recategorize.mjs'),
};

const USAGE = `bukz — the AI bookkeeper's toolbelt

Usage: node bin/bukz.mjs <command> [options]

Setup & data
  check           Verify config and API connectivity (never prints secrets)
  budgets         List YNAB budgets / Xero organisations
  pull            Fetch transactions + categories into data/transactions.json
                  Incremental by default (deltas only); --full re-fetches everything
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
  uncategorized   Transactions with no category, and unapproved ones
  match           Find transactions matching a receipt
                    --amount 42.50 --date YYYY-MM-DD [--window DAYS] [--payee TEXT]

Write (mutating — YNAB only; DRY-RUN by default, --yes to apply)
  recategorize    Change one transaction's category
                    --txn <id> --category "<name>" [--yes|--apply]
                    Refuses splits; category must exist in the cache.

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
