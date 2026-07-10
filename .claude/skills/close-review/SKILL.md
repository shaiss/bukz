---
name: close-review
description: Use when the user asks for a month-end close, a full books review, a periodic checkup, or to "run the whole team" on their books.
---

# Close review — run the whole team

The full monthly checkup: every bukz check, one synthesized report, one action checklist.

## Steps

1. **Scope:** confirm the period (default: last full calendar month) and set `--since` accordingly — but run anomalies **without** `--since` too, because missing-recurring detection needs history.
2. **Pull fresh:** `node bin/bukz.mjs pull` (demo mode: `--in fixtures/sample.json` on the analysis commands instead).
3. **Run the team**, in this order:
   - `node bin/bukz.mjs anomalies`
   - `node bin/bukz.mjs mismatches`
   - `node bin/bukz.mjs uncategorized`
   - `node bin/bukz.mjs spot-check --per-category 3 --since <period start>`
4. **Apply each skill's triage judgment** (see the `anomalies`, `mismatches`, `triage`, and `spot-check` skills' guidance — same standards apply here).
5. **Synthesize one report** — not four:
   - **Header:** period, provider, data freshness, transaction count.
   - **🔴 Fix before closing:** likely errors (duplicates, wrong categories, sign errors, suspected missing entries).
   - **🟡 Verify:** plausible-but-unconfirmed (refunds, new payees, stopped recurrences).
   - **🟢 Housekeeping:** uncategorized/unapproved counts, spot-check pass rate.
   - **Action checklist:** numbered, ordered by severity, each item a concrete edit the user can make in YNAB/Xero — and naming the **account** the flagged transaction is on (read `account`) so the user can find it.
6. **Offer to save** the report to `reports/<YYYY-MM>-close.md` (gitignored).

## Rules

- One deduplicated report — a transaction flagged by two checks appears once, with both pieces of evidence.
- Flag, don't fix. NEVER read `.env`.
