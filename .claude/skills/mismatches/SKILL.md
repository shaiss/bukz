---
name: mismatches
description: Use when the user wants to find miscategorized transactions, category mismatches, or payees whose transactions drifted into the wrong category.
---

# Category mismatch check

Finds payees that almost always land in one category, then flags the stragglers. High precision by design: a payee needs a ≥80% dominant category before its exceptions are questioned.

## Steps

1. **Fresh data:** `node bin/bukz.mjs pull` if needed. Demo mode: `--in fixtures/sample.json`.
2. **Scan:** `node bin/bukz.mjs mismatches` (tune: `--min-history 3 --dominance 0.8`, scope with `--since`).
3. **Judge each flagged outlier** — divergence is *sometimes correct*:
   - Netflix in "Groceries" once among six "Subscriptions": almost certainly wrong.
   - Costco in "Auto" once among "Groceries": plausibly correct — they sell tires. Check amount and memo before flagging.
   - A split transaction line in a different category is often deliberate.
4. **Report:**

   | Payee | Usual category (share) | Stray transaction | Its category | Verdict | Suggested fix |

5. **Know the tool's blind spot** and say it: payees with *no* dominant category (Amazon, Walmart, Target) are intentionally skipped here — reviewing those is the `spot-check` skill's job. Lowering `--dominance` to ~0.6 widens the net at the cost of noise.

## Rules

- Flag, don't fix — recommend the change; the human applies it in YNAB/Xero.
- NEVER read `.env`.
