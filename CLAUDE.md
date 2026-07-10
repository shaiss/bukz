# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What bukz is

bukz turns Claude Code into a professional bookkeeper's AI team — it accelerates a human bookkeeper, it does not replace one. The architecture enforces a strict split:

- **Deterministic plumbing is code**: fetching transactions, statistics, sampling, matching live in a zero-dependency Node CLI (`bin/bukz.mjs` + `src/`). Every number in a report must be reproducible.
- **Judgment is Claude**: deciding whether a flagged transaction is actually wrong happens in the skills (`.claude/skills/`), which consume the CLI's JSON output.

When adding features, keep this split: never have a skill ask Claude to compute statistics, and never have the CLI make judgment calls.

## Golden rules

1. **NEVER read `.env`** (it is also permission-denied in `.claude/settings.json`). It holds API tokens. Config debugging goes through `node bin/bukz.mjs check`, which prints booleans only. Never ask the user to paste a token into chat; if they do, tell them to revoke and rotate it.
2. **Flag, then offer to apply with confirmation.** Analysis output is leads for triage. Write commands (`recategorize`, YNAB only) are dry-run by default; a skill may apply a fix only after showing the user the planned edit and getting their explicit OK (`--yes`). No money movement; splits are refused; categories must exist. The human remains the source of truth.
3. **Flag, don't verdict**: analysis output is leads for triage, and reports should present them that way.

## Commands

```sh
node bin/bukz.mjs help            # full CLI reference
node bin/bukz.mjs check           # config doctor (safe: booleans only)
node bin/bukz.mjs pull            # fetch books → data/transactions.json (incremental by default)
node bin/bukz.mjs pull --full     # re-fetch everything (ignore the cache cursor)
node bin/bukz.mjs anomalies       # (also: spot-check, mismatches, uncategorized, match, categories, budgets)

node --test                        # run all tests
node --test tests/analysis.test.mjs  # run one test file
node fixtures/generate.mjs         # regenerate demo fixtures
```

There is no build/lint step — plain ESM (`.mjs`), Node ≥ 18, zero runtime dependencies (no `npm install` needed; keep it that way).

Every analysis command accepts `--in FILE` — `--in fixtures/sample.json` is demo mode and works without API keys. `--since YYYY-MM-DD` filters; `--provider ynab|xero` selects the source.

## Architecture

```
bin/bukz.mjs           dispatcher → src/commands/<name>.mjs (thin wrappers)
src/providers/         ynab.mjs, xero.mjs — normalize to the shared transaction
                       shape documented in providers/index.mjs
src/analysis/          pure functions: stats.mjs (median/MAD/robustZ),
                       anomalies.mjs, mismatches.mjs, sample.mjs
src/data.mjs           cache I/O; data/transactions.json is the analysis input
.claude/skills/        the AI team: bukz-setup, spot-check, anomalies,
                       mismatches, triage, receipts, close-review
fixtures/generate.mjs  writes sample.json with PLANTED issues — each plant has
                       a matching test assertion; keep them in sync
```

Key conventions that span files:

- **Normalized transaction shape** (contract between providers, analysis, and skills) is documented in `src/providers/index.mjs`. Amounts are currency units, **negative = outflow**. Splits become one row per line. `transfer: true` rows are excluded from all analysis.
- **Determinism everywhere**: anomaly "now" is the newest transaction date (not wall clock), spot-check sampling is seeded (mulberry32). Same data + same flags = same output, so fixtures never go stale and reviews are reproducible.
- **Robust statistics**: outlier detection uses median/MAD (`robustZ`), never mean/stdev — amounts are heavy-tailed. `robustZ` has a documented fallback for zero-spread (flat subscription) histories.
- **All CLI output is JSON on stdout**, led by a `meta` block (`provider`, `pulledAt`, …) so skills can judge staleness.

## Adding a provider

Implement `listSources`, `checkAuth`, `fetchCategories`, `fetchTransactions({ since })` in `src/providers/<name>.mjs`, normalize to the shared shape (mind the sign convention), and register it in `src/providers/index.mjs`. Error messages should name the missing env var and where to get the credential — see the existing providers.

## Xero specifics worth knowing

Auth is a Custom Connection (OAuth2 client_credentials — no browser flow, token bound to one org). MVP fetches `BankTransactions` only (invoices/bills are roadmap). Xero JSON dates arrive as `/Date(ms)/` — `toIsoDate` in `xero.mjs` handles both that and ISO. The chart of accounts plays the role of categories.
