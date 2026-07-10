---
name: receipts
description: Use when the user mentions receipts — has receipt images or PDFs to log, wants receipts extracted, categorized, or matched against transactions.
---

# Receipt processing

Turn receipt images/PDFs into ledger rows and match them to real transactions. Files flow `receipts/inbox/` → `receipts/processed/`; extracted data lands in `receipts/ledger.csv` (gitignored — it's the user's financial data).

## Steps

1. **Intake:** list `receipts/inbox/`. If empty, tell the user to drop images (jpg/png/heic) or PDFs there.
2. **Get data:** see `_shared/data-prep.md` — receipt matching reads the transaction cache.
3. **Extract — one file at a time.** Read the file directly (you can read images and PDFs natively). Pull out: date, merchant, total, currency, tax, payment method, and any line items worth noting. If a field is illegible, record `?` — never fabricate.
4. **Categorize:** see `_shared/data-prep.md` (load the real category list), then suggest one using the merchant type and — better — how this merchant's transactions are already categorized in the cache.
5. **Match against the books:**
   `node bin/bukz.mjs match --amount <total> --date <date> [--payee <merchant>]`
   - one `exact` hit → matched; record its id.
   - multiple hits → disambiguate by payee/account, or ask.
   - only `close` hits → likely tip/tax delta; say so.
   - nothing → **the receipt may be missing from the books** — this is the most valuable find; put it at the top of the report.
6. **Record:** append to `receipts/ledger.csv`, creating it with this header if missing:
   `date,merchant,amount,currency,category_suggested,payment_method,source_file,matched_txn_id,status,notes`
   (status: `matched` / `unmatched` / `needs-review`.)
7. **Archive:** move the file to `receipts/processed/` renamed `YYYY-MM-DD_<merchant-slug>_<amount>.<ext>`.
8. **Report:** one table for the batch (include each match's account, from the transaction's `account` field) + a callout list of unmatched receipts.

## Rules

- Never fabricate a value you can't read — `?` and `needs-review` exist for that.
- Amounts in the ledger are positive (receipts are documents); matching handles signs.
