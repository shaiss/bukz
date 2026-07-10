---
name: triage
description: Use when the user wants to categorize uncategorized transactions, clear unapproved transactions, or get to inbox-zero on their budget.
---

# Transaction triage

Propose categories for everything uncategorized, and review everything unapproved — the bookkeeper's inbox-zero.

## Steps

1. **Fresh data:** `node bin/bukz.mjs pull` if needed. Demo mode: `--in fixtures/sample.json`.
2. **List the inbox:** `node bin/bukz.mjs uncategorized` (output is capped at 100 rows per bucket; the `count` field has the true total — say if you're only seeing a page).
3. **Load the vocabulary:** `node bin/bukz.mjs categories` — only ever propose categories that actually exist in the user's budget.
4. **Propose a category for each uncategorized transaction:**
   - Best evidence: the same payee's categorized history elsewhere in the cache.
   - Next: merchant-type inference from the payee name and amount.
   - A bare "Check #204" is unknowable from data — put it in the ask-the-human pile, don't guess.
5. **Report** with confidence, ask-pile last. Include each transaction's `account` (show `—` if none) so the user can find the row in their app:

   | Date | Payee | Account | Amount | Proposed category | Confidence | Basis |

6. **Unapproved transactions:** flag any that also look mis-categorized or anomalous; otherwise list them briefly for one-click approval by the user in their app.

## Rules

- bukz is read-only — the user applies categories in YNAB/Xero (write-back is on the roadmap).
- Never invent a category name that isn't in the `categories` output.
- NEVER read `.env`.
