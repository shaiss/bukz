# AGENTS.md

Guidance for any coding agent (Claude Code, ZCode, etc.) working in this repository.
Read this together with `CLAUDE.md` — `CLAUDE.md` describes the *product*; this file
describes the *engineering state* and the rules that apply to whoever (or whatever) edits the code.

## What bukz is (one paragraph)

bukz turns an AI coding agent into a professional bookkeeper's team. A zero-dependency
Node CLI (`bin/bukz.mjs` + `src/`) does all the deterministic work — fetching
transactions, statistics, sampling, matching — and emits JSON. A set of skills
(`.claude/skills/`) consume that JSON and apply bookkeeper *judgment*. The golden rule:
**numbers come from code, opinions come from the model, and the user confirms every fix
before it's applied.** bukz writes only via explicit, confirmed commands — never silently.

## Golden rules (non-negotiable)

1. **NEVER read `.env`.** It holds API tokens and is permission-denied in
   `.claude/settings.json`. Config debugging goes through `node bin/bukz.mjs check`,
   which prints booleans only. Never ask the user to paste a token into chat; if they
   do, tell them to revoke and rotate it.
2. **Writes need explicit confirmation.** Mutating commands (`recategorize`, YNAB only)
   are dry-run by default. A skill applies a fix only after showing the user the planned
   edit and getting their explicit OK, then passes `--yes`. No money movement; splits are
   refused; category names must exist in the cache. The human is the source of truth.
3. **Flag, don't verdict.** Analysis output is leads for triage, presented that way.
4. **Keep the architecture split.** Never have a skill ask the model to compute
   statistics, and never have the CLI make judgment calls.
5. **Zero runtime dependencies.** Plain ESM (`.mjs`), Node ≥ 18. No build/lint step.
   Keep `package.json` dep-free.

## Commands

```sh
node bin/bukz.mjs help            # full CLI reference
node bin/bukz.mjs check           # config doctor (safe: booleans only)
node bin/bukz.mjs pull            # fetch books → data/transactions.json (incremental)
node bin/bukz.mjs pull --full     # ignore the cursor, re-fetch everything
node bin/bukz.mjs sync-config     # hub Sheet → config/bills.json + config/rules.json
                                  # prefer: --service-account FILE --spreadsheet-id ID
                                  # demo: --from fixtures/sheets-hub.json
                                  # (never requires editing .env; skills must not touch .env)
node bin/bukz.mjs anomalies       # (also: spot-check, mismatches, rules, rule-check,
                                  #  uncategorized, match, categories, budgets)
node bin/bukz.mjs pl              # reporting: pl, cashflow, balances, variance, outlook
node bin/bukz.mjs serve           # localhost dashboard SPA over the cache (read-only)
node bin/bukz.mjs feed-serve      # famdash GET /api/feed/recent (Bearer BUKZ_API_KEY)
                                  # default 127.0.0.1:7801; docs/feed.md
                                  # non-loopback hard-fails unless
                                  # --allow-non-loopback / BUKZ_FEED_ALLOW_NON_LOOPBACK=1
                                  # Cipher must CLEAR before that flag (repo is public)
node bin/bukz.mjs recategorize    # MUTATING (YNAB): --txn <id> --category "<name>"; dry-run unless --yes
node bin/bukz.mjs assign          # MUTATING (YNAB budget): --month --category --amount | --copy-from; dry-run unless --yes

node --test                        # run all tests
node --test tests/analysis.test.mjs # run one test file
node fixtures/generate.mjs         # regenerate demo fixtures
```

Every analysis command accepts `--in FILE` — `--in fixtures/sample.json` is demo mode
and works without API keys. `--since YYYY-MM-DD` filters; `--provider ynab|xero`
selects the source. Curated rules: `rule-check --in fixtures/sample.json --rules fixtures/rules.json`.

## Architecture map

```
bin/bukz.mjs            dispatcher → dynamic import of src/commands/<name>.mjs
src/cli.mjs             arg parsing + shared output helpers (parse, num, out)
src/env.mjs             tiny .env loader (zero deps)
src/data.mjs            cache I/O (atomic writes + incremental merge);
                        data/transactions.json is the analysis input
src/config.mjs          loader + atomic writer for config/ — gitignored curated
                        registries (bills.json, rules.json, entities.json);
                        *.example.json are committed; sync-config pulls bills+rules
src/sheets/             Google Sheets read-path: service-account JWT auth,
                        values.get client, grid→JSON parsers for Bills/Rules tabs.
                        CLI flags preferred for credentials; optional env fallback;
                        never opens/rewrites `.env`. sync-config hydrates local
                        config/; outlook/rule-check keep using loadConfig.
src/server.mjs          the read-only localhost server behind `serve`: static
                        SPA from web/, the analysis modules for browser import,
                        and /api/data + /api/bills (re-read per request)
src/feed/               famdash feed. feed.mjs is pure (no I/O); server.mjs is
                        GET /api/feed/recent only (bearer auth, last cache,
                        no provider calls). Separate from `serve`.
src/providers/          ynab.mjs, xero.mjs — normalize to the shared transaction
                        shape documented in providers/index.mjs
src/analysis/           pure functions: stats.mjs (median/MAD/robustZ),
                        anomalies.mjs, mismatches.mjs, rules.mjs,
                        curated-rules.mjs, sample.mjs; reporting: money.mjs
                        (cent math), period.mjs, pl.mjs, cashflow.mjs,
                        variance.mjs, outlook.mjs; budget work: budget.mjs
src/commands/           one thin wrapper per CLI command (read + write/mutating)
fixtures/generate.mjs   writes sample.json with PLANTED issues; each plant has a
                        matching test assertion in tests/. fixtures/bills.json
                        + fixtures/rules.json are demo registries;
                        fixtures/sheets-hub.json stands in for Sheets API values
.claude/skills/         the AI team: bukz-setup, spot-check, anomalies,
                        mismatches, rules, triage, receipts, close-review,
                        weekly-checkpoint, budget
.claude/skills/_shared/ shared skill content (see below); not a skill itself
.claude/settings.json   permission policy (.env is deny-listed)
config/                 machine-local curated data (gitignored except templates):
                        bills.json powers `outlook`, rules.json powers `rule-check`,
                        entities.json maps account→entity for future entity reports
web/                    the dashboard SPA (index.html, app.js, views.mjs,
                        util.mjs, style.css) — zero dependencies, no build step;
                        it imports the SAME pure analysis modules the CLI runs,
                        so screen numbers and JSON numbers come from one codebase.
                        Visual language: the Modernist system (borrowed from
                        shaiss/print-bench) — Archivo (vendored in web/fonts/,
                        OFL 1.1), ink on paper, one red accent, zero radius,
                        mono numerals; semantic green/amber/red for money status
```

### The dashboard (`serve`)

`node bin/bukz.mjs serve` starts a read-only SPA at `http://127.0.0.1:7800`
(`--port`, `--in FILE`, `--bills FILE`; demo: `serve --in fixtures/sample.json
--bills fixtures/bills.json`). Ground rules:

- **Read-only, localhost-only.** The server binds 127.0.0.1, serves GET only,
  and nothing outside `web/` + `src/analysis/` + the two data files. No write
  actions exist in the SPA — fixes happen through the confirmed CLI flows.
- **Numbers come from the shared analysis modules.** The browser imports
  `src/analysis/*.mjs` directly; the SPA never re-implements a computation.
  Keep those modules free of `node:*` imports — that's what makes them
  browser-loadable.
- `/api/data` and `/api/bills` re-read their files per request, so a fresh
  `pull` shows up on browser refresh — no server restart.

### The famdash feed (`feed-serve`)

Separate process from the dashboard so the unauthenticated SPA cannot be
bound onto a public interface by accident. `GET /api/feed/recent` with
`Authorization: Bearer $BUKZ_API_KEY`. Pure mappers live in `src/feed/feed.mjs`
(no I/O). Default bind `127.0.0.1:7801`. Hosts other than `127.0.0.1`,
`localhost`, and `::1` hard-fail unless `--allow-non-loopback` or
`BUKZ_FEED_ALLOW_NON_LOOPBACK=1`. Contract: `docs/feed.md`. This repo is
public — Cipher must CLEAR before that flag. Refusal errors do not include
secrets.

### Cross-file contracts to respect

- **Normalized transaction shape** lives in `src/providers/index.mjs` as a comment.
  Amounts are currency units, **negative = outflow**. Splits become one row per line.
  `transfer: true` rows are excluded from all analysis. If you touch a provider, keep
  this shape intact — it is the contract between providers, analysis, and skills.
- **Determinism**: anomaly "now" is the newest transaction date (not the wall clock);
  spot-check sampling is seeded (mulberry32). Same data + same flags = same output, so
  fixtures never go stale and reviews are reproducible.
- **Robust statistics**: outlier detection uses median/MAD (`robustZ`), never
  mean/stdev. `robustZ` has a documented fallback for zero-spread histories.
- **All CLI output is JSON on stdout**, led by a `meta` block so skills can judge
  staleness. Never `console.log` debug noise from a command.
- **Pull is incremental.** `pull` merges deltas into the existing cache by
  transaction `id`, so repeated pulls are cheap and the cache's history only grows.
  A `cursor` field in the cache holds the provider's delta token (YNAB
  `server_knowledge`; Xero has none and re-fetches by date window). `--full`
  bypasses the cursor and re-fetches everything; switching providers forces a full
  fetch so two sources are never blended into one cache. Writes are atomic
  (temp-file + rename), so an interrupted pull leaves the prior cache intact.
  `pull` also snapshots `accounts` (balances) and `budgetMonths` on every pull
  when the provider exposes them (YNAB does, Xero does not yet) — cheap, whole-
  refresh data that isn't mergeable history.
- **Reporting conventions.** All money aggregation happens in integer cents
  (`src/analysis/money.mjs`) and rounds to 2dp only at the output edge. `cashflow`
  is the **one deliberate exception** to the transfer-exclusion rule — moving
  money between accounts is cash movement, which is exactly what cashflow and the
  14-day outlook measure; `pl` and `variance` exclude transfers like everything
  else. Period defaults derive from the data, never the wall clock: `pl` defaults
  to the month of the newest transaction, `variance` to that month (falling back
  to the newest cached budget month), `outlook`'s reference date is the newest
  transaction date.

## Adding things

- **A provider**: implement `listSources`, `checkAuth`, `fetchCategories`,
  `fetchTransactions({ since })` in `src/providers/<name>.mjs`, normalize to the shared
  shape (mind the sign convention), register it in `src/providers/index.mjs`. Error
  messages name the missing env var and where to get the credential. Optional
  capabilities (`fetchAccounts`, `fetchBudgetMonths`) are detected by `pull`;
  omit them and the cache simply lacks those fields, with the reporting commands
  giving a pull-from-YNAB error.
- **An analysis**: add a pure function in `src/analysis/`, a thin command wrapper in
  `src/commands/`, register it in `bin/bukz.mjs`, and add a planted fixture + test.
- **A skill**: `.claude/skills/<name>/SKILL.md` with `name` and `description` YAML
  frontmatter. The skill drives the CLI and applies judgment to its JSON.

### Shared skill content (DRY)

Skills share common mechanics — fresh-data/demo-mode procedures, the
categories-loading step, and the cross-cutting guardrails (never read `.env`,
read-only, flag-don't-verdict). To keep skills from restating these:

- **`.claude/skills/_shared/data-prep.md`** holds the shared *procedures*
  (fresh-data, demo-mode, categories-loading, reading output). Skills reference it
  with "see `_shared/data-prep.md`" rather than restating the steps. It is **not**
  a skill (no frontmatter) and is read on demand, not auto-loaded.
- **`AGENTS.md § Golden rules`** holds the cross-cutting *guardrails* (always-on
  context). Skills list only the rule **unique to them** in their own `## Rules`
  section and do not restate `.env`/read-only/flag-don't-fix.

When adding a skill, reuse `_shared/data-prep.md` and add a unique rule only if the
skill has one.

## Conventions

- All command output is JSON — `out()` in `src/cli.mjs`. Skills read it; humans don't.
- **Findings tables always include the `account` field.** A bookkeeper needs to know
  which account/card a flagged transaction is on to locate and fix it; "account" is
  also load-bearing context (a "duplicate" across two accounts usually isn't one).
  The data always carries it (85/85 fixture rows do); show `—` only when it's null.
- Numeric CLI args come through `num()` in `src/cli.mjs`. Empty/whitespace strings
  must be rejected (they coerce to `0` via `Number("")`), and calendar dates must be
  round-trip validated (JS rolls `2026-02-31` → `2026-03-03`).
- Fixtures and their test assertions are kept in lockstep — see the PLANT comments at
  the top of `fixtures/generate.mjs`. Regenerate with `node fixtures/generate.mjs`.
- Commit messages and PRs: this repo has no commit history yet — its first commits
  establish the baseline.

## Current state

**Mature and working.**

- Both providers (YNAB, Xero) implemented; YNAB is read + write (transactions,
  category fixes, budget assignments; balances + budget months incl. Age of
  Money and goal targets), Xero is read-only (transactions).
- Google Sheets hub read-path shipped: `sync-config` pulls Bills + Rules tabs
  into `config/bills.json` + `config/rules.json` (service-account JWT, zero
  deps); demo via `--from fixtures/sheets-hub.json`. `rule-check` flags
  transactions against curated exact payee→category rules.
- CLI includes `check`, `budgets`, `pull`, `sync-config`, `categories`,
  `spot-check`, `anomalies`, `mismatches`, `rules`, `rule-check`,
  `uncategorized`, `match`, `recategorize`, `assign`, reporting (`pl`,
  `cashflow`, `balances`, `variance`, `outlook`), `serve`, and `feed-serve`.
- All ten skills written, including `weekly-checkpoint` and `budget`.
- Demo mode (`--in fixtures/sample.json`) works end-to-end with no API keys
 (`outlook` also takes `--bills fixtures/bills.json`; curated rules:
 `rule-check --rules fixtures/rules.json`). `feed-serve` is the exception
 that needs `BUKZ_API_KEY` (presence-only in `check`); demo data still
 needs no YNAB/Xero keys. See `docs/feed.md`.
- Input validation hardened: empty numeric args throw (not silently coerce to 0),
  and calendar dates are round-trip validated through the `Date` constructor so
  impossible dates like `2026-02-31` are rejected instead of rolling over.

### Roadmap

- Xero invoices/bills (ACCPAY/ACCREC), QuickBooks provider, Xero balances
- Reporting, next slices: entity-sliced P&L (`pl --entity` via
  `config/entities.json`), Sheets write-back / multi-tab hub sync beyond
  bills+rules, autopay "did it actually post" verification — aggregation core,
  balances, budget-vs-actual, 14-day outlook, budget assignment, Sheets→config
  read-path, and curated `rule-check` are shipped
- Rules engine, next slices: fuzzy payee matching across merchant variants
  (`SQ *SHOP` vs `SQ *SHOP #123`) — derive-from-history (`rules`) and exact
  curated check (`rule-check` + Sheets sync) are shipped
- Packaging as an installable Claude Code plugin
- Famdash feed beyond the five v0 kinds (href, live pull) — v0 `feed-serve` is shipped; a public URL still needs Cipher CLEAR
