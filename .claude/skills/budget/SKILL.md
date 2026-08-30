---
name: budget
description: Use when the user wants to do YNAB budget work — assign dollars to categories, fund next month, check month-ahead progress or Age of Money, review Ready to Assign, or asks "am I a month ahead?".
---

# Budget work — assign dollars, get a month ahead

The YNAB method's goal: by the time a month starts, it's already fully funded
with last month's income. bukz measures that and can do the assigning — with
the same confirm-first safety as every write.

## Steps

1. **Get data** per `_shared/data-prep.md` — a fresh pull matters: budget
   months, Age of Money, and goal targets only enter the cache via `pull`.
2. **Read the month-ahead picture:**

   ```sh
   node bin/bukz.mjs variance
   ```

   The `ahead` block: `focusMonth` (the lived-in month, from the data),
   `ageOfMoney` (30+ days = month-ahead territory), `readyToAssign`, and
   `next` — next month's `assigned` vs the `reference` (the last complete
   month's budget) with `fundedPct`. The dashboard's Variance tab shows the
   same numbers with a funded meter and per-category goal targets.
3. **Assign dollars** (DRY-RUN by default — always show the plan first):

   ```sh
   node bin/bukz.mjs assign --month 2026-09 --category "Groceries" --amount 400
   node bin/bukz.mjs assign --month 2026-09 --copy-from 2026-08   # fund like last month
   ```

   `--copy-from` proposes repeating the source month's budget — only the rows
   that differ — with `planTotal` and the target month's `readyToAssign`
   alongside. Surface the full table, note whether Ready to Assign can cover
   `planTotal`, then on the user's explicit OK re-run with `--yes`.
4. **After writing**, the local cache is refreshed automatically; a fresh
   `variance` confirms the new funding (or the user just refreshes the
   dashboard).

## Rules

- Amounts are the category's NEW budgeted total, not an increment — say so
  when showing the plan; a user thinking "add $100" gets their budget set to
  $100 otherwise.
- A category under its goal target is a lead, not a verdict — the user may be
  deliberately deferring. Present, don't push.
- Never batch `--yes` behind a vague approval: show the assignment table and
  get an explicit OK for exactly what will be written.
