---
name: close-review
description: Use when the user asks for a month-end close, a full books review, a periodic checkup, or to "run the whole team" on their books.
---

# Close review — run the whole team

The full monthly checkup: the month's financial statements, every bukz check,
one synthesized report, one action checklist.

## Steps

1. **Scope:** confirm the period (default: last full calendar month) and set `--since` accordingly — but run anomalies **without** `--since` too, because missing-recurring detection needs history.
2. **Get data:** see `_shared/data-prep.md` (fresh pull; for demo, pass `--in fixtures/sample.json` to each command instead — and `--bills fixtures/bills.json` to `outlook`).
3. **Run the team**, in this order:
   - `node bin/bukz.mjs anomalies`
   - `node bin/bukz.mjs mismatches`
   - `node bin/bukz.mjs uncategorized`
   - `node bin/bukz.mjs spot-check --per-category 3 --since <period start>`
4. **Run the deliverables** — the month's statements (all read-only):
   - `node bin/bukz.mjs pl --since <period start> --until <period end>`
   - `node bin/bukz.mjs variance --month <YYYY-MM>`
   - `node bin/bukz.mjs cashflow --since <period start>`
5. **Apply each skill's triage judgment** (see the `anomalies`, `mismatches`, `triage`, and `spot-check` skills' guidance — same standards apply here).
6. **Synthesize one report** — not seven:
   - **Header:** period, provider, data freshness, transaction count.
   - **The deliverables:** P&L (income / expenses / net, top categories),
     budget vs actual (categories over budget, from `variance`), and the
     cashflow summary (monthly in/out/net per account). These are computed
     numbers — present them as the month's statements, not as leads.
   - **🔴 Fix before closing:** likely errors (duplicates, wrong categories, sign errors, suspected missing entries).
   - **🟡 Verify:** plausible-but-unconfirmed (refunds, new payees, stopped recurrences).
   - **🟢 Housekeeping:** uncategorized/unapproved counts, spot-check pass rate.
   - **Action checklist:** numbered, ordered by severity, each item a concrete edit the user can make in YNAB/Xero — and naming the **account** the flagged transaction is on (read `account`) so the user can find it.
7. **Offer to save** the report to `reports/<YYYY-MM>-close.md` (gitignored).

## Rules

- One deduplicated report — a transaction flagged by two checks appears once, with both pieces of evidence.
- A category blowing its budget in `variance` is a *lead* about the books only when the underlying transactions look wrong; a correctly-categorized overspend is a spending fact, not a bookkeeping error. Say which one it is.
