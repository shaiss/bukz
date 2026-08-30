---
name: weekly-checkpoint
description: Use when the user asks for the weekly checkpoint, a weekly bookkeeping status report, next-two-weeks cash coverage, or "how do the books look this week".
---

# Weekly checkpoint — the weekly deliverable

One report, same shape every week: balances per account, an autopay check,
14-day cash coverage with 🔴/🟡/🟢 per account, flags, and next actions for the
client. This is the bookkeeper's weekly status row, assembled from bukz output.

## Steps

1. **Scope:** the checkpoint date (default: today). Get data per
   `_shared/data-prep.md` — a **fresh pull matters here**: balances and budget
   snapshots only enter the cache via `pull`.
2. **Run the numbers** (all read-only):

   ```sh
   node bin/bukz.mjs balances
   node bin/bukz.mjs outlook                # 14-day projection; --days N to widen
   node bin/bukz.mjs anomalies              # unfiltered — the detectors need full
                                            # history (recurring gaps especially);
                                            # triage flags touching this week
   node bin/bukz.mjs uncategorized
   ```

   Demo mode: add `--in fixtures/sample.json --bills fixtures/bills.json` (the
   bills registry is separate from the transaction cache).
3. **Render the checkpoint table** — one row per account:
   - **Balance** from `balances` (`meta.pulledAt` is the as-of time — say it).
   - **14-day coverage**: 🔴/🟡/🟢 from `outlook.accounts[].status`, showing
     `projectedOutflows` and `projectedBalance` next to each light.
   - **The overall cell**: `outlook.status` — green only when every account is
     green. That single cell answers "am I at cashflow risk over the next 14 days?".
4. **Fill the flag columns:**
   - *All autopays OK?* — red/yellow accounts with autopay bills due are the
     risk. `outlook.unmatchedBills` means a bill's `paidFrom` name matches no
     cached account (glossary drift) — fix the name in `config/bills.json`;
     don't silently drop the bill.
   - *Manual payments due soon* — `outlook.manualWatch` (non-autopay bills due
     within 30 days).
   - *Anomalies / flags* — triage the `anomalies` buckets the way the
     `anomalies` skill does; surface only real leads, each with its **account**.
5. **Next actions for the client:** a short numbered list — cover cash in
   red/yellow accounts (name the account and the bill), answer anomaly leads,
   and clear uncategorized rows if the count grew.
6. **Offer to save** the checkpoint to `reports/<YYYY-MM-DD>-checkpoint.md`
   (gitignored), so weeks can be diffed later.

## Rules

- The traffic lights are computed by `outlook` — surface them as they are. If
  you disagree with one (e.g. a credit card's negative balance is its normal
  paid-in-full pattern), say so *next to* the light; never adjust the number.
- Bills change. When the user says a bill's amount/cadence/paying account
  changed, offer to edit `config/bills.json` — show the planned edit first.
  It's a local registry file, not their books, but they still confirm changes.
