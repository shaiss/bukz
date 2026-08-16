# Payee→category rules (`rules` command + skill) — design

Date: 2026-08-16
Status: implemented autonomously; user reviews post-hoc (flag-don't-apply is preserved)

## Problem

YNAB's auto-categorization rules (payee X → category Y) cannot be read or written
through the API — that was confirmed against the YNAB API v1 docs. But bukz's cache
contains the full transaction history, which is the ground truth those rules would be
built from. The user wants an "auto-rule mapping": mine the cache for dominant
payee→category patterns and hand the result either to a human bookkeeper or to a
browser-capable AI that enters the rules in YNAB's UI. This is the first slice of the
roadmap's rules-engine item.

## Approaches considered

1. **New pure analysis + `rules` command + skill** (chosen). Follows the repo recipe
   ("Adding things" in AGENTS.md): deterministic counting lives in `src/analysis/`,
   judgment lives in the skill. Complements `mismatches`, which already computes
   dominant categories but reports only the *stragglers*; `rules` reports the *mapping*
   itself plus the uncategorized rows that mapping would fix.
2. **Extend `mismatches`** to also emit rules. Rejected: muddies a focused command's
   contract, and its consumers (skill + docs) describe exception-flagging semantics.
3. **Skill-only** (Claude derives mappings from the raw cache JSON). Rejected: violates
   the architecture split — counting and dominance shares are statistics, so they
   belong in code.

## Spec

### `deriveRules(transactions, opts)` in `src/analysis/rules.mjs`

Pure function, mirrors `findMismatches` conventions (same defaults: support 3,
dominance/confidence 0.8).

- Input: normalized transactions. Exclude `transfer: true` rows and rows without a
  payee. Group by exact payee string (v1 — no fuzzy payee normalization; noted as
  future work since YNAB payee names vary, e.g. `SQ *SHOP` vs `SQ *SHOP #123`).
- Per payee, split rows into categorized (`category` truthy) and uncategorized.
  - `support` = count of categorized rows; `confidence` = topCategory / support,
    where ties on count break by category name ascending (deterministic regardless of
    row order).
  - `support >= minSupport && confidence >= minConfidence` → **rule**:
    `{ payee, category, support, confidence, medianAmount, lastDate, exceptions, uncategorized }`.
    `exceptions` = categorized rows off the dominant category (full rows — they are
    per-transaction findings and carry `account`). `uncategorized` = the payee's
    uncategorized rows (full rows; these are immediate `recategorize` candidates).
  - `support >= minSupport && confidence < minConfidence` → **ambiguous**:
    `{ payee, support, categories: [{category, count}...], uncategorizedCount, medianAmount, lastDate }`.
    No rule is proposed; a human decides whether the payee needs splits or multiple
    rules.
  - `support < minSupport` → skipped; counted in `summary.belowMinSupport`. (Their
    uncategorized rows remain the `uncategorized` command's domain.)
- `medianAmount` uses the existing `median` from `stats.mjs` (signed; negative =
  typical outflow). `lastDate` = newest row date.
- Rules sort by `uncategorized.length` desc (most actionable first), then support desc,
  then payee asc. Ambiguous sorts by support desc, then payee asc.
- `summary`: `{ payeesConsidered, rules, ambiguous, belowMinSupport, uncategorizedRowsInRules }`.

Relationship to `mismatches`: a rule's `exceptions` are the same rows `mismatches`
flags for that payee. The two analyses agree by construction (same dominance idea);
tests assert the Netflix plant yields both a mismatch flag and a rule exception.

### Command: `node bin/bukz.mjs rules`

Flags: `--min-support N` (default 3, integer ≥ 1), `--min-confidence 0..1`
(default 0.8, exclusive of 0, inclusive of 1), plus the common `--since/--until/--in`.
Output is the standard JSON shape: `meta`, `query`, `summary`, `rules`, `ambiguous`.
Registered in `bin/bukz.mjs` (COMMANDS + USAGE under Analysis).

Numeric/date validation goes through `num()`/`assertDate` in `src/cli.mjs` (empty
strings already throw; add range checks for the two new flags).

### Skill: `.claude/skills/rules/SKILL.md`

Drives the command, then applies judgment:

1. Data prep per `_shared/data-prep.md` (fresh pull / demo / `categories` vocabulary).
2. Run `rules`; judge each candidate before presenting it — a rule is only as good as
   its history: weigh `exceptions` first (see the mismatches skill; a rule built on
   mislabeled history propagates the error), and treat `ambiguous` payees as
   split-decision questions, not failures.
3. Two handoffs, both human-confirmed:
   - **History:** for a rule's `uncategorized` rows, offer `recategorize` per row —
     dry-run, show the plan, explicit OK, then `--yes`. Never bulk-apply.
   - **Future:** YNAB's rules are not API-writable. Present the mapping as a table for
     the bookkeeper, or hand the command's JSON to a browser-capable agent to enter in
     the YNAB web app.
4. Unique rule for this skill: never apply a rule wholesale on the strength of the
   confidence number — every write still goes through the confirm-then-apply flow, and
   exceptions are judged before any uncategorized row is "fixed" to the dominant
   category.

### Fixtures & tests (TDD)

Two new plants in `fixtures/generate.mjs` (PLANT 8, 9), each with assertions:

- **PLANT 8 — Staples** (rule with work to do): 4 rows `Office Supplies` + 1
  uncategorized row. Confidence 1.0, so `mismatches` ignores it (needs share < 1);
  `rules` must list it with one uncategorized candidate.
- **PLANT 9 — Costco Wholesale** (ambiguous): 3 `Groceries` + 3 `Dining Out`. No
  dominance → invisible to `mismatches`; `rules` must list it under `ambiguous`.

Plant amounts sit in a smooth band (no per-payee robust-Z outlier ≥ 3.5) and dates are
irregular (no weekly/biweekly/monthly cadence, MAD of gaps > 3), so no existing
anomaly assertion trips. Known knock-on, updated in lockstep: `uncategorizedCount`
goes 2 → 3 (PLANT 8's row) — the `anomalies: counts triage work` assertion and the
PLANT header comments change with it. Netflix (PLANT 1) doubles as the cross-check:
`rules` must emit Netflix → Subscriptions with exactly one exception (the June
Groceries row).

New tests in `tests/analysis.test.mjs`: Staples rule shape, Costco ambiguity, Netflix
exception agreement with `mismatches`, thin-history payees (Amazon's single uncategorized
row) produce no rule, and summary counts.

### Docs

`bin/bukz.mjs` USAGE, `AGENTS.md` (command list, architecture map, counts, roadmap),
`CLAUDE.md` (command list, architecture map).

## Out of scope (v1)

- Fuzzy/normalized payee matching across merchant variants.
- Persisting a user-curated rule set in the cache (the command re-derives every run —
  deterministic, and the curated layer is the YNAB UI / bookkeeper).
- Any bulk write. Applying to history stays per-transaction `recategorize` with
  confirmation.
