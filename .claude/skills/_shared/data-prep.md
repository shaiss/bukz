# Shared data-prep steps

Every analysis skill starts the same way: get fresh data (or demo data), then run its
command. This file holds those shared steps so each skill states only what is *unique*
to it. When a skill says "get data" in its step 1, it means: follow the **Fresh data**
and **Demo mode** steps below.

## Fresh data

1. If `data/transactions.json` is missing, run `node bin/bukz.mjs pull`.
2. If the cache's `meta.pulledAt` is more than a day old **and** the user wants current
   books, offer to re-pull.
3. `pull` fetches the last 365 days; scope a window with `--since YYYY-MM-DD`.
   Analysis commands accept both `--since YYYY-MM-DD` and `--until YYYY-MM-DD`
   to bound the cached transactions reviewed (e.g. `--since 2026-04-01 --until
   2026-05-31` for an April–May audit).

## Demo mode

No API keys yet? Every analysis command works on the bundled demo dataset by appending
`--in fixtures/sample.json` (a sample budget with planted bookkeeping errors). Offer a
demo tour any time the user has not set up keys.

## Loading the category vocabulary

Before proposing or judging a category, load the user's real category list:

```sh
node bin/bukz.mjs categories
```

Only ever propose categories that actually exist in that output. For a stronger signal,
check how a merchant's other transactions are already categorized in the cache.

## Reading the output

Every command prints JSON on stdout led by a `meta` block (`provider`, `pulledAt`,
`since`, `transactionCount`) — use it to judge staleness and scope. Each transaction
row carries an `account` field; **always surface `account` in findings tables** so the
user can locate and fix the row (see AGENTS.md § Conventions).

## Rules that apply to every skill

These live in **AGENTS.md § Golden rules** and are always in context — they are not
repeated in each skill:

- **NEVER read `.env`.** Config questions → `node bin/bukz.mjs check` (booleans only).
- **Flag, don't verdict.** Analysis output is leads for triage, never a confirmed error.
- **Writes need explicit confirmation.** Mutating commands (currently
  `recategorize`) are dry-run by default. To apply a change you MUST first show the
  user the planned edit (run without `--yes`), get their explicit OK, and only then
  re-run with `--yes`. Never pass `--yes` without that confirmation.

Each skill's own **Rules** section lists only what is unique to that skill.

## Writes (mutating commands)

bukz's first write command is `recategorize` (YNAB only). It follows a strict
safety model — the same model future writes should follow:

1. **Dry-run first.** `recategorize --txn <id> --category "<name>"` prints the
   planned change with `applied: false` and touches nothing.
2. **Confirm, then apply.** Show the user the planned edit. On their explicit OK,
   re-run with `--yes` (or `--apply`) to write it to YNAB. The command refreshes
   the local cache after a successful write.
3. **Hard limits.** Split transactions are refused (YNAB can't recategorize one
   line of a split via the API). Category names must exist in the cached
   `categories` list — never write an invented name. Xero is not supported yet.

The golden rule is now "flag, then offer to apply with confirmation" — not
"flag, don't fix". See AGENTS.md § Golden rules.
