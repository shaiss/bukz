---
name: anomalies
description: Use when the user wants to find anomalies, unusual or suspicious transactions, duplicate charges, missing recurring payments, or asks "does anything look off" about their books.
---

# Anomaly review

The CLI flags candidates mechanically; **your job is triage** — separating plausible-benign from needs-human-review using payee context the math can't see.

## Steps

1. **Fresh data:** `node bin/bukz.mjs pull` if the cache is missing/stale. Demo mode: `--in fixtures/sample.json`.
2. **Scan:** `node bin/bukz.mjs anomalies` (tune: `--z 3.5 --window 3 --top 5`, scope with `--since`).
3. **Triage each bucket:**
   - `duplicates` — same payee+amount within the window. Two coffees in a weekend: benign. A subscription, rent, or insurance premium twice: almost certainly a double charge.
   - `amountOutliers` — robust z-score vs. the payee's own history. Note: on perfectly-flat histories (fixed subscriptions), any change >~35% also flags — that's often a price hike, worth telling the user about either way.
   - `signFlips` — money-in from a usually money-out payee. Usually a refund (fine, confirm it was expected); occasionally a sign error at entry (not fine).
   - `missingRecurring` — steady cadence gone quiet. Three stories: cancelled service (fine), failed payment (bad), missed entry (bookkeeping bug). Ask which.
   - `newLargePayees` — first-ever payee with a top-decile amount. Fraud check: "did you expect this?"
   - `largest` — top amounts, context for everything above.
4. **Report** severity-ordered. Every finding must name which **account** its transaction(s) are on (read the `account` field) — this is load-bearing context, not decoration: a "duplicate" across two different accounts is usually *not* a duplicate, and knowing the card narrows the search. For payee-level findings that span accounts, list them or say "mixed":

   | Severity | Account | Issue | Evidence | Likely explanation | Recommended action |

   End with the `uncategorizedCount` / `unapprovedCount` line and suggest the `triage` skill if either is nonzero.

## Rules

- Every flag is a *lead*, not a verdict — never present a flag as a confirmed error.
- Flag, don't fix. NEVER read `.env`.
