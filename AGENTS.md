# AGENTS.md

Guidance for any coding agent (Claude Code, ZCode, etc.) working in this repository.
Read this together with `CLAUDE.md` — `CLAUDE.md` describes the *product*; this file
describes the *engineering state* and the rules that apply to whoever (or whatever) edits the code.

## What bukz is (one paragraph)

bukz turns an AI coding agent into a professional bookkeeper's team. A zero-dependency
Node CLI (`bin/bukz.mjs` + `src/`) does all the deterministic work — fetching
transactions, statistics, sampling, matching — and emits JSON. A set of skills
(`.claude/skills/`) consume that JSON and apply bookkeeper *judgment*. The golden rule:
**numbers come from code, opinions come from the model, and the user applies every fix
in their own app.** bukz is strictly read-only against YNAB and Xero.

## Golden rules (non-negotiable)

1. **NEVER read `.env`.** It holds API tokens and is permission-denied in
   `.claude/settings.json`. Config debugging goes through `node bin/bukz.mjs check`,
   which prints booleans only. Never ask the user to paste a token into chat; if they
   do, tell them to revoke and rotate it.
2. **bukz is read-only** against YNAB/Xero. No write-backs, no money movement. Skills
   flag issues; the human applies fixes in their app.
3. **Flag, don't verdict.** Analysis output is leads for triage, presented that way.
4. **Keep the architecture split.** Never have a skill ask the model to compute
   statistics, and never have the CLI make judgment calls.
5. **Zero runtime dependencies.** Plain ESM (`.mjs`), Node ≥ 18. No build/lint step.
   Keep `package.json` dep-free.

## Commands

```sh
node bin/bukz.mjs help            # full CLI reference
node bin/bukz.mjs check           # config doctor (safe: booleans only)
node bin/bukz.mjs pull            # fetch books → data/transactions.json
node bin/bukz.mjs anomalies       # (also: spot-check, mismatches, uncategorized, match, categories, budgets)

node --test                        # run all tests
node --test tests/analysis.test.mjs # run one test file
node fixtures/generate.mjs         # regenerate demo fixtures
```

Every analysis command accepts `--in FILE` — `--in fixtures/sample.json` is demo mode
and works without API keys. `--since YYYY-MM-DD` filters; `--provider ynab|xero`
selects the source.

## Architecture map

```
bin/bukz.mjs            dispatcher → dynamic import of src/commands/<name>.mjs
src/cli.mjs             arg parsing + shared output helpers (parse, num, out)
src/env.mjs             tiny .env loader (zero deps)
src/data.mjs            cache I/O; data/transactions.json is the analysis input
src/providers/          ynab.mjs, xero.mjs — normalize to the shared transaction
                        shape documented in providers/index.mjs
src/analysis/           pure functions: stats.mjs (median/MAD/robustZ),
                        anomalies.mjs, mismatches.mjs, sample.mjs
src/commands/           one thin wrapper per CLI command
fixtures/generate.mjs   writes sample.json with PLANTED issues; each plant has a
                        matching test assertion in tests/analysis.test.mjs
.claude/skills/         the AI team: bukz-setup, spot-check, anomalies,
                        mismatches, triage, receipts, close-review
.claude/settings.json   permission policy (.env is deny-listed)
```

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

## Adding things

- **A provider**: implement `listSources`, `checkAuth`, `fetchCategories`,
  `fetchTransactions({ since })` in `src/providers/<name>.mjs`, normalize to the shared
  shape (mind the sign convention), register it in `src/providers/index.mjs`. Error
  messages name the missing env var and where to get the credential.
- **An analysis**: add a pure function in `src/analysis/`, a thin command wrapper in
  `src/commands/`, register it in `bin/bukz.mjs`, and add a planted fixture + test.
- **A skill**: `.claude/skills/<name>/SKILL.md` with `name` and `description` YAML
  frontmatter. The skill drives the CLI and applies judgment to its JSON.

## Conventions

- All command output is JSON — `out()` in `src/cli.mjs`. Skills read it; humans don't.
- **Findings tables always include the `account` field.** A bookkeeper needs to know
  which account/card a flagged transaction is on to locate and fix it; "account" is
  also load-bearing context (a "duplicate" across two accounts usually isn't one).
  The data always carries it (72/72 fixture rows do); show `—` only when it's null.
- Numeric CLI args come through `num()` in `src/cli.mjs`. Empty/whitespace strings
  must be rejected (they coerce to `0` via `Number("")`), and calendar dates must be
  round-trip validated (JS rolls `2026-02-31` → `2026-03-03`).
- Fixtures and their test assertions are kept in lockstep — see the PLANT comments at
  the top of `fixtures/generate.mjs`. Regenerate with `node fixtures/generate.mjs`.
- Commit messages and PRs: this repo has no commit history yet — its first commits
  establish the baseline.

## Current state

**Mature, working, but uncommitted (no git history yet — all files untracked).**

- Both providers (YNAB, Xero) implemented and read-only.
- All nine CLI commands implemented: `check`, `budgets`, `pull`, `categories`,
  `spot-check`, `anomalies`, `mismatches`, `uncategorized`, `match`.
- All seven skills written.
- 12/12 tests pass (`node --test`).
- Demo mode (`--in fixtures/sample.json`) works end-to-end with no API keys.

### Open work (in progress when this file was written)

Input-validation hardening. Two concrete bugs are known and reproduced:

1. **Empty numeric args silently coerce to 0.** `num('')` returns `0` because
   `Number("")` is `0`, not `NaN`. `bukz anomalies --z ''` therefore runs at `z=0` and
   flags every transaction as an outlier. Same class: `num(' ')`, `num('\t')`.
2. **Invalid calendar dates silently roll over.** `--since 2026-13-99` and
   `match --date 2026-02-31` pass the `YYYY-MM-DD` *format* regex but `new Date()`
   either rolls them forward (`02-31` → `03-03`, matching the wrong transactions) or
   yields `Invalid Date`. Dates must be validated by round-tripping through the Date
   constructor and comparing the result back to the input.

The roadmap (see README.md): write-back via YNAB API; Xero invoices/bills; a rules
engine ("payee X is always category Y"); packaging as an installable plugin.
